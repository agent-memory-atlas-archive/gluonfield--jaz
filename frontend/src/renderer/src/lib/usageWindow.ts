import { usageDateKey } from '@/lib/usageDaily'

export type UsageDateRange = { start: string; end: string }
export type UsageWindow = { days: number } | UsageDateRange

export function recentUsageRange(days: number, now = new Date()): UsageDateRange {
  const end = usageDateKey(now)
  const start = new Date(`${end}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - days + 1)
  return { start: start.toISOString().slice(0, 10), end }
}

export function usageRangeError({ start, end }: UsageDateRange): string | null {
  const dates = [start, end]
  const times = dates.map((date) => Date.parse(`${date}T00:00:00Z`))
  if (times.some((time, index) => !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== dates[index])) {
    return 'Choose a start and end date.'
  }
  if (start > end) {
    return 'End date must be on or after start date.'
  }
  if ((times[1] - times[0]) / 86_400_000 >= 365) {
    return 'Choose a range of up to 365 days.'
  }
  return null
}
