import { useIsMobile } from '@/lib/hooks/useIsMobile'
import { useMetaHeld } from '@/lib/hooks/useMetaHeld'
import { KeyboardShortcut } from '@/components/ui/KeyboardShortcut'
import type { SidePanelMode } from '@/lib/sidePanelTabs'

export function SidePanelControl({ open, mode, onToggle }: {
  open: boolean
  mode: SidePanelMode
  onToggle: (mode: SidePanelMode) => void
}) {
  const isMobile = useIsMobile()
  const metaHeld = useMetaHeld(!isMobile)
  return (
    <div className="flex shrink-0 items-center gap-1">
      {(['tabs', 'overview'] as const).map((option) => {
        const active = open && mode === option
        const label = option === 'tabs' ? 'Side Panel' : 'Overview'
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            title={`${active ? 'Hide' : 'Open'} ${label} (${option === 'tabs' ? '⌘⇧S' : '⌘O'})`}
            onClick={() => onToggle(option)}
            className={`flex h-10 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13px] font-medium whitespace-nowrap transition-[background-color,color,transform] duration-150 active:scale-[0.96] ${active ? 'bg-surface text-ink' : 'text-ink-2 hover:bg-surface hover:text-ink'}`}
          >
            {label}
            {metaHeld ? <KeyboardShortcut value={option === 'tabs' ? '⇧S' : 'O'} /> : null}
          </button>
        )
      })}
    </div>
  )
}
