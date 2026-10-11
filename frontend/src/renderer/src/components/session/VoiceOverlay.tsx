import { useCallback, useEffect, useState } from 'react'
import type { VoiceOverlayState } from '@shared/voice'
import { FloatingVoice } from '@/components/session/FloatingVoice'
import { clientRuntime } from '@/lib/clientRuntime'

export function VoiceOverlay() {
  const [state, setState] = useState<VoiceOverlayState | null>(null)
  useEffect(() => clientRuntime.voiceOverlay?.subscribe(setState), [])
  // The window is exactly as tall as the pill and its transcript.
  const fit = useCallback((root: HTMLDivElement | null) => {
    if (!root) {
      return
    }
    const observer = new ResizeObserver(() => clientRuntime.voiceOverlay!.resize(root.offsetHeight))
    observer.observe(root)
    return () => observer.disconnect()
  }, [])
  if (!state) {
    return null
  }
  const command = clientRuntime.voiceOverlay!.command
  const voice = { ...state, analyser: null, outputAnalyser: null,
    start: () => command('reconnect'), end: () => command('exit'), dismiss: () => command('exit'),
    mute: () => command('mute'), muteSpeaker: () => command('muteSpeaker') }
  return <div ref={fit} className="flex justify-center p-3"><FloatingVoice voice={voice} face={state.face} level={state.level} outputLevel={state.outputLevel} onReturn={() => command('return')} /></div>
}
