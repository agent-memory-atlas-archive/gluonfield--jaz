import { Globe } from 'lucide-react'
import { memo, useState } from 'react'

export const Favicon = memo(function Favicon({
  url,
  iconUrl,
  className = 'size-3.5 shrink-0 text-ink-3',
}: {
  url: string
  iconUrl?: string
  className?: string
}) {
  const [failedSource, setFailedSource] = useState('')
  let domain: string
  try {
    domain = new URL(url).hostname
  } catch {
    domain = ''
  }
  const source = iconUrl || (domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64` : '')
  if (!source || source === failedSource) return <Globe size={14} className={className} aria-hidden />
  return (
    <img
      src={source}
      alt=""
      width={14}
      height={14}
      loading="lazy"
      draggable={false}
      onError={() => setFailedSource(source)}
      className={`${className} rounded-sm outline outline-1 outline-black/10 dark:outline-white/10`}
    />
  )
})
