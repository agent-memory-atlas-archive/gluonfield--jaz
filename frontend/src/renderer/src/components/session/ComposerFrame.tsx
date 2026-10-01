import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { type ComponentProps, useEffect, useRef, useState } from 'react'
import { RAINBOW_BEAM } from '@/components/ui/rainbow'
import { useEffectsEnabled } from '@/lib/appearance'

// Borderless card, agent-council style: the surface tone IS the card. While
// focused a rainbow conic ring circles it; with effects off the ring is a calm
// static border that never animates.
export function ComposerFrame({ className = '', ...card }: ComponentProps<'div'>) {
  const ref = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(false)
  const reducedMotion = useReducedMotion()
  const effectsEnabled = useEffectsEnabled()
  // autoFocus lands before React's focus listeners attach; sync the ring state.
  useEffect(() => {
    if (ref.current?.contains(document.activeElement)) setFocused(true)
  }, [])
  return (
    <div
      ref={ref}
      className="relative"
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false)
      }}
    >
      <AnimatePresence>
        {focused && effectsEnabled ? (
          <motion.div
            key="ring"
            aria-hidden
            className="pointer-events-none absolute -inset-[2px]"
            initial={{ opacity: 0 }}
            animate={{
              opacity: 1,
              ...(reducedMotion ? {} : { '--ring-angle': ['0deg', '360deg'] }),
            }}
            exit={{ opacity: 0 }}
            transition={{
              opacity: { duration: 0.25, ease: 'easeOut' },
              '--ring-angle': { duration: 2.6, ease: 'linear', repeat: Infinity },
            }}
          >
            {/* glow trailing the comet, bleeding softly outside the card */}
            <div
              className="absolute -inset-[4px] rounded-[18px] opacity-50 blur-[10px]"
              style={{ background: RAINBOW_BEAM }}
            />
            {/* the comet itself; the card's opaque surface covers the center */}
            <div className="absolute inset-0 rounded-[14px]" style={{ background: RAINBOW_BEAM }} />
          </motion.div>
        ) : null}
      </AnimatePresence>
      <div
        {...card}
        className={`relative rounded-[12px] bg-surface p-2.5 transition-shadow ${
          effectsEnabled ? '' : focused ? 'ring-2 ring-primary' : 'ring-1 ring-border'
        } ${className}`}
      />
    </div>
  )
}
