import { useCallback } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useVoiceBot, voiceHome } from '@/lib/voice/bot'
import { initialVoiceState } from '@/lib/voice/session'
import { useGlobalVoice } from '@/lib/voice/VoiceProvider'

export function useVoiceMode(sessionId: string) {
  const voice = useGlobalVoice()
  const router = useRouter()
  const { sessionId: owner, connect, start: reconnect, phase } = voice
  const ownerBot = useVoiceBot(owner)
  const start = useCallback(() => {
    if (owner && phase !== 'off' && owner !== sessionId) {
      router.history.push(voiceHome(owner, ownerBot))
    } else if (owner && phase !== 'off') {
      if (phase === 'error') {
        reconnect()
      }
    } else {
      connect(sessionId)
    }
  }, [connect, owner, ownerBot, phase, reconnect, router, sessionId])
  return { ...voice, ...(owner !== sessionId ? initialVoiceState : {}), start }
}
