import { useReducedMotion } from 'motion/react'
import { useLayoutEffect, useRef } from 'react'
import { useEffectsEnabled } from '@/lib/appearance'
import { useTheme } from '@/lib/theme'

const PITCH = 22
const RADIUS = 1.35
const ALPHA = 0.18
const HUES = 48
const TAU = Math.PI * 2
// The camera, and where the board starts: far back, tipped away and turned.
const FOCAL = 1000
const DEPTH = 2600
const TILT = 1.15
const TURN = 0.45
const ENTER_MS = 1300
const EXIT_MS = 380

type Point = { x: number; y: number }
type Motion = { from: number; on: boolean; start: number; origin: Point }

// A damped spring from 1 to rest at 0, overshooting once.
function spring(ms: number): number {
  const omega = TAU / 1400
  const decay = 260
  return Math.exp(-ms / decay) * (Math.cos(omega * ms) + Math.sin(omega * ms) / (omega * decay))
}

// How far the board has arrived: 0 is back at the switch, 1 is flat on the page.
function arrival(motion: Motion, now: number): number {
  const ms = now - motion.start
  if (motion.on) {
    return 1 - (1 - motion.from) * spring(ms)
  }
  return motion.from * (1 - Math.min(1, ms / EXIT_MS) ** 2)
}

// The theme's rainbow, sampled into a strip the board's tint runs across.
function prism(): string[] {
  const style = getComputedStyle(document.documentElement)
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
  const gradient = ctx.createLinearGradient(0, 0, HUES, 0)
  const stops = [1, 2, 3, 4, 5].map((i) => style.getPropertyValue(`--color-rainbow-${i}`).trim())
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

  // The board at arrival p, in perspective. It flies from the switch, tipped
  // back and turned, and swings up to face the page; its rainbow drains to
  // grey as it lands.
  const posed = (p: number, origin: Point) => {
    const away = 1 - p
    const depth = DEPTH * away
    const tilt = TILT * away
    const turn = TURN * away * Math.sign(width / 2 - origin.x)
    const [tiltCos, tiltSin, turnCos, turnSin] = [Math.cos(tilt), Math.sin(tilt), Math.cos(turn), Math.sin(turn)]
    const reach = (FOCAL + depth) / FOCAL
    const ox = (origin.x - width / 2) * reach * away
    const oy = (origin.y - height / 2) * reach * away
    const tint = Math.max(0, Math.min(1, away * 1.6))
    const fade = Math.min(1, p * 4)
    let color = ''
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i] - width / 2
      const y = ys[i] - height / 2
      const ty = y * tiltCos
      const tz = depth - y * tiltSin
      const rx = x * turnCos + tz * turnSin
      const rz = tz * turnCos - x * turnSin
      const scale = FOCAL / (FOCAL + rz)
      if (scale <= 0) {
        continue
      }
      const next = tint > 0.08 ? hues[Math.floor(((xs[i] + ys[i]) / (width + height)) * HUES) % HUES] : ink
      if (next !== color) {
        color = next
        ctx.fillStyle = color
      }
      ctx.globalAlpha = fade * Math.min(1, ALPHA * scale + 0.85 * tint)
      ctx.beginPath()
      ctx.arc(width / 2 + (rx + ox) * scale, height / 2 + (ty + oy) * scale, RADIUS * scale * (1 + 1.5 * tint), 0, TAU)
      ctx.fill()
    }
  }

  const draw = (now: number) => {
    ctx.clearRect(0, 0, width, height)
    if (motion) {
      posed(arrival(motion, now), motion.origin)
    } else if (on) {
      flat()
    }
  }

  const frame = (now: number) => {
    if (motion && now - motion.start > (motion.on ? ENTER_MS : EXIT_MS)) {
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

  // The board comes from where the user just clicked, or mid-page from the
  // keyboard.
  const origin = (): Point => {
    const rect = canvas.getBoundingClientRect()
    if (performance.now() - pointer.at > 1000) {
      return { x: width / 2, y: height / 2 }
    }
    return { x: (pointer.x - rect.left) / zoom(), y: (pointer.y - rect.top) / zoom() }
  }

  // A field's first state, and every change without effects, is drawn at once.
  const set = (next: boolean, animate: boolean) => {
    if (next === on) {
      return
    }
    const first = on === undefined
    const now = performance.now()
    const from = motion ? Math.min(1, arrival(motion, now)) : Number(Boolean(on))
    on = next
    motion = first || !animate ? null : { from, on: next, start: now, origin: origin() }
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

// The canvas's dot grid behind the new-thread composer. Turning it on flies
// the board out of the switch in perspective until it lies flat on the page.
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
