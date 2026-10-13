import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export function FitContent({ children }: { children: ReactNode }) {
  const container = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useLayoutEffect(() => {
    const box = container.current!
    const body = content.current!
    const measure = () => {
      if (box.clientWidth && box.clientHeight) {
        setScale(Math.min(1, box.clientWidth / body.scrollWidth, box.clientHeight / body.scrollHeight))
      }
    }
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    observer.observe(body)
    measure()
    return () => observer.disconnect()
  }, [children])
  return <div ref={container} className="canvas-fit">
    <div ref={content} className="canvas-fit-content" style={{ transform: `scale(${scale})` }}>{children}</div>
  </div>
}
