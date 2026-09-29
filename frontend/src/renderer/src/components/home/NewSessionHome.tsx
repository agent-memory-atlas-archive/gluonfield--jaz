import { type ReactNode, useState } from 'react'
import { motion } from 'motion/react'
import { DitherTerrain, DitherWordmark } from '@/components/launch/DitherArt'
import { ComposerCard } from '@/components/session/Composer'
import { FileDropScope } from '@/components/ui/FileDrop'
import { useHomeWordmark } from '@/lib/appearance'
import { DEFAULT_HOME_WORDMARK, isHomeLogoUrl } from '@/lib/homeWordmark'
import type { SendMessageHandler } from '@/lib/sendMessage'

// One column, as wide as the composer card: the wordmark never outgrows it.
const HOME_WIDTH = 640

// Welcome mode: the dithered wordmark over the composer card, standing on
// the boot screen's brandscape under a sky that follows the theme.
export function NewSessionHome({
  creating,
  disabled = false,
  goalAvailable = false,
  leftSlot,
  draftStorageKey,
  fileRoot,
  onSend,
  onVoice,
}: {
  creating: boolean
  disabled?: boolean
  goalAvailable?: boolean
  leftSlot: ReactNode
  draftStorageKey?: string
  /** directory the composer's @-mention file picker indexes ('' = workspace root) */
  fileRoot?: string
  onSend: SendMessageHandler
  onVoice?: () => void
}) {
  const wordmark = useHomeWordmark()
  const logoUrl = isHomeLogoUrl(wordmark) ? wordmark : null
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null)

  return (
    <FileDropScope className="relative flex h-full flex-col overflow-hidden">
      <motion.div
        className="flex flex-1 items-center justify-center px-10 py-8 max-sm:px-4"
        initial={{ opacity: 0, y: 14, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      >
        <div className="flex w-full flex-col gap-8" style={{ maxWidth: HOME_WIDTH }}>
          {logoUrl && logoUrl !== failedLogoUrl ? (
            <div className="flex h-48 items-center justify-center">
              <img
                src={logoUrl}
                alt="Home logo"
                referrerPolicy="no-referrer"
                onError={() => setFailedLogoUrl(logoUrl)}
                className="block max-h-full max-w-full object-contain"
              />
            </div>
          ) : (
            <DitherWordmark text={logoUrl ? DEFAULT_HOME_WORDMARK : wordmark} maxWidth={HOME_WIDTH} />
          )}
          <ComposerCard
            streaming={creating}
            autoFocus
            placeholder="Ask anything, or hand your assistant a task…"
            planAvailable
            goalControlVisible
            goalAvailable={goalAvailable}
            disabled={creating || disabled}
            leftSlot={leftSlot}
            draftStorageKey={draftStorageKey}
            clearTiming="never"
            fileRoot={fileRoot}
            onSend={onSend}
            onVoice={onVoice}
          />
        </div>
      </motion.div>
      {/* in flow, so the hero centers in whatever the brandscape leaves; a short
          window shrinks the sky, never the composer */}
      <DitherTerrain sky className="flex min-h-0 shrink flex-col justify-end" />
    </FileDropScope>
  )
}
