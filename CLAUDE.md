# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8080   # dev server
```

### Frontend

```bash
cd frontend
npm install
npm run dev          # dev server on :3000
npm run build        # production build
npm run type-check   # TypeScript check only
npm run lint         # ESLint
```

### Both (Docker Compose)

```bash
docker compose up --build          # start everything
MOCK_MODE=true docker compose up   # force mock mode
```

## Architecture

**Monorepo:** `backend/` (Python FastAPI) + `frontend/` (Next.js 14 App Router) + `deploy/` (Cloud Run scripts).

**WebSocket protocol** is the single integration contract. Every message has a `type` field. Types are defined in `frontend/lib/types.ts` (TypeScript) and `backend/models.py` (Pydantic). These must stay in sync.

**Session flow:**
1. Frontend connects WebSocket → sends `session.start` with system instructions
2. Backend opens a Gemini Live session (or mock session if no API key)
3. Backend streams `output.text.delta` / `output.audio.delta` messages back
4. Tool calls (`tool.call` / `tool.result`) are forwarded to frontend for the Inspector drawer
5. Frontend sends `session.end` → backend closes Gemini session

**Mock mode** is auto-activated when `GEMINI_API_KEY` is unset or `MOCK_MODE=true`. `backend/mock_mode.py` replicates the exact protocol — the frontend cannot distinguish mock from live.

**Tool execution:** When Gemini calls `parse_greek`, `lookup_lexicon`, or `scan_meter`, the backend in `tools.py` executes the tool (using a separate non-streaming Gemini call in production, hardcoded examples in mock mode), then sends both `tool.call` and `tool.result` events to the frontend before returning the result to Gemini.

**Audio:** Browser captures PCM 16-bit 16kHz mono via `ScriptProcessorNode` → base64 → WebSocket → Gemini Live. Gemini audio responses arrive as base64 PCM chunks → `AudioContext` for playback. Look for `# GEMINI_LIVE:` comments for wiring points.

## Key Files

| File | Purpose |
|---|---|
| `backend/main.py` | FastAPI app, `/ws` WebSocket endpoint, `/health` |
| `backend/session.py` | Routes to mock or live handler |
| `backend/gemini_client.py` | Gemini Live SDK integration |
| `backend/mock_mode.py` | Mock streaming responses (no API key needed) |
| `backend/tools.py` | Tool declarations + executors (parse_greek, etc.) |
| `frontend/hooks/useSession.ts` | Central state: transcript, tool calls, audio, camera |
| `frontend/hooks/useWebSocket.ts` | WebSocket with auto-reconnect |
| `frontend/lib/types.ts` | Shared message type definitions |
| `frontend/app/globals.css` | CSS variable palette (light/dark), keyframes |
| `frontend/components/session/ParseCard.tsx` | Inline morphology result card |
| `frontend/components/layout/InspectorDrawer.tsx` | Slide-out debug drawer |

## Design System

CSS variables are defined in `frontend/app/globals.css`. Use `var(--accent)`, `var(--surface)`, `var(--border)`, etc. directly in inline styles or Tailwind's `style` prop. Toggle dark mode by adding/removing the `dark` class on `<html>`.

Fonts: `greek` class = EB Garamond (polytonic), `inspector-mono` class = JetBrains Mono, body = DM Sans.

## Gemini Live API Notes

The backend uses `google-genai` (not `google-generativeai`). Search for `# GEMINI_LIVE:` comments in `gemini_client.py` for places where the exact SDK API may need adjustment based on the installed version. The Live model is `gemini-2.0-flash-live-001`.
