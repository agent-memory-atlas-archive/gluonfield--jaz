import { spring } from 'motion'
import { motion, useReducedMotion } from 'motion/react'
import type { CSSProperties, ReactNode } from 'react'
import { SidePanelResizeHandle } from './SidePanelResizeHandle'
import type { useSidePanelState } from './SidePanelState'

const panelSpring = { stiffness: 400, damping: 36 }
const widthTransition = `width ${spring({ ...panelSpring, keyframes: [0, 1] })}`

export function SidePanelDrawer({ panel, isMobile, children }: {
  panel: ReturnType<typeof useSidePanelState>
  isMobile: boolean
  children: ReactNode
}) {
  const desktopPreview = !isMobile && panel.view === 'preview'
  const reducedMotion = useReducedMotion()
  return <motion.div
    style={{
      '--side-panel-width': desktopPreview ? '100%' : `${panel.width}px`,
      width: isMobile ? undefined : panel.open ? panel.widthStyle : 0,
      transition: isMobile || panel.resizing || reducedMotion ? 'none' : widthTransition,
    } as CSSProperties}
    className="relative h-full shrink-0 overflow-hidden max-sm:absolute max-sm:inset-y-0 max-sm:right-0 max-sm:z-shell max-sm:w-full!"
    initial={false}
    animate={{ x: isMobile && !panel.open ? '100%' : 0 }}
    transition={panel.resizing || reducedMotion ? { duration: 0 } : { type: 'spring', ...panelSpring }}
  >
    {panel.resizable ? <SidePanelResizeHandle
      width={panel.width}
      minWidth={panel.minWidth}
      maxWidth={panel.maxWidth}
      disabled={isMobile || !panel.open}
      onResizeStart={() => panel.setResizing(true)}
      onResize={panel.resize}
      onResizeEnd={() => panel.setResizing(false)}
    /> : null}
    {children}
  </motion.div>
}
