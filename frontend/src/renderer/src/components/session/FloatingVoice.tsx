import { useRouter } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import type { BotAvatar } from '@shared/bots'
import { VoicePill } from '@/components/session/VoiceMode'
import { clientRuntime } from '@/lib/clientRuntime'
import { useVoiceDocked } from '@/lib/voice/bot'
import type { VoiceHandle } from '@/lib/voice/session'
import { useGlobalVoice } from '@/lib/voice/VoiceProvider'

// The voice pill away from its chat: drag it anywhere, click it to go back.
// Its own buttons keep their clicks.
export function FloatingVoice({ voice, face, onReturn, level, outputLevel }: {
  voice: VoiceHandle
  face: BotAvatar | null
  onReturn: () => void
  level?: number
  outputLevel?: number
}) {
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const gesture = useRef<{ x: number; y: number; moved: boolean; origin: typeof offset } | null>(null)
  const finish = () => {
    clientRuntime.voiceOverlay?.drag(null)
    gesture.current = null
  }
  return (
    <div
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      aria-label="Floating voice conversation"
      className="touch-none cursor-grab drop-shadow-[0_6px_14px_rgba(0,0,0,0.28)] active:cursor-grabbing [-webkit-app-region:no-drag]"
      onPointerDown={(event) => {
        if (event.button !== 0 || (event.target as Element).closest('[data-voice-control]')) {
          return
        }
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        gesture.current = { x: event.screenX, y: event.screenY, moved: false, origin: offset }
        clientRuntime.voiceOverlay?.drag({ x: event.screenX, y: event.screenY })
      }}
      onPointerMove={(event) => {
        const start = gesture.current
        if (!start) {
          return
        }
        const x = event.screenX - start.x
        const y = event.screenY - start.y
        start.moved ||= Math.hypot(x, y) > 4
        if (!start.moved) {
          return
        }
        if (clientRuntime.voiceOverlay) {
          clientRuntime.voiceOverlay.drag({ x: event.screenX, y: event.screenY })
        } else {
          setOffset({ x: start.origin.x + x, y: start.origin.y + y })
        }
      }}
      onPointerUp={() => {
        const clicked = gesture.current && !gesture.current.moved
        finish()
        if (clicked) {
          onReturn()
        }
      }}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
    >
      <VoicePill voice={voice} face={face} level={level} outputLevel={outputLevel} onReturn={onReturn} />
    </div>
  )
}

export function GlobalVoice() {
  const voice = useGlobalVoice()
  const router = useRouter()
  const docked = useVoiceDocked(voice.home)
  if (clientRuntime.voiceOverlay || voice.phase === 'off' || !voice.sessionId || docked) {
    return null
  }
  return (
    <div className="fixed right-5 bottom-5 z-[80] max-sm:right-3 max-sm:bottom-3">
      <FloatingVoice voice={voice} face={voice.bot?.avatar ?? null} onReturn={() => router.history.push(voice.home)} />
    </div>
  )
}
