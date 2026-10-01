import { useEffect } from 'react'
import { clientRuntime } from '@/lib/clientRuntime'
import { audioLevel } from '@/lib/voice/audioLevel'
import { useVoiceDocked } from '@/lib/voice/bot'
import { useGlobalVoice } from '@/lib/voice/VoiceProvider'

export function VoiceDesktopBridge() {
  const voice = useGlobalVoice()
  const { sessionId, bot, home, phase, muted, speakerMuted, activity, error, analyser, outputAnalyser, start, end, mute, muteSpeaker } = voice
  const face = bot?.avatar ?? null
  const docked = useVoiceDocked(home)
  useEffect(() => clientRuntime.voiceOverlay?.onCommand((command) => {
    const actions = { mute, muteSpeaker, reconnect: start, exit: end }
    if (command !== 'return') {
      actions[command]()
    }
  }), [end, mute, muteSpeaker, start])

  useEffect(() => {
    const bridge = clientRuntime.voiceOverlay
    if (!bridge) {
      return
    }
    if (!sessionId || phase === 'off') {
      bridge.publish(null)
      return
    }
    const samples = new Uint8Array(analyser?.fftSize ?? 0)
    const outputSamples = new Uint8Array(outputAnalyser?.fftSize ?? 0)
    const publish = () => bridge.publish({ face, home, phase, muted, speakerMuted, activity, error, docked,
      level: analyser && !muted ? audioLevel(analyser, samples) : 0,
      outputLevel: outputAnalyser ? audioLevel(outputAnalyser, outputSamples) : 0 })
    publish()
    if (!analyser && !outputAnalyser) {
      return
    }
    const timer = setInterval(publish, 80)
    return () => clearInterval(timer)
  }, [sessionId, face, home, phase, muted, speakerMuted, activity, error, analyser, outputAnalyser, docked])
  useEffect(() => () => clientRuntime.voiceOverlay?.publish(null), [])
  return null
}
