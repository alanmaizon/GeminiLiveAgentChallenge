"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { AUDIO_SAMPLE_RATE } from "@/lib/constants"
import { arrayBufferToBase64 } from "@/lib/utils"

interface UseAudioCaptureOptions {
  onAudioChunk: (base64Pcm: string) => void
}

export function useAudioCapture({ onAudioChunk }: UseAudioCaptureOptions) {
  const [isCapturing, setIsCapturing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const audioContextRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const onChunkRef = useRef(onAudioChunk)
  onChunkRef.current = onAudioChunk

  const stop = useCallback(() => {
    processorRef.current?.disconnect()
    sourceRef.current?.disconnect()
    streamRef.current?.getTracks().forEach((t) => t.stop())
    audioContextRef.current?.close()
    processorRef.current = null
    sourceRef.current = null
    streamRef.current = null
    audioContextRef.current = null
    setIsCapturing(false)
  }, [])

  const start = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      // GEMINI_LIVE: Gemini Live expects PCM 16-bit 16kHz mono
      // AudioContext resamples from device rate to target rate
      const ctx = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE })
      audioContextRef.current = ctx

      const source = ctx.createMediaStreamSource(stream)
      sourceRef.current = source

      // ScriptProcessorNode for raw PCM access (deprecated but widely supported)
      // TODO: migrate to AudioWorklet for production
      const bufferSize = 4096
      const processor = ctx.createScriptProcessor(bufferSize, 1, 1)
      processorRef.current = processor

      processor.onaudioprocess = (e: AudioProcessingEvent) => {
        const float32 = e.inputBuffer.getChannelData(0)
        // Convert Float32 [-1,1] → Int16 PCM
        const int16 = new Int16Array(float32.length)
        for (let i = 0; i < float32.length; i++) {
          int16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32767))
        }
        onChunkRef.current(arrayBufferToBase64(int16.buffer))
      }

      source.connect(processor)
      processor.connect(ctx.destination)
      setIsCapturing(true)
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone permission denied. Please allow microphone access and try again."
          : "Failed to start microphone capture."
      setError(msg)
    }
  }, [])

  const toggle = useCallback(async () => {
    if (isCapturing) {
      stop()
    } else {
      await start()
    }
  }, [isCapturing, start, stop])

  // Cleanup on unmount
  useEffect(() => () => stop(), [stop])

  return { isCapturing, error, start, stop, toggle }
}
