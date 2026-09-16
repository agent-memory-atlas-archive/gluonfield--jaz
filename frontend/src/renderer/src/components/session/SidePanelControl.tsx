import { LayoutList, PanelRight } from 'lucide-react'
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
    <div className="flex shrink-0 items-center gap-0.5">
      {(['tabs', 'overview'] as const).map((option) => {
        const active = open && mode === option
        const label = option === 'tabs' ? 'Side Panel' : 'Overview'
        const Icon = option === 'tabs' ? PanelRight : LayoutList
        return (
          <button
            key={option}
            type="button"
            aria-label={label}
            aria-pressed={active}
            title={`${active ? 'Hide' : 'Open'} ${label} (${option === 'tabs' ? '⌘⇧S' : '⌘O'})`}
            onClick={() => onToggle(option)}
            className={`flex h-7 cursor-pointer items-center justify-center gap-1 rounded-lg px-2.5 text-xs pointer-coarse:h-10 pointer-coarse:min-w-10 font-medium whitespace-nowrap transition-[background-color,color,transform] duration-150 active:scale-[0.96] ${active ? 'bg-surface text-ink' : 'text-ink-2 hover:bg-surface hover:text-ink'}`}
          >
            <Icon size={14} aria-hidden className="shrink-0" />
            <span className="max-sm:hidden">{label}</span>
            {metaHeld ? <KeyboardShortcut value={option === 'tabs' ? '⇧S' : 'O'} /> : null}
          </button>
        )
      })}
    </div>
  )
}
