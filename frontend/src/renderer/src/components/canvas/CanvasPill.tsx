import { useNavigate } from '@tanstack/react-router'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { MenuRow, Popover } from '@/components/ui/Popover'
import { isMacDesktop } from '@/lib/clientRuntime'

// A canvas thread hides the app's chrome; this is all that remains of it: the
// way back into Jaz and the project the canvas belongs to. It doubles as the
// window's drag handle.
export function CanvasPill({ name }: { name: string }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const go = (to: '/' | '/new') => {
    setOpen(false)
    void navigate({ to })
  }
  return (
    <div className={`canvas-pill canvas-overlay titlebar-drag${isMacDesktop ? ' beside-traffic-lights' : ''}`}>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        placement="below"
        trigger={
          <button type="button" className="canvas-pill-menu" aria-label="Jaz menu" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
            <span className="canvas-pill-mark">jaz</span>
            <ChevronDown size={14} />
          </button>
        }
      >
        <MenuRow onClick={() => go('/')}>All threads</MenuRow>
        <MenuRow onClick={() => go('/new')}>New task</MenuRow>
      </Popover>
      <span className="canvas-pill-name">{name}</span>
    </div>
  )
}
