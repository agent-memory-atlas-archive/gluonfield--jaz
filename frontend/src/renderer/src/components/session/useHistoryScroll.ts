import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

export function useHistoryScroll({
  scrollRef,
  firstKey,
  hasMore,
  onLoadMore,
}: {
  scrollRef: RefObject<HTMLDivElement | null>
  firstKey: string | undefined
  hasMore: boolean
  onLoadMore: () => void
}) {
  const historyRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const anchor = useRef<{ element: Element; top: number } | null>(null)
  const loadMore = useRef(onLoadMore)

  useLayoutEffect(() => {
    loadMore.current = onLoadMore
  })

  useLayoutEffect(() => {
    // Native anchoring also preserves the reading position through later image reflow.
    if (CSS.supports('overflow-anchor', 'auto')) return
    const viewport = scrollRef.current
    const history = historyRef.current
    const first = history?.firstElementChild
    if (!history || !first) return
    const contentTop = (element: Element) => element.getBoundingClientRect().top - history.getBoundingClientRect().top
    const previous = anchor.current
    if (viewport && previous && previous.element !== first && previous.element.isConnected) {
      viewport.scrollTop += contentTop(previous.element) - previous.top
    }
    anchor.current = { element: first, top: contentTop(first) }
  }, [firstKey, scrollRef])

  useEffect(() => {
    const viewport = scrollRef.current
    const sentinel = sentinelRef.current
    if (!viewport || !sentinel || !hasMore) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) loadMore.current()
    }, { root: viewport, rootMargin: '240px 0px 0px' })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [firstKey, hasMore, scrollRef])

  return { historyRef, sentinelRef }
}
