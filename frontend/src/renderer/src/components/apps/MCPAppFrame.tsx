import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { EmptyState } from '@/components/ui/EmptyState'
import { callMCPAppTool, mcpAppQuery, mcpAppsQuery } from '@/lib/api/mcp'
import { mcpAppHostContext } from '@/lib/mcpAppHost'

// Every pinned MCP App stays mounted over the content card, so opening its
// section is instant and finds the app as the user left it; only the active
// app is visible.
export function MCPApps({ activeId }: { activeId?: string }) {
  const apps = useQuery(mcpAppsQuery).data ?? []
  return apps.map((app) => (
    <MCPAppFrame key={app.server_id} serverId={app.server_id} name={app.name} active={app.server_id === activeId} />
  ))
}

// Hosts one server's MCP App through the official AppBridge. The app's tool
// calls reach its own server through Jaz, which holds the authenticated MCP
// session, so the sandboxed page never sees a token.
function MCPAppFrame({ serverId, name, active }: { serverId: string; name: string; active: boolean }) {
  const app = useQuery(mcpAppQuery(serverId))
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
    const connected = import('@modelcontextprotocol/ext-apps/app-bridge').then(async ({ AppBridge, PostMessageTransport }) => {
      if (closed) return undefined
      const bridge = new AppBridge(
        null,
        { name: 'Jaz', version: '1' },
        { openLinks: {}, serverTools: {}, logging: {} },
        { hostContext: mcpAppHostContext() },
      )
      bridge.oncalltool = (params) => callMCPAppTool(serverId, params)
      bridge.onopenlink = async ({ url }) => {
        window.open(url, '_blank', 'noopener,noreferrer')
        return {}
      }
      // The app themes itself as it initializes; two frames let that paint land.
      bridge.oninitialized = () => requestAnimationFrame(() => requestAnimationFrame(() => setReadyFor(html)))
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
  }, [html, serverId])

  return (
    <div className={`absolute inset-0 bg-bg ${active ? '' : 'invisible'}`}>
      {html === undefined && app.isError ? (
        <EmptyState title={`Couldn't open ${name}`}>
          <p>{app.error.message}</p>
        </EmptyState>
      ) : (
        <iframe
          ref={frame}
          title={name}
          sandbox="allow-scripts allow-forms allow-popups"
          allow="clipboard-write"
          className={`block size-full border-0 transition-opacity duration-150 ${html !== undefined && readyFor === html ? '' : 'pointer-events-none opacity-0'}`}
        />
      )}
    </div>
  )
}
