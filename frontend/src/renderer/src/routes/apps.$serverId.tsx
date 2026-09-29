import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { MCPAppFrame } from '@/components/apps/MCPAppFrame'
import { mcpAppsQuery } from '@/lib/api/mcp'

export const Route = createFileRoute('/apps/$serverId')({
  component: AppPage,
})

function AppPage() {
  const { serverId } = Route.useParams()
  const apps = useQuery(mcpAppsQuery)
  const name = apps.data?.find((app) => app.server_id === serverId)?.name ?? 'App'
  return <MCPAppFrame key={serverId} serverId={serverId} name={name} />
}
