import { useRouter, useRouterState } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { VoicePill } from '@/components/session/VoiceMode'
import { clientRuntime } from '@/lib/clientRuntime'
import { useVoiceBot, voiceHome } from '@/lib/voice/bot'
import type { VoiceHandle } from '@/lib/voice/session'
import { useGlobalVoice } from '@/lib/voice/VoiceProvider'

// The voice pill away from its chat: drag it anywhere, click it to go back.
// Its own buttons keep their clicks.
export function FloatingVoice({ voice, sessionId, onReturn, level, outputLevel }: {
  voice: VoiceHandle
  sessionId: string
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
      <VoicePill voice={voice} sessionId={sessionId} level={level} outputLevel={outputLevel} onReturn={onReturn} />
    </div>
  )
}

export function GlobalVoice() {
  const voice = useGlobalVoice()
  const router = useRouter()
  const bot = useVoiceBot(voice.sessionId)
  const location = useRouterState({ select: (state) => state.location })
  if (clientRuntime.voiceOverlay || voice.phase === 'off' || !voice.sessionId) {
    return null
  }
  const home = voiceHome(voice.sessionId, bot)
  if (location.pathname === home && !location.search.settings) {
    return null
  }
  return (
    <div className="fixed right-5 bottom-5 z-[80] max-sm:right-3 max-sm:bottom-3">
      <FloatingVoice voice={voice} sessionId={voice.sessionId} onReturn={() => router.history.push(home)} />
    </div>
  )
}
