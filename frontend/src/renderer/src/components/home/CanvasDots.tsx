import { useReducedMotion } from 'motion/react'
import { useLayoutEffect, useRef } from 'react'
import { useEffectsEnabled } from '@/lib/appearance'
import { useTheme } from '@/lib/theme'

const PITCH = 22
const RADIUS = 1.35
const ALPHA = 0.18
const TAU = Math.PI * 2
// On the way in each dot starts a little towards the switch and springs into
// its slot as it fades in; dots nearer the switch start first.
const DRIFT = 36
const DAMPING = 0.7
const OMEGA = TAU / 600
const DAMPED = OMEGA * Math.sqrt(1 - DAMPING ** 2)
const APPEAR_MS = 220
const SPREAD_MS = 420
const JITTER_MS = 80
const SETTLE_MS = 900
// On the way out the dots fade where they are.
const FADE_MS = 250

type Point = { x: number; y: number }
type Motion = {
  on: boolean
  start: number
  end: number
  // Where each dot was and how visible when the motion began.
  sx: Float32Array
  sy: Float32Array
  seen: Float32Array
  delay: Float32Array
}

// A stable pseudo-random number in [0, 1) per dot.
function hash(n: number): number {
  const v = Math.sin(n * 12.9898) * 43758.5453
  return v - Math.floor(v)
}

// Where dot i is ms into the motion; returns how visible it is.
function locate(m: Motion, i: number, tx: number, ty: number, ms: number, out: Point): number {
  const t = ms - m.delay[i]
  if (!m.on || t <= 0) {
    out.x = m.sx[i]
    out.y = m.sy[i]
    return m.on ? m.seen[i] : m.seen[i] * Math.max(0, 1 - ms / FADE_MS)
  }
  const decay = Math.exp(-DAMPING * OMEGA * t)
  const settle = decay * (Math.cos(DAMPED * t) + ((DAMPING * OMEGA) / DAMPED) * Math.sin(DAMPED * t))
  out.x = tx + (m.sx[i] - tx) * settle
  out.y = ty + (m.sy[i] - ty) * settle
  return m.seen[i] + (1 - m.seen[i]) * Math.min(1, t / APPEAR_MS)
}

