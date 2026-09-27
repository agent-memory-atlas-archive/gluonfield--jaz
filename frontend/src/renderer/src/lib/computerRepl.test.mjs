import { expect, test } from 'bun:test'
import { setTimeout } from 'node:timers'
import { ComputerRepl } from './computerRepl'
import { ComputerRuntime } from '../../../main/computerRuntime'

function fixture(owner = 1, runtime) {
  const calls = []
  runtime ??= new ComputerRuntime(async () => ({
    listToolsJson: async () => JSON.stringify({ tools: [{ name: 'inspect', capabilities: ['accessibility.tree'], inputSchema: {} }] }),
    callTool: async () => ({ text: 'native state', structuredJson: '{"answer":42}', images: [{ mimeType: 'image/png', dataBase64: 'cGljdHVyZQ==' }] }),
    shutdown: async () => {},
    uniffiDestroy: () => {},
  }), async () => ({ available: true, platform: 'darwin' }))
  const host = {
    begin: (id, session) => runtime.begin(owner, id, session),
    call: (id, action) => {
      calls.push(action)
      return runtime.call(owner, id, action)
    },
    end: (id) => runtime.end(owner, id),
    cancel: (id) => runtime.cancel(owner, id),
  }
  return { host, runtime, calls, repl: new ComputerRepl(host, 'session-' + owner, 100) }
}

test('native scripts persist variables, emit discovery and forward screenshots through the real runtime adapter', async () => {
  const { repl, calls } = fixture()
  try {
    const docs = await repl.run('')
    expect(docs.text).toContain('snapshot_id')
    expect(calls).toEqual([])
    await repl.run('const native = await computer.call("inspect", {})')
    const output = await repl.run('nodeRepl.write(native.answer)\nawait computer.tools()\nawait computer.call("inspect", {})')
    expect(output.text).toContain('42')
    expect(output.text).toContain('inspect')
    expect(output.image_base64).toBe('cGljdHVyZQ==')
    const isolated = await repl.run('nodeRepl.write([typeof process, typeof require, typeof window, typeof fetch])')
    expect(isolated.text).toContain('["undefined","undefined","undefined","undefined"]')
  } finally {
    repl.cancel()
  }
})

test('two native sessions enforce one machine lease while status stays available', async () => {
  const one = fixture()
  const two = fixture(2, one.runtime)
  const running = one.repl.run('await new Promise(() => {})')
  const rejected = running.catch((error) => error)
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect((await one.runtime.status()).owner).toBe('session-1')
  await expect(two.repl.run('await computer.tools()')).rejects.toThrow('controlling this machine')
  one.repl.cancel()
  expect((await rejected).message).toContain('cancelled')
  expect((await two.repl.run('nodeRepl.write(42)')).text).toContain('42')
  two.repl.cancel()
})

test('cancelling while admission waits prevents late script execution', async () => {
  const admission = Promise.withResolvers()
  const f = fixture()
  let ended = false
  const repl = new ComputerRepl({
    ...f.host,
    begin: () => admission.promise,
    end: async () => {
      ended = true
    },
  }, 'thread')
  const running = repl.run('await computer.call("inspect", {})')
  const rejected = running.catch((error) => error)
  repl.cancel()
  await expect(repl.run('nodeRepl.write("overlap")')).rejects.toThrow('Another')
  admission.resolve()
  expect((await rejected).message).toContain('cancelled')
  expect(f.calls).toEqual([])
  expect(ended).toBe(true)
})
