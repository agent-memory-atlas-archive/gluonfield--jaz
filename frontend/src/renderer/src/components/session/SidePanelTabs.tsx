import { FileText, FolderGit2, Globe, MessageCirclePlus, Plus, Terminal, X } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { IconButton } from '@/components/ui/IconButton'
import { Popover } from '@/components/ui/Popover'
import { useBrowserSessions } from '@/lib/browserSessions'
import type { SidePanelTab } from '@/lib/sidePanelTabs'

const TAB_TYPES = {
  file: { label: 'Files', icon: FileText },
  'side-chat': { label: 'Side chat', icon: MessageCirclePlus },
  preview: { label: 'Browser', icon: Globe },
  terminal: { label: 'Terminal', icon: Terminal },
  diff: { label: 'Code diff', icon: FolderGit2 },
}

export function SidePanelTabMenu({ sideChatAvailable, onAdd, empty = false }: {
  sideChatAvailable: boolean
  onAdd: (kind: SidePanelTab['kind']) => void
  empty?: boolean
}) {
  const [open, setOpen] = useState(false)
  const options = (Object.keys(TAB_TYPES) as SidePanelTab['kind'][]).filter((kind) => kind !== 'side-chat' || sideChatAvailable)
  const rows = options.map((kind) => {
    const { label, icon: Icon } = TAB_TYPES[kind]
    return (
      <button type="button" className="flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-[9px] px-3 text-left text-[13px] text-ink-2 hover:bg-surface-2 hover:text-ink" key={kind} onClick={() => {
        onAdd(kind)
        setOpen(false)
      }}>
        <Icon size={16} className="shrink-0 text-ink-3" />
        {label}
      </button>
    )
  })
  if (empty) {
    return <div className="m-auto w-52 p-2">{rows}</div>
  }
  return (
    <Popover open={open} onClose={() => setOpen(false)} placement="below" align="end" trigger={
      <IconButton className="size-10!" aria-label="New tab" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((value) => !value)}>
        <Plus size={17} />
      </IconButton>
    }>
      {rows}
    </Popover>
  )
}

export function SidePanelTabs({ tabs, activeId, sideChatAvailable, onSelect, onClose, onAdd }: {
  tabs: SidePanelTab[]
  activeId?: string
  sideChatAvailable: boolean
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onAdd: (kind: SidePanelTab['kind']) => void
}) {
  const sessions = useBrowserSessions()
  const browsers = useSyncExternalStore(sessions.subscribe, sessions.getSnapshot)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.parentElement?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId])
  const focusTab = (id: string) => {
    onSelect(id)
    requestAnimationFrame(() => document.getElementById(`panel-tab-${id}`)?.focus())
  }
  const closeTab = (id: string) => {
    onClose(id)
    requestAnimationFrame(() => {
      const selected = list.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
      const target = selected ?? list.current?.parentElement?.querySelector<HTMLButtonElement>('[aria-label="New tab"]')
      target?.focus()
    })
  }
  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-1">
      <div ref={list} role="tablist" aria-label="Side panel tabs" className="scrollbar-quiet flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {tabs.map((tab, index) => {
          const { label, icon: Icon } = TAB_TYPES[tab.kind]
          const target = browsers.find((browser) => browser.id === tab.id)?.target
          const title = tab.kind === 'file' ? tab.file?.path.split('/').pop() || label : target?.title || target?.displayUrl || label
          const active = activeId === tab.id
          return (
            <div key={tab.id} className={`group flex h-10 min-w-0 shrink-0 items-center rounded-[9px] ${active ? 'bg-bg text-ink shadow-sm' : 'text-ink-2 hover:bg-surface-2'}`}>
              <button
                id={`panel-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`panel-body-${tab.id}`}
                tabIndex={active ? 0 : -1}
                title={tab.kind === 'file' ? tab.file?.path || title : target?.displayUrl || title}
                onClick={() => onSelect(tab.id)}
                onKeyDown={(event) => {
                  const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
                    : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
                      : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1
                  if (next >= 0) {
                    event.preventDefault()
                    focusTab(tabs[next].id)
                  } else if (event.key === 'Delete') {
                    event.preventDefault()
                    closeTab(tab.id)
                  }
                }}
                className="flex h-10 min-w-0 max-w-48 cursor-pointer items-center gap-2 rounded-[9px] pl-3 pr-1 text-[13px]"
              >
                <Icon size={15} className="shrink-0 text-ink-3" />
                <span className="truncate">{title}</span>
              </button>
              <button type="button" aria-label={`Close ${title}`} title={`Close ${title}`} onClick={() => closeTab(tab.id)} className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-[9px] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink">
                <X size={13} />
              </button>
            </div>
          )
        })}
      </div>
      <SidePanelTabMenu sideChatAvailable={sideChatAvailable} onAdd={onAdd} />
    </div>
  )
}
