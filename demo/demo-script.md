# Demo Script — ΛΟΓΟΣ (4 minutes)

## Setup (before recording)
- Backend running (mock mode or live)
- Frontend at localhost:3000
- Prepare: a photo of a printed Greek text (e.g. Iliad opening lines)
- Difficulty selector set to **Intermediate** (default)

---

## 0:00–0:30 — Introduction
**Show the console in disconnected state.**

> "This is Logos — a realtime Ancient Greek scholarly console. No text boxes, no static Q&A. You speak, you show, and it responds live."

Point to the welcome screen features:
- **Voice** — speak in natural English, ask about any Greek text
- **Camera** — hold up a manuscript, inscription, or printed page
- **Passage mode** — pin a text for close reading; Logos tracks it across turns

> "Let's start a session."

Click **Start session**. Watch the status dot pulse amber → green.

---

## 0:30–1:30 — Voice Interaction + Tool Calling
**Type (or speak):** "Can you parse the word μῆνιν for me?"

Watch streaming tokens appear in the transcript.

> "Notice the response streaming in real time — and more importantly, watch the tool call."

Open the **Inspector** (terminal icon, top right).

> "Logos called parse_greek as a function — structured data, not guesswork."

Point to the **ParseCard** that appears inline in the transcript:
```
μῆνιν  →  μῆνις
         (mēnin)          ← shown visually in the card
Part of Speech: Noun, Feminine
Case: Accusative Singular
Meaning: "wrath, rage"
```

> "Transliteration appears in the card but is never spoken aloud — the UI handles the visual layer, the voice handles the spoken layer."

---

## 1:30–2:00 — Lexicon + Meter
**Type:** "Look up μῆνις in the lexicon."

Watch the **LexiconCard** appear with definitions, usage note, and key references.

> "Structured lexicon entry — definitions, usage context, citations — one function call."

**Type:** "Scan the meter of μῆνιν ἄειδε θεά Πηληϊάδεω Ἀχιλῆος"

Watch the **ScansionCard** appear instantly (local scanner, < 1 ms):
```
DACTYLIC HEXAMETER
μῆνιν ἄειδε θεὰ Πηληϊάδεω Ἀχιλῆος
— ∪∪ | — ∪∪ | — — | — ∪∪ | — ∪∪ | — —
Foot 1: Dactyl   Foot 2: Dactyl   Foot 3: Spondee …
```

> "The scansion result is a live structured table — not text. Logos names the meter and one notable feature rather than reading each foot aloud."

---

## 2:00–3:00 — Visual Recognition
Switch to camera. Click the **camera icon** in the composer bar.

Hold up (or screen-share) a printed page with the opening of the Iliad.

Click **capture & send**.

Watch the image appear inline in the transcript, followed by streaming analysis.

> "Logos can read manuscripts, inscriptions, even printed textbook pages. Point and ask."

**Mid-response, type:** "Wait — what does ἄειδε mean exactly?"

> "Interruption is native. The [interrupted] marker appears; Logos pivots cleanly."

---

## 3:00–3:30 — Passage Mode / Close Reading
Click **Add passage** and paste:

```
μῆνιν ἄειδε θεά, Πηληϊάδεω Ἀχιλῆος
οὐλομένην, ἣ μυρί' Ἀχαιοῖς ἄλγε' ἔθηκεν
```

> "The passage is sent as context at session start — Logos knows what we're reading."

**Ask:** "Why is μῆνιν in the accusative?"

**Ask:** "What is the mood of ἄειδε and why?"

> "Every follow-up builds on the same passage context. No copy-pasting."

---

## 3:30–4:00 — Architecture + Close
> "Next.js frontend, FastAPI backend on Cloud Run, Gemini Live API for native audio. Tool calls give structured outputs — morphology, lexicon entries, scansion — rendered as rich cards. The hexameter scanner is fully local, sub-millisecond, deterministic."

> "Transliteration stays visual. Grammar stays accurate. Speech stays natural."

Click **End session**.

---

## The "Wow" Moment (if time allows)
Hold up a photo of a Homer page.
- Logos reads it via camera
- Identifies the passage (Iliad I.1)
- Parses μῆνιν → ParseCard appears
- Explains the accusative and its thematic significance
- Scans the opening line → ScansionCard with foot table

All streaming in realtime, tool calls visible in the Inspector, no transliteration spoken aloud.
