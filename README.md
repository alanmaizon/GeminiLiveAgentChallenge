# ΛΟΓΟΣ — Realtime Ancient Greek Scholar Console

[![Deploy: Cloud Run](https://img.shields.io/badge/deploy-Cloud%20Run-4285F4?logo=googlecloud&logoColor=white)](https://cloud.google.com/run)
[![Backend: Python 3.11](https://img.shields.io/badge/backend-Python%203.11-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Frontend: Next.js 14](https://img.shields.io/badge/frontend-Next.js%2014-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Gemini Live](https://img.shields.io/badge/Gemini%20Live-2.5%20Flash-8E44AD?logo=google&logoColor=white)](https://ai.google.dev/)
[![Tests: 82 passing](https://img.shields.io/badge/tests-82%20passing-22C55E?logo=pytest&logoColor=white)](#testing)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow)](LICENSE)

A realtime multimodal AI console for Ancient Greek scholarship. Speak, type, or show images of manuscripts and artefacts to a live AI philologist that responds with streaming text, structured tool cards, and synthesized audio.

## Features

- **Voice input** — speak to Logos and hear streaming responses via Gemini Live native audio
- **Camera input** — show manuscripts, inscriptions, or printed Greek pages for instant analysis
- **Philological tools** — structured morphological analysis (`parse_greek`), lexicon entries (`lookup_lexicon`), and dactylic hexameter scansion (`scan_meter`) via function-calling
- **Visual-only fields** — transliteration, IPA, and scansion patterns are rendered as UI cards, never spoken aloud
- **Streaming transcript** — token-by-token rendering with interruption support
- **Inspector drawer** — live event log, tool call traces, token monitor, camera preview
- **Contextual passage mode** — pin a Greek text passage; it is injected as session context automatically
- **Adaptive difficulty** — beginner / intermediate / advanced level selector adjusts model register
- **Mock mode** — fully demoable without an API key

## Architecture

```
Browser (Next.js)  ←── WebSocket ───►  FastAPI Backend  ───►  Gemini Live API
                                               │
                                          tools.py
                                       ┌──────┴──────┐
                                  meter.py      gemini-2.5-flash
                              (local, <1 ms)   (JSON, thinking off)
```

**WebSocket protocol** is the single integration contract. Every message has a `type` field — types are defined in `frontend/lib/types.ts` (TypeScript) and `backend/models.py` (Pydantic). These must stay in sync.

**Tool execution split:** the full tool result goes to the frontend (for cards); a spoken-safe subset (visual-only fields stripped) goes back to the model via `send_tool_response`. This prevents transliteration, IPA, and scansion notation from being narrated.

**`scan_meter` is fully local** — a deterministic dactylic hexameter scanner (`backend/meter.py`) handles nucleus extraction, long-by-position rules, backtracking, and synizesis fallback in under 1 ms with `lru_cache`. No LLM call.

See [CLAUDE.md](./CLAUDE.md) for full architecture notes and key file index.

## Quick Start (Docker Compose)

```bash
git clone <repo-url> && cd GeminiLiveAgentChallenge

# Copy env files
cp backend/.env.example backend/.env
# Optional: add GEMINI_API_KEY to backend/.env — omit for mock mode

docker compose up --build
```

- Frontend: http://localhost:3000
- Backend health: http://localhost:8080/health

## Local Development

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # add your API key
uvicorn main:app --reload --port 8080
```

### Frontend

```bash
cd frontend
npm install
npm run dev   # http://localhost:3000
```

## Testing

### Unit tests (no API key needed)

```bash
# Backend — 66 tests (pytest)
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m pytest tests/ -v
```

```bash
# Frontend — 16 tests (Vitest)
cd frontend
npm install
npm test
```

| Suite | File | Tests | What it covers |
|---|---|---|---|
| Transcript sanitization | `backend/tests/test_sanitize.py` | 20 | Control-token stripping, transliteration parens removal |
| Spoken-safe tool split | `backend/tests/test_spoken_safe.py` | 18 | Visual-only fields stripped from model response |
| Hexameter scanner | `backend/tests/test_meter.py` | 28 | Dactylic hexameter scansion, spondee detection, backtracking |
| Frontend utils | `frontend/lib/__tests__/utils.test.ts` | 16 | `formatTimestamp`, `cn`, type guards |

### End-to-end demo test (Playwright)

The e2e suite drives a real browser through all three tool flows and records a video. The Aesop fable image used in the image-upload session is committed at `tests/e2e/fixtures/`.

**Prerequisites:** Node.js 18+, the app running locally (see Quick Start).

```bash
# Install Playwright + browser
cd tests/e2e
npm install
npx playwright install chromium

# Start the app (separate terminal, from repo root)
docker compose up --build
# — or —
cd backend && uvicorn main:app --port 8080 &
cd frontend && npm run dev &

# Run the demo (headed, ~4 minutes)
node demo.mjs

# Run headless (CI-friendly)
LOGOS_HEADLESS=true node demo.mjs
```

The runner exercises:
1. **Session 1 (Beginner)** — `parse_greek` tool → ParseCard appears in transcript
2. **Session 2 (Intermediate)** — Aesop JPEG uploaded → `lookup_lexicon` → LexiconCard
3. **Session 3 (Advanced)** — Iliad hexameter → `scan_meter` → ScansionCard

All three tool assertions are hard-fails; the script exits non-zero if a card does not appear.

Output (video + diagnostic screenshots) is written to `tests/e2e/output/` (gitignored).

**Mock mode** (no API key): set `MOCK_MODE=true` in `backend/.env` — the frontend is indistinguishable from a live session and all tool cards render from hardcoded examples.

```bash
# Full test matrix with mock mode
MOCK_MODE=true docker compose up --build &
cd tests/e2e && LOGOS_HEADLESS=true node demo.mjs
```

## Environment Variables

### Backend (`backend/.env`)

| Variable | Default | Description |
|---|---|---|
| `GEMINI_API_KEY` | — | Google AI Studio key (Mode A) |
| `GCP_PROJECT_ID` | — | GCP project for Vertex AI auth (Mode B) |
| `GCP_REGION` | `us-central1` | Vertex AI region |
| `GEMINI_MODEL` | `gemini-live-2.5-flash-native-audio` | Gemini Live model ID |
| `MOCK_MODE` | `false` | Force mock mode (auto-enabled if no key) |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | CORS allowed origins |

### Frontend (`frontend/.env.local`)

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_WS_URL` | `ws://localhost:8080/ws` | Backend WebSocket URL |
| `NEXT_PUBLIC_APP_NAME` | `Logos` | App display name |

## Deployment to Google Cloud Run

```bash
export GCP_PROJECT_ID=your-project-id
export GCP_REGION=us-central1
export GEMINI_API_KEY=your-api-key

# 1. Deploy backend
bash deploy/cloud-run-backend.sh

# 2. Deploy frontend — paste the URL printed by step 1
export BACKEND_URL=https://logos-backend-xxx-uc.a.run.app
bash deploy/cloud-run-frontend.sh
```

Both services are deployed as unauthenticated Cloud Run services. The backend CORS policy is controlled by `ALLOWED_ORIGINS`.

## Implemented Features

- ✅ **Feature A** — Philological Parse Mode (`parse_greek` tool + ParseCard)
- ✅ **Feature B** — Visual Text Recognition (camera → Gemini multimodal)
- ✅ **Feature C** — Pronunciation guidance (IPA in parse cards, never spoken)
- ✅ **Feature D** — Contextual Passage Mode (pinned passage injected at session start)
- ✅ **Feature E** — Adaptive Difficulty (3-level selector, appended to system instruction)

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS, Lucide React |
| Backend | Python 3.11, FastAPI 0.115, uvicorn |
| AI | Gemini Live API (`gemini-live-2.5-flash-native-audio`), google-genai ≥ 1.67 |
| Meter analysis | Custom deterministic hexameter scanner (`meter.py`), `lru_cache` |
| Testing | pytest ≥ 8, Vitest 1.6 |
| Deploy | Google Cloud Run (backend + frontend), Cloud Build |
