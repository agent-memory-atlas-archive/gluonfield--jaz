import { expect, test } from 'bun:test'

test('history recovery survives live metadata updates and cancels when the session unmounts', async () => {
  const worker = new globalThis.Worker(new globalThis.URL('./sessionHistoryRecovery.worker.mjs', import.meta.url).href)
  try {
    const result = await new Promise((resolve, reject) => {
      worker.onmessage = (event) => resolve(event.data)
      worker.onerror = reject
    })
    expect(result.before).toContain('Keep this conversation visible')
    expect(result.after).toContain('Keep this conversation visible')
    expect(result.after).toContain('aria-label="Stop response"')
    expect(result.after).not.toContain('load this session')
    expect(result.during).toContain('Keep this conversation visible')
    expect(result.recovered).toContain('Latest conversation')
    expect(result.recovered).toContain('Earlier current history')
    expect(result.recovered).not.toContain('Keep this conversation visible')
    expect(result.requests).toEqual([
      '', '?before_message_seq=3&history_revision=2&turns=24',
      '', '?before_message_seq=3&history_revision=2&turns=24',
      '', '?before_message_seq=3&history_revision=2&turns=24',
      '', '?before_message_seq=3&history_revision=2&turns=24',
    ])
    expect(result.requestsAfterUnmount).toBe(0)
    expect(result.failureRequests).toBe(2)
    expect(result.failed).toContain('Retry')
    expect(result.failed).not.toContain('Internal database details')
  } finally {
    worker.terminate()
  }
})
