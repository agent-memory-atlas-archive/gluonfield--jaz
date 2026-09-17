import { useMemo } from 'react'
import { SidePanelControl } from '@/components/session/SidePanelControl'
import type { useSidePanelState } from '@/components/session/SidePanelState'
import { SidePanelTabs } from '@/components/session/SidePanelTabs'
import { TokenStats } from '@/components/session/TokenStats'
import { RuntimeBadge } from '@/components/sidebar/RuntimeBadge'
import type { Session } from '@/lib/api/types'
import { useTitlebarActions, useTitlebarSlot } from '@/lib/titlebar'

export function SessionTitlebar({ session, isMobile, panel, sideChatAvailable }: {
  session: Session
  isMobile: boolean
  panel: ReturnType<typeof useSidePanelState>
  sideChatAvailable: boolean
}) {
  const { open, mode, tabs, activeTab, width, selectTab, reorderTabs, closeTab, addTab, toggleMode } = panel
  const activeId = activeTab?.id
  const slot = useMemo(() => <>
    <RuntimeBadge session={session} truncate />
    <TokenStats session={session} />
  </>, [session])
  useTitlebarSlot(slot)
  const actions = useMemo(() => (
    <div className="flex min-w-0 items-center gap-1" style={{ width: open && mode === 'tabs' ? isMobile ? '100%' : `calc(${width}px - 1rem)` : undefined }}>
      {open && mode === 'tabs' ? <SidePanelTabs
        tabs={tabs}
        activeId={activeId}
        sideChatAvailable={sideChatAvailable}
        onSelect={selectTab}
        onReorder={reorderTabs}
        onClose={closeTab}
        onAdd={addTab}
      /> : null}
      <SidePanelControl open={open} mode={mode} onToggle={toggleMode} />
    </div>
  ), [open, mode, isMobile, width, tabs, activeId, sideChatAvailable, selectTab, reorderTabs, closeTab, addTab, toggleMode])
  useTitlebarActions(actions)
  return null
}
