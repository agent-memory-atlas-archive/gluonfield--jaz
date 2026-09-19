import { useState } from 'react'
import type { VoiceMessage } from '@/lib/api/types'
import { AssistantMarkdown } from '@/components/session/AssistantMarkdown'
import { Collapse } from '@/components/ui/Collapse'
import { DisclosureTrigger } from '@/components/ui/DisclosureTrigger'

export function SpokenReply({ voice, findActive, showCopy }: {
  voice: VoiceMessage
  findActive: boolean
  showCopy: boolean
}) {
  const [open, setOpen] = useState(false)
  const effectiveOpen = open || findActive
  return (
    <div className="flex w-full max-w-[var(--prose-max)] flex-col items-start">
      <DisclosureTrigger label="Spoken reply" open={effectiveOpen} onClick={() => setOpen((value) => !value)} />
      <Collapse open={effectiveOpen} className="w-full">
        <div className="pt-2">
          <AssistantMarkdown text={voice.text} createdAt={voice.at} showCopy={showCopy} />
        </div>
      </Collapse>
    </div>
  )
}
