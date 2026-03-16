"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useWebSocket } from "./useWebSocket"
import { useAudioCapture } from "./useAudioCapture"
import { useCamera } from "./useCamera"
import type {
  ConnectionState,
  InspectorEvent,
  SessionState,
  ToolCallRecord,
  TranscriptMessage,
  ServerMessage,
} from "@/lib/types"
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
}

export function useSession() {
  const [state, setState] = useState<SessionState>(INITIAL_STATE)
  const streamingMessageIdRef = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const systemInstructionRef = useRef<string>("")

  // ── Audio playback ──────────────────────────────────────────────────────
  const audioCtxRef = useRef<AudioContext | null>(null)
  const audioQueueRef = useRef<ArrayBuffer[]>([])
  const isPlayingRef = useRef(false)

  const enqueueAudio = useCallback((base64Pcm: string) => {
    // GEMINI_LIVE: wire actual PCM→AudioContext playback
    try {
      const binary = atob(base64Pcm)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      audioQueueRef.current.push(bytes.buffer)
      if (!isPlayingRef.current) drainAudioQueue()
    } catch {
      // Ignore decode errors
    }
  }, [])

  const drainAudioQueue = useCallback(() => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false
      return
    }
    isPlayingRef.current = true
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext({ sampleRate: 24000 })
    }
    const ctx = audioCtxRef.current
    const buffer = audioQueueRef.current.shift()!
    const int16 = new Int16Array(buffer)
    const float32 = new Float32Array(int16.length)
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768

    const audioBuffer = ctx.createBuffer(1, float32.length, ctx.sampleRate)
    audioBuffer.copyToChannel(float32, 0)

    const source = ctx.createBufferSource()
    source.buffer = audioBuffer
    source.connect(ctx.destination)
    source.onended = drainAudioQueue
    source.start()
  }, [])

  // ── WebSocket ──────────────────────────────────────────────────────────

  const addInspectorEvent = useCallback((event: string, data?: unknown) => {
    const entry: InspectorEvent = {
      id: generateId(),
      timestamp: new Date(),
      event,
      data,
    }
    setState((s) => ({
      ...s,
      inspectorEvents: [...s.inspectorEvents, entry],
    }))
  }, [])

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
            // Start new message
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
          enqueueAudio(msg.audio)
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
            // Attach parse result to the current streaming message
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
          // Already captured by addInspectorEvent above
          break
      }
    },
    [enqueueAudio, addInspectorEvent] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const { status: wsStatus, connect, disconnect, send } = useWebSocket({
    onMessage: handleMessage,
    autoReconnect: false,
  })

  // ── Timer ───────────────────────────────────────────────────────────────
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

  // ── Transcript helpers ──────────────────────────────────────────────────
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

  // ── Public actions ──────────────────────────────────────────────────────

  const startSession = useCallback(
    (systemInstruction: string) => {
      systemInstructionRef.current = systemInstruction
      setState({ ...INITIAL_STATE, connectionState: "connecting" })
      connect()
      // After WS open, send session.start
      // We rely on the wsStatus → "open" transition below
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
    stopTimer()
    setState((s) => ({ ...s, connectionState: "ended" }))
  }, [send, disconnect])

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
    // Mark current streaming message as interrupted
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
  }, [send])

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
    clearInspector,
    audio,
    camera,
  }
}
