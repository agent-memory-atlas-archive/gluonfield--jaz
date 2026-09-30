import { createFileRoute } from '@tanstack/react-router'

// The app itself lives in MCPApps over the content card, which stays mounted
// across sections; this route only makes one sidebar entrypoint the active one
// and carries a deep link's app-relative path to it.
export const Route = createFileRoute('/apps/$serverId/$tool')({
  validateSearch: (search): { path?: string } =>
    typeof search.path === 'string' && search.path.startsWith('/') ? { path: search.path } : {},
})
