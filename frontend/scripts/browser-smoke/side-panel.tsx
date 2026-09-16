import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserWorkspace } from '@/components/browser/BrowserWorkspace'
import { SidePanel } from '@/components/session/SidePanel'
import { SidePanelControl } from '@/components/session/SidePanelControl'
import { SidePanelDrawer } from '@/components/session/SidePanelDrawer'
import { useSidePanelState } from '@/components/session/SidePanelState'
import { FileReaderLinkProvider, PreviewLinkProvider, RenderedMarkdown } from '@/components/session/MessageMarkdown'
import { isPreviewWebviewPending, type PreviewWebviewElement } from '@/components/session/previewWebview'
import type { Session } from '@/lib/api/types'
import { keys } from '@/lib/query/keys'
import { useIsMobile } from '@/lib/hooks/useIsMobile'
import { setThemePref } from '@/lib/theme'

export async function exerciseSidePanelTabs(): Promise<void> {
  const element = document.createElement('div')
  element.style.cssText = 'position:fixed;inset:0;background:var(--color-bg);z-index:1'
  document.body.append(element)
  const root = createRoot(element)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(keys.browserSettings, { enabled: false, mode: 'desktop' })
  queryClient.setQueryData(keys.health, { capabilities: { session_file_read: true } })
  queryClient.setQueryData(keys.sessionRepo('tabs'), { git: false })
  queryClient.setQueryData(keys.sessionRepoChanges('tabs'), { files: [{ path: 'change.ts', status: 'modified', added: 1, deleted: 0 }], total_added: 1, total_deleted: 0 })
  const diffKey = keys.sessionRepoDiff('tabs', 'modified:change.ts', '', '')
  queryClient.setQueryData(diffKey, { path: 'change.ts', patch: '@@ -1 +1 @@\n-before\n+after' })
  for (const path of ['/ANALYSIS.md', '/NOTES.md']) {
    queryClient.setQueryData(keys.sessionFile('tabs', path), { path, content: `# ${path.slice(1)}\n\nRetained document content.\n\n[Open notes](/NOTES.md)` })
  }
  const session: Session = {
    id: 'tabs', slug: 'tabs', title: 'Manufacturing research', runtime: 'acp', status: 'idle',
    created_at: '', updated_at: '', last_attention_at: '',
    runtime_ref: { type: 'acp', agent: 'codex', cwd: '/workspace' },
  }
  let panel: ReturnType<typeof useSidePanelState>
  let chatRenders = 0
  let terminalConnections = 0
  let terminalCloses = 0
  const terminalInput: string[] = []
  const NativeSocket = window.WebSocket
  class TerminalSocket {
    readyState = NativeSocket.OPEN
    onopen: (() => void) | null = null
    onmessage: ((event: { data: string }) => void) | null = null
    onclose: (() => void) | null = null
    constructor() {
      terminalConnections += 1
      setTimeout(() => {
        this.onopen?.()
        this.onmessage?.({ data: JSON.stringify({ type: 'ready', cwd: '/workspace' }) })
        this.onmessage?.({ data: JSON.stringify({ type: 'output', data: 'retained terminal output\r\n$ ' }) })
      }, 20)
    }
    send(data: string) {
      const message = JSON.parse(data)
      if (message.type === 'input') {
        terminalInput.push(message.data)
      }
    }
    close() {
      terminalCloses += 1
      this.readyState = NativeSocket.CLOSED
      this.onclose?.()
    }
  }
  window.WebSocket = new Proxy(NativeSocket, {
    construct(Target, args) {
      return String(args[0]).includes('/tabs/terminal') ? new TerminalSocket() : new Target(...args as [string])
    },
  })
  const noop = async () => {}
  function Chat() {
    chatRenders += 1
    const state = useSidePanelState('tabs', true)
    const isMobile = useIsMobile()
    useLayoutEffect(() => {
      panel = state
    })
    return <div ref={state.containerRef} className="flex h-full flex-col">
      <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-border px-4">
        <span className="truncate text-[13px] text-ink-2">Manufacturing research</span>
        <SidePanelControl open={state.open} mode={state.mode} onToggle={state.toggleMode} />
      </header>
      <div className="relative flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 p-8 text-ink" data-tab-chat>
          <FileReaderLinkProvider sessionId="tabs" onOpen={state.openFile}>
            <PreviewLinkProvider onOpen={state.openPreview}>
              <RenderedMarkdown text={`# Product research\n\nReview the [analysis](/ANALYSIS.md) and compare it with the [supplier website](${location.origin}/target?tabs=one).`} />
            </PreviewLinkProvider>
          </FileReaderLinkProvider>
        </div>
        <SidePanelDrawer panel={state} isMobile={isMobile}>
          <SidePanel session={session} panel={state} subagents={[]} spawnedThreads={[]} working={false} sideChatAvailable sideChatEvents={[]} onSend={noop} onQueuePrompt={noop} onQueueAction={noop} onSendSideChat={noop} />
        </SidePanelDrawer>
      </div>
    </div>
  }
  const until = async (check: () => boolean | Promise<boolean>) => {
    const end = Date.now() + 5000
    while (!await check()) {
      if (Date.now() > end) {
        throw new Error('Side panel check timed out: ' + check.toString())
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  const click = async (target: Element | null) => {
    if (!target) {
      throw new Error('Missing side panel control')
    }
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    await new Promise(requestAnimationFrame)
    const bounds = target.getBoundingClientRect()
    const x = Math.round(bounds.x + bounds.width / 2)
    const y = Math.round(bounds.y + bounds.height / 2)
    await window.smoke.pointer('mouseMove', x, y)
    await window.smoke.pointer('mouseDown', x, y)
    await window.smoke.pointer('mouseUp', x, y)
  }
  const button = (label: string) => [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === label && item.getBoundingClientRect().height)
  const tab = (id: string) => document.getElementById(`panel-tab-${id}`)
  const webview = (id: string) => document.querySelector(`[data-browser-session="${id}"] webview`) as PreviewWebviewElement
  const evaluate = async (view: PreviewWebviewElement, expression: string) => {
    const response = await window.jaz!.browserCommand({ webContentsId: view.getWebContentsId(), method: 'Runtime.evaluate', params: { expression, returnByValue: true } }) as { result: { value: unknown } }
    return response.result.value
  }
  const ready = async (id: string) => {
    const view = webview(id)
    if (!view) {
      return false
    }
    try {
      return await evaluate(view, 'document.readyState === "complete"') === true
    } catch (error) {
      if (!isPreviewWebviewPending(error)) {
        throw error
      }
      return false
    }
  }
  const add = async (label: string) => {
    await click(element.querySelector('[aria-label="New tab"]'))
    await until(() => Boolean(button(label)))
    await click(button(label)!)
    await until(() => !document.querySelector('[aria-label="New tab"][aria-expanded="true"]'))
  }
  try {
    await window.smoke.resize(1440, 900)
    setThemePref('dark')
    root.render(<QueryClientProvider client={queryClient}><BrowserWorkspace><Chat /></BrowserWorkspace></QueryClientProvider>)
    await until(() => Boolean(button('Side Panel')))
    await click(element.querySelector('[data-tab-chat] button'))
    await until(() => panel?.activeTab?.kind === 'file' && Boolean(element.querySelector('[role="tabpanel"] h1')))
    if (button('Overview')?.getAttribute('aria-pressed') !== 'false' || button('Side Panel')?.getAttribute('aria-pressed') !== 'true') {
      throw new Error('File links did not select the tabbed panel exclusively')
    }
    await until(() => element.querySelector('[role="tablist"]')!.getBoundingClientRect().width > 750)
    await click(element.querySelector('[role="tabpanel"] .chat-prose-link-button'))
    await until(() => panel.tabs.length === 2 && panel.activeTab?.id === 'file:/NOTES.md')
    await click(tab('file:/ANALYSIS.md'))
    await window.smoke.key('Right')
    await until(() => document.activeElement === tab('file:/NOTES.md'))
    await click(element.querySelector('[role="tabpanel"]:not([hidden]) input'))
    await window.smoke.key('P', ['control'])
    if (panel.activeTab?.id !== 'file:/NOTES.md') {
      throw new Error('Control+P in a file input was intercepted by the browser tab shortcut')
    }
    panel.openPreview(location.origin + '/target?tabs=one')
    await until(() => ready('tabs'))
    const first = webview('tabs')
    const firstID = first.getWebContentsId()
    await evaluate(first, 'window.retainedTabValue = 41')
    const firstSize = await evaluate(first, '[innerWidth,innerHeight].join(",")')
    await add('Browser')
    await until(() => panel.tabs.filter((entry) => entry.kind === 'preview').length === 2)
    const secondId = panel.activeTab!.id
    const input = document.querySelector<HTMLInputElement>(`[data-browser-session="${secondId}"] input`)!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, location.origin + '/target?tabs=two')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.form!.requestSubmit()
    await until(() => ready(secondId))
    await evaluate(webview(secondId), 'window.retainedTabValue = 92')
    await click(tab('tabs'))
    await until(() => !document.querySelector<HTMLElement>('[data-browser-session="tabs"]')!.inert)
    if (webview('tabs').getWebContentsId() !== firstID || await evaluate(first, 'window.retainedTabValue') !== 41 || await evaluate(first, '[innerWidth,innerHeight].join(",")') !== firstSize) {
      throw new Error('Switching tabs replaced or resized the retained browser')
    }
    await add('Terminal')
    await until(() => terminalConnections === 1 && element.textContent?.includes('retained terminal output') === true)
    await window.smoke.key('D', ['control'])
    if (terminalInput.join('') !== '\u0004' || panel.activeTab?.kind !== 'terminal') {
      throw new Error('Opening a terminal did not focus it or preserve Control+D input')
    }
    const terminal = element.querySelector('.xterm')
    await click(button('Overview')!)
    await until(() => button('Overview')!.getAttribute('aria-pressed') === 'true')
    if (element.querySelector('[role="tablist"]')!.getBoundingClientRect().height || !document.querySelector<HTMLElement>('[data-browser-session="tabs"]')!.inert) {
      throw new Error('Overview left tabs or browser visible')
    }
    await click(button('Side Panel')!)
    await until(() => panel.mode === 'tabs' && panel.open)
    if (terminalConnections !== 1 || terminalCloses || element.querySelector('.xterm') !== terminal) {
      throw new Error('Switching Overview restarted the terminal')
    }
    await add('Side chat')
    await until(() => Boolean(element.querySelector('textarea')))
    const composer = element.querySelector<HTMLTextAreaElement>('textarea')!
    await click(composer)
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(composer, 'Draft for the side chat')
    composer.dispatchEvent(new Event('input', { bubbles: true }))
    await click(tab('file:/ANALYSIS.md'))
    await click(tab('side-chat'))
    if (composer.value !== 'Draft for the side chat') {
      throw new Error('Switching tabs discarded the side-chat draft')
    }
    await click(tab('file:/ANALYSIS.md'))
    await until(() => panel.activeTab?.id === 'file:/ANALYSIS.md')
    await new Promise((resolve) => setTimeout(resolve, 700))
    await window.smoke.capture('side-panel-tabs-dark')
    await click(element.querySelector('[aria-label="New tab"]'))
    await until(() => Boolean(button('Browser')))
    await until(() => getComputedStyle(button('Browser')!.closest('[data-escape-surface]')!).opacity === '1')
    await window.smoke.capture('side-panel-tab-menu')
    await window.smoke.key('Escape')
    setThemePref('light')
    await new Promise((resolve) => setTimeout(resolve, 200))
    await window.smoke.capture('side-panel-tabs-light')
    const rendersBeforeTitleChange = chatRenders
    await evaluate(first, 'document.title = "Updated browser title"')
    await until(() => tab('tabs')?.textContent === 'Updated browser title')
    if (chatRenders !== rendersBeforeTitleChange) {
      throw new Error('A browser title update rerendered the conversation')
    }
    await add('Code diff')
    await until(() => queryClient.getQueryCache().find({ queryKey: diffKey })?.isActive() === true)
    await click(tab('file:/ANALYSIS.md'))
    await until(() => panel.activeTab?.kind === 'file')
    if (queryClient.getQueryCache().find({ queryKey: diffKey })?.isActive()) {
      throw new Error('A hidden code diff still has an active query')
    }
    await queryClient.invalidateQueries({ queryKey: keys.sessionRepo('tabs') })
    if (queryClient.getQueryState(diffKey)?.fetchStatus !== 'idle') {
      throw new Error('Invalidation refetched a hidden code diff')
    }
    panel.closeTab('diff')
    const secondID = webview(secondId).getWebContentsId()
    panel.closeTab(secondId)
    await until(async () => !await window.smoke.browserExists(secondID))
    if (!await window.smoke.browserExists(firstID)) {
      throw new Error('Closing a browser also closed the neighbouring browser')
    }
    await window.smoke.resize(390, 844)
    await until(() => window.innerWidth === 390)
    await click(button('Overview')!)
    await click(button('Side Panel')!)
    await until(() => panel.mode === 'tabs')
    await new Promise((resolve) => setTimeout(resolve, 200))
    await window.smoke.capture('side-panel-tabs-mobile')
    if (element.scrollWidth > window.innerWidth || !element.querySelector('[aria-label="New tab"]')!.getBoundingClientRect().width) {
      throw new Error('Mobile tabs overflow or hide their add control')
    }
    panel.closeTab('terminal')
    await until(() => terminalCloses === 1)
    for (const entry of [...panel.tabs].filter((entry) => entry.kind !== 'terminal')) {
      panel.closeTab(entry.id)
      await until(() => !panel.tabs.some((tab) => tab.id === entry.id))
    }
    await until(() => Boolean(button('Browser')))
    const openPreview = panel.openPreview
    openPreview(location.origin + '/target?tabs=rapid-one')
    openPreview(location.origin + '/target?tabs=rapid-two')
    await until(() => panel.tabs.filter((entry) => entry.kind === 'preview').length === 2)
    for (const entry of [...panel.tabs]) {
      panel.closeTab(entry.id)
      await until(() => !panel.tabs.some((tab) => tab.id === entry.id))
    }
    await click(button('Browser')!)
    await until(() => panel.activeTab?.kind === 'preview')
    const addTab = panel.addTab
    addTab('preview')
    addTab('preview')
    await until(() => panel.tabs.length === 3)
    const neighbour = panel.tabs[1].id
    await click(tab('tabs'))
    await window.smoke.key('Delete')
    await until(() => panel.activeTab?.id === neighbour && document.activeElement === tab(neighbour))
    await window.smoke.key('Delete')
    await until(() => panel.tabs.length === 1 && document.activeElement === tab(panel.activeTab!.id))
    await window.smoke.key('Delete')
    await until(() => panel.tabs.length === 0 && document.activeElement?.getAttribute('aria-label') === 'New tab')
  } catch (error) {
    await window.smoke.capture('side-panel-tabs-failure')
    throw error
  } finally {
    root.unmount()
    queryClient.clear()
    window.WebSocket = NativeSocket
    element.remove()
    setThemePref('light')
    await window.smoke.resize(1050, 850)
  }
}
