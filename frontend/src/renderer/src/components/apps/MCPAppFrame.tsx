import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { EmptyState } from '@/components/ui/EmptyState'
import { callMCPAppTool, mcpAppQuery } from '@/lib/api/mcp'
import { mcpAppHostContext } from '@/lib/mcpAppHost'

// Hosts one server's MCP App across the content card through the official
// AppBridge. The app's tool calls reach its own server through Jaz, which holds
// the authenticated MCP session, so the sandboxed page never sees a token.
export function MCPAppFrame({ serverId, name }: { serverId: string; name: string }) {
  const app = useQuery(mcpAppQuery(serverId))
  const frame = useRef<HTMLIFrameElement>(null)
  const html = app.data

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

  if (app.isError) {
    return (
      <EmptyState title={`Couldn't open ${name}`}>
        <p>{app.error.message}</p>
      </EmptyState>
    )
  }
  return (
    <iframe
      ref={frame}
      title={name}
      sandbox="allow-scripts allow-forms allow-popups"
      className="block size-full border-0 bg-bg"
    />
  )
}
