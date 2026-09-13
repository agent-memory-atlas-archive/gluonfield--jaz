import { Mic, MicOff, RotateCcw, Volume2, VolumeX, X } from 'lucide-react'
import { IconButton } from '@/components/ui/IconButton'
import { VoiceVisualizer } from '@/components/session/VoiceVisualizer'
import type { VoiceHandle } from '@/lib/voice/session'

export function VoiceMode({ voice }: { voice: VoiceHandle }) {
  if (voice.phase === 'off') {
    return voice.error ? <p role="alert" className="mb-3 text-center text-xs text-danger">{voice.error}</p> : null
  }
  const status = voice.phase === 'connecting' ? 'Connecting voice…'
    : voice.phase === 'ending' ? 'Ending voice…'
    : voice.phase === 'error' ? 'Voice disconnected'
    : voice.muted ? 'Microphone muted' : ''

  return (
    <div className="mb-3 flex flex-col items-center" aria-label="Voice conversation">
      <div className="pointer-events-none">
        <VoiceVisualizer voice={voice} />
      </div>
      <p className="mt-1 flex h-5 items-center text-xs text-ink-2">
        {status ? <span role="status" aria-atomic="true">{status}</span> : null}
      </p>
      {voice.error ? <p role="alert" className="mt-1 max-w-sm text-center text-xs text-danger">{voice.error}</p> : null}
    </div>
  )
}

export function VoiceControls({ voice, floating = false }: { voice: VoiceHandle; floating?: boolean }) {
  const microphoneLabel = voice.muted ? 'Unmute microphone' : 'Mute microphone'
  const speakerLabel = voice.speakerMuted ? 'Unmute speaker' : 'Mute speaker'
  const size = floating ? 'sm' : 'md'
  const variant = floating ? 'inverse' : 'ghost'
  const hitArea = floating ? '[-webkit-app-region:no-drag]' : 'relative after:absolute after:-inset-1 aria-pressed:bg-surface-2 aria-pressed:text-ink'
  const buttons = (
    <>
      {voice.phase === 'error' ? (
        <IconButton size={size} variant={variant} className={hitArea} title="Reconnect voice" aria-label="Reconnect voice" onClick={voice.start}>
          <RotateCcw size={16} />
        </IconButton>
      ) : (
        <IconButton size={size} variant={variant} className={hitArea} title={microphoneLabel} aria-label={microphoneLabel} aria-pressed={voice.muted} disabled={voice.phase !== 'listening'} onClick={voice.mute}>
          {voice.muted ? <MicOff size={17} /> : <Mic size={17} />}
        </IconButton>
      )}
      <IconButton size={size} variant={variant} className={floating ? hitArea : `${hitArea} bg-ink! text-bg! hover:bg-ink/85!`} title="Close voice mode" aria-label="Close voice mode" disabled={voice.phase === 'ending'} onClick={voice.end}>
        <X size={17} />
      </IconButton>
      <IconButton size={size} variant={variant} className={hitArea} title={speakerLabel} aria-label={speakerLabel} aria-pressed={voice.speakerMuted} disabled={voice.phase !== 'listening'} onClick={voice.muteSpeaker}>
        {voice.speakerMuted ? <VolumeX size={17} /> : <Volume2 size={17} />}
      </IconButton>
    </>
  )
  return floating ? <div className="flex items-center gap-1 rounded-full bg-black/70 p-0.5 shadow-[0_2px_10px_rgba(0,0,0,0.25)]">{buttons}</div> : buttons
}
