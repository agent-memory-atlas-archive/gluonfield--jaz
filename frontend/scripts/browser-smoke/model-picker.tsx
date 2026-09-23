import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AgentModelControls, useNewThreadControls } from '@/components/session/useNewThreadControls'
import type { AgentSettings, ModelCatalogEntry } from '@/lib/api/types'
import { NEW_SESSION_AGENT_KEY, NEW_SESSION_MODELS_KEY } from '@/lib/newSessionConfig'
import { keys } from '@/lib/query/keys'

export async function exerciseModelPicker(): Promise<void> {
  const model = (value: string, label: string, efforts: string[]): ModelCatalogEntry => ({
    value, label, reasoning: { status: 'ready', efforts, default_effort: 'medium' },
  })
  const efforts = ['low', 'medium', 'high', 'xhigh', 'max']
  const codex = [
    model('gpt-6-astra', 'GPT-6 Astra', [...efforts, 'ultra']),
    model('gpt-5.6-sol', 'GPT-5.6 Sol', [...efforts, 'ultra']),
    model('gpt-5.6-terra', 'GPT-5.6 Terra', efforts),
  ]
  const claude = [
    model('opus[1m]', 'Opus 5.5', [...efforts, 'ultracode']),
    model('sonnet', 'Sonnet 5', efforts),
    model('haiku', 'Haiku 4.5', []),
  ]
  const providers = ['openai', 'openrouter'].map((id) => ({ id, label: id, base_url: '', implemented: true }))
  const settings: AgentSettings = {
    providers, agents: ['codex', 'claude'],
    acp: {
      codex: { enabled: true, model_provider: 'openai', model: 'gpt-6-astra', reasoning_effort: 'medium' },
      claude: { enabled: true, model: 'opus[1m]', reasoning_effort: 'xhigh' },
    },
    acp_options: {
      codex: { local: true, supports_auth: false, reasoning_efforts: [], provider_mode: 'agent_defaults', model_providers: providers, models: codex },
      claude: { local: true, supports_auth: false, reasoning_efforts: [], models: claude },
    },
  }
  const originalFetch = window.fetch
  const originalAgent = localStorage.getItem(NEW_SESSION_AGENT_KEY)
  const originalModels = localStorage.getItem(NEW_SESSION_MODELS_KEY)
  localStorage.setItem(NEW_SESSION_AGENT_KEY, 'codex')
  localStorage.removeItem(NEW_SESSION_MODELS_KEY)
  window.fetch = async (input, init) => {
    const url = String(input)
    if (url.includes('/v1/settings/agents')) {
      return Response.json(settings)
    }
    if (url.includes('/v1/model-providers/')) {
      return Response.json({ models: url.includes('/openai/') ? codex : [model('qwen/qwen3', 'Qwen 3', ['low', 'high'])] })
    }
    return originalFetch(input, init)
  }
  const element = document.createElement('div')
  element.style.cssText = 'position:fixed;inset:0;background:var(--color-bg);padding:280px 24px 24px;z-index:1'
  document.body.append(element)
  const root = createRoot(element)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  let controls: ReturnType<typeof useNewThreadControls>
  const until = async (check: () => boolean) => {
    const end = Date.now() + 5000
    while (!check()) {
      if (Date.now() > end) {
        throw new Error('Model picker: ' + check.toString())
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  const button = (name: string) => [...document.querySelectorAll('button')].find((item) => item.getAttribute('aria-label') === name || item.textContent?.trim() === name)
  const slider = () => document.querySelector<HTMLInputElement>('input[type="range"]')!
  const frame = () => new Promise(requestAnimationFrame)
  const click = async (target: Element | undefined) => {
    if (!target) {
      throw new Error('Missing model picker control')
    }
    await frame()
    const rect = target.getBoundingClientRect()
    const x = Math.round(rect.x + rect.width / 2)
    const y = Math.round(rect.y + rect.height / 2)
    await window.smoke.pointer('mouseMove', x, y)
    await window.smoke.pointer('mouseDown', x, y)
    await frame()
    await window.smoke.pointer('mouseUp', x, y)
    await frame()
  }
  const configIs = (agent: string, model: string, effort: string) => {
    const config = controls.sessionConfig({ directory: '', worktree: false })
    return config.agent === agent && config.model === model && config.reasoning_effort === effort
  }
  function Composer() {
    controls = useNewThreadControls()
    return <div className="flex flex-wrap gap-2 rounded-card bg-surface p-3"><AgentModelControls controls={controls} /></div>
  }
  const render = (key: number) => root.render(<StrictMode><QueryClientProvider client={client}><Composer key={key} /></QueryClientProvider></StrictMode>)
  const openPicker = async () => {
    await click([...element.querySelectorAll('button')].find((item) => item.getAttribute('aria-label')?.startsWith('Model:')))
    await until(() => Boolean(slider()))
    await until(() => document.activeElement?.getAttribute('aria-label')?.startsWith('Select model,') === true)
    await until(() => getComputedStyle(document.querySelector('[role="dialog"]')!.parentElement!).opacity === '1')
  }
  const openModels = async () => {
    await click([...document.querySelectorAll('button')].find((item) => item.getAttribute('aria-label')?.startsWith('Select model,')))
    await until(() => document.activeElement?.getAttribute('aria-label') === 'Search models')
  }
  const close = async () => {
    await window.smoke.key('Escape')
    await until(() => !document.querySelector('[role="dialog"]'))
    if (!document.activeElement?.getAttribute('aria-label')?.startsWith('Model:')) {
      throw new Error('Picker lost focus on Escape')
    }
  }

  try {
    render(0)
    await until(() => controls?.modelSuggestions.length === 3)
    await openPicker()
    await window.smoke.key('Tab')
    if (document.activeElement !== slider()) {
      throw new Error('Natural Tab sequence missed the slider')
    }
    await window.smoke.key('Home')
    const expected = [
      ['gpt-5.6-terra', 'low'], ['gpt-5.6-sol', 'low'], ['gpt-5.6-sol', 'medium'],
      ['gpt-6-astra', 'low'], ['gpt-6-astra', 'medium'], ['gpt-6-astra', 'xhigh'],
    ]
    for (const [index, [id, effort]] of expected.entries()) {
      if (index > 0) {
        await window.smoke.key('Right')
      }
      await until(() => configIs('codex', id, effort))
    }
    await openModels()
    await click(button('GPT-6 Astra'))
    await until(() => slider()?.getAttribute('aria-label') === 'Reasoning effort')
    await window.smoke.key('Tab')
    if (document.activeElement !== slider()) {
      throw new Error('Fixed model selection lost keyboard focus: ' + document.activeElement?.outerHTML)
    }
    await window.smoke.key('End')
    await until(() => configIs('codex', 'gpt-6-astra', 'ultra'))
    await window.smoke.capture('codex-picker')
    await close()
    await click(button('Agent: Codex'))
    await click(button('Claude'))
    await until(() => configIs('claude', 'opus[1m]', 'xhigh'))
    await openPicker()
    await openModels()
    await click(button('Opus 5.5'))
    await until(() => slider()?.getAttribute('aria-label') === 'Reasoning effort')
    await window.smoke.key('Tab')
    await window.smoke.key('Home')
    await window.smoke.key('Right')
    for (const effort of ['high', 'xhigh', 'max', 'ultracode']) {
      await window.smoke.key('Right')
      await until(() => configIs('claude', 'opus[1m]', effort))
    }
    const rect = slider().getBoundingClientRect()
    const y = Math.round(rect.y + rect.height / 2)
    await window.smoke.pointer('mouseDown', Math.round(rect.right - 16), y)
    await frame()
    await window.smoke.pointer('mouseMove', Math.round(rect.left + 16), y)
    await frame()
    await window.smoke.pointer('mouseMove', Math.round(rect.right - 16), y)
    await window.smoke.pointer('mouseUp', Math.round(rect.right - 16), y)
    await until(() => configIs('claude', 'opus[1m]', 'ultracode'))
    await window.smoke.capture('claude-picker')
    await close()
    const previousControls = controls
    render(1)
    await until(() => controls !== previousControls && controls.pickerMode === 'model' && configIs('claude', 'opus[1m]', 'ultracode'))
    await click(button('Agent: Claude'))
    await click(button('Codex'))
    await until(() => controls.pickerMode === 'model' && configIs('codex', 'gpt-6-astra', 'ultra'))
    settings.acp.codex = { ...settings.acp.codex, model_provider: 'openrouter', model: 'qwen/qwen3', reasoning_effort: 'high' }
    client.setQueryData(keys.agentSettings, { ...settings })
    await until(() => configIs('codex', 'qwen/qwen3', 'high'))
    settings.acp.codex = { ...settings.acp.codex, model_provider: 'openai', model: 'gpt-6-astra' }
    client.setQueryData(keys.agentSettings, { ...settings })
    await until(() => configIs('codex', 'gpt-6-astra', 'ultra'))
    await openPicker()
    await openModels()
    await click(button('Recommended'))
    await until(() => slider()?.getAttribute('aria-label') === 'Recommended model and effort')
    await close()
    await window.smoke.resize(390, 760)
    await openPicker()
    const bounds = document.querySelector('[role="dialog"]')!.getBoundingClientRect()
    if (bounds.left < 0 || bounds.right > innerWidth) {
      throw new Error('Picker overflows mobile viewport')
    }
    await window.smoke.capture('model-picker-mobile')
    await close()
  } finally {
    root.unmount()
    client.clear()
    element.remove()
    window.fetch = originalFetch
    for (const [key, value] of [[NEW_SESSION_AGENT_KEY, originalAgent], [NEW_SESSION_MODELS_KEY, originalModels]] as const) {
      if (value == null) {
        localStorage.removeItem(key)
      } else {
        localStorage.setItem(key, value)
      }
    }
    await window.smoke.resize(1100, 780)
  }
}
