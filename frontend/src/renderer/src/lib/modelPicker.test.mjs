import { describe, expect, test } from 'bun:test'
import { modelPresets, parseModelSelections } from './modelPicker'
import { modelReasoningSelection } from './reasoningEfforts'

const model = (value, efforts, aliases) => ({
  value,
  label: value,
  aliases,
  reasoning: { status: 'ready', efforts },
})
const codex = [
  model('gpt-6-astra', ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']),
  model('gpt-5.6-sol', ['low', 'medium', 'high', 'xhigh']),
  model('gpt-5.6-terra', ['low', 'medium', 'high']),
]

describe('model picker presets', () => {
  test('orders the six Codex combinations without adding advanced efforts', () => {
    expect(modelPresets('codex', codex).map(({ model, effort }) => [model, effort])).toEqual([
      ['gpt-5.6-terra', 'low'],
      ['gpt-5.6-sol', 'low'],
      ['gpt-5.6-sol', 'medium'],
      ['gpt-6-astra', 'low'],
      ['gpt-6-astra', 'medium'],
      ['gpt-6-astra', 'xhigh'],
    ])
  })

  test('uses provider model IDs and only advertised efforts', () => {
    const suggestions = [
      model('openai/gpt-6-astra', ['medium'], ['gpt-6-astra']),
      { ...codex[1], reasoning: { status: 'pending' } },
    ]
    expect(modelPresets('codex', suggestions)).toEqual([
      { model: 'openai/gpt-6-astra', effort: 'medium', mode: 'recommended' },
    ])
    expect(modelPresets('codex', [])).toEqual([])
    expect(modelPresets('grok', codex)).toEqual([])
  })

  test('Claude presets leave Max and Ultracode accessible on the fixed Opus model', () => {
    const suggestions = [
      { ...model('opus[1m]', ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode']), label: 'Opus 5.5' },
      model('sonnet', ['low', 'medium', 'high']),
    ]
    expect(modelPresets('claude', suggestions).map(({ model, effort }) => [model, effort])).toEqual([
      ['sonnet', 'low'],
      ['sonnet', 'medium'],
      ['opus[1m]', 'low'],
      ['opus[1m]', 'medium'],
      ['opus[1m]', 'high'],
      ['opus[1m]', 'xhigh'],
    ])
    for (const effort of ['high', 'xhigh', 'max', 'ultracode']) {
      const selection = modelReasoningSelection({
        agent: 'claude', model: 'opus[1m]', requested: effort, settingsMode: false,
        catalog: { status: 'ready', suggestions, unknownModel: 'unavailable' },
      })
      expect(selection.effectiveEffort).toBe(effort)
      expect(selection.supported).toBe(true)
    }
  })
})

test('saved picker choices preserve mode and keep agents and providers separate', () => {
  const selections = {
    'codex/openai': { model: 'gpt-6-astra', effort: 'medium', mode: 'recommended' },
    'codex/openrouter': { model: 'qwen/qwen3', effort: '', mode: 'model' },
    'claude/': { model: 'opus[1m]', effort: 'ultracode', mode: 'model' },
  }
  expect(parseModelSelections(JSON.stringify(selections))).toEqual(selections)
  for (const raw of [null, 'null', '{bad json', '{"claude/":null}', '{"codex/openai":{"model":2}}']) {
    expect(parseModelSelections(raw)).toEqual({})
  }
})
