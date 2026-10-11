import { useReducedMotion } from 'motion/react'
import { useLayoutEffect, useRef } from 'react'
import { useEffectsEnabled } from '@/lib/appearance'
import { useTheme } from '@/lib/theme'

const PITCH = 22
const RADIUS = 1.35
const ALPHA = 0.18
const HUES = 48
const TAU = Math.PI * 2
const SWEEP = 260
const SPEED = 12.8
const EASE = 0.7

type Wave = {
  on: boolean
  start: number
  end: number
  reach: number
  from: Float32Array
  dist: Float32Array
  ux: Float32Array
  uy: Float32Array
  hue: Uint8Array
}

// The way in is a shockwave: fast from the click, slowing as it spreads.
function front(ms: number): number {
  return SPEED * ms ** EASE
}

// Where a dot sits in the wave: px behind the shockwave on the way in, ms
// since the sweep passed on the way out.
function local(wave: Wave, i: number, elapsed: number): number {
  return wave.on ? front(elapsed) - wave.dist[i] : elapsed - (SWEEP * wave.dist[i]) / wave.reach
}

// How present a dot is: 1 is its resting size.
function presence(wave: Wave, i: number, u: number): number {
  const from = wave.from[i]
  if (u <= 0) {
    return from
  }
  if (!wave.on) {
    return from * (1 - Math.min(1, u / 220)) ** 2
  }
  return from + (1 - from) * (1 - Math.exp(-u / 40) * Math.cos(u / 22))
}

// The theme's rainbow, sampled around a circle so the wave's colour follows
// its direction.
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
  let wave: Wave | null = null
  let ink = ''
  let hues: string[] = []
  let raf = 0
  let pointer = { x: 0, y: 0, at: -Infinity }

  const draw = (now: number) => {
    ctx.clearRect(0, 0, width, height)
    if (!wave) {
      if (!on) {
        return
      }
      ctx.globalAlpha = ALPHA
      ctx.fillStyle = ink
      ctx.beginPath()
      for (let i = 0; i < xs.length; i++) {
        ctx.moveTo(xs[i] + RADIUS, ys[i])
        ctx.arc(xs[i], ys[i], RADIUS, 0, TAU)
      }
      ctx.fill()
      return
    }
    let color = ''
    for (let i = 0; i < xs.length; i++) {
      const u = local(wave, i, now - wave.start)
      const p = presence(wave, i, u)
      if (p < 0.02) {
        continue
      }
      // A dot the shockwave brings in flares in the rainbow and ripples.
      const fresh = wave.on && u > 0 ? 1 - wave.from[i] : 0
      const crest = fresh * (u / 26) * Math.exp(1 - u / 26)
      const push = fresh * 7 * Math.exp(-u / 70) * Math.sin(u / 24)
      ctx.globalAlpha = Math.min(1, ALPHA * Math.min(p, 1) + 0.85 * crest)
      // Parsing a colour costs more than drawing a dot: set it only on change.
      const next = crest > 0.05 ? hues[wave.hue[i]] : ink
      if (next !== color) {
        color = next
        ctx.fillStyle = color
      }
      ctx.beginPath()
      ctx.arc(xs[i] + wave.ux[i] * push, ys[i] + wave.uy[i] * push, RADIUS * p * (1 + 2 * crest), 0, TAU)
      ctx.fill()
    }
  }

  const frame = (now: number) => {
    if (wave && now > wave.start + wave.end) {
      wave = null
    }
    draw(now)
    if (wave) {
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
    wave = null
    cancelAnimationFrame(raf)
    draw(performance.now())
  }

  const recolor = () => {
    ink = getComputedStyle(document.documentElement).getPropertyValue('--color-ink').trim()
    hues = prism()
    if (!wave) {
      draw(performance.now())
    }
  }

  // The wave starts where the user just clicked, or mid-page from the keyboard.
  const origin = () => {
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
    const from = new Float32Array(xs.length)
    for (let i = 0; i < xs.length; i++) {
      from[i] = wave ? Math.min(1, presence(wave, i, local(wave, i, now - wave.start))) : Number(Boolean(on))
    }
    on = next
    wave = null
    cancelAnimationFrame(raf)
    if (first || !animate) {
      draw(now)
      return
    }
    const { x, y } = origin()
    const reach = Math.max(Math.hypot(x, y), Math.hypot(width - x, y), Math.hypot(x, height - y), Math.hypot(width - x, height - y))
    const dist = new Float32Array(xs.length)
    const ux = new Float32Array(xs.length)
    const uy = new Float32Array(xs.length)
    const hue = new Uint8Array(xs.length)
    for (let i = 0; i < xs.length; i++) {
      const dx = xs[i] - x
      const dy = ys[i] - y
      dist[i] = Math.hypot(dx, dy) || 1
      ux[i] = dx / dist[i]
      uy[i] = dy / dist[i]
      hue[i] = Math.floor(((Math.atan2(dy, dx) / TAU + 1) % 1) * HUES)
    }
    // The shockwave runs until every dot is well behind it.
    const end = next ? ((reach + 200) / SPEED) ** (1 / EASE) : SWEEP + 220
    wave = { on: next, start: now, end, reach, from, dist, ux, uy, hue }
    raf = requestAnimationFrame(frame)
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

// The canvas's dot grid behind the new-thread composer. Turning it on sends a
// wave out from the click: dots flare in the rainbow, bounce and settle grey.
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
