import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { ThreadCanvas } from '@/components/canvas/ThreadCanvas'
import { applyPatch } from '@/components/canvas/board'
import { useCanvasContexts } from '@/components/canvas/useCanvasContexts'
import type { CanvasView } from '@/lib/api/canvas'
import { keys } from '@/lib/query/keys'

export async function exerciseCanvas(): Promise<void> {
  const sessionId = 'canvas-smoke'
  const paragraphs = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1}: Read the rest by scrolling inside this item.`).join('\n\n')
  let view: CanvasView = {
    version: '1', dir: '/fixture', edges: [], components: {},
    nodes: [
      { id: 'report', type: 'file', file: 'report.md', x: 0, y: 0, width: 320, height: 260 },
      { id: 'table', type: 'file', file: 'costs.csv', x: 480, y: 0, width: 320, height: 260 },
      { id: 'page', type: 'link', url: 'about:blank', x: 0, y: 440, width: 180, height: 160 },
      { id: 'sticky', type: 'text', text: paragraphs, color: '3', x: 360, y: 440, width: 200, height: 160 },
      { id: 'text', type: 'text', text: paragraphs, x: 600, y: 440, width: 200, height: 160 },
    ],
    files: { report: { path: 'report.md', version: '1' }, table: { path: 'costs.csv', version: '1' } },
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(keys.sessionCanvas(sessionId), view)
  client.setQueryData([...keys.sessionFile(sessionId, 'report.md'), '1'], { content: paragraphs })
  const csv = Array.from({ length: 40 }, (_, i) => Array.from({ length: 12 }, (_, column) => `Part-${i}-${column}`).join(',')).join('\n')
  const header = Array.from({ length: 12 }, (_, column) => `Column-${column}`).join(',')
  client.setQueryData([...keys.sessionFile(sessionId, 'costs.csv'), '1'], { content: header + '\n' + csv })
  const originalFetch = window.fetch
  window.fetch = async (input, init) => {
    if (new URL(String(input)).pathname !== `/v1/sessions/${sessionId}/canvas`) {
      return originalFetch(input, init)
    }
    if (init?.method === 'PATCH') {
      view = { ...applyPatch(view, JSON.parse(String(init.body))), version: String(Number(view.version) + 1) }
      return Response.json({ version: view.version })
    }
    return Response.json(view)
  }
  function Fixture() {
    const { selection, onSelect } = useCanvasContexts({ contexts: [], removeContext: () => {}, replaceContexts: () => {} })
    return <ThreadCanvas sessionId={sessionId} working={false} selection={selection} onSelect={onSelect} onPrompt={() => {}} />
  }
  const element = document.createElement('div')
  element.style.cssText = 'position:fixed;inset:0;z-index:1;background:var(--color-bg)'
  document.body.append(element)
  const root = createRoot(element)
  const until = async (check: () => boolean, message = check.toString()) => {
    const deadline = Date.now() + 3000
    while (!check()) {
      if (Date.now() > deadline) {
        throw new Error('Canvas: ' + message)
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  const node = (id: string) => element.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)!
  const viewport = () => element.querySelector<HTMLElement>('.react-flow__viewport')!.style.transform
  const drag = async (x: number, y: number, dx: number, dy: number) => {
    await window.smoke.pointer('mouseMove', Math.round(x), Math.round(y))
    await window.smoke.pointer('mouseDown', Math.round(x), Math.round(y))
    await window.smoke.pointer('mouseMove', Math.round(x + dx / 2), Math.round(y + dy / 2))
    await window.smoke.pointer('mouseMove', Math.round(x + dx), Math.round(y + dy))
    await window.smoke.pointer('mouseUp', Math.round(x + dx), Math.round(y + dy))
  }
  const select = async (id: string) => {
    const r = node(id).getBoundingClientRect()
    await drag(r.x + r.width / 2, r.y + r.height / 2, 0, 0)
    await until(() => node(id).classList.contains('selected'))
  }
  try {
    root.render(<QueryClientProvider client={client}><Fixture /></QueryClientProvider>)
    await until(() => Boolean(node('report')?.querySelector('p')))
    await new Promise((resolve) => setTimeout(resolve, 100))
    for (const id of ['report', 'table', 'sticky', 'text']) {
      await select(id)
      const scroll = node(id).querySelector<HTMLElement>('.canvas-scroll')!
      const r = scroll.getBoundingClientRect()
      const zoom = r.width / scroll.offsetWidth
      const before = viewport()
      await drag(r.right - 4 * zoom, r.y + 8 * zoom, 0, 45)
      await until(() => scroll.scrollTop > 0)
      if (viewport() !== before) {
        throw new Error('Scrolling an item moved the canvas')
      }
      if (id === 'table') {
        await drag(r.x + 8 * zoom, r.bottom - 4 * zoom, 45, 0)
        await until(() => scroll.scrollLeft > 0)
      }
    }
    if (node('report').querySelector('.canvas-viewer-toolbar') || node('report').textContent?.includes('MD · report.md')) {
      throw new Error('The Markdown item still has a duplicate filename footer')
    }
    for (const zoomedOut of [false, true]) {
      if (zoomedOut) {
        for (let step = 0; step < 3; step++) {
          element.querySelector<HTMLButtonElement>('[aria-label="Zoom out"]')!.click()
          await new Promise((resolve) => setTimeout(resolve, 250))
        }
      }
      for (const id of ['report', 'page']) {
        await select(id)
        for (const corner of ['top left', 'top right', 'bottom right', 'bottom left']) {
          const r = node(id).getBoundingClientRect()
          const left = corner.includes('left')
          const top = corner.includes('top')
          const x = left ? r.left - 10 : r.right + 10
          const y = top ? r.top - 10 : r.bottom + 10
          const saved = view.nodes.find((item) => item.id === id)!
          const width = Number(saved.width)
          const height = Number(saved.height)
          const hit = document.elementFromPoint(x, y)
          if (!hit?.classList.contains('canvas-resize-handle')) {
            await window.smoke.capture('canvas-resize-miss')
            throw new Error(`${id} ${corner} at (${x}, ${y}) hit ${hit?.className}`)
          }
          await drag(x, y, left ? -15 : 15, top ? -15 : 15)
          await until(() => {
            const updated = view.nodes.find((item) => item.id === id)!
            return Number(updated.width) > width && Number(updated.height) > height
          }, `${id} ${corner} resize did not save (${width} × ${height}, zoomed out: ${zoomedOut})`)
        }
        const r = node(id).getBoundingClientRect()
        const width = Number(view.nodes.find((item) => item.id === id)!.width)
        await drag(r.right + 8, r.y + r.height / 2, 20, 0)
        await until(() => Number(view.nodes.find((item) => item.id === id)!.width) > width)
      }
    }
    await select('page')
    const focus = node('page').querySelector<HTMLButtonElement>('.canvas-focus')!
    const r = focus.getBoundingClientRect()
    await drag(r.x + r.width / 2, r.y + r.height / 2, 0, 0)
    await until(() => node('page').querySelector('.canvas-focus')?.textContent === 'Done')
    await window.smoke.key('Escape')
    await until(() => node('page').querySelector('.canvas-focus')?.textContent === 'Focus')
    const label = node('report').querySelector<HTMLElement>('.canvas-item-label')!.getBoundingClientRect()
    const before = Number(view.nodes.find((item) => item.id === 'report')!.x)
    if (!document.elementFromPoint(label.x + label.width / 2, label.y + label.height / 2)?.closest('.canvas-item-label')) {
      throw new Error('Resize targets cover the document title')
    }
    await drag(label.x + label.width / 2, label.y + label.height / 2, 25, 0)
    await until(() => Number(view.nodes.find((item) => item.id === 'report')!.x) > before, 'The document could not be moved by its title')
    await window.smoke.capture('canvas')
  } finally {
    root.unmount()
    client.clear()
    element.remove()
    window.fetch = originalFetch
  }
}
