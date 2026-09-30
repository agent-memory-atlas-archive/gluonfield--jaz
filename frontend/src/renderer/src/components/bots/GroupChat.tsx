import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUp } from 'lucide-react'
import { motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { MentionSuggestions, MentionTextarea, useMentionInput } from '@/components/session/MentionInput'
import { SidePanelControl } from '@/components/session/SidePanelControl'
import { THREAD_COLUMN_CLASS } from '@/components/session/threadLayout'
import { useThreadAutoScroll } from '@/components/session/useThreadAutoScroll'
import { EmptyState } from '@/components/ui/EmptyState'
import { IconButton } from '@/components/ui/IconButton'
import { useToast } from '@/components/ui/toast'
import { botsQuery, sendGroupMessage } from '@/lib/api/bots'
import { markThreadSeen } from '@/lib/api/feed'
import { sessionEventsQuery } from '@/lib/api/sessions'
import type { Bot } from '@/lib/api/types'
import { botAvatars, chatEntries } from '@/lib/bots'
import { modalDialogOpen } from '@/lib/dom/modal'
import { useSessionEvents } from '@/lib/hooks/useSessionEvents'
import { useSessionHistory } from '@/lib/hooks/useSessionHistory'
import { useWindowEvent } from '@/lib/hooks/useWindowEvent'
import { invalidateSessionLists } from '@/lib/query/invalidate'
import { coalesceSessionEvents } from '@/lib/sessionEvents'
import { OVERVIEW_PANEL_WIDTH } from '@/lib/sidePanelTabs'
import { useTitlebarActions, useTitlebarSlot } from '@/lib/titlebar'
import { BotPill } from './BotAvatar'
import { ChatLog } from './ChatLog'
import { GroupDetails } from './GroupDetails'

// A group is a room, not an agent thread: its transcript is the room_message
// events on the group's thread, and messages go to the room, which decides
// which members answer.
export function GroupChat({ group, bots }: { group: Bot; bots: Bot[] }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const reportHistoryError = useCallback(
    (message: string) => toast(`Couldn't load earlier history: ${message}`, 'danger'),
    [toast],
  )
  const history = useSessionHistory(group.id, reportHistoryError)
  const live = useQuery(sessionEventsQuery(group.id))
  useSessionEvents(group.id, history.data?.latest_event_seq)
  const { attachScroll, onScroll, pinToBottom } = useThreadAutoScroll({ resetKey: group.id })
  const [detailsOpen, setDetailsOpen] = useState(false)
  const entries = useMemo(
    () => chatEntries([], coalesceSessionEvents([...(history.data?.events ?? []), ...live.data]), group, false),
    [history.data?.events, live.data, group],
  )
  // Members' status comes from the bot list, polled briskly while the room is
  // open so "is working" rows keep up with the round.
  const fresh = useQuery({ ...botsQuery, refetchInterval: 2_000 }).data ?? bots
  const working = fresh.filter((bot) => group.members?.includes(bot.id) && bot.status === 'running')

  useEffect(() => {
    void markThreadSeen(group.id).finally(() => invalidateSessionLists(queryClient))
  }, [group.id, queryClient])
  useTitlebarSlot(useMemo(() => <BotPill avatars={botAvatars(group, bots)} name={group.name} />, [group, bots]))
  useTitlebarActions(
    useMemo(
      () => (
        <SidePanelControl
          open={detailsOpen}
          mode="overview"
          modes={['overview']}
          overviewLabel="Details"
          onToggle={() => setDetailsOpen((open) => !open)}
        />
      ),
      [detailsOpen],
    ),
  )
  useWindowEvent('keydown', (e) => {
    if (e.defaultPrevented || !e.metaKey || e.shiftKey || e.altKey || e.ctrlKey || modalDialogOpen()) return
    if (e.key.toLowerCase() !== 'o') return
    e.preventDefault()
    setDetailsOpen((open) => !open)
  })

  return (
    <div className="relative flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <div ref={attachScroll} onScroll={onScroll} className="scrollbar-quiet min-h-0 flex-1 overflow-y-auto">
          <div className={`${THREAD_COLUMN_CLASS} py-6`}>
            {history.isError && !history.data ? (
              <EmptyState title="Couldn't load this chat" />
            ) : history.data && !entries.length ? (
              <EmptyState title="Say something to the group" />
            ) : (
              <ChatLog entries={entries} bots={bots} named working={working} />
            )}
          </div>
        </div>
        <div className={`${THREAD_COLUMN_CLASS} w-full pb-4`}>
          <GroupComposer group={group} onSent={pinToBottom} />
        </div>
      </div>
      <motion.div
        initial={false}
        animate={{ width: detailsOpen ? OVERVIEW_PANEL_WIDTH : 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 36 }}
        inert={!detailsOpen}
        className="h-full shrink-0 overflow-hidden max-sm:absolute max-sm:inset-y-0 max-sm:right-0 max-sm:z-shell"
      >
        <GroupDetails group={group} bots={bots} />
      </motion.div>
    </div>
  )
}

function GroupComposer({ group, onSent }: { group: Bot; onSent: () => void }) {
  const toast = useToast()
  const mention = useMentionInput({ storageKey: `jaz.groupDraft.${group.id}`, storage: 'local' })
  const send = useMutation({
    mutationFn: (text: string) => sendGroupMessage(group.id, text),
    onSuccess: () => {
      mention.reset()
      onSent()
    },
    onError: (error) => toast(`Couldn't send: ${error.message}`, 'danger'),
  })
  const submit = () => {
    const text = mention.value().trim()
    if (text && !send.isPending) send.mutate(text)
  }

  return (
    <div className="relative">
      <MentionSuggestions mention={mention} placement="above" />
      <div className="flex items-end gap-2 rounded-[12px] bg-surface p-2.5 ring-1 ring-border focus-within:ring-2 focus-within:ring-primary">
        <div className="min-w-0 flex-1">
          <MentionTextarea
            mention={mention}
            placeholder={`Message ${group.name}`}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.shiftKey) return
              e.preventDefault()
              submit()
            }}
          />
        </div>
        <IconButton
          variant="primary"
          size="md"
          aria-label="Send message"
          title="Send message"
          disabled={mention.isEmpty || send.isPending}
          onClick={submit}
        >
          <ArrowUp size={16} />
        </IconButton>
      </div>
    </div>
  )
}
