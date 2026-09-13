import { cloneElement, type ReactElement, type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { layoutRect, layoutViewport } from '@/lib/dom/zoom'
import { useWindowEvent } from '@/lib/hooks/useWindowEvent'

export function HoverCard({ children, content, disabled = false }: {
  children: ReactElement<{ 'aria-describedby'?: string }>
  content: ReactNode
  disabled?: boolean
}) {
  const id = useId()
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const cancelClose = useCallback(() => clearTimeout(closeTimer.current), [])
  const close = useCallback(() => {
    cancelClose()
    setTarget(null)
    setAnchor(null)
  }, [cancelClose])

  useEffect(() => {
    if (!target || disabled) {
      return
    }
    const timer = setTimeout(() => setAnchor(layoutRect(target)), 700)
    return () => clearTimeout(timer)
  }, [disabled, target])
  useEffect(() => cancelClose, [cancelClose])
  useWindowEvent('scroll', close, Boolean(target), true)
  useWindowEvent('resize', close, Boolean(target))
  useWindowEvent('blur', close, Boolean(target))
  useWindowEvent('keydown', (event) => {
    if (event.key === 'Escape') {
      close()
    }
  }, Boolean(target))

  const leave = () => {
    cancelClose()
    if (anchor) {
      closeTimer.current = setTimeout(close, 100)
    } else {
      close()
    }
  }

  return (
    <div
      onPointerEnter={(event) => {
        if (disabled || event.pointerType !== 'mouse') {
          return
        }
        cancelClose()
        setTarget(event.currentTarget)
      }}
      onPointerLeave={leave}
      onPointerDownCapture={close}
      onContextMenuCapture={close}
      onFocus={(event) => {
        if (!disabled && event.target.matches(':focus-visible')) {
          setTarget(event.currentTarget)
        }
      }}
      onBlur={close}
    >
      {cloneElement(children, { 'aria-describedby': !disabled && anchor ? id : undefined })}
      {!disabled && anchor && createPortal(
        <HoverPanel id={id} anchor={anchor} onEnter={cancelClose} onLeave={leave}>
          {content}
        </HoverPanel>,
        document.body,
      )}
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
