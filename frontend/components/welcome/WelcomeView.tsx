import { Mic, Camera, FileText } from "lucide-react"
import { SystemInstructions } from "./SystemInstructions"
import { FeatureCard } from "./FeatureCard"

interface WelcomeViewProps {
  systemInstruction: string
  onSystemInstructionChange: (v: string) => void
}

export function WelcomeView({ systemInstruction, onSystemInstructionChange }: WelcomeViewProps) {
  return (
    <div className="flex flex-col gap-6 pt-6 pb-4 overflow-y-auto">
      {/* System instructions */}
      <SystemInstructions
        value={systemInstruction}
        onChange={onSystemInstructionChange}
      />

      {/* Feature cards */}
      <div className="flex flex-col sm:flex-row gap-3">
        <FeatureCard
          icon={Mic}
          iconColor="var(--accent)"
          title="Speak to Logos"
          subtitle="Ask questions aloud. Hear correct Attic pronunciation, parsing, and literary analysis — in realtime."
        />
        <FeatureCard
          icon={Camera}
          iconColor="#1a73e8"
          title="Show Logos"
          subtitle="Hold up a manuscript, inscription, or printed page. Logos will read, transcribe, and analyze it."
        />
        <FeatureCard
          icon={FileText}
          iconColor="#0f9d58"
          title="Share your text"
          subtitle="Paste a passage or Greek word. Get morphological parsing, scansion, and close reading on demand."
        />
      </div>

      {/* Prompt text */}
      <p
        className="text-center text-sm pb-2"
        style={{ color: "var(--text-muted)" }}
      >
        Click <strong style={{ color: "var(--text-secondary)" }}>Start session</strong> below to begin streaming
      </p>
    </div>
  )
}
