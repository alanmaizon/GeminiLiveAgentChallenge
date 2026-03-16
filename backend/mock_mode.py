"""
Mock mode: realistic streaming responses without a Gemini API key.
Follows the same message protocol as the live backend.
"""

import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import AsyncGenerator, Any

from models import (
    SessionStartedMessage,
    StatusMessage,
    TextDeltaMessage,
    TextDoneMessage,
    ToolCallMessage,
    ToolResultMessage,
    LogMessage,
)
from tools import execute_tool_mock

# ── Mock response corpus ──────────────────────────────────────────────────────

MOCK_RESPONSES = {
    "hello": (
        "Χαῖρε! I am Logos (ΛΟΓΟΣ), your Ancient Greek scholarly companion. "
        "I am here to help you navigate the beauty and complexity of Ancient Greek — "
        "from the Homeric epics to Attic prose, from Koine scripture to inscriptions "
        "on stone. You may speak to me, type, or show me images of texts.\n\n"
        "How may I assist you today? Perhaps you wish to read a passage, parse a verb, "
        "or hear the pronunciation of a word? The world of Ancient Greek is vast — "
        "let us explore it together."
    ),
    "iliad": (
        "Μῆνιν ἄειδε θεά, Πηληϊάδεω Ἀχιλῆος...\n\n"
        "The Iliad opens with one of the most celebrated lines in all of world literature. "
        "Homer commands the goddess (Muse) to 'sing the wrath of Achilles, son of Peleus.' "
        "The very first word — μῆνιν (mēnin), 'wrath' — arrives in the accusative case, "
        "the direct object of the imperative ἄειδε. This is no accident: Homer places "
        "the central theme of the entire epic at the very front of the sentence.\n\n"
        "The μῆνις of Achilles is not ordinary anger (θυμός). It is a sustained, divine-like "
        "wrath — the kind that only heroes and gods can sustain — with catastrophic consequences "
        "for both Greeks and Trojans alike."
    ),
    "parse": (
        "Of course! I will parse that word for you.\n\n"
        "Let me invoke my morphological analysis tool..."
    ),
    "pronunciation": (
        "Excellent question! Ancient Greek pronunciation — specifically reconstructed "
        "Attic pronunciation (sometimes called 'Erasmian') — differs significantly from "
        "Modern Greek.\n\n"
        "For ἄνθρωπος (ánthrōpos, 'human being'):\n"
        "IPA: /án.tʰrɔː.pos/\n\n"
        "Key features to note:\n"
        "• ἄ — short alpha, like English 'father' but shorter\n"
        "• ν — standard nasal\n"
        "• θ — aspirated 't', like 't' followed by a puff of air (not 'th' as in 'the')\n"
        "• ρ — trilled or tapped 'r'\n"
        "• ω — long 'o', like sustained 'aw' in British English\n"
        "• π — unaspirated 'p', softer than English 'p'\n"
        "• ος — short 'o' + 's'\n\n"
        "The accent mark (ά) indicates the pitch accent — a rise in musical pitch, "
        "not stress as in English."
    ),
    "image": (
        "I can see the image you have shared. This appears to be a page of Ancient Greek text. "
        "Let me attempt a transcription and analysis...\n\n"
        "The text appears to be from a manuscript tradition, written in a clear hand. "
        "I can make out several words in polytonic Unicode form. The script style suggests "
        "this may be from a printed critical edition or a medieval manuscript copy.\n\n"
        "Note: In live mode with camera access, I can perform detailed optical recognition "
        "and provide precise transcription, dialect identification, and textual criticism."
    ),
    "default": (
        "That is a fascinating question touching on the heart of Ancient Greek studies. "
        "Greek is not merely a language — it is a civilization encoded in phonemes and morphemes. "
        "Every ending carries information: who acts, who is acted upon, when, how, and in what "
        "mood. No other language in the Western tradition matches its precision.\n\n"
        "Allow me to address your question directly. In Attic Greek — the dialect of Plato, "
        "Thucydides, and the tragedians — we find the most refined literary expression in "
        "antiquity. The vocabulary is rich with philosophical precision, the syntax demanding "
        "of careful attention, and the style capable of extraordinary subtlety.\n\n"
        "Shall we look at a specific passage or grammatical point?"
    ),
}


