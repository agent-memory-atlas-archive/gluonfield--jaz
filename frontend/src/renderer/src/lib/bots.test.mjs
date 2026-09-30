import { describe, expect, test } from 'bun:test'
import { botAvatars, botIdFromTarget, botSections, botTarget } from './bots'

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
