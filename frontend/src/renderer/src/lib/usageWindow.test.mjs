import { expect, test } from 'bun:test'
import { recentUsageRange, usageRangeError } from '@/lib/usageWindow'
import { keys } from '@/lib/query/keys'

test('presets include today and use local calendar dates across month, leap-year and year boundaries', () => {
  expect(recentUsageRange(1, new Date(2026, 8, 13, 0, 5))).toEqual({ start: '2026-09-13', end: '2026-09-13' })
  expect(recentUsageRange(7, new Date(2026, 0, 3))).toEqual({ start: '2025-12-28', end: '2026-01-03' })
  expect(recentUsageRange(30, new Date(2024, 2, 1))).toEqual({ start: '2024-02-01', end: '2024-03-01' })
})

test('custom dates include both endpoints and reject incomplete, reversed and overlong windows', () => {
  expect(usageRangeError({ start: '2024-03-10', end: '2024-03-10' })).toBeNull()
  expect(usageRangeError({ start: '2024-01-01', end: '2024-12-30' })).toBeNull()
  expect(usageRangeError({ start: '2024-01-01', end: '2024-12-31' })).toContain('365 days')
  expect(usageRangeError({ start: '2024-03-11', end: '2024-03-10' })).toContain('on or after')
  expect(usageRangeError({ start: '', end: '2024-03-10' })).toContain('start and end')
  expect(usageRangeError({ start: '2024-02-30', end: '2024-03-10' })).toContain('start and end')
})

test('each usage window and timezone has a distinct query cache entry', () => {
  const windows = [{ days: 1 }, { days: 7 }, { days: 30 }, { start: '2024-03-09', end: '2024-03-10' }, { start: '2024-03-09', end: '2024-03-11' }, { start: '2024-03-10', end: '2024-03-11' }]
  const queries = windows.flatMap((window) => ['UTC', 'America/New_York'].map((timezone) => JSON.stringify(keys.usageDaily(window, timezone))))
  expect(new Set(queries).size).toBe(windows.length * 2)
})
