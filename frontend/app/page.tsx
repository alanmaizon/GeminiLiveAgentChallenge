"use client"

import { useState } from "react"
import { useSession } from "@/hooks/useSession"
import { useTheme } from "@/hooks/useTheme"
import { TopBar } from "@/components/layout/TopBar"
import { ComposerBar } from "@/components/layout/ComposerBar"
import { InspectorDrawer } from "@/components/layout/InspectorDrawer"
import { WelcomeView } from "@/components/welcome/WelcomeView"
import { TranscriptView } from "@/components/session/TranscriptView"
import { DEFAULT_SYSTEM_INSTRUCTION } from "@/lib/constants"

export default function ConsolePage() {
  const { theme, toggle: toggleTheme } = useTheme()
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [systemInstruction, setSystemInstruction] = useState(DEFAULT_SYSTEM_INSTRUCTION)

  const {
    state,
    startSession,
    endSession,
    sendText,
    sendImage,
    interrupt,
    clearInspector,
    audio,
    camera,
  } = useSession()

  const isLive = state.connectionState === "live"
  const isConnecting = state.connectionState === "connecting"
  const isEnded = state.connectionState === "ended"
  const hasSession = isLive || isConnecting || isEnded || state.transcript.length > 0

  return (
    <div
      className="flex flex-col h-screen"
      style={{ background: "var(--bg)", color: "var(--text-primary)" }}
    >
      {/* Top bar */}
      <TopBar
        connectionState={state.connectionState}
        elapsedSeconds={state.elapsedSeconds}
        theme={theme}
        onToggleTheme={toggleTheme}
        onToggleInspector={() => setInspectorOpen((v) => !v)}
        inspectorOpen={inspectorOpen}
      />

      {/* Main content area */}
      <main className="flex-1 overflow-hidden relative">
        <div className="h-full max-w-3xl mx-auto px-4 flex flex-col">
          {!hasSession ? (
            <WelcomeView
              systemInstruction={systemInstruction}
              onSystemInstructionChange={setSystemInstruction}
            />
          ) : (
            <TranscriptView
              messages={state.transcript}
              isStreaming={state.isAssistantStreaming}
              connectionState={state.connectionState}
            />
          )}
        </div>
      </main>

      {/* Composer bar */}
      <ComposerBar
        connectionState={state.connectionState}
        isAudioCapturing={audio.isCapturing}
        isCameraActive={camera.isActive}
        audioError={audio.error}
        cameraError={camera.error}
        onStartSession={() => startSession(systemInstruction)}
        onEndSession={endSession}
        onSendText={sendText}
        onToggleMic={audio.toggle}
        onToggleCamera={camera.toggle}
        onCaptureAndSendImage={() => {
          const b64 = camera.captureFrame()
          if (b64) sendImage(b64)
        }}
        onInterrupt={interrupt}
      />

      {/* Inspector drawer */}
      <InspectorDrawer
        open={inspectorOpen}
        onClose={() => setInspectorOpen(false)}
        events={state.inspectorEvents}
        toolCalls={state.toolCalls}
        tokenCount={state.tokenCount}
        isStreaming={state.isAssistantStreaming}
        isCameraActive={camera.isActive}
        videoRef={camera.videoRef}
        onClear={clearInspector}
      />
    </div>
  )
}
