import { useReducedMotion } from 'motion/react'
import { useLayoutEffect, useRef } from 'react'
import { useEffectsEnabled } from '@/lib/appearance'
import { useTheme } from '@/lib/theme'

const PITCH = 22
const RADIUS = 1.35
const ALPHA = 0.18
const HUES = 48
const TAU = Math.PI * 2
// On the way in each dot is a damped spring pulled to its slot; launches
// spread out so the grid fills outward from the switch.
const DAMPING = 0.8
const OMEGA = TAU / 600
const DAMPED = OMEGA * Math.sqrt(1 - DAMPING ** 2)
const SPREAD_MS = 380
const JITTER_MS = 60
const SETTLE_MS = 1100
// On the way out the dots spiral into the switch.
const GATHER_MS = 180
const SUCK_MS = 260
const SWIRL = 0.9
// Fast dots draw as short comets: a tail along the last stretch of their path.
const TRAIL_MS = 14
const TAIL = 12

type Point = { x: number; y: number }
type Motion = {
  on: boolean
  start: number
  end: number
  origin: Point
  // Where each dot was and how visible when the motion began.
  sx: Float32Array
  sy: Float32Array
  seen: Float32Array
  delay: Float32Array
  vx: Float32Array
  vy: Float32Array
  hue: Uint8Array
}

// A stable pseudo-random number in [0, 1) per dot.
function hash(n: number): number {
  const v = Math.sin(n * 12.9898) * 43758.5453
  return v - Math.floor(v)
}

// Where dot i is ms into the motion; returns how visible it is.
function locate(m: Motion, i: number, tx: number, ty: number, ms: number, out: Point): number {
  const t = ms - m.delay[i]
  if (t <= 0) {
    out.x = m.sx[i]
    out.y = m.sy[i]
    return m.seen[i]
  }
  if (m.on) {
    const dx = m.sx[i] - tx
    const dy = m.sy[i] - ty
    const decay = Math.exp(-DAMPING * OMEGA * t)
    const cos = Math.cos(DAMPED * t)
    const sin = Math.sin(DAMPED * t) / DAMPED
    out.x = tx + decay * (dx * cos + (m.vx[i] + DAMPING * OMEGA * dx) * sin)
    out.y = ty + decay * (dy * cos + (m.vy[i] + DAMPING * OMEGA * dy) * sin)
    return 1
  }
  const u = Math.min(1, t / SUCK_MS)
  const rx = m.sx[i] - m.origin.x
  const ry = m.sy[i] - m.origin.y
  const pull = 1 - u * u
  const turn = SWIRL * u * u
  out.x = m.origin.x + pull * (rx * Math.cos(turn) - ry * Math.sin(turn))
  out.y = m.origin.y + pull * (rx * Math.sin(turn) + ry * Math.cos(turn))
  return m.seen[i] * (1 - u ** 4)
}

