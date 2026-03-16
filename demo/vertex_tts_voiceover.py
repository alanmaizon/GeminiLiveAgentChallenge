"""
vertex_tts_voiceover.py
=======================
Generate a WAV voiceover for the Logos demo video using the Vertex AI
Gemini TTS API (google-genai SDK).

Requirements:
    pip install google-genai

Usage:
    export GOOGLE_CLOUD_PROJECT="your-project-id"
    export GOOGLE_CLOUD_REGION="global"      # or us-central1, etc.
    python vertex_tts_voiceover.py

Env overrides (all optional):
    GOOGLE_CLOUD_PROJECT   — GCP project ID (required)
    GOOGLE_CLOUD_REGION    — Vertex AI region  (default: global)
    VERTEX_TTS_MODEL       — model ID          (default: gemini-2.5-flash-tts)
    VERTEX_TTS_VOICE       — prebuilt voice    (default: Kore)
    VERTEX_TTS_LANGUAGE    — BCP-47 language   (default: en-US)
    VERTEX_TTS_STYLE       — style/persona prompt
    VOICEOVER_TEXT_FILE    — path to .txt file (default: voiceover.txt)
    VOICEOVER_OUTPUT       — output WAV path   (default: voiceover.wav)

Mux with the silent demo video:
    ffmpeg -i demo-output/<video>.webm \\
           -i voiceover.wav \\
           -c:v copy -c:a aac -shortest \\
           demo-output/final-demo-with-voiceover.mp4
"""

import os
import wave
from pathlib import Path

from google import genai
from google.genai import types

PROJECT_ID    = os.getenv("GOOGLE_CLOUD_PROJECT")
LOCATION      = os.getenv("GOOGLE_CLOUD_REGION", "global")
MODEL         = os.getenv("VERTEX_TTS_MODEL",    "gemini-2.5-flash-tts")
VOICE         = os.getenv("VERTEX_TTS_VOICE",    "Kore")
LANGUAGE_CODE = os.getenv("VERTEX_TTS_LANGUAGE", "en-US")
INPUT_FILE    = os.getenv("VOICEOVER_TEXT_FILE", "voiceover.txt")
OUTPUT_WAV    = os.getenv("VOICEOVER_OUTPUT",    "voiceover.wav")

STYLE_PROMPT = os.getenv(
    "VERTEX_TTS_STYLE",
    "Read this as a polished product demo voiceover. "
    "Calm, confident, articulate, medium pace, lightly cinematic, "
    "clear technical diction, natural pauses between sections.",
)


def write_wav(
    filename: str,
    pcm_data: bytes,
    channels: int = 1,
    rate: int = 24_000,
    sample_width: int = 2,
) -> None:
    with wave.open(filename, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(sample_width)
        wf.setframerate(rate)
        wf.writeframes(pcm_data)


def main() -> None:
    if not PROJECT_ID:
        raise RuntimeError("Set GOOGLE_CLOUD_PROJECT before running.")

    text_path = Path(INPUT_FILE)
    if not text_path.exists():
        raise FileNotFoundError(f"Missing voiceover text file: {text_path}")

    script_text = text_path.read_text(encoding="utf-8").strip()
    if not script_text:
        raise ValueError("voiceover text file is empty.")

    print(f"Synthesising via {MODEL} / voice={VOICE} …")

    client = genai.Client(vertexai=True, project=PROJECT_ID, location=LOCATION)

    response = client.models.generate_content(
        model=MODEL,
        contents=f"{STYLE_PROMPT}: {script_text}",
        config=types.GenerateContentConfig(
            speech_config=types.SpeechConfig(
                language_code=LANGUAGE_CODE,
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name=VOICE
                    )
                ),
            ),
            temperature=1.2,
        ),
    )

    audio_bytes = response.candidates[0].content.parts[0].inline_data.data
    write_wav(OUTPUT_WAV, audio_bytes)
    print(f"✓  Saved voiceover: {OUTPUT_WAV}")
    print(f"   ({len(audio_bytes):,} bytes of PCM 16-bit 24 kHz mono)")


if __name__ == "__main__":
    main()
