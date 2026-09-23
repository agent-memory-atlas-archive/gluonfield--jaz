import { ChevronDown, ChevronLeft, ChevronRight, LoaderCircle, Zap } from 'lucide-react'
import { useRef, useState } from 'react'
import { ReasoningEffortSlider } from '@/components/acp/ReasoningEffortSlider'
import { Button } from '@/components/ui/Button'
import { MenuRow, Popover } from '@/components/ui/Popover'
import type { ReasoningEffortOption } from '@/lib/api/types'
import { modelPresets, type ModelPickerMode, type ModelSelection } from '@/lib/modelPicker'
import { filterModelSuggestions, modelSuggestionFor, modelSuggestionLabel, type ModelSuggestion } from '@/lib/models'
import { reasoningEffortLabel } from '@/lib/reasoningEfforts'

export function ModelSelect({
  agent,
  value,
  effort,
  mode,
  suggestions,
  effortOptions,
  loading,
  disabled,
  placement,
  onChange,
}: {
  agent: string
  value: string
  effort: string
  mode: ModelPickerMode
  suggestions: ModelSuggestion[]
  effortOptions: ReasoningEffortOption[]
  loading?: boolean
  disabled?: boolean
  placement?: 'above' | 'below'
  onChange: (selection: ModelSelection) => void
}) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'slider' | 'models'>('slider')
  const [query, setQuery] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)

  const selected = modelSuggestionFor(suggestions, value)
  const effortValue = effort || selected?.reasoning.default_effort || ''
  const label = value ? modelSuggestionLabel(suggestions, value) : 'Model'
  const effortLabel = selected?.reasoning.automatic && effortOptions.length === 0
    ? 'Thinking'
    : reasoningEffortLabel(effortValue, effortOptions)
  const presets = modelPresets(agent, suggestions)
  const presetIndex = presets.findIndex((preset) => preset.model === selected?.value && preset.effort === effortValue)
  const recommended = mode === 'recommended' && presets.length > 1 && presetIndex >= 0
  const effortStops = effortOptions.filter((option) => option.value !== '')
  if (effortStops.length && !effortStops.some((option) => option.value === effortValue)) {
    effortStops.unshift({ value: effortValue, label: effortLabel })
  }
  const stops = recommended
    ? presets.map((preset, index) => ({
        value: String(index),
        label: `${modelSuggestionLabel(suggestions, preset.model)} ${reasoningEffortLabel(preset.effort, effortOptions)}`,
      }))
    : effortStops
  const filtered = filterModelSuggestions(suggestions, query)
  const typed = query.trim()
  const typedIsNew = typed !== '' && !modelSuggestionFor(suggestions, typed)
  const showModels = () => {
    setQuery('')
    setView('models')
  }
  const selectModel = (model: string) => {
    const next = modelSuggestionFor(suggestions, model)
    onChange({
      model,
      effort: next?.reasoning.efforts?.includes(effortValue) ? effortValue : next?.reasoning.default_effort ?? '',
      mode: 'model',
    })
    setView('slider')
  }
  const title = `${label} ${effortLabel}`

  return (
    <Popover
      open={open}
      onClose={() => {
        setOpen(false)
        triggerRef.current?.focus()
      }}
      placement={placement}
      trigger={
        <Button
          ref={triggerRef}
          variant="secondary"
          size="sm"
          className="max-w-[13rem]"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Model: ${label}, reasoning effort: ${effortLabel}`}
          title={title}
          disabled={disabled}
          onClick={() => {
            setView('slider')
            setOpen(!open)
          }}
        >
          <span className="truncate">{label}</span>
          <span className="shrink-0 text-ink-3">{effortLabel}</span>
          <ChevronDown size={13} className="shrink-0" />
        </Button>
      }
    >
      <div role="dialog" aria-label="Model and effort" className="w-[280px] max-w-[calc(100vw-32px)]">
        {view === 'slider' ? (
          <div key="slider" className="px-2 pb-1.5">
            <button
              autoFocus
              type="button"
              onClick={showModels}
              aria-label={`Select model, ${recommended ? 'Recommended, ' : ''}${title}`}
              className="flex min-h-10 w-full items-center gap-2 rounded-control px-1 text-[13px] outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-primary"
            >
              {recommended ? <Zap size={16} className="shrink-0 text-ink-3" aria-label="Recommended" /> : null}
              <span className="min-w-0 flex-1 truncate text-ink">
                {label} <span className="text-ink-3">{effortLabel}</span>
              </span>
              {loading ? <LoaderCircle size={14} className="shrink-0 animate-spin text-ink-3" /> : <ChevronRight size={15} className="shrink-0 text-ink-3" />}
            </button>
            {stops.length > 1 ? (
              <ReasoningEffortSlider
                compact
                options={stops}
                value={recommended ? String(presetIndex) : effortValue}
                ariaLabel={recommended ? 'Recommended model and effort' : 'Reasoning effort'}
                disabled={disabled || loading}
                onChange={(next) => onChange(recommended
                  ? presets[Number(next)]
                  : { model: value, effort: next, mode: 'model' })}
              />
            ) : null}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1 pb-1">
              <button type="button" aria-label="Back to effort" onClick={() => setView('slider')} className="flex size-10 shrink-0 items-center justify-center rounded-control text-ink-3 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-primary">
                <ChevronLeft size={16} />
              </button>
              <input
                autoFocus
                value={query}
                aria-label="Search models"
                placeholder="Search models…"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && typed) {
                    event.preventDefault()
                    selectModel(filtered[0]?.value ?? typed)
                  }
                }}
                className="h-9 min-w-0 flex-1 rounded-full bg-ink/10 px-3 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:ring-1 focus:ring-ink/25"
              />
            </div>
            <div className="max-h-[280px] overflow-y-auto [&>button]:min-h-10">
              {presets.length > 1 && !typed ? (
                <MenuRow selected={recommended} onClick={() => {
                  onChange(presets[presetIndex >= 0 ? presetIndex : Math.floor(presets.length / 2)])
                  setView('slider')
                }}>
                  Recommended
                </MenuRow>
              ) : null}
              {filtered.map((model) => (
                <MenuRow key={model.value} selected={!recommended && model.value === selected?.value} onClick={() => selectModel(model.value)}>
                  {model.label}
                </MenuRow>
              ))}
              {typedIsNew ? <MenuRow onClick={() => selectModel(typed)}>Use “{typed}”</MenuRow> : null}
              {loading ? <div className="px-3 py-2 text-[13px] text-ink-3">Loading models…</div> : null}
            </div>
          </>
        )}
      </div>
    </Popover>
  )
}
