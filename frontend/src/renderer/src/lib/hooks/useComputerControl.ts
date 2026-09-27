import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiAuthenticatedWebSocketUrl } from '@/lib/api/client'
import { computerSettingsQuery } from '@/lib/api/settings'
import { connectComputer } from '@/lib/computerConnection'

export function useComputerControl(sessionId: string): void {
  const settings = useQuery(computerSettingsQuery)
  useEffect(() => {
    const host = window.jaz?.computer
    if (host && settings.data?.enabled) {
      return connectComputer(apiAuthenticatedWebSocketUrl('/v1/sessions/' + encodeURIComponent(sessionId) + '/computer'), host, sessionId)
    }
  }, [settings.data?.enabled, sessionId])
}
