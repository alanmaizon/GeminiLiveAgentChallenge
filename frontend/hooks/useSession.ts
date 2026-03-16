"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useWebSocket } from "./useWebSocket"
import { useAudioCapture } from "./useAudioCapture"
import { useCamera } from "./useCamera"
import type {
  ConnectionState,
  DifficultyLevel,
  InspectorEvent,
  SessionState,
  ToolCallRecord,
  TranscriptMessage,
  ServerMessage,
} from "@/lib/types"
import { DIFFICULTY_INSTRUCTIONS } from "@/lib/constants"
import { generateId } from "@/lib/utils"

const INITIAL_STATE: SessionState = {
  connectionState: "idle",
  sessionId: null,
  transcript: [],
  inspectorEvents: [],
  toolCalls: [],
  isAssistantStreaming: false,
  elapsedSeconds: 0,
  tokenCount: 0,
  pinnedPassage: null,
  difficultyLevel: "intermediate",
}

export function useSession() {
  const [state, setState] = useState<SessionState>(INITIAL_STATE)
  const streamingMessageIdRef = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const systemInstructionRef = useRef<string>("")

  // ── Gapless audio playback ───────────────────────────────────────────────
  // Each incoming PCM chunk is scheduled precisely at the end of the previous
  // one using AudioContext's internal clock, eliminating clicks/pops.
  const audioCtxRef = useRef<AudioContext | null>(null)
  const nextStartTimeRef = useRef(0)

  const scheduleAudioChunk = useCallback((base64Pcm: string) => {
    try {
      const binary = atob(base64Pcm)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext({ sampleRate: 24000 })
      }
      const ctx = audioCtxRef.current

      const int16 = new Int16Array(bytes.buffer)
      const float32 = new Float32Array(int16.length)
      for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768

      const audioBuffer = ctx.createBuffer(1, float32.length, ctx.sampleRate)
      audioBuffer.copyToChannel(float32, 0)

      const source = ctx.createBufferSource()
      source.buffer = audioBuffer
      source.connect(ctx.destination)

      // Schedule this chunk to start exactly when the previous one ends.
      // Math.max guards against scheduling in the past if there's a gap.
      const startTime = Math.max(ctx.currentTime, nextStartTimeRef.current)
      source.start(startTime)
      nextStartTimeRef.current = startTime + audioBuffer.duration
    } catch {
      // Ignore decode / context errors
    }
  }, [])

  const stopAudio = useCallback(() => {
    audioCtxRef.current?.close()
    audioCtxRef.current = null
    nextStartTimeRef.current = 0
  }, [])

  // ── Inspector ─────────────────────────────────────────────────────────────

  const addInspectorEvent = useCallback((event: string, data?: unknown) => {
    const entry: InspectorEvent = {
      id: generateId(),
      timestamp: new Date(),
      event,
      data,
    }
    setState((s) => ({ ...s, inspectorEvents: [...s.inspectorEvents, entry] }))
  }, [])

  // ── WebSocket message handler ─────────────────────────────────────────────

  const handleMessage = useCallback(
    (msg: ServerMessage) => {
      addInspectorEvent(msg.type, msg)

      switch (msg.type) {
        case "status":
          setState((s) => ({ ...s, connectionState: msg.state as ConnectionState }))
          if (msg.state === "live") startTimer()
          if (msg.state === "ended" || msg.state === "error") stopTimer()
          break

        case "session.started":
          setState((s) => ({ ...s, sessionId: msg.session_id }))
          break

        case "session.ended":
          setState((s) => ({ ...s, connectionState: "ended" }))
          stopTimer()
          break

        case "output.text.delta": {
          setState((s) => {
            const id = streamingMessageIdRef.current
            if (id) {
              return {
                ...s,
                isAssistantStreaming: true,
                tokenCount: s.tokenCount + 1,
                transcript: s.transcript.map((m) =>
                  m.id === id ? { ...m, content: m.content + msg.delta } : m
                ),
              }
            }
            const newId = generateId()
            streamingMessageIdRef.current = newId
            const newMsg: TranscriptMessage = {
              id: newId,
              role: "assistant",
              content: msg.delta,
              isStreaming: true,
              timestamp: new Date(),
            }
            return {
              ...s,
              isAssistantStreaming: true,
              tokenCount: s.tokenCount + 1,
              transcript: [...s.transcript, newMsg],
            }
          })
          break
        }

        case "output.text.done":
          setState((s) => ({
            ...s,
            isAssistantStreaming: false,
            transcript: s.transcript.map((m) =>
              m.id === streamingMessageIdRef.current
                ? { ...m, isStreaming: false, content: msg.full_text }
                : m
            ),
          }))
          streamingMessageIdRef.current = null
          break

        case "output.audio.delta":
          scheduleAudioChunk(msg.audio)
          break

        case "tool.call": {
          const record: ToolCallRecord = {
            id: generateId(),
            callId: msg.call_id,
            toolName: msg.tool_name,
            args: msg.args,
            timestamp: new Date(),
          }
          setState((s) => ({ ...s, toolCalls: [...s.toolCalls, record] }))
          break
        }

        case "tool.result":
          setState((s) => ({
            ...s,
            toolCalls: s.toolCalls.map((tc) =>
              tc.callId === msg.call_id ? { ...tc, result: msg.result } : tc
            ),
            transcript: s.transcript.map((m) =>
              m.id === streamingMessageIdRef.current
                ? { ...m, parseResult: msg.result as TranscriptMessage["parseResult"] }
                : m
            ),
          }))
          break

        case "error":
          setState((s) => ({ ...s, connectionState: "error" }))
          addTranscriptMessage("system", `Error: ${msg.message}`)
          stopTimer()
          break

        case "log":
          break
      }
    },
    [scheduleAudioChunk, addInspectorEvent] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const { status: wsStatus, connect, disconnect, send } = useWebSocket({
    onMessage: handleMessage,
    autoReconnect: false,
  })

  // ── Timer ─────────────────────────────────────────────────────────────────
  const startTimer = () => {
    if (timerRef.current) return
    timerRef.current = setInterval(() => {
      setState((s) => ({ ...s, elapsedSeconds: s.elapsedSeconds + 1 }))
    }, 1000)
  }
  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  useEffect(() => () => stopTimer(), [])

  // ── Transcript helpers ────────────────────────────────────────────────────
  const addTranscriptMessage = (
    role: TranscriptMessage["role"],
    content: string,
    extra?: Partial<TranscriptMessage>
  ) => {
    setState((s) => ({
      ...s,
      transcript: [
        ...s.transcript,
        { id: generateId(), role, content, timestamp: new Date(), ...extra },
      ],
    }))
  }

  // ── Public actions ────────────────────────────────────────────────────────

  const startSession = useCallback(
    (systemInstruction: string, difficulty: DifficultyLevel) => {
      // Append difficulty modifier to the system instruction
      const fullInstruction = systemInstruction + DIFFICULTY_INSTRUCTIONS[difficulty]
      systemInstructionRef.current = fullInstruction
      setState((s) => ({
        ...INITIAL_STATE,
        connectionState: "connecting",
        difficultyLevel: difficulty,
        pinnedPassage: s.pinnedPassage, // preserve any pre-loaded passage
      }))
      connect()
    },
    [connect]
  )

  // Send session.start once WS is open
  useEffect(() => {
    if (wsStatus === "open" && state.connectionState === "connecting") {
      send({
        type: "session.start",
        config: { system_instruction: systemInstructionRef.current },
      })
    }
  }, [wsStatus, state.connectionState, send])

  const endSession = useCallback(() => {
    send({ type: "session.end" })
    disconnect()
    stopAudio()
    stopTimer()
    setState((s) => ({ ...s, connectionState: "ended" }))
  }, [send, disconnect, stopAudio])

  const sendText = useCallback(
    (text: string) => {
      addTranscriptMessage("user", text)
      send({ type: "input.text", text })
    },
    [send] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const sendImage = useCallback(
    (base64: string, mimeType = "image/jpeg") => {
      addTranscriptMessage("user", "[Image sent]", {
        image: `data:${mimeType};base64,${base64}`,
        mimeType,
      })
      send({ type: "input.image", image: base64, mime_type: mimeType })
    },
    [send] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const interrupt = useCallback(() => {
    send({ type: "input.interrupt" })
    stopAudio() // Stop any currently playing audio immediately
    setState((s) => ({
      ...s,
      isAssistantStreaming: false,
      transcript: s.transcript.map((m) =>
        m.id === streamingMessageIdRef.current
          ? { ...m, isStreaming: false, interrupted: true }
          : m
      ),
    }))
    streamingMessageIdRef.current = null
  }, [send, stopAudio])

  // ── Feature D: Contextual Passage Mode ───────────────────────────────────
  const loadPassage = useCallback(
    (text: string) => {
      setState((s) => ({ ...s, pinnedPassage: text }))
      if (state.connectionState === "live") {
        // Send the passage to the model as context
        send({
          type: "input.text",
          text: `[Passage loaded for close reading]\n\n${text}\n\nPlease acknowledge this passage and stand by for questions about it.`,
        })
        addTranscriptMessage(
          "user",
          `[Passage loaded for close reading]\n\n${text}`
        )
      }
    },
    [state.connectionState, send] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const clearPassage = useCallback(() => {
    setState((s) => ({ ...s, pinnedPassage: null }))
  }, [])

  // ── Feature E: Adaptive Difficulty ───────────────────────────────────────
  const setDifficulty = useCallback((level: DifficultyLevel) => {
    setState((s) => ({ ...s, difficultyLevel: level }))
  }, [])

  const clearInspector = useCallback(() => {
    setState((s) => ({ ...s, inspectorEvents: [], toolCalls: [] }))
  }, [])

  const audio = useAudioCapture({
    onAudioChunk: useCallback(
      (b64: string) => send({ type: "input.audio", audio: b64 }),
      [send]
    ),
  })

  const camera = useCamera()

  return {
    state,
    wsStatus,
    startSession,
    endSession,
    sendText,
    sendImage,
    interrupt,
    loadPassage,
    clearPassage,
    setDifficulty,
    clearInspector,
    audio,
    camera,
  }
}
