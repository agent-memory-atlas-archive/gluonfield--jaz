import { describe, expect, test } from 'bun:test'
import { botDoing, chatEntries } from './bots'

describe('bot chat log', () => {
  const self = { id: 'gimli', name: 'Gimli' }
  const at = (minute) => `2026-09-30T21:${String(minute).padStart(2, '0')}:00Z`
  const user = (seq, minute, text) => ({ seq, role: 'user', content: text, blocks: [], created_at: at(minute) })
  let seq = 0
  const event = (minute, fields) => ({ session_id: 'gimli', seq: ++seq, at: at(minute), ...fields })
  const said = (minute, text) => event(minute, { type: 'room_message', room_message: { speaker: 'bot', bot_id: 'gimli', name: 'Gimli', text } })
  const wrote = (minute, text) => event(minute, { type: 'acp_message', content: text, acp: { id: 'gimli' } })
  const tool = (minute) => event(minute, { type: 'acp', acp: { id: 'gimli', tool_calls: [{ id: 't', title: 'Run rm -rf build' }] } })
  const woke = (minute, kind, label) => event(minute, { type: 'bot_activity', bot_activity: { kind, label } })
  const shape = (entries) => entries.map((entry) => entry.kind === 'activity' ? `· ${entry.event.bot_activity?.kind ?? entry.event.type}` : `${entry.kind}: ${entry.text}`)

  test('shows only what was typed and sent, never the work between', () => {
    const entries = chatEntries(
      [user(1, 1, 'move linkin park to in progress')],
      [wrote(2, 'Let me find the issue first.'), tool(3), said(4, 'Moved it.'), wrote(5, 'Done: DEM-6 is In Progress.')],
      self,
      false,
    )
    expect(shape(entries)).toEqual(['user: move linkin park to in progress', 'bot: Moved it.'])
  })

  test('a finished turn that sent nothing falls back to its last reply', () => {
    const messages = [user(1, 1, 'hi')]
    const events = [wrote(2, 'Checking.'), tool(3), wrote(4, 'Hi! What should we work on?')]
    expect(shape(chatEntries(messages, events, self, true))).toEqual(['user: hi'])
    expect(shape(chatEntries(messages, events, self, false))).toEqual(['user: hi', 'bot: Hi! What should we work on?'])
  })

  test('group turns and routine runs stay out of the chat unless the bot speaks', () => {
    const entries = chatEntries(
      [user(1, 1, 'hi')],
      [said(2, 'Hey.'), woke(3, 'group', 'Team'), wrote(4, 'PASS'), woke(5, 'routine', 'Digest'), wrote(6, 'Nothing new.'), woke(7, 'message_sent', 'dr eggbot'), event(8, { type: 'agent_switch', content: 'codex' })],
      self,
      false,
    )
    expect(shape(entries)).toEqual(['user: hi', 'bot: Hey.', '· message_sent', '· agent_switch'])
  })

  test('a working bot says what it is busy with until the user writes again', () => {
    const events = [said(2, 'Hey.'), woke(3, 'group', 'Team')]
    expect(botDoing([user(1, 1, 'hi')], events)).toBe('working in Team')
    expect(botDoing([user(1, 1, 'hi')], [...events, woke(4, 'routine', 'Say hi')])).toBe('running Say hi')
    expect(botDoing([user(1, 1, 'hi'), user(2, 5, 'still there?')], events)).toBeUndefined()
  })
})
