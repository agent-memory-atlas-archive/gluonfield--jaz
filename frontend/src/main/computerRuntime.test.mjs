import { expect, test } from 'bun:test'
import { ComputerRuntime } from './computerRuntime'
import { COMPUTER_IMAGE_LIMIT } from '../shared/computerControl'

const tools = [
  { name: 'inspect', capabilities: ['accessibility.tree'], inputSchema: {} },
  { name: 'click', capabilities: ['input.pointer.click'], inputSchema: {} },
  { name: 'settings', capabilities: ['system.config.write'], inputSchema: {} },
  { name: 'browser', capabilities: ['browser.dialog', 'input.delivery_mode'], inputSchema: {} },
]
const available = async () => ({ available: true, platform: 'darwin', driverVersion: 'fixture' })
const result = { text: 'observed', images: [], isError: false, structuredJson: '{"value":42}' }

function fixture(callTool = async () => result, shutdown = async () => {}) {
  let destroyed = 0
  const calls = []
  const runtime = new ComputerRuntime(async () => ({
    listToolsJson: async () => JSON.stringify({ tools }),
    callTool: async (...args) => {
      calls.push(args)
      return callTool(...args)
    },
    shutdown,
    uniffiDestroy: () => {
      destroyed += 1
    },
  }), available)
  return { runtime, calls, destroyed: () => destroyed }
}

test('machine lease spans owners and stays held until native shutdown finishes', async () => {
  const stopping = Promise.withResolvers()
  const f = fixture(undefined, () => stopping.promise)
  await f.runtime.begin(1, 'first', 'thread-one')
  await expect(f.runtime.begin(2, 'second', 'thread-two')).rejects.toThrow('controlling this machine')
  expect((await f.runtime.status()).owner).toBe('thread-one')
  await expect(f.runtime.call(2, 'first', {})).rejects.toThrow('does not own')
  await f.runtime.cancel(2, 'first')
  expect((await f.runtime.status()).owner).toBe('thread-one')
  const ending = f.runtime.end(1, 'first')
  await expect(f.runtime.begin(2, 'second', 'thread-two')).rejects.toThrow('controlling this machine')
  stopping.resolve()
  await ending
  expect(f.destroyed()).toBe(1)
  await f.runtime.begin(2, 'second', 'thread-two')
  await f.runtime.shutdown()
  expect((await f.runtime.status()).owner).toBeUndefined()
})

test('tool catalog projects native capabilities and preserves driver schemas', async () => {
  const f = fixture()
  await f.runtime.begin(1, 'first', 'thread')
  try {
    expect((await f.runtime.call(1, 'first', {})).data).toEqual(['inspect', 'click'])
    expect((await f.runtime.call(1, 'first', { name: 'inspect' })).data).toEqual(tools[0])
    await expect(f.runtime.call(1, 'first', { name: 'settings', args: {} })).rejects.toThrow('Unknown')
    const output = await f.runtime.call(1, 'first', { name: 'click', args: { element_token: 'fresh' } })
    expect(output.data).toEqual({ value: 42 })
    expect(f.calls[0].slice(0, 2)).toEqual(['click', '{"element_token":"fresh"}'])
  } finally {
    await f.runtime.shutdown()
  }
})

test('cancellation reaches the native signal and waits for admitted work', async () => {
  const started = Promise.withResolvers()
  const finished = Promise.withResolvers()
  let signal
  const f = fixture(async (_name, _args, options) => {
    signal = options.signal
    started.resolve()
    await finished.promise
    signal.throwIfAborted()
    return result
  })
  await f.runtime.begin(1, 'first', 'thread')
  const running = f.runtime.call(1, 'first', { name: 'click', args: {} })
  const rejected = running.catch((error) => error)
  await started.promise
  await expect(f.runtime.call(1, 'first', { name: 'click', args: {} })).rejects.toThrow('Await each')
  const cancelled = f.runtime.cancelOwner(1)
  expect(signal.aborted).toBe(true)
  expect((await f.runtime.status()).owner).toBe('thread')
  finished.resolve()
  expect((await rejected).message).toContain('cancelled')
  await cancelled
  expect(f.destroyed()).toBe(1)
})

test('screenshots use the real SDK image shape, enforce bounds and propagate refusals', async () => {
  let output = { ...result, images: [{ mimeType: 'image/png', dataBase64: 'cGljdHVyZQ==' }] }
  const f = fixture(async () => output)
  await f.runtime.begin(1, 'first', 'thread')
  try {
    const image = await f.runtime.call(1, 'first', { name: 'inspect', args: {} })
    expect(image.image_base64).toBe('cGljdHVyZQ==')
    expect(image.image_mime_type).toBe('image/png')
    output = { ...result, images: [{ mimeType: 'image/png', dataBase64: 'a'.repeat(COMPUTER_IMAGE_LIMIT + 1) }] }
    await expect(f.runtime.call(1, 'first', { name: 'inspect', args: {} })).rejects.toThrow('32 MiB')
    output = { ...result, structuredJson: '{"window_id":18446744073709551615}' }
    await expect(f.runtime.call(1, 'first', { name: 'inspect', args: {} })).rejects.toThrow('safe range')
    output = { ...result, isError: true, text: 'stale snapshot' }
    await expect(f.runtime.call(1, 'first', { name: 'click', args: {} })).rejects.toThrow('stale snapshot')
  } finally {
    await f.runtime.shutdown()
  }
})

test('unavailable permissions prevent driver creation and release admission', async () => {
  let creations = 0
  const runtime = new ComputerRuntime(async () => {
    creations += 1
  }, async () => ({ available: false, platform: 'darwin', reason: 'Permission needed' }))
  await expect(runtime.begin(1, 'first', 'thread')).rejects.toThrow('Permission needed')
  expect(creations).toBe(0)
  expect((await runtime.status()).owner).toBeUndefined()
})
