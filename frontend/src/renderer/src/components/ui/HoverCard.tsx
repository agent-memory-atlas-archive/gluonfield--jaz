import { cloneElement, createContext, type ReactElement, type ReactNode, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { layoutRect, layoutViewport } from '@/lib/dom/zoom'
import { useWindowEvent } from '@/lib/hooks/useWindowEvent'

type Card = {
  triggerId: string
  anchor: DOMRect
  content: ReactNode
}

const HoverCardContext = createContext<{
  id: string
  triggerId?: string
  show: (triggerId: string, target: HTMLElement, content: ReactNode) => void
  leave: () => void
  close: () => void
} | null>(null)

export function HoverCardGroup({ children }: { children: ReactNode }) {
  const id = useId()
  const [active, setActive] = useState(false)
  const [card, setCard] = useState<Card | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const cancel = useCallback(() => clearTimeout(timer.current), [])
  const close = useCallback(() => {
    cancel()
    setActive(false)
    setCard(null)
  }, [cancel])

  useEffect(() => cancel, [cancel])
  useWindowEvent('scroll', close, active, true)
  useWindowEvent('resize', close, active)
  useWindowEvent('blur', close, active)
  useWindowEvent('keydown', (event) => {
    if (event.key === 'Escape') {
      close()
    }
  }, active)

  const show = (triggerId: string, target: HTMLElement, content: ReactNode) => {
    cancel()
    setActive(true)
    const open = () => setCard({ triggerId, anchor: layoutRect(target), content })
    if (card) {
      open()
    } else {
      timer.current = setTimeout(open, 700)
    }
  }
  const leave = () => {
    cancel()
    if (card) {
      timer.current = setTimeout(close, 150)
    } else {
      close()
    }
  }

  return (
    <HoverCardContext.Provider value={{ id, triggerId: card?.triggerId, show, leave, close }}>
      {children}
      {card && createPortal(
        <HoverPanel id={id} anchor={card.anchor} onEnter={cancel} onLeave={leave}>
          {card.content}
        </HoverPanel>,
        document.body,
      )}
    </HoverCardContext.Provider>
  )
}

export function HoverCard({ children, content, disabled = false }: {
  children: ReactElement<{ 'aria-describedby'?: string }>
  content: ReactNode
  disabled?: boolean
}) {
  const id = useId()
  const group = useContext(HoverCardContext)!

  return (
    <div
      onPointerEnter={(event) => {
        if (!disabled && event.pointerType === 'mouse') {
          group.show(id, event.currentTarget, content)
        }
      }}
      onPointerLeave={group.leave}
      onPointerDownCapture={group.close}
      onContextMenuCapture={group.close}
      onFocus={(event) => {
        if (!disabled && event.target.matches(':focus-visible')) {
          group.show(id, event.currentTarget, content)
        }
      }}
      onBlur={group.leave}
    >
      {cloneElement(children, { 'aria-describedby': group.triggerId === id ? group.id : undefined })}
    </div>
  )
}

function HoverPanel({
  id,
  anchor,
  onEnter,
  onLeave,
  children,
}: {
  id: string
  anchor: DOMRect
  onEnter: () => void
  onLeave: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const viewport = layoutViewport()
  const width = Math.min(320, viewport.width - 16)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const panel = ref.current!
    const update = () => {
      const { height } = layoutRect(panel)
      const fitsRight = anchor.right + 6 + width <= viewport.width - 8
      const fitsLeft = anchor.left - 6 - width >= 8
      const left = fitsRight ? anchor.right + 6 : fitsLeft ? anchor.left - 6 - width : 8
      const top = fitsRight || fitsLeft ? anchor.top : anchor.bottom + 6
      setPosition({ left, top: Math.max(8, Math.min(top, viewport.height - height - 8)) })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(panel)
    return () => observer.disconnect()
  }, [anchor, viewport.height, viewport.width, width])

  return (
    <div
      ref={ref}
      id={id}
      role="tooltip"
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      style={{ ...position, width, visibility: position ? 'visible' : 'hidden' }}
      className="fixed z-tooltip rounded-card bg-surface px-3 py-2 text-[13px] text-ink shadow-raised ring-1 ring-border/70"
    >
      {children}
    </div>
  )
}
