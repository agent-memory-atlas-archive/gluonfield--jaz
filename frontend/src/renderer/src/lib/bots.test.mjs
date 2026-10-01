import { describe, expect, test } from 'bun:test'
import { botChat, placePin } from './bots'

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
    const { entries } = botChat(
      [user(1, 1, 'move linkin park to in progress')],
      [wrote(2, 'Let me find the issue first.'), tool(3), said(4, 'Moved it.'), wrote(5, 'Done: DEM-6 is In Progress.')],
      self,
      false,
    )
    expect(shape(entries)).toEqual(['user: move linkin park to in progress', 'bot: Moved it.'])
  })

  test('a finished turn that sent nothing falls back to its last reply, even after messaging a bot', () => {
    const messages = [user(1, 1, 'hi')]
    const events = [wrote(2, 'Checking.'), woke(3, 'message_sent', 'Pip'), tool(4), wrote(5, 'Hi! What should we work on?')]
    expect(shape(botChat(messages, events, self, true).entries)).toEqual(['user: hi', '· message_sent'])
    expect(shape(botChat(messages, events, self, false).entries)).toEqual(['user: hi', '· message_sent', 'bot: Hi! What should we work on?'])
  })

  test('group turns and routine runs stay out of the chat unless the bot speaks', () => {
    const { entries } = botChat(
      [user(1, 1, 'hi')],
      [said(2, 'Hey.'), woke(3, 'group', 'Team'), wrote(4, 'PASS'), woke(5, 'routine', 'Digest'), wrote(6, 'Nothing new.'), woke(7, 'message_sent', 'dr eggbot'), event(8, { type: 'agent_switch', content: 'codex' })],
      self,
      false,
    )
    expect(shape(entries)).toEqual(['user: hi', 'bot: Hey.', '· message_sent', '· agent_switch'])
  })

  test('a working bot says what it is busy with, since when and its latest note, until the user writes again', () => {
    const events = [said(2, 'Hey.'), woke(3, 'group', 'Team'), wrote(4, 'Reading the CRM.\n\nChecking two more threads.')]
    expect(botChat([user(1, 1, 'hi')], events, self, true).work).toEqual({ doing: 'working in Team', since: at(3), note: 'Checking two more threads.' })
    expect(botChat([user(1, 1, 'hi')], [...events, woke(5, 'routine', 'Say hi')], self, true).work).toEqual({ doing: 'running Say hi', since: at(5), note: undefined })
    expect(botChat([user(1, 1, 'hi'), user(2, 6, 'still there?')], events, self, true).work.doing).toBeUndefined()
  })
})

test('a dragged pin lands beside the tile under it, and holds still over itself or empty space', () => {
  expect(placePin(['a', 'b', 'c'], 'c', 'a', false)).toEqual(['c', 'a', 'b'])
  expect(placePin(['a', 'b', 'c'], 'a', 'b', true)).toEqual(['b', 'a', 'c'])
  expect(placePin(['a', 'b'], 'x', 'a', true)).toEqual(['a', 'x', 'b'])
  expect(placePin(['a', 'b'], 'x', undefined, false)).toEqual(['a', 'b', 'x'])
  expect(placePin(['a', 'b', 'c'], 'b', 'b', true)).toEqual(['a', 'b', 'c'])
  expect(placePin(['a', 'b'], 'a', undefined, false)).toEqual(['a', 'b'])
})
