"""
Gemini Live API integration for Logos.

SDK: google-genai >= 1.67.0
Docs: https://pypi.org/project/google-genai/

Auth modes:
  Vertex AI   — genai.Client(vertexai=True, project=..., location=...)
                Uses Application Default Credentials (ADC).
                Enable by setting GCP_PROJECT_ID.
  AI Studio   — genai.Client(api_key=...)
                Enable by setting GEMINI_API_KEY.

Session methods used (non-deprecated):
  session.send_client_content()  — turn-based text / inline images
  session.send_realtime_input()  — real-time audio or video blobs
                                   ONE named parameter per call (audio, video, or text)
                                   Do NOT interleave with send_client_content
  session.send_tool_response()   — return function-call results to the model
"""

import asyncio
import base64
import json
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from config import settings, USE_VERTEX_AI
from models import (
    SessionStartedMessage,
    SessionEndedMessage,
    StatusMessage,
    TextDeltaMessage,
    TextDoneMessage,
    AudioDeltaMessage,
    AudioDoneMessage,
    ToolCallMessage,
    ToolResultMessage,
    ErrorMessage,
    LogMessage,
)
from tools import TOOL_DECLARATIONS, execute_tool_live
from audio import pcm_to_base64


def _build_client() -> Any:
    """Return a google-genai Client for Vertex AI or AI Studio."""
    from google import genai  # type: ignore[import]

    if USE_VERTEX_AI:
        return genai.Client(
            vertexai=True,
            project=settings.gcp_project_id,
            location=settings.gcp_region,
        )
    return genai.Client(
        api_key=settings.gemini_api_key,
        http_options={"api_version": "v1"},
    )


