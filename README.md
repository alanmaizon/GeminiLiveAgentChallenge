# ΛΟΓΟΣ — Realtime Ancient Greek Scholar Console

A premium, realtime multimodal AI console for Ancient Greek scholarship. Speak, type, or show images of texts and artefacts to a live AI philologist that responds with streaming text and structured spoken audio.

## Features

- **Voice input** — speak to Logos and hear streaming responses
- **Camera input** — show manuscripts, inscriptions, or printed Greek pages for instant analysis
- **Philological parsing** — structured morphological analysis via function-calling tools (`parse_greek`, `lookup_lexicon`, `scan_meter`)
- **Streaming transcript** — token-by-token rendering with interruption support
- **Inspector drawer** — live event log, tool call traces, token monitor, camera preview
- **Mock mode** — fully demoable without an API key

## Architecture

```
Browser (Next.js)  ←── WebSocket ───►  FastAPI Backend (Cloud Run)
                                               │
                                               ▼
                                        Gemini Live API
```

See [architecture.md](./architecture.md) for the full diagram and architecture decision records.

## Quick Start (Docker Compose)

```bash
# Clone
git clone <repo-url> && cd logos

# Copy env files
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local

# Optional: add your Gemini API key to backend/.env
# Without it, MOCK_MODE=true is used automatically

docker compose up --build
```

Frontend: http://localhost:3000
Backend health: http://localhost:8080/health

## Local Development (without Docker)

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # edit with your API key
uvicorn main:app --reload --port 8080
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local   # edit NEXT_PUBLIC_WS_URL if needed
uvicorn main:app --reload --port 8080
```

## Environment Variables

### Backend (`backend/.env`)

| Variable | Default | Description |
|---|---|---|
| `GEMINI_API_KEY` | — | Google AI Studio or Vertex AI key |
| `GEMINI_MODEL` | `gemini-live-2.5-flash-native-audio` | Gemini Live model ID |
| `MOCK_MODE` | `false` | Enable mock mode (auto-enabled if no API key) |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | CORS allowed origins |
| `GCP_PROJECT_ID` | — | Google Cloud project (for Cloud Run) |

### Frontend (`frontend/.env.local`)

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_WS_URL` | `ws://localhost:8080/ws` | Backend WebSocket URL |
| `NEXT_PUBLIC_APP_NAME` | `Logos` | App display name |

## Deployment to Google Cloud Run

```bash
export GCP_PROJECT_ID=your-project-id
export GEMINI_API_KEY=your-api-key

# Deploy backend
bash deploy/cloud-run-backend.sh

# Deploy frontend (set BACKEND_URL from the step above)
export BACKEND_URL=https://logos-backend-xxx-uc.a.run.app
bash deploy/cloud-run-frontend.sh
```

## Implemented Features

- ✅ Feature A — Philological Parse Mode (`parse_greek` tool + ParseCard UI)
- ✅ Feature B — Visual Text Recognition (camera capture → Gemini multimodal)
- ✅ Feature C — Pronunciation guidance (IPA in parse results and responses)
- ✅ Feature D — Contextual Passage Mode (pinned passage card above transcript, passage sent as context on session start)
- ✅ Feature E — Adaptive Difficulty (3-level selector in WelcomeView, level badge in TopBar, appended to system instruction)

## Tech Stack

- **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind CSS, Lucide React
- **Backend:** Python FastAPI, websockets, google-genai SDK
- **AI:** Gemini Live API (gemini-live-2.5-flash-native-audio)
- **Deploy:** Google Cloud Run (backend + frontend)
