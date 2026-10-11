import { useEffect, useState } from 'react'
import { buildArtifactThemeCSS } from '@/lib/artifacts'

// Sandboxed documents cannot read the app's CSS variables, so the host passes
// the current theme in and rebuilds when the root theme class or style changes.
export function useArtifactThemeCSS(): string {
  const [css, setCSS] = useState(() => buildArtifactThemeCSS())
  useEffect(() => {
    const update = () => setCSS(buildArtifactThemeCSS())
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
    return () => observer.disconnect()
  }, [])
  return css
}
