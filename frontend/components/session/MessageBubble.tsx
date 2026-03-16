"use client"

import { useState } from "react"
import { Copy, Check } from "lucide-react"
import type { TranscriptMessage } from "@/lib/types"
import { formatTimestamp } from "@/lib/utils"
import { ParseCard } from "./ParseCard"
import { LexiconCard } from "./LexiconCard"
import { ScansionCard } from "./ScansionCard"
import { ImageMessage } from "./ImageMessage"
import { StreamingIndicator } from "./StreamingIndicator"
import { cn } from "@/lib/utils"

interface MessageBubbleProps {
  message: TranscriptMessage
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false)

  const isUser = message.role === "user"
  const isSystem = message.role === "system"

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (isSystem) {
    return (
      <div className="flex justify-center py-1">
        <span
          className="text-xs px-3 py-1 rounded-full"
          style={{ background: "var(--surface)", color: "var(--text-muted)", border: "1px solid var(--border)" }}
        >
          {message.content}
        </span>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "group flex flex-col gap-1 animate-fade-in",
        isUser ? "items-end" : "items-start"
      )}
    >
      {/* Speaker label + timestamp */}
      <div
        className="flex items-center gap-2 px-1"
        style={{ color: "var(--text-muted)" }}
      >
        <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
          {isUser ? "You" : "Logos"}
        </span>
        <span className="text-xs">{formatTimestamp(message.timestamp)}</span>
        {message.interrupted && (
          <span className="text-xs italic" style={{ color: "var(--error)" }}>
            [interrupted]
          </span>
        )}
      </div>

      {/* Message content */}
      <div className="relative max-w-[90%]">
        {/* Inline image */}
        {message.image && (
          <ImageMessage src={message.image} />
        )}

        {/* Text content */}
        {message.content && message.content !== "[Image sent]" && (
          <div
            className={cn(
              "rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap transcript-prose",
              isUser && "rounded-tr-sm",
              !isUser && "rounded-tl-sm",
              message.isStreaming && !isUser && "streaming-cursor"
            )}
            style={{
              background: isUser ? "var(--accent)" : "var(--surface)",
              color: isUser ? "var(--accent-fg)" : "var(--text-primary)",
              border: isUser ? "none" : "1px solid var(--border)",
            }}
          >
            {message.content}
          </div>
        )}

        {/* Streaming dots (when no content yet) */}
        {message.isStreaming && !message.content && (
          <div
            className="rounded-xl rounded-tl-sm px-4 py-3"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
          >
            <StreamingIndicator />
          </div>
        )}

        {/* Tool result cards */}
        {message.parseResult && <ParseCard result={message.parseResult} />}
        {message.lexiconResult && <LexiconCard result={message.lexiconResult} />}
        {message.scanResult && <ScansionCard result={message.scanResult} />}

        {/* Copy button */}
        {message.content && !message.isStreaming && (
          <button
            onClick={handleCopy}
            className="absolute -right-7 top-2 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ color: "var(--text-muted)" }}
            title="Copy message"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        )}
      </div>
    </div>
  )
}