// The theme's rainbow around a circle, so a dot's colour follows its heading.
function prism(): string[] {
  const style = getComputedStyle(document.documentElement)
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
  const gradient = ctx.createLinearGradient(0, 0, HUES, 0)
  const stops = [1, 2, 3, 4, 5, 1].map((i) => style.getPropertyValue(`--color-rainbow-${i}`).trim())
  stops.forEach((color, i) => gradient.addColorStop(i / (stops.length - 1), color))
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, HUES, 1)
  const data = ctx.getImageData(0, 0, HUES, 1).data
  return Array.from({ length: HUES }, (_, i) => `rgb(${data[i * 4]} ${data[i * 4 + 1]} ${data[i * 4 + 2]})`)
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
  let hues: string[] = []
  let raf = 0
  let pointer = { x: 0, y: 0, at: -Infinity }
  const here = { x: 0, y: 0 }
  const back = { x: 0, y: 0 }

  const flat = () => {
    ctx.globalAlpha = ALPHA
    ctx.fillStyle = ink
    ctx.beginPath()
    for (let i = 0; i < xs.length; i++) {
      ctx.moveTo(xs[i] + RADIUS, ys[i])
      ctx.arc(xs[i], ys[i], RADIUS, 0, TAU)
    }
    ctx.fill()
  }

  // Moving dots streak in the rainbow by heading; slowing down, they turn
  // back into grey dots.
  const moving = (m: Motion, ms: number) => {
    ctx.lineCap = 'round'
    let color = ''
    for (let i = 0; i < xs.length; i++) {
      const shown = locate(m, i, xs[i], ys[i], ms, here)
      if (shown < 0.02) {
        continue
      }
      locate(m, i, xs[i], ys[i], ms - TRAIL_MS, back)
      const travelled = Math.hypot(here.x - back.x, here.y - back.y)
      const glow = Math.min(1, travelled / TRAIL_MS / 1.5)
      const next = glow > 0.15 ? hues[m.hue[i]] : ink
      if (next !== color) {
        color = next
        ctx.fillStyle = color
        ctx.strokeStyle = color
      }
      ctx.globalAlpha = shown * (ALPHA + (0.75 - ALPHA) * glow)
      ctx.beginPath()
      if (glow > 0.15) {
        const tail = Math.min(TAIL, travelled) / travelled
        ctx.lineWidth = RADIUS * 2
        ctx.moveTo(here.x + (back.x - here.x) * tail, here.y + (back.y - here.y) * tail)
        ctx.lineTo(here.x, here.y)
        ctx.stroke()
      } else {
        ctx.arc(here.x, here.y, RADIUS, 0, TAU)
        ctx.fill()
      }
    }
  }

  const draw = (now: number) => {
    ctx.clearRect(0, 0, width, height)
    if (motion) {
      moving(motion, now - motion.start)
    } else if (on) {
      flat()
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
    hues = prism()
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

  // Every dot starts the new motion where the last one left it: hidden in the
  // switch, resting in its slot, or anywhere in between.
  const launch = (next: boolean, now: number): Motion => {
    const from = origin()
    const reach = Math.max(Math.hypot(from.x, from.y), Math.hypot(width - from.x, from.y), Math.hypot(from.x, height - from.y), Math.hypot(width - from.x, height - from.y))
    const n = xs.length
    const m: Motion = { on: next, start: now, end: 0, origin: from, sx: new Float32Array(n), sy: new Float32Array(n), seen: new Float32Array(n), delay: new Float32Array(n), vx: new Float32Array(n), vy: new Float32Array(n), hue: new Uint8Array(n) }
    for (let i = 0; i < n; i++) {
      if (motion) {
        m.seen[i] = locate(motion, i, xs[i], ys[i], now - motion.start, here)
      } else {
        const spread = hash(i + 31) * TAU
        here.x = on ? xs[i] : from.x + Math.cos(spread) * 6
        here.y = on ? ys[i] : from.y + Math.sin(spread) * 6
        m.seen[i] = Number(Boolean(on))
      }
      m.sx[i] = here.x
      m.sy[i] = here.y
      const heading = next ? Math.atan2(ys[i] - from.y, xs[i] - from.x) : Math.atan2(here.y - from.y, here.x - from.x)
      m.hue[i] = Math.floor(((heading / TAU + 1) % 1) * HUES)
      if (next) {
        // Launched towards the slot but off line, so the paths curve.
        const dx = xs[i] - here.x
        const dy = ys[i] - here.y
        const angle = (hash(i) - 0.5) * 1.8
        const speed = Math.hypot(dx, dy) * OMEGA * 1.1
        const length = Math.hypot(dx, dy) || 1
        m.vx[i] = ((dx * Math.cos(angle) - dy * Math.sin(angle)) / length) * speed
        m.vy[i] = ((dx * Math.sin(angle) + dy * Math.cos(angle)) / length) * speed
        m.delay[i] = (Math.hypot(xs[i] - from.x, ys[i] - from.y) / reach) * SPREAD_MS + hash(i + 7) * JITTER_MS
      } else {
        m.delay[i] = (1 - Math.hypot(here.x - from.x, here.y - from.y) / reach) * GATHER_MS + hash(i + 7) * JITTER_MS
      }
    }
    m.end = next ? SPREAD_MS + JITTER_MS + SETTLE_MS : GATHER_MS + JITTER_MS + SUCK_MS
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

// The canvas's dot grid behind the new-thread composer. Turning it on bursts
// the dots out of the switch into their places; turning it off spirals them
// back in.
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
