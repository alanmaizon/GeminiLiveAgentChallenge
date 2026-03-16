# Demo Script — ΛΟΓΟΣ (4 minutes)

## Setup (before recording)
- Backend running (mock mode or live)
- Frontend at localhost:3000
- Prepare: a photo of a printed Greek text (e.g. Iliad opening lines)
- System instructions: default (pre-populated)

---

## 0:00–0:30 — Introduction
**Show the console in disconnected state.**

> "This is Logos — a realtime Ancient Greek scholarly console. No text boxes, no static Q&A. You speak, you show, and it responds live."

Point to the three feature cards:
- "Speak to Logos" — voice-first interaction
- "Show Logos" — camera for visual recognition
- "Share your text" — type or paste passages

> "Let's start a session."

Click **Start session**. Watch the connection status dot pulse amber → green.

---

## 0:30–1:30 — Voice Interaction + Tool Calling
**Type (or speak):** "Can you parse the word μῆνιν for me?"

Watch streaming tokens appear in the transcript.

> "Notice the response streaming token by token — no waiting for a complete answer."

Open the **Inspector** (terminal icon, top right).

> "Here's the event log. And watch — when Logos calls the parse_greek tool..."

Point to the tool call appearing in the inspector with args and result.

**The parse card appears inline in the transcript:**
```
μῆνιν → μῆνις (mēnin)
  Part of Speech: Noun, Feminine
  Case: Accusative Singular
  Meaning: "wrath, rage"
```

> "Structured morphological output, rendered right in the conversation. Not just text — structured data from a function call."

---

## 1:30–2:30 — Visual Recognition
Switch to camera. Click the **camera icon** in the composer bar.

Hold up (or screen-share) a printed page with the opening of the Iliad.

Click **capture & send**.

Watch the image appear inline in the transcript, followed by streaming analysis.

> "Logos can read manuscripts, inscriptions, even printed textbook pages. This is the 'see' in see, hear, speak."

**Mid-response, type:** "Wait — what does μῆνιν mean exactly?"

> "And it handles interruption. The [interrupted] marker appears. Logos gracefully pivots."

---

## 2:30–3:30 — Close Reading / Teaching Mode
**Type:** "Let's do a close reading of the opening line: μῆνιν ἄειδε θεά, Πηληϊάδεω Ἀχιλῆος"

Watch Logos maintain context across follow-up questions:

**Follow-up:** "Why is μῆνιν in the accusative?"

**Follow-up:** "What is the significance of placing that word first?"

> "Logos tracks which passage we're in. Every follow-up builds on the previous context."

**Type:** "Can you scan the meter?"

Watch the scan_meter tool call in the inspector, and the scansion pattern in the response.

---

## 3:30–4:00 — Architecture + Close
Switch to architecture diagram (or show architecture.md).

> "Next.js frontend, FastAPI backend on Cloud Run, Gemini Live API. Tool-calling gives us structured outputs — morphology tables, lexicon entries, scansion — rendered as rich cards, not just text."

> "Logos breaks the text-box paradigm. It's a live, multimodal scholarly companion — the tool Ancient Greek learners have never had."

Click **End session**.

---

## The "Wow" Moment (if time allows)
Hold up a photo of a Homer page.
- Logos reads it via camera
- Identifies the passage (Iliad I.1)
- Recites the opening with pronunciation
- Parses μῆνιν
- Explains the significance

All in streaming realtime, with tool calls visible in the inspector.
