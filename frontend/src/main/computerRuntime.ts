import type { CuaDriverLike } from '@trycua/cua-driver'
import type { ComputerAction, ComputerStatus } from '@shared/computerControl'
import { COMPUTER_IMAGE_LIMIT } from '@shared/computerControl'
import type { ScriptResult } from '@shared/script'

type Tool = {
  name: string
  description: string
  capabilities: string[]
  inputSchema: { properties?: Record<string, unknown> }
}

type Lease = {
  id: string
  owner: number
  session: string
  abort: AbortController
  driver: Promise<CuaDriverLike>
  tools: Promise<Tool[]>
  pending?: Promise<ScriptResult>
  closing?: Promise<void>
  timeout: ReturnType<typeof setTimeout>
}

export class ComputerRuntime {
  private active?: Lease

  constructor(
    private readonly create: () => Promise<CuaDriverLike>,
    private readonly availability: () => Promise<ComputerStatus>,
  ) {}

  async status(): Promise<ComputerStatus> {
    return { ...await this.availability(), owner: this.active?.session }
  }

  async begin(owner: number, id: string, session: string): Promise<void> {
    if (this.active) {
      throw new Error('Another computer-use script is controlling this machine')
    }
    const abort = new AbortController()
    const driver = this.availability().then((status) => {
      if (!status.available) {
        throw new Error(status.reason || 'Computer use is unavailable')
      }
      abort.signal.throwIfAborted()
      return this.create()
    })
    const lease: Lease = {
      id, owner, session, abort, driver,
      tools: driver.then(async (driver) => {
        const catalog = JSON.parse(await driver.listToolsJson({ signal: abort.signal })) as { tools: Tool[] }
        return catalog.tools.filter((tool) => tool.capabilities.length > 0 && tool.capabilities.every((capability) =>
          /^(app|window|accessibility|input|screen|clipboard|menu|state|agent_cursor|visual)\./.test(capability)))
      }),
      timeout: setTimeout(() => void this.cancel(owner, id).catch(() => {}), 65000),
    }
    this.active = lease
    try {
      await lease.tools
      abort.signal.throwIfAborted()
    } catch (error) {
      await this.end(owner, id)
      throw error
    }
  }

  async call(owner: number, id: string, input: ComputerAction): Promise<ScriptResult> {
    const lease = this.owned(owner, id)
    lease.abort.signal.throwIfAborted()
    if (lease.closing || lease.pending) {
      throw new Error('Await each computer action before starting another')
    }
    const pending = this.perform(lease, input)
    lease.pending = pending
    try {
      return await pending
    } finally {
      lease.pending = undefined
    }
  }

  private async perform(lease: Lease, input: ComputerAction): Promise<ScriptResult> {
    const tools = await lease.tools
    if (!input.name) {
      return { status: 'ok', data: tools.map((tool) => tool.name) }
    }
    const tool = tools.find((tool) => tool.name === input.name)
    if (!tool) {
      throw new Error('Unknown native computer tool; inspect computer.tools()')
    }
    if (!input.args) {
      return { status: 'ok', data: tool }
    }
    const driver = await lease.driver
    const result = await driver.callTool(tool.name, JSON.stringify(input.args, exactNumbers), { signal: lease.abort.signal })
    if (Buffer.byteLength(result.text) + Buffer.byteLength(result.structuredJson ?? '') > 4 * 1024 * 1024) {
      throw new Error('Computer result exceeds 4 MiB; request a smaller observation')
    }
    if (result.isError) {
      throw new Error((result.text || result.errorCode || 'Computer action failed').slice(0, 12000))
    }
    const image = result.images.at(-1)
    if (image && image.dataBase64.length > COMPUTER_IMAGE_LIMIT) {
      throw new Error('Computer screenshot exceeds 32 MiB')
    }
    return {
      status: 'ok',
      text: result.text,
      data: result.structuredJson ? JSON.parse(result.structuredJson, exactNumbers) : { text: result.text },
      image_base64: image?.dataBase64,
      image_mime_type: image?.mimeType,
    }
  }

  async cancel(owner: number, id: string): Promise<void> {
    if (this.active?.owner !== owner || this.active.id !== id) {
      return
    }
    this.active.abort.abort(new Error('Computer script cancelled'))
    await this.end(owner, id)
  }

  async end(owner: number, id: string): Promise<void> {
    if (this.active?.owner !== owner || this.active.id !== id) {
      return
    }
    const lease = this.active
    lease.closing ??= this.close(lease)
    await lease.closing
  }

  async cancelOwner(owner: number): Promise<void> {
    if (this.active?.owner === owner) {
      await this.cancel(owner, this.active.id)
    }
  }

  async shutdown(): Promise<void> {
    if (this.active) {
      await this.cancel(this.active.owner, this.active.id)
    }
  }

  private owned(owner: number, id: string): Lease {
    if (this.active?.owner !== owner || this.active.id !== id) {
      throw new Error('Computer action does not own the active script')
    }
    return this.active
  }

  private async close(lease: Lease): Promise<void> {
    clearTimeout(lease.timeout)
    try {
      await lease.pending?.catch(() => {})
      const driver = await lease.driver.catch(() => undefined)
      if (driver) {
        try {
          await driver.shutdown()
        } finally {
          if ('uniffiDestroy' in driver && typeof driver.uniffiDestroy === 'function') {
            driver.uniffiDestroy()
          }
        }
      }
    } finally {
      this.active = undefined
    }
  }
}

function exactNumbers(_key: string, value: unknown): unknown {
  if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) {
    throw new Error('Computer data contains a number outside the JavaScript safe range')
  }
  return value
}
