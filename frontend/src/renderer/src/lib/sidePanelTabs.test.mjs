import { expect, test } from 'bun:test'
import { sidePanelTabs } from '@/lib/sidePanelTabs'

const empty = { tabs: [], activeId: null }
const open = (state, tab) => sidePanelTabs(state, { type: 'open', tab })

test('files replace the empty picker, reuse a path, and preserve separate documents', () => {
  let state = open(empty, { id: 'file', kind: 'file', file: null })
  state = open(state, { id: 'file:a', kind: 'file', file: { path: '/a.md', line: 1 } })
  state = open(state, { id: 'file:b', kind: 'file', file: { path: '/b.md' } })
  state = open(state, { id: 'file:a', kind: 'file', file: { path: '/a.md', line: 42 } })
  expect(state.tabs).toHaveLength(2)
  expect(state.tabs[0].file.line).toBe(42)
  expect(state.tabs[1].file.path).toBe('/b.md')
  expect(state.activeId).toBe('file:a')
})

test('closing a tab selects its right neighbour, then left, then the empty state', () => {
  let state = empty
  for (const id of ['one', 'two', 'three']) {
    state = open(state, { id, kind: 'preview' })
  }
  state = sidePanelTabs(state, { type: 'select', id: 'two' })
  state = sidePanelTabs(state, { type: 'close', id: 'two' })
  expect(state.activeId).toBe('three')
  state = sidePanelTabs(state, { type: 'close', id: 'three' })
  expect(state.activeId).toBe('one')
  state = sidePanelTabs(state, { type: 'close', id: 'one' })
  expect(state).toEqual(empty)
})

test('closing an inactive tab keeps selection and stale actions cannot select a missing tab', () => {
  let state = open(empty, { id: 'terminal', kind: 'terminal' })
  state = open(state, { id: 'browser', kind: 'preview' })
  state = sidePanelTabs(state, { type: 'close', id: 'terminal' })
  expect(state.activeId).toBe('browser')
  expect(sidePanelTabs(state, { type: 'select', id: 'terminal' })).toBe(state)
  expect(sidePanelTabs(state, { type: 'close', id: 'terminal' })).toBe(state)
})
