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
    loadPassage,
    clearPassage,
    setDifficulty,
    clearInspector,
    audio,
    camera,
  } = useSession()

  const hasSession =
    state.connectionState !== "idle" || state.transcript.length > 0

  return (
    <div
      className="flex flex-col h-screen"
      style={{ background: "var(--bg)", color: "var(--text-primary)" }}
    >
      <TopBar
        connectionState={state.connectionState}
        elapsedSeconds={state.elapsedSeconds}
        difficultyLevel={state.difficultyLevel}
        theme={theme}
        onToggleTheme={toggleTheme}
        onToggleInspector={() => setInspectorOpen((v) => !v)}
        inspectorOpen={inspectorOpen}
      />

      <main className="flex-1 overflow-hidden relative">
        <div className="h-full max-w-3xl mx-auto px-4 flex flex-col">
          {!hasSession ? (
            <WelcomeView
              systemInstruction={systemInstruction}
              onSystemInstructionChange={setSystemInstruction}
              difficultyLevel={state.difficultyLevel}
              onDifficultyChange={setDifficulty}
              onLoadPassage={(text) => loadPassage(text)}
            />
          ) : (
            <TranscriptView
              messages={state.transcript}
              isStreaming={state.isAssistantStreaming}
              connectionState={state.connectionState}
              pinnedPassage={state.pinnedPassage}
              onClearPassage={clearPassage}
            />
          )}
        </div>
      </main>

      <ComposerBar
        connectionState={state.connectionState}
        isAudioCapturing={audio.isCapturing}
        isCameraActive={camera.isActive}
        audioError={audio.error}
        cameraError={camera.error}
        onStartSession={() => startSession(systemInstruction, state.difficultyLevel)}
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

      {/* Demo hooks: hidden controls for Playwright automation */}
      <input
        type="file"
        accept="image/*"
        data-testid="image-upload-input"
        style={{ position: "absolute", left: "-9999px", opacity: 0 }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (!file) return
          const reader = new FileReader()
          reader.onload = () => {
            const result = reader.result as string
            const b64 = result.split(",")[1]
            sendImage(b64, file.type)
          }
          reader.readAsDataURL(file)
        }}
      />
      {/* Difficulty setters — allow Playwright to change level between sessions
          (WelcomeView is hidden once a session has started) */}
      {(["beginner", "intermediate", "advanced"] as const).map((level) => (
        <button
          key={level}
          data-testid={`set-difficulty-${level}`}
          style={{ position: "absolute", left: "-9999px", opacity: 0 }}
          onClick={() => setDifficulty(level)}
          tabIndex={-1}
          aria-hidden="true"
        />
      ))}
    </div>
  )
}
