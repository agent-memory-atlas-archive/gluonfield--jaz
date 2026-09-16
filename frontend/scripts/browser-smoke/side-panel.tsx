import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserWorkspace } from '@/components/browser/BrowserWorkspace'
import { SidePanel } from '@/components/session/SidePanel'
import { SessionTitlebar } from '@/components/session/SessionTitlebar'
import { SidePanelDrawer } from '@/components/session/SidePanelDrawer'
import { SidePanelStateProvider, useSidePanelState } from '@/components/session/SidePanelState'
import { FileReaderLinkProvider, PreviewLinkProvider, RenderedMarkdown } from '@/components/session/MessageMarkdown'
import { isPreviewWebviewPending, type PreviewWebviewElement } from '@/components/session/previewWebview'
import type { Session } from '@/lib/api/types'
import { keys } from '@/lib/query/keys'
import { useIsMobile } from '@/lib/hooks/useIsMobile'
import { setThemePref } from '@/lib/theme'
import { TitlebarActionsOutlet, TitlebarProvider, TitlebarSlotOutlet } from '@/lib/titlebar'

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
    runtime_ref: { type: 'acp', agent: 'codex', cwd: '/workspace' }, model: 'gpt-6-astra', reasoning_effort: 'xhigh',
  }
  let panel: ReturnType<typeof useSidePanelState>
  let activeSessionId: string
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
  function Chat({ sessionId }: { sessionId: string }) {
    chatRenders += 1
    const state = useSidePanelState(sessionId, true)
    const currentSession = { ...session, id: sessionId }
    const isMobile = useIsMobile()
    useLayoutEffect(() => {
      panel = state
      activeSessionId = sessionId
    })
    return <div ref={state.containerRef} className="flex h-full flex-col">
      <SessionTitlebar session={currentSession} panel={state} isMobile={isMobile} sideChatAvailable />
      <header className="titlebar-drag flex h-[52px] shrink-0 items-center gap-2 px-3" style={{ paddingLeft: isMobile ? 96 : 168 }}>
        <div id="titlebar-slot" className="relative z-shell flex min-w-0 items-center gap-1.5"><TitlebarSlotOutlet /></div>
        <div id="titlebar-actions" className="relative z-shell ml-auto flex min-w-0 items-center gap-1.5"><TitlebarActionsOutlet /></div>
      </header>
      <div className="relative flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 p-8 text-ink" data-tab-chat>
          <FileReaderLinkProvider sessionId={sessionId} onOpen={state.openFile}>
            <PreviewLinkProvider onOpen={state.openPreview}>
              <RenderedMarkdown text={`# Product research\n\nReview the [analysis](/ANALYSIS.md) and compare it with the [supplier website](${location.origin}/target?tabs=one).`} />
            </PreviewLinkProvider>
          </FileReaderLinkProvider>
        </div>
        <SidePanelDrawer panel={state} isMobile={isMobile}>
          <SidePanel session={currentSession} panel={state} subagents={[]} spawnedThreads={[]} working={false} sideChatAvailable sideChatEvents={[]} onSend={noop} onQueuePrompt={noop} onQueueAction={noop} onSendSideChat={noop} />
        </SidePanelDrawer>
      </div>
    </div>
  }
  const rootRoute = createRootRoute({
    component: () => <BrowserWorkspace><SidePanelStateProvider><TitlebarProvider><Outlet /></TitlebarProvider></SidePanelStateProvider></BrowserWorkspace>,
  })
  const chatRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/sessions/$sessionId',
    component: () => {
      const { sessionId } = chatRoute.useParams()
      return <Chat key={sessionId} sessionId={sessionId} />
    },
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([chatRoute]),
    history: createMemoryHistory({ initialEntries: ['/sessions/tabs'] }),
  })
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
    if (!target.contains(document.elementFromPoint(x, y))) {
      throw new Error('Side panel control is obscured: ' + target.outerHTML)
    }
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
      if (!isPreviewWebviewPending(error) && !(error instanceof Error && error.message.includes('Cannot find default execution context'))) {
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
    root.render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
    await until(() => Boolean(button('Side Panel')))
    await click(element.querySelector('[data-tab-chat] button'))
    await until(() => panel?.activeTab?.kind === 'file' && Boolean(element.querySelector('[role="tabpanel"] h1')))
    if (button('Overview')?.getAttribute('aria-pressed') !== 'false' || button('Side Panel')?.getAttribute('aria-pressed') !== 'true') {
      throw new Error('File links did not select the tabbed panel exclusively')
    }
    await until(() => element.querySelector('[role="tablist"]')!.getBoundingClientRect().width > 100)
    await until(() => Math.abs(element.querySelector('[role="separator"]')!.parentElement!.getBoundingClientRect().width - panel.width) < 1)
    const tabsBounds = element.querySelector('[role="tablist"]')!.getBoundingClientRect()
    const controlsBounds = button('Side Panel')!.getBoundingClientRect()
    if (tabsBounds.height > 28 || Math.abs(tabsBounds.y - controlsBounds.y) > 1 || tabsBounds.right > controlsBounds.left) {
      throw new Error('Tabs and panel controls do not share a compact top row')
    }
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
    const toolbar = document.querySelector('[data-browser-session="tabs"] form')!
    const browserBounds = toolbar.getBoundingClientRect()
    const headerBounds = element.querySelector('header')!.getBoundingClientRect()
    const browserHost = document.querySelector<HTMLElement>('[data-browser-session="tabs"]')!
    const resizeHandle = element.querySelector('[role="separator"]')!
    if (Math.abs(browserBounds.top - headerBounds.bottom) > 1 || getComputedStyle(browserHost).borderTopLeftRadius !== '0px' || getComputedStyle(resizeHandle.firstElementChild!).backgroundColor !== 'rgba(0, 0, 0, 0)') {
      throw new Error('Side panel retains a gap, rounded browser corner or visible resize border')
    }
    if (!button('Side Panel')!.querySelector('svg') || !button('Overview')!.querySelector('svg')) {
      throw new Error('Panel controls are missing icons')
    }
    const back = toolbar.querySelector('[aria-label="Back"]')!.getBoundingClientRect()
    const forward = toolbar.querySelector('[aria-label="Forward"]')!.getBoundingClientRect()
    if (toolbar.getBoundingClientRect().height !== 36 || back.width !== 28 || forward.x - back.x > 30) {
      throw new Error('Browser navigation controls are not compact')
    }
    await window.smoke.capture('side-panel-browser-compact')
    await add('Terminal')
    await until(() => terminalConnections === 1 && element.textContent?.includes('retained terminal output') === true)
    await window.smoke.key('D', ['control'])
    if (terminalInput.join('') !== '\u0004' || panel.activeTab?.kind !== 'terminal') {
      throw new Error('Opening a terminal did not focus it or preserve Control+D input')
    }
    const terminal = element.querySelector('.xterm')
    await click(button('Overview')!)
    await until(() => button('Overview')!.getAttribute('aria-pressed') === 'true')
    if (element.querySelector('[role="tablist"]') || !document.querySelector<HTMLElement>('[data-browser-session="tabs"]')!.inert) {
      throw new Error('Overview left tabs or browser visible')
    }
    await click(button('Side Panel')!)
    await until(() => panel.mode === 'tabs' && panel.open)
    if (terminalConnections !== 1 || terminalCloses || element.querySelector('.xterm') !== terminal) {
      throw new Error('Switching Overview restarted the terminal')
    }
    await add('Side chat')
    await until(() => Boolean(element.querySelector('[role="tabpanel"]:not([hidden]) textarea')))
    const composer = element.querySelector<HTMLTextAreaElement>('[role="tabpanel"]:not([hidden]) textarea')!
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
    if (element.scrollWidth > window.innerWidth || !element.querySelector('[aria-label="New tab"]')!.getBoundingClientRect().width || tab(panel.activeTab!.id)!.getBoundingClientRect().width < 80) {
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

    await window.smoke.resize(1440, 900)
    await until(() => window.innerWidth === 1440)
    panel.openFile('/ANALYSIS.md:12')
    panel.openFile('/NOTES.md')
    for (const kind of ['terminal', 'side-chat', 'diff'] as const) {
      panel.addTab(kind)
    }
    panel.openPreview(location.origin + '/target?tabs=retained-one')
    panel.openPreview(location.origin + '/target?tabs=retained-two')
    await until(() => panel.tabs.length === 7 && panel.activeTab?.kind === 'preview')
    const retainedTabId = panel.activeTab!.id
    await until(() => ready(retainedTabId))
    const retainedView = webview(retainedTabId)
    const retainedViewId = retainedView.getWebContentsId()
    await evaluate(retainedView, 'window.chatNavigationValue = 73')
    panel.resize(720)
    await until(() => panel.width === 720)
    const savedTabs = JSON.stringify(panel.tabs)
    const navigate = async (sessionId: string) => {
      await router.navigate({ to: '/sessions/$sessionId', params: { sessionId } })
      await until(() => activeSessionId === sessionId)
    }
    await navigate('other-chat')
    if (panel.tabs.length || panel.mode !== 'overview') {
      throw new Error('A new chat inherited another chat\'s tabs or mode')
    }
    if (!document.querySelector<HTMLElement>(`[data-browser-session="${retainedTabId}"]`)!.inert) {
      throw new Error('Navigating away left the previous chat browser active')
    }
    panel.addTab('file')
    await until(() => panel.tabs.length === 1)
    panel.close()
    await until(() => !panel.open)
    await navigate('tabs')
    await until(() => !document.querySelector<HTMLElement>(`[data-browser-session="${retainedTabId}"]`)!.inert)
    await until(() => panel.width === 720)
    if (JSON.stringify(panel.tabs) !== savedTabs || panel.activeTab?.id !== retainedTabId || !panel.open || panel.mode !== 'tabs' || panel.width !== 720) {
      throw new Error('Returning to a chat lost its tabs, selection, visibility, mode or width')
    }
    if (webview(retainedTabId).getWebContentsId() !== retainedViewId || await evaluate(retainedView, 'window.chatNavigationValue') !== 73) {
      throw new Error('Returning to a chat replaced its retained browser page')
    }
    panel.closeTab('file:/NOTES.md')
    panel.toggleMode('overview')
    await until(() => panel.mode === 'overview' && panel.tabs.length === 6)
    await navigate('other-chat')
    if (panel.open || panel.mode !== 'tabs' || panel.tabs.length !== 1 || panel.activeTab?.id !== 'file') {
      throw new Error('The other chat lost its independent closed panel and file picker')
    }
    await navigate('tabs')
    if (!panel.open || panel.mode !== 'overview' || panel.tabs.some((entry) => entry.id === 'file:/NOTES.md')) {
      throw new Error('Returning to a chat lost Overview or resurrected a closed tab')
    }
    panel.toggleMode('tabs')
    await until(() => panel.mode === 'tabs')
    panel.selectTab('file:/ANALYSIS.md')
    await until(() => panel.activeTab?.kind === 'file' && Boolean(element.querySelector('[role="tabpanel"] h1')))
    await until(() => Math.abs(element.querySelector('[role="separator"]')!.parentElement!.getBoundingClientRect().width - panel.width) < 1)
    await window.smoke.capture('side-panel-restored-tabs')
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