def _classify_input(text: str) -> str:
    """Return a key for selecting the appropriate mock response."""
    text_lower = text.lower()
    if any(w in text_lower for w in ["hello", "hi", "χαῖρε", "start", "begin"]):
        return "hello"
    if any(w in text_lower for w in ["iliad", "homer", "μῆνιν", "μηνιν", "achilles"]):
        return "iliad"
    if any(w in text_lower for w in ["parse", "morphol", "verb", "noun", "declens"]):
        return "parse"
    if any(w in text_lower for w in ["pronounc", "ipa", "sound", "say"]):
        return "pronunciation"
    if any(w in text_lower for w in ["image", "photo", "picture", "see", "camera"]):
        return "image"
    return "default"


async def stream_mock_response(
    text: str,
    chunk_size: int = 3,
    delay_ms: int = 30,
) -> AsyncGenerator[str, None]:
    """Yield text in small chunks with a delay to simulate streaming."""
    for i in range(0, len(text), chunk_size):
        yield text[i : i + chunk_size]
        await asyncio.sleep(delay_ms / 1000)


async def handle_mock_session(
    websocket: Any,
    message: dict[str, Any],
) -> None:
    """Process one client message and send appropriate mock responses."""

    async def send(msg: Any) -> None:
        if hasattr(msg, "model_dump"):
            await websocket.send_text(json.dumps(msg.model_dump()))
        else:
            await websocket.send_text(json.dumps(msg))

    msg_type = message.get("type")
    now = datetime.now(timezone.utc).isoformat()

    if msg_type == "session.start":
        await asyncio.sleep(0.5)  # Simulate connection delay
        await send(StatusMessage(state="connecting"))
        await asyncio.sleep(0.3)
        session_id = f"mock-{uuid.uuid4().hex[:8]}"
        await send(SessionStartedMessage(session_id=session_id))
        await send(StatusMessage(state="live"))
        await send(LogMessage(event="session.started", data={"session_id": session_id}, timestamp=now))
        return

    if msg_type == "session.end":
        from models import SessionEndedMessage
        await send(SessionEndedMessage())
        await send(StatusMessage(state="ended"))
        return

    if msg_type == "input.interrupt":
        await send(LogMessage(event="input.interrupt", timestamp=now))
        return

    # Determine response text
    if msg_type == "input.text":
        user_text = message.get("text", "")
    elif msg_type == "input.audio":
        user_text = "hello"  # Treat audio as a generic hello in mock mode
    elif msg_type == "input.image":
        user_text = "image"
    else:
        return

    response_key = _classify_input(user_text)
    response_text = MOCK_RESPONSES[response_key]

    # Occasionally inject a tool call for parse requests
    should_parse = response_key == "parse" or "parse" in user_text.lower()
    parse_word = "μῆνιν"  # Default demo word

    if should_parse:
        # Emit partial text first
        preamble = "Of course! I will parse that word for you.\n\nLet me invoke my morphological analysis tool..."
        full = ""
        async for chunk in stream_mock_response(preamble):
            await send(TextDeltaMessage(delta=chunk))
            full += chunk

        await asyncio.sleep(0.3)

        # Emit tool call
        call_id = f"call-{uuid.uuid4().hex[:8]}"
        await send(ToolCallMessage(
            tool_name="parse_greek",
            args={"word": parse_word, "context": user_text},
            call_id=call_id,
        ))
        await asyncio.sleep(0.4)

        # Execute mock tool
        result = execute_tool_mock("parse_greek", {"word": parse_word})
        await send(ToolResultMessage(call_id=call_id, result=result))
        await asyncio.sleep(0.2)

        # Continue with explanation
        explanation = (
            f"\n\nHere is the full analysis:\n"
            f"**{result.get('word', parse_word)}** → {result.get('lemma', '—')} "
            f"({result.get('transliteration', '')})\n"
            f"• {result.get('part_of_speech', '')}, {result.get('case', result.get('mood', ''))}, "
            f"{result.get('number', '')}\n"
            f"• Meaning: \"{result.get('definition', '')}\""
        )
        async for chunk in stream_mock_response(explanation):
            await send(TextDeltaMessage(delta=chunk))
            full += chunk

        await send(TextDoneMessage(full_text=full + explanation))
    else:
        # Plain streaming response
        full = ""
        async for chunk in stream_mock_response(response_text):
            await send(TextDeltaMessage(delta=chunk))
            full += chunk
        await send(TextDoneMessage(full_text=full))

    await send(LogMessage(event="output.done", data={"chars": len(response_text)}, timestamp=now))
