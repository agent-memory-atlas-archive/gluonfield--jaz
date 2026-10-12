import { MessageSquare } from 'lucide-react'
import { Segmented } from '@/components/ui/Segmented'

function DotsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" aria-hidden>
      <path d="M5 5h.01M12 5h.01M19 5h.01M5 12h.01M12 12h.01M19 12h.01M5 19h.01M12 19h.01M19 19h.01" />
    </svg>
  )
}

// A thread starts as a chat or a canvas and keeps that mode for life.
export function ThreadModeSwitch({ canvas, disabled, onChange }: { canvas: boolean; disabled?: boolean; onChange: (canvas: boolean) => void }) {
  return (
    <Segmented
      layoutId="thread-mode"
      compact
      value={canvas ? 'canvas' : 'chat'}
      disabled={disabled}
      onChange={(value) => onChange(value === 'canvas')}
      options={[
        { value: 'chat', label: 'Chat', icon: <MessageSquare size={14} /> },
        { value: 'canvas', label: 'Canvas', icon: <DotsIcon /> },
      ]}
    />
  )
}
