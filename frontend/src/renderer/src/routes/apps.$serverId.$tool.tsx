import { createFileRoute } from '@tanstack/react-router'

// The app itself lives in MCPApps over the content card, which stays mounted
// across sections; this route only makes one sidebar entrypoint the active one.
export const Route = createFileRoute('/apps/$serverId/$tool')({})
