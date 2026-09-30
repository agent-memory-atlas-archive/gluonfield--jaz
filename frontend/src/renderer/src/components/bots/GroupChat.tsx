import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUp } from 'lucide-react'
import { motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { UserBubble } from '@/components/session/Bubble'
import { MentionSuggestions, MentionTextarea, useMentionInput } from '@/components/session/MentionInput'
import { UserMessageMarkdown } from '@/components/session/MessageMarkdown'
import { SidePanelControl } from '@/components/session/SidePanelControl'
import { stableEventKey } from '@/components/session/timeline'
import { THREAD_COLUMN_CLASS } from '@/components/session/threadLayout'
import { useThreadAutoScroll } from '@/components/session/useThreadAutoScroll'
import { EmptyState } from '@/components/ui/EmptyState'
import { IconButton } from '@/components/ui/IconButton'
import { useToast } from '@/components/ui/toast'
import { sendGroupMessage } from '@/lib/api/bots'
import { markThreadSeen } from '@/lib/api/feed'
import { sessionEventsQuery } from '@/lib/api/sessions'
import type { Bot, BotAvatar as Avatar, RoomMessageEvent } from '@/lib/api/types'
import { BOT_COLORS, botAvatars } from '@/lib/bots'
import { modalDialogOpen } from '@/lib/dom/modal'
import { useSessionEvents } from '@/lib/hooks/useSessionEvents'
import { useSessionHistory } from '@/lib/hooks/useSessionHistory'
import { useWindowEvent } from '@/lib/hooks/useWindowEvent'
import { invalidateSessionLists } from '@/lib/query/invalidate'
import { coalesceSessionEvents } from '@/lib/sessionEvents'
import { OVERVIEW_PANEL_WIDTH } from '@/lib/sidePanelTabs'
import { useTitlebarActions, useTitlebarSlot } from '@/lib/titlebar'
import { BotAvatar, BotPill } from './BotAvatar'
import { GroupDetails } from './GroupDetails'

const GONE: Avatar = { shape: 'circle', color: 'gray' }

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
  const messages = useMemo(
    () =>
      coalesceSessionEvents([...(history.data?.events ?? []), ...live.data]).flatMap((event) =>
        event.room_message ? [{ key: stableEventKey(event), at: event.at, message: event.room_message }] : [],
      ),
    [history.data?.events, live.data],
  )

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
          <div className={`${THREAD_COLUMN_CLASS} flex flex-col gap-5 py-6`}>
            {history.isError && !history.data ? (
              <EmptyState title="Couldn't load this chat" />
            ) : history.data && !messages.length ? (
              <EmptyState title="Say something to the group" />
            ) : (
              messages.map(({ key, at, message }) => <RoomMessage key={key} at={at} message={message} bots={bots} />)
            )}
            {group.status === 'running' ? <p className="animate-pulse text-sm text-ink-3">Replying…</p> : null}
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

function RoomMessage({ at, message, bots }: { at: string; message: RoomMessageEvent; bots: Bot[] }) {
  if (message.speaker === 'user') return <UserBubble text={message.text} createdAt={at} />
  const avatar = bots.find((bot) => bot.id === message.bot_id)?.avatar ?? GONE
  return (
    <div className="flex items-start gap-2.5">
      <BotAvatar avatar={avatar} size={28} className="mt-5" />
      <div className="flex min-w-0 max-w-[84%] flex-col items-start gap-1">
        <span
          className="px-1 text-[12px] font-medium"
          style={{ color: `color-mix(in oklab, ${BOT_COLORS[avatar.color]} 65%, var(--color-ink))` }}
        >
          {message.name}
        </span>
        <div className="min-w-0 rounded-card bg-surface px-3.5 py-2.5 text-sm [overflow-wrap:break-word] select-text">
          <UserMessageMarkdown text={message.text} />
        </div>
      </div>
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
