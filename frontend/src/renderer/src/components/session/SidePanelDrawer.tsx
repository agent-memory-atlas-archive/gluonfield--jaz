import { motion } from 'motion/react'
import type { CSSProperties, ReactNode } from 'react'
import { drawerSlide } from '@/lib/dom/drawer'
import { SidePanelResizeHandle } from './SidePanelResizeHandle'
import type { useSidePanelState } from './SidePanelState'

export function SidePanelDrawer({ panel, isMobile, children }: {
  panel: ReturnType<typeof useSidePanelState>
  isMobile: boolean
  children: ReactNode
}) {
  const desktopPreview = !isMobile && panel.view === 'preview'
  return <motion.div
    style={{
      '--side-panel-width': desktopPreview ? '100%' : `${panel.width}px`,
    } as CSSProperties}
    className="relative h-full shrink-0 overflow-hidden max-sm:absolute max-sm:inset-y-0 max-sm:right-0 max-sm:z-shell max-sm:w-full!"
    initial={false}
    animate={drawerSlide({ isMobile, open: panel.open, side: 'right', width: desktopPreview ? panel.widthStyle : panel.width })}
    transition={desktopPreview || panel.resizing ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 36 }}
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
