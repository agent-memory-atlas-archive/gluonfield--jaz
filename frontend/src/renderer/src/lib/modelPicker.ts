import { modelSuggestionFor, type ModelSuggestion } from '@/lib/modelSuggestion'

export type ModelPickerMode = 'recommended' | 'model'

export interface ModelSelection {
  model: string
  effort: string
  mode: ModelPickerMode
}

const presets: Record<string, [string, string][]> = {
  codex: [
    ['gpt-5.6-terra', 'low'],
    ['gpt-5.6-sol', 'low'],
    ['gpt-5.6-sol', 'medium'],
    ['gpt-6-astra', 'low'],
    ['gpt-6-astra', 'medium'],
    ['gpt-6-astra', 'xhigh'],
  ],
  claude: [
    ['sonnet', 'low'],
    ['sonnet', 'medium'],
    ['opus[1m]', 'low'],
    ['opus[1m]', 'medium'],
    ['opus[1m]', 'high'],
    ['opus[1m]', 'xhigh'],
  ],
}

export function modelPresets(agent: string, suggestions: ModelSuggestion[]): ModelSelection[] {
  return (presets[agent] ?? []).flatMap(([id, effort]) => {
    const model = modelSuggestionFor(suggestions, id)
    return model?.reasoning.status === 'ready' && model.reasoning.efforts?.includes(effort)
      ? [{ model: model.value, effort, mode: 'recommended' as const }]
      : []
  })
}

export function parseModelSelections(raw: string | null): Record<string, ModelSelection> {
  try {
    const parsed = JSON.parse(raw ?? '{}')
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, ModelSelection] => {
      const value = entry[1] as Partial<ModelSelection> | null
      return value != null && typeof value.model === 'string' && typeof value.effort === 'string'
        && (value.mode === 'model' || value.mode === 'recommended')
    }))
  } catch {
    return {}
  }
}
