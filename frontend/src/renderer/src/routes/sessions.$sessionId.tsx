import { createFileRoute, useLocation } from '@tanstack/react-router'
import { ThreadView } from '@/components/session/ThreadView'

type SessionSearch = {
  message?: number
}

export const Route = createFileRoute('/sessions/$sessionId')({
  validateSearch: (search): SessionSearch => {
    const raw = search.message
    const message = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : 0
    return Number.isSafeInteger(message) && message > 0 ? { message } : {}
  },
  component: SessionRoute,
})

function SessionRoute() {
  const { sessionId } = Route.useParams()
  const { message } = Route.useSearch()
  const initialPrompt = useLocation({ select: (location) => location.state.initialSessionPrompt })
  return (
    <ThreadView
      key={sessionId}
      sessionId={sessionId}
      message={message}
      initialPrompt={initialPrompt?.sessionId === sessionId ? initialPrompt : undefined}
    />
  )
}
