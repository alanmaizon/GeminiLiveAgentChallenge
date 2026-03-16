"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export function useCamera() {
  const [isActive, setIsActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setIsActive(false)
  }, [])

  const start = useCallback(async (videoEl?: HTMLVideoElement) => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: 640, height: 480 },
      })
      streamRef.current = stream
      const el = videoEl ?? videoRef.current
      if (el) {
        el.srcObject = stream
        el.play().catch(() => {})
      }
      setIsActive(true)
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Camera permission denied. Please allow camera access and try again."
          : "Failed to start camera."
      setError(msg)
    }
  }, [])

  const toggle = useCallback(
    async (videoEl?: HTMLVideoElement) => {
      if (isActive) {
        stop()
      } else {
        await start(videoEl)
      }
    },
    [isActive, start, stop]
  )

  /** Capture the current video frame as a JPEG base64 string. */
  const captureFrame = useCallback((quality = 0.85): string | null => {
    const video = videoRef.current
    if (!video || !isActive) return null

    const canvas = document.createElement("canvas")
    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 480
    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL("image/jpeg", quality)
    // Strip the data:image/jpeg;base64, prefix
    return dataUrl.split(",")[1] ?? null
  }, [isActive])

  useEffect(() => () => stop(), [stop])

  return { isActive, error, videoRef, start, stop, toggle, captureFrame }
}
