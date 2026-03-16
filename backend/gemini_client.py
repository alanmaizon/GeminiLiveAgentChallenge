"""
Gemini Live API integration for Logos.

Manages a bidirectional streaming session with the Gemini Live API,
forwarding events to the frontend via WebSocket.
"""

import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from config import settings
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


async def run_gemini_session(
    websocket: Any,
    config: dict[str, Any],
) -> None:
    """
    Open a Gemini Live session and bridge messages between the WebSocket client
    and the Gemini API.
    """
    # GEMINI_LIVE: import google-genai SDK
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=settings.gemini_api_key)

    system_instruction = config.get("system_instruction", "")
    session_id = f"live-{uuid.uuid4().hex[:8]}"

    async def send(msg: Any) -> None:
        if hasattr(msg, "model_dump"):
            await websocket.send_text(json.dumps(msg.model_dump()))
        else:
            await websocket.send_text(json.dumps(msg))

    now = lambda: datetime.now(timezone.utc).isoformat()  # noqa: E731

    # ── Build LiveConnectConfig ──────────────────────────────────────────────
    # GEMINI_LIVE: adjust config fields to match exact SDK version
    live_config = types.LiveConnectConfig(
        response_modalities=["TEXT", "AUDIO"],
        system_instruction=types.Content(
            parts=[types.Part(text=system_instruction)]
        ) if system_instruction else None,
        tools=[
            types.Tool(
                function_declarations=[
                    types.FunctionDeclaration(**decl) for decl in TOOL_DECLARATIONS
                ]
            )
        ],
    )

    await send(StatusMessage(state="connecting"))

    try:
        async with client.aio.live.connect(
            model=settings.gemini_model,
            config=live_config,
        ) as session:
            await send(SessionStartedMessage(session_id=session_id))
            await send(StatusMessage(state="live"))
            await send(LogMessage(event="session.started", data={"session_id": session_id}, timestamp=now()))

            # Queue for messages coming from the browser WebSocket
            input_queue: asyncio.Queue[Optional[dict[str, Any]]] = asyncio.Queue()

            async def receive_from_client() -> None:
                """Read browser messages and enqueue them."""
                while True:
                    try:
                        raw = await websocket.receive_text()
                        msg = json.loads(raw)
                        await input_queue.put(msg)
                    except Exception:
                        await input_queue.put(None)  # Signal disconnect
                        break

            async def send_to_gemini() -> None:
                """Forward browser messages to the Gemini session."""
                while True:
                    msg = await input_queue.get()
                    if msg is None:
                        break

                    msg_type = msg.get("type")

                    if msg_type == "session.end":
                        await input_queue.put(None)
                        break

                    if msg_type == "input.text":
                        # GEMINI_LIVE: send text turn
                        await session.send(input=msg["text"], end_of_turn=True)

                    elif msg_type == "input.audio":
                        # GEMINI_LIVE: send PCM audio chunk
                        import base64
                        pcm_data = base64.b64decode(msg["audio"])
                        await session.send(
                            input=types.LiveClientRealtimeInput(
                                media_chunks=[
                                    types.Blob(
                                        data=pcm_data,
                                        mime_type="audio/pcm;rate=16000",
                                    )
                                ]
                            )
                        )

                    elif msg_type == "input.image":
                        # GEMINI_LIVE: send image for multimodal input
                        import base64
                        image_data = base64.b64decode(msg["image"])
                        mime = msg.get("mime_type", "image/jpeg")
                        await session.send(
                            input=types.LiveClientRealtimeInput(
                                media_chunks=[
                                    types.Blob(data=image_data, mime_type=mime)
                                ]
                            ),
                            end_of_turn=True,
                        )

                    elif msg_type == "input.interrupt":
                        # GEMINI_LIVE: signal interruption — close/reopen or send interrupt
                        await send(LogMessage(event="input.interrupt", timestamp=now()))

                    await send(LogMessage(event=msg_type, timestamp=now()))

            async def receive_from_gemini() -> None:
                """Forward Gemini responses to the browser."""
                current_text = ""
                async for response in session.receive():
                    # Text token
                    if response.text:
                        await send(TextDeltaMessage(delta=response.text))
                        current_text += response.text

                    # Audio chunk
                    if response.data:
                        # GEMINI_LIVE: response.data is raw PCM bytes
                        audio_b64 = pcm_to_base64(response.data)
                        await send(AudioDeltaMessage(audio=audio_b64))

                    # Tool call
                    if response.tool_call:
                        for fc in response.tool_call.function_calls:
                            call_id = fc.id or f"call-{uuid.uuid4().hex[:8]}"
                            args = dict(fc.args) if fc.args else {}

                            await send(ToolCallMessage(
                                tool_name=fc.name,
                                args=args,
                                call_id=call_id,
                            ))

                            # Execute the tool
                            result = await execute_tool_live(fc.name, args, client)

                            await send(ToolResultMessage(call_id=call_id, result=result))
                            await send(LogMessage(
                                event="tool.executed",
                                data={"tool": fc.name, "call_id": call_id},
                                timestamp=now(),
                            ))

                            # Return result to Gemini
                            await session.send(
                                input=types.LiveClientToolResponse(
                                    function_responses=[
                                        types.FunctionResponse(
                                            name=fc.name,
                                            id=fc.id,
                                            response={"result": result},
                                        )
                                    ]
                                )
                            )

                    # Turn complete
                    if getattr(response, "server_content", None) and \
                            getattr(response.server_content, "turn_complete", False):
                        if current_text:
                            await send(TextDoneMessage(full_text=current_text))
                            current_text = ""
                        await send(AudioDoneMessage())

            # Run client→Gemini and Gemini→client concurrently
            client_task = asyncio.create_task(receive_from_client())
            send_task = asyncio.create_task(send_to_gemini())
            recv_task = asyncio.create_task(receive_from_gemini())

            await asyncio.gather(client_task, send_task, recv_task, return_exceptions=True)

    except Exception as exc:
        await send(ErrorMessage(message=str(exc), code="GEMINI_ERROR"))
        await send(StatusMessage(state="error"))
    finally:
        await send(SessionEndedMessage())
        await send(StatusMessage(state="ended"))
        await send(LogMessage(event="session.ended", timestamp=now()))
