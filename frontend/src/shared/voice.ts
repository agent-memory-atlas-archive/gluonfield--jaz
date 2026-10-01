import type { BotAvatar } from './bots'

export type VoiceWorkActivity = 'thinking' | 'working' | null

export type VoiceStatus = {
  phase: 'off' | 'connecting' | 'listening' | 'ending' | 'error'
  muted: boolean
  speakerMuted: boolean
  activity: VoiceWorkActivity
  error: string
}

export type VoiceOverlayState = VoiceStatus & {
  // The face of the bot the conversation is with, sent so the overlay never
  // has to look the bot up; null for Jaz.
  face: BotAvatar | null
  // The route the conversation lives on: its thread, or its bot's chat.
  home: string
  docked: boolean
  level: number
  outputLevel: number
}

export type VoiceCommand = 'mute' | 'muteSpeaker' | 'exit' | 'reconnect' | 'return'

export interface VoiceOverlayAPI {
  drag: (point: { x: number; y: number } | null) => void
  publish: (state: VoiceOverlayState | null) => void
  subscribe: (handler: (state: VoiceOverlayState | null) => void) => () => void
  command: (command: VoiceCommand) => void
  onCommand: (handler: (command: VoiceCommand) => void) => () => void
}