async def run_gemini_session(
    websocket: Any,
    config: dict[str, Any],
) -> None:
    from google.genai import types  # type: ignore[import]

    client = _build_client()
    system_instruction = config.get("system_instruction", "")
    session_id = f"live-{uuid.uuid4().hex[:8]}"

    async def send(msg: Any) -> None:
        if hasattr(msg, "model_dump"):
            await websocket.send_text(json.dumps(msg.model_dump()))
        else:
            await websocket.send_text(json.dumps(msg))

    def now() -> str:
        return datetime.now(timezone.utc).isoformat()

    # ── LiveConnectConfig ────────────────────────────────────────────────────
    # Tools passed as raw dicts — avoids having to construct Schema objects
    # manually and is fully supported by the SDK.
    live_config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=(
            types.Content(parts=[types.Part(text=system_instruction)])
            if system_instruction
            else None
        ),
        tools=[{"function_declarations": TOOL_DECLARATIONS}],
    )

    await send(StatusMessage(state="connecting"))

    try:
        async with client.aio.live.connect(
            model=settings.gemini_model,
            config=live_config,
        ) as session:
            await send(SessionStartedMessage(session_id=session_id))
            await send(StatusMessage(state="live"))
            await send(LogMessage(
                event="session.started",
                data={"session_id": session_id, "vertex_ai": USE_VERTEX_AI},
                timestamp=now(),
            ))

            # True when the session is using send_realtime_input (audio mode).
            # False when using send_client_content (text / image mode).
            # We track this to avoid the SDK's interleaving restriction.
            _in_realtime_mode = False
            input_queue: asyncio.Queue[Optional[dict[str, Any]]] = asyncio.Queue()

            async def receive_from_client() -> None:
                while True:
                    try:
                        raw = await websocket.receive_text()
                        await input_queue.put(json.loads(raw))
                    except Exception:
                        await input_queue.put(None)
                        break

            async def send_to_gemini() -> None:
                nonlocal _in_realtime_mode
                while True:
                    msg = await input_queue.get()
                    if msg is None:
                        break

                    msg_type: Optional[str] = msg.get("type")

                    if msg_type == "session.end":
                        await input_queue.put(None)
                        break

                    elif msg_type == "input.text":
                        # Turn-based text — use send_client_content.
                        # Note: do not mix with send_realtime_input in the
                        # same conversation (SDK restriction).
                        _in_realtime_mode = False
                        await session.send_client_content(
                            turns=msg["text"],
                            turn_complete=True,
                        )

                    elif msg_type == "input.audio":
                        # Real-time audio — use send_realtime_input with
                        # the `audio` named parameter (ONE param per call).
                        _in_realtime_mode = True
                        pcm_data = base64.b64decode(msg["audio"])
                        await session.send_realtime_input(
                            audio=types.Blob(
                                data=pcm_data,
                                mime_type="audio/pcm;rate=16000",
                            )
                        )

                    elif msg_type == "input.image":
                        # Images are turn-based — bundle image + instruction
                        # in a single send_client_content call to avoid the
                        # interleaving restriction.
                        _in_realtime_mode = False
                        image_data = base64.b64decode(msg["image"])
                        mime = msg.get("mime_type", "image/jpeg")
                        content = types.Content(
                            role="user",
                            parts=[
                                types.Part(
                                    inline_data=types.Blob(
                                        data=image_data, mime_type=mime
                                    )
                                ),
                                types.Part(
                                    text=(
                                        "Please describe, transcribe, and analyze "
                                        "this image in the context of Ancient Greek "
                                        "scholarship."
                                    )
                                ),
                            ],
                        )
                        await session.send_client_content(
                            turns=content,
                            turn_complete=True,
                        )

                    elif msg_type == "input.interrupt":
                        # Force a new empty turn — this preempts whatever the model
                        # is currently generating, giving a "barge-in" effect.
                        await session.send_client_content(turns=[], turn_complete=True)
                        await send(LogMessage(event="input.interrupt", timestamp=now()))

                    if msg_type:
                        await send(LogMessage(event=msg_type, timestamp=now()))

            async def receive_from_gemini() -> None:
                current_text = ""
                async for response in session.receive():
                    # ── Diagnostic: emit raw event type to inspector ─────────
                    if getattr(response, "setup_complete", None):
                        await send(LogMessage(event="gemini.setup_complete", timestamp=now()))
                        continue  # Nothing to forward; session is ready

                    # Determine and log the top-level event type.
                    # LiveServerMessage schema:
                    #   .server_content.model_turn.parts  → text / audio parts
                    #   .server_content.turn_complete     → end-of-turn flag
                    #   .tool_call.function_calls         → function call list
                    if getattr(response, "server_content", None) is not None:
                        evt = "gemini.server_content"
                    elif getattr(response, "tool_call", None) is not None:
                        evt = "gemini.tool_call"
                    else:
                        evt = "gemini.unknown"
                    await send(LogMessage(event=evt, timestamp=now()))

                    # ── server_content: text + turn_complete (SDK ≥ 1.67) ────
                    # Text is aggregated at server_content.text; audio is
                    # delivered separately via response.media (not via parts).
                    server_content = getattr(response, "server_content", None)
                    if server_content is not None:
                        text = getattr(server_content, "text", None)
                        if text:
                            await send(TextDeltaMessage(delta=text))
                            current_text += text

                        if getattr(server_content, "turn_complete", False):
                            if current_text:
                                await send(TextDoneMessage(full_text=current_text))
                                current_text = ""
                            await send(AudioDoneMessage())

                    # ── Audio: response.media (SDK ≥ 1.67) ───────────────────
                    media = getattr(response, "media", None)
                    if media:
                        audio_bytes = getattr(media[0], "data", None)
                        if audio_bytes:
                            await send(AudioDeltaMessage(audio=pcm_to_base64(audio_bytes)))

                    # ── Tool / function call ─────────────────────────────────
                    tool_call = getattr(response, "tool_call", None)
                    if tool_call is not None:
                        for fc in (getattr(tool_call, "function_calls", None) or []):
                            call_id: str = getattr(fc, "id", None) or f"call-{uuid.uuid4().hex[:8]}"
                            args: dict[str, Any] = dict(fc.args) if getattr(fc, "args", None) else {}

                            await send(ToolCallMessage(
                                tool_name=fc.name,
                                args=args,
                                call_id=call_id,
                            ))

                            result = await execute_tool_live(fc.name, args, client)

                            await send(ToolResultMessage(call_id=call_id, result=result))
                            await send(LogMessage(
                                event="tool.executed",
                                data={"tool": fc.name, "call_id": call_id},
                                timestamp=now(),
                            ))

                            # Return the tool result to Gemini using typed objects.
                            await session.send_tool_response(
                                function_responses=types.LiveClientToolResponse(
                                    function_responses=[
                                        types.FunctionResponse(
                                            name=fc.name,
                                            id=call_id,
                                            response={"output": result},
                                        )
                                    ]
                                )
                            )

            client_task = asyncio.create_task(receive_from_client())
            send_task = asyncio.create_task(send_to_gemini())
            recv_task = asyncio.create_task(receive_from_gemini())

            results = await asyncio.gather(
                client_task, send_task, recv_task, return_exceptions=True
            )
            for res in results:
                if isinstance(res, Exception):
                    import traceback as tb
                    tb.print_exception(type(res), res, res.__traceback__)
                    await send(LogMessage(
                        event="task.error",
                        data={"error": str(res)},
                        timestamp=now(),
                    ))

    except Exception as exc:
        await send(ErrorMessage(message=str(exc), code="GEMINI_ERROR"))
        await send(StatusMessage(state="error"))
    finally:
        await send(SessionEndedMessage())
        await send(StatusMessage(state="ended"))
        await send(LogMessage(event="session.ended", timestamp=now()))
