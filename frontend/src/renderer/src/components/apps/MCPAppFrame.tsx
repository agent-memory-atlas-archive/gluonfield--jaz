import { useQuery } from '@tanstack/react-query'
import type { CallToolResult } from '@modelcontextprotocol/client'
import { useEffect, useRef, useState } from 'react'
import { EmptyState } from '@/components/ui/EmptyState'
import { callMCPAppTool, entrypointKey, mcpAppQuery, mcpEntrypointsQuery } from '@/lib/api/mcp'
import type { MCPEntrypoint } from '@/lib/api/types'
import { serveFile, type OpenedFile } from '@/lib/mcpAppFiles'
import { mcpAppHostContext } from '@/lib/mcpAppHost'

// Every sidebar app stays mounted over the content card, so opening its
// section is instant and finds the app as the user left it; only the active
// one is visible.
export function MCPApps({ activeKey }: { activeKey?: string }) {
  const entrypoints = useQuery(mcpEntrypointsQuery).data ?? []
  return entrypoints
    .filter((entry) => entry.type === 'global')
    .map((entry) => {
      const key = entrypointKey(entry)
      return (
        <div key={key} className={`absolute inset-0 bg-bg ${key === activeKey ? '' : 'invisible'}`}>
          <MCPAppFrame entry={entry} active={key === activeKey} />
        </div>
      )
    })
}

// Hosts one entrypoint through the official AppBridge. Opening it calls the
// entrypoint's tool with {} or, for a file viewer, the opened file; the app
// gets that input and result once it initializes. Tool calls reach the app's
// own server through Jaz, which holds the authenticated MCP session, so the
// sandboxed page never sees a token.
export function MCPAppFrame({ entry, active, file }: { entry: MCPEntrypoint; active: boolean; file?: OpenedFile }) {
  const { server_id: serverId, tool } = entry
  const app = useQuery(mcpAppQuery(serverId, tool))
  const frame = useRef<HTMLIFrameElement>(null)
  const html = app.data
  // The document paints before the app has the host theme, so it stays
  // transparent until the app reports ui/notifications/initialized.
  const [readyFor, setReadyFor] = useState<string>()
  const { refetch } = app

  useEffect(() => {
    if (active) void refetch()
  }, [active, refetch])

  useEffect(() => {
    const iframe = frame.current
    const target = iframe?.contentWindow
    if (!iframe || !target || html === undefined) return
    let closed = false
    let observer: MutationObserver | undefined
    const input = file ? { file: { name: file.name, resourceUri: file.uri } } : {}
    const opened = callMCPAppTool(serverId, { name: tool, arguments: input }).catch(
      (error: Error): CallToolResult => ({ content: [{ type: 'text', text: error.message }], isError: true }),
    )
    const connected = import('@modelcontextprotocol/ext-apps/app-bridge').then(async ({ AppBridge, PostMessageTransport }) => {
      if (closed) return undefined
      const bridge = new AppBridge(
        null,
        { name: 'Jaz', version: '1' },
        { openLinks: {}, serverTools: {}, logging: {}, ...(file && { experimental: { 'openai/resource': {} } }) },
        { hostContext: mcpAppHostContext() },
      )
      // A file viewer's calls carry the opened file's path, which only its
      // server may see.
      bridge.oncalltool = (params) =>
        callMCPAppTool(serverId, file ? { ...params, _meta: { ...params._meta, 'openai/resource': { path: file.path } } } : params)
      bridge.onopenlink = async ({ url }) => {
        window.open(url, '_blank', 'noopener,noreferrer')
        return {}
      }
      if (file) serveFile(bridge, file)
      bridge.oninitialized = () => {
        void bridge.sendToolInput({ arguments: input })
        void opened.then((result) => bridge.sendToolResult(result))
        // The app themes itself as it initializes; two frames let that paint land.
        requestAnimationFrame(() => requestAnimationFrame(() => setReadyFor(html)))
      }
      // Listen before the document loads so the app's first ui/initialize lands.
      await bridge.connect(new PostMessageTransport(target, target))
      iframe.srcdoc = html
      observer = new MutationObserver(() => bridge.setHostContext(mcpAppHostContext()))
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
      return bridge
    })
    return () => {
      closed = true
      observer?.disconnect()
      void connected.then((bridge) => bridge?.close())
    }
  }, [html, serverId, tool, file])

  if (html === undefined && app.isError) {
    return (
      <EmptyState title={`Couldn't open ${entry.title}`}>
        <p>{app.error.message}</p>
      </EmptyState>
    )
  }
  return (
    <iframe
      ref={frame}
      title={entry.title}
      sandbox="allow-scripts allow-forms allow-popups"
      allow="clipboard-write"
      className={`block size-full border-0 transition-opacity duration-150 ${html !== undefined && readyFor === html ? '' : 'pointer-events-none opacity-0'}`}
    />
  )
}
