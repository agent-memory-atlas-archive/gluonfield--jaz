import type { VoiceState } from '@/lib/voice/session'

export function audioLevel(analyser: AnalyserNode, samples: Uint8Array<ArrayBuffer>): number {
  analyser.getByteTimeDomainData(samples)
  let energy = 0
  for (const sample of samples) {
    energy += ((sample - 128) / 128) ** 2
  }
  return Math.min(1, Math.sqrt(energy / samples.length) * 5)
}

// Reads a voice's input and output levels: from its analysers in the window
// that owns the audio, or from the levels another window relays.
export class VoiceLevels {
  private input = new Uint8Array(0)
  private output = new Uint8Array(0)

  read(voice: VoiceState, level: number, outputLevel: number): { input: number; output: number } {
    if (voice.analyser && this.input.length !== voice.analyser.fftSize) {
      this.input = new Uint8Array(voice.analyser.fftSize)
    }
    if (voice.outputAnalyser && this.output.length !== voice.outputAnalyser.fftSize) {
      this.output = new Uint8Array(voice.outputAnalyser.fftSize)
    }
    return {
      input: voice.muted ? 0 : voice.analyser ? audioLevel(voice.analyser, this.input) : level,
      output: voice.outputAnalyser ? audioLevel(voice.outputAnalyser, this.output) : outputLevel,
    }
  }
}
