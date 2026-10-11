import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useToast } from '@/components/ui/toast'
import { getCanvas, patchCanvas, type CanvasPatch, type CanvasView } from '@/lib/api/canvas'
import { keys } from '@/lib/query/keys'
import { applyPatch, invertPatch } from './board'

// The server's board plus the user's edits still in flight. The board is polled
// while the agent works and read once more when its turn ends. Undo and redo
// replay the inverse of the user's own patches, so the agent's edits stay.
export function useCanvasSync(sessionId: string, working: boolean) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const canvas = useQuery({
    queryKey: keys.sessionCanvas(sessionId),
    queryFn: () => getCanvas(sessionId, queryClient.getQueryData<CanvasView>(keys.sessionCanvas(sessionId))),
    refetchInterval: working ? 1000 : false,
  })
  const { refetch } = canvas
  const wasWorking = useRef(working)
  useEffect(() => {
    if (wasWorking.current && !working) void refetch()
    wasWorking.current = working
  }, [working, refetch])

  const view = canvas.data
  const [pending, setPending] = useState<CanvasPatch[]>([])
  const local = useMemo(() => (view ? pending.reduce(applyPatch, view) : undefined), [view, pending])
  // Edits made in one event must see each other before React renders.
  const latest = useRef(local)
  useLayoutEffect(() => {
    latest.current = local
  }, [local])
  const history = useRef<Record<'undo' | 'redo', CanvasPatch[]>>({ undo: [], redo: [] })

  const send = useCallback((change: CanvasPatch) => {
    const inverse = invertPatch(latest.current!, change)
    latest.current = applyPatch(latest.current!, change)
    setPending((current) => [...current, change])
    patchCanvas(sessionId, change)
      .catch((error: Error) => toast(`Couldn't save the canvas: ${error.message}`, 'danger'))
      .then(() => refetch())
      .finally(() => setPending((current) => current.filter((item) => item !== change)))
    return inverse
  }, [sessionId, refetch, toast])
  const commit = useCallback((change: CanvasPatch) => {
    history.current.undo.push(send(change))
    history.current.redo = []
  }, [send])
  const replay = useCallback((from: 'undo' | 'redo') => {
    const change = history.current[from].pop()
    if (change) {
      history.current[from === 'undo' ? 'redo' : 'undo'].push(send(change))
    }
  }, [send])
  return { view, local, commit, replay, error: canvas.error }
}
