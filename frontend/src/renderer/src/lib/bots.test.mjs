import { describe, expect, test } from 'bun:test'
import { botAvatars, botIdFromTarget, botSections, botTarget, chatEntries } from './bots'

function bot(id, { name = id, pinned = false, at = '2026-09-01T00:00:00Z', kind = 'bot', members } = {}) {
  return { id, kind, name, pinned, members, updated_at: at, avatar: { shape: 'circle', color: id } }
}

describe('bot panel sections', () => {
  test('pinned tiles stay in name order while the list follows activity', () => {
    const bots = [
      bot('b', { pinned: true, at: '2026-09-03T00:00:00Z' }),
      bot('a', { pinned: true, at: '2026-09-01T00:00:00Z' }),
      bot('old', { at: '2026-09-01T00:00:00Z' }),
      bot('fresh', { at: '2026-09-02T00:00:00.5Z' }),
      bot('mid', { at: '2026-09-02T00:00:00Z' }),
    ]

    const { pinned, rest } = botSections(bots, '')

    expect(pinned.map((item) => item.id)).toEqual(['a', 'b'])
    expect(rest.map((item) => item.id)).toEqual(['fresh', 'mid', 'old'])
  })

  test('search filters both sections by name, ignoring case', () => {
    const bots = [bot('1', { name: 'Inbox', pinned: true }), bot('2', { name: 'Standup' }), bot('3', { name: 'inbox zero' })]

    const { pinned, rest } = botSections(bots, ' INBOX ')

    expect(pinned.map((item) => item.id)).toEqual(['1'])
    expect(rest.map((item) => item.id)).toEqual(['3'])
  })
})

test('groups wear their first two members and fall back to their own face', () => {
  const members = [bot('red'), bot('blue'), bot('green')]
  const group = bot('purple', { kind: 'group', members: ['gone', 'red', 'blue', 'green'] })

  expect(botAvatars(group, members).map((avatar) => avatar.color)).toEqual(['red', 'blue'])
  expect(botAvatars({ ...group, members: ['gone'] }, members).map((avatar) => avatar.color)).toEqual(['purple'])
})

test('bot mention targets round-trip and leave other targets alone', () => {
  expect(botIdFromTarget(botTarget('20260930T101500-abcdef12'))).toBe('20260930T101500-abcdef12')
  expect(botIdFromTarget('20260930T101500-abcdef12')).toBeUndefined()
  expect(botIdFromTarget('/workspace/bot:notes.md')).toBeUndefined()
})

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
  const shape = (entries) => entries.map((entry) => entry.kind === 'activity' ? `· ${entry.event.bot_activity.kind}` : `${entry.kind}: ${entry.text}`)

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
      [said(2, 'Hey.'), woke(3, 'group', 'Team'), wrote(4, 'PASS'), woke(5, 'routine', 'Digest'), wrote(6, 'Nothing new.'), woke(7, 'message_sent', 'dr eggbot')],
      self,
      false,
    )
    expect(shape(entries)).toEqual(['user: hi', 'bot: Hey.', '· message_sent'])
  })
})

