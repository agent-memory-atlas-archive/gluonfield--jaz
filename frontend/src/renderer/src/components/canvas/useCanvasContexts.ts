import { useCallback, useMemo, useState } from 'react'
import type { ComposerContext } from '@/lib/sendMessage'

export interface CanvasPick {
  node: string
  label: string
}

interface DraftContexts {
  contexts: ComposerContext[]
  removeContext: (id: string) => void
  replaceContexts: (contexts: ComposerContext[]) => void
}

const contextId = (node: string) => `canvas:${node}`

// The canvas selection rides along as composer context. It lives in the board,
// never in the stored draft: sending clears it, a removed chip deselects.
export function useCanvasContexts(draft: DraftContexts) {
  const [picks, setPicks] = useState<CanvasPick[]>([])
  const onSelect = useCallback((next: CanvasPick[]) => {
    setPicks((current) => (current.map((pick) => pick.node).join() === next.map((pick) => pick.node).join() ? current : next))
  }, [])
  const selection = useMemo(() => picks.map((pick) => pick.node), [picks])
  const contexts = useMemo<ComposerContext[]>(() => [
    ...draft.contexts,
    ...picks.map((pick) => ({ id: contextId(pick.node), type: 'canvas' as const, node: pick.node, label: pick.label })),
  ], [draft.contexts, picks])
  const { removeContext, replaceContexts } = draft
  const remove = useCallback((id: string) => {
    if (id.startsWith('canvas:')) setPicks((current) => current.filter((pick) => contextId(pick.node) !== id))
    else removeContext(id)
  }, [removeContext])
  const replace = useCallback((next: ComposerContext[]) => {
    replaceContexts(next.filter((context) => context.type !== 'canvas'))
    setPicks(next.flatMap((context) => (context.type === 'canvas' ? [{ node: context.node, label: context.label }] : [])))
  }, [replaceContexts])
  return { selection, onSelect, contexts, removeContext: remove, replaceContexts: replace }
}
