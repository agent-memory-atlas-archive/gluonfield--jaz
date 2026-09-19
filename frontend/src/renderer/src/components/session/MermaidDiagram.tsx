import { useEffect, useState, type ReactNode } from 'react'
import { useTheme } from '@/lib/theme'

// Mermaid's renderer and configuration share global state.
let renderQueue = Promise.resolve()
let nextDiagramId = 0

export function MermaidDiagram({ text, children }: { text: string; children: ReactNode }) {
  const { resolved } = useTheme()
  const [rendered, setRendered] = useState<{ text: string; theme: string; src: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      renderQueue = renderQueue.then(async () => {
        if (cancelled) {
          return
        }
        const host = document.createElement('div')
        host.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none'
        host.setAttribute('aria-hidden', 'true')
        try {
          const { default: mermaid } = await import('mermaid')
          if (cancelled) {
            return
          }
          document.body.append(host)
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            suppressErrorRendering: true,
            theme: resolved === 'dark' ? 'dark' : 'default',
            look: 'classic',
            htmlLabels: false,
            fontFamily: 'Inter, sans-serif',
          })
          const { svg } = await mermaid.render(`jaz-mermaid-${++nextDiagramId}`, text, host)
          host.innerHTML = svg
          const diagram = host.querySelector('svg')!
          diagram.setAttribute('width', String(diagram.viewBox.baseVal.width))
          if (!cancelled) {
            setRendered({ text, theme: resolved, src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(host.innerHTML) })
          }
        } catch {
          if (!cancelled) {
            setRendered(null)
          }
        } finally {
          host.remove()
        }
      })
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [text, resolved])

  if (rendered?.text !== text || rendered.theme !== resolved) {
    return children
  }
  return (
    <div className="overflow-x-auto p-4">
      <img src={rendered.src} alt="Mermaid diagram" className="mx-auto max-w-none" />
    </div>
  )
}
