import { useCallback } from 'react'
import { useRouter } from '@tanstack/react-router'
import { initialVoiceState } from '@/lib/voice/session'
import { useGlobalVoice } from '@/lib/voice/VoiceProvider'

export function useVoiceMode(sessionId: string) {
  const voice = useGlobalVoice()
  const router = useRouter()
  const { sessionId: owner, home, connect, start: reconnect, phase } = voice
  const start = useCallback(() => {
    if (owner && phase !== 'off' && owner !== sessionId) {
      router.history.push(home)
    } else if (owner && phase !== 'off') {
      if (phase === 'error') {
        reconnect()
      }
    } else {
      connect(sessionId)
    }
  }, [connect, home, owner, phase, reconnect, router, sessionId])
  return { ...voice, ...(owner !== sessionId ? initialVoiceState : {}), start }
}