function createField(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!
  let width = 0
  let height = 0
  let xs = new Float32Array()
  let ys = new Float32Array()
  let on: boolean | undefined
  let motion: Motion | null = null
  let ink = ''
  let raf = 0
  let pointer = { x: 0, y: 0, at: -Infinity }
  const here = { x: 0, y: 0 }

  const draw = (now: number) => {
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = ink
    if (!motion) {
      if (!on) {
        return
      }
      ctx.globalAlpha = ALPHA
      ctx.beginPath()
      for (let i = 0; i < xs.length; i++) {
        ctx.moveTo(xs[i] + RADIUS, ys[i])
        ctx.arc(xs[i], ys[i], RADIUS, 0, TAU)
      }
      ctx.fill()
      return
    }
    for (let i = 0; i < xs.length; i++) {
      const shown = locate(motion, i, xs[i], ys[i], now - motion.start, here)
      if (shown < 0.02) {
        continue
      }
      ctx.globalAlpha = ALPHA * shown
      ctx.beginPath()
      ctx.arc(here.x, here.y, RADIUS, 0, TAU)
      ctx.fill()
    }
  }

  const frame = (now: number) => {
    if (motion && now - motion.start > motion.end) {
      motion = null
    }
    draw(now)
    if (motion) {
      raf = requestAnimationFrame(frame)
    }
  }

  // The rendered size over the layout size: the document can be zoomed.
  const zoom = () => canvas.getBoundingClientRect().width / canvas.offsetWidth || 1

  const resize = () => {
    width = canvas.offsetWidth
    height = canvas.offsetHeight
    const scale = zoom() * window.devicePixelRatio
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    const cols = Math.ceil(width / PITCH)
    const rows = Math.ceil(height / PITCH)
    xs = new Float32Array(cols * rows)
    ys = new Float32Array(cols * rows)
    for (let i = 0; i < xs.length; i++) {
      xs[i] = (i % cols) * PITCH + PITCH / 2
      ys[i] = Math.floor(i / cols) * PITCH + PITCH / 2
    }
    motion = null
    cancelAnimationFrame(raf)
    draw(performance.now())
  }

  const recolor = () => {
    ink = getComputedStyle(document.documentElement).getPropertyValue('--color-ink').trim()
    if (!motion) {
      draw(performance.now())
    }
  }

  // The dots come from where the user just clicked, or mid-page from the
  // keyboard.
  const origin = (): Point => {
    const rect = canvas.getBoundingClientRect()
    if (performance.now() - pointer.at > 1000) {
      return { x: width / 2, y: height / 2 }
    }
    return { x: (pointer.x - rect.left) / zoom(), y: (pointer.y - rect.top) / zoom() }
  }

  // Every dot starts the new motion where the last one left it; a hidden dot
  // starts a little towards the switch.
  const launch = (next: boolean, now: number): Motion => {
    const from = origin()
    const reach = Math.max(Math.hypot(from.x, from.y), Math.hypot(width - from.x, from.y), Math.hypot(from.x, height - from.y), Math.hypot(width - from.x, height - from.y))
    const n = xs.length
    const m: Motion = { on: next, start: now, end: next ? SPREAD_MS + JITTER_MS + SETTLE_MS : FADE_MS, sx: new Float32Array(n), sy: new Float32Array(n), seen: new Float32Array(n), delay: new Float32Array(n) }
    for (let i = 0; i < n; i++) {
      const dx = from.x - xs[i]
      const dy = from.y - ys[i]
      const distance = Math.hypot(dx, dy) || 1
      if (motion) {
        m.seen[i] = locate(motion, i, xs[i], ys[i], now - motion.start, here)
      } else {
        const drift = on ? 0 : Math.min(DRIFT, distance) / distance
        here.x = xs[i] + dx * drift
        here.y = ys[i] + dy * drift
        m.seen[i] = Number(Boolean(on))
      }
      m.sx[i] = here.x
      m.sy[i] = here.y
      m.delay[i] = next ? (distance / reach) * SPREAD_MS + hash(i) * JITTER_MS : 0
    }
    return m
  }

  // A field's first state, and every change without effects, is drawn at once.
  const set = (next: boolean, animate: boolean) => {
    if (next === on) {
      return
    }
    const first = on === undefined
    const now = performance.now()
    const started = first || !animate ? null : launch(next, now)
    on = next
    motion = started
    cancelAnimationFrame(raf)
    draw(now)
    if (motion) {
      raf = requestAnimationFrame(frame)
    }
  }

  const onPointer = (event: PointerEvent) => {
    pointer = { x: event.clientX, y: event.clientY, at: event.timeStamp }
  }
  window.addEventListener('pointerdown', onPointer, true)
  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  resize()
  return {
    set,
    recolor,
    dispose: () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      window.removeEventListener('pointerdown', onPointer, true)
    },
  }
}

// The canvas's dot grid behind the new-thread composer. Turning it on settles
// the dots into place in a wave from the switch; turning it off fades them.
export function CanvasDots({ on }: { on: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const field = useRef<ReturnType<typeof createField>>(null)
  const effects = useEffectsEnabled()
  const reduced = useReducedMotion()
  const { resolved } = useTheme()
  useLayoutEffect(() => {
    const created = createField(ref.current!)
    field.current = created
    return created.dispose
  }, [])
  useLayoutEffect(() => {
    field.current!.recolor()
  }, [resolved])
  useLayoutEffect(() => {
    field.current!.set(on, effects && !reduced)
  }, [on, effects, reduced])
  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 size-full" />
}
