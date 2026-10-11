import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useToast } from '@/components/ui/toast'
import { getCanvas, patchCanvas, type CanvasPatch, type CanvasView } from '@/lib/api/canvas'
import { keys } from '@/lib/query/keys'
import { applyPatch } from './board'

// The server's board plus the user's edits still in flight. The board is polled
// while the agent works and read once more when its turn ends.
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
  const commit = useCallback((change: CanvasPatch) => {
    setPending((current) => [...current, change])
    patchCanvas(sessionId, change)
      .catch((error: Error) => toast(`Couldn't save the canvas: ${error.message}`, 'danger'))
      .then(() => refetch())
      .finally(() => setPending((current) => current.filter((item) => item !== change)))
  }, [sessionId, refetch, toast])
  return { view, local, commit, error: canvas.error }
}
