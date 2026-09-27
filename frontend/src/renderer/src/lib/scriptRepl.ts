import { newQuickJSWASMModuleFromVariant, type QuickJSContext, type QuickJSWASMModule } from 'quickjs-emscripten-core'
import RELEASE_SYNC from '@jitl/quickjs-wasmfile-release-sync'
import type { ScriptResult } from '@shared/script'

// QuickJS supports async global scripts; the 0.32 TypeScript bindings omit this flag.
// https://github.com/bellard/quickjs/blob/master/quickjs.h#L319
const JS_EVAL_FLAG_ASYNC = 1 << 7
const OUTPUT_BYTES = 12000
const encoder = new TextEncoder()
const decoder = new TextDecoder()

let engine: Promise<QuickJSWASMModule> | undefined

export class ScriptRepl<Input> {
  private vm: QuickJSContext | undefined
  private documented = false
  private deadline = 0
  private expiresAt = 0
  private running = false
  private cancelled = false
  private rejectRun: ((error: Error) => void) | undefined
  private abort = new AbortController()
  private jobs = new Set<Promise<void>>()
  private output: ScriptResult = { status: 'ok' }

  constructor(
    private readonly action: (input: Input, signal: AbortSignal) => Promise<ScriptResult>,
    private readonly options: { name: string; api: string; documentation: string; observe: (input: Input) => boolean },
    private readonly timeoutMS = 60000,
  ) {}

  async run(code: string): Promise<ScriptResult> {
    if (this.running) {
      throw new Error(`Another ${this.options.name} script is running`)
    }
    this.running = true
    this.cancelled = false
    this.abort = new AbortController()
    const documentation = !this.documented || !code.trim() ? this.options.documentation + '\n' : ''
    this.output = { status: 'ok' }
    this.expiresAt = Date.now() + this.timeoutMS
    const timeout = setTimeout(() => this.cancel(), this.timeoutMS)
    try {
      engine ??= newQuickJSWASMModuleFromVariant(RELEASE_SYNC)
      const module = await engine
      this.abort.signal.throwIfAborted()
      const fresh = !this.vm
      this.vm ??= module.newContext()
      const vm = this.vm
      vm.runtime.setMemoryLimit(64 * 1024 * 1024)
      vm.runtime.setMaxStackSize(512 * 1024)
      vm.runtime.setInterruptHandler(() => {
        if (Date.now() > Math.min(this.deadline, this.expiresAt)) {
          this.cancel()
        }
        return this.cancelled
      })
      this.deadline = Date.now() + 1500
      if (fresh) {
        vm.newFunction('__write', (value) => {
          this.write(vm.getString(value))
        }).consume((fn) => vm.setProp(vm.global, '__write', fn))
        vm.newFunction('__action', (value) => {
          const input = vm.dump(value) as Input
          const pending = vm.newPromise()
          const job = this.perform(input).then((result) => {
            using value = vm.newString(JSON.stringify(result))
            pending.resolve(value)
          }, (error) => {
            using value = vm.newError(error instanceof Error ? error.message : String(error))
            pending.reject(value)
          }).finally(async () => {
            pending.dispose()
            await new Promise((resolve) => setTimeout(resolve, 0))
            this.deadline = Date.now() + 1500
            this.jobs.delete(job)
          })
          this.jobs.add(job)
          return pending.handle
        }).consume((fn) => vm.setProp(vm.global, '__hostAction', fn))
        vm.unwrapResult(vm.evalCode('const __action = async input => JSON.parse(await __hostAction(input))')).dispose()
        vm.unwrapResult(vm.evalCode(this.options.api)).dispose()
      }
      if (code.trim()) {
        using handle = vm.unwrapResult(vm.evalCode(code, `${this.options.name}.js`, JS_EVAL_FLAG_ASYNC))
        while (true) {
          this.executeJobs(vm)
          const state = vm.getPromiseState(handle)
          if (state.type !== 'pending') {
            vm.unwrapResult(state).dispose()
            if (!this.jobs.size) {
              break
            }
          }
          await new Promise<void>((resolve, reject) => {
            this.rejectRun = reject
            Promise.race(this.jobs).then(resolve, reject)
          })
        }
      }
      this.output.text = documentation + outputTail(this.output.text || '', OUTPUT_BYTES - encoder.encode(documentation).length)
      this.documented = true
      return this.output
    } catch (error) {
      const failure = this.cancelled ? this.abort.signal.reason : error
      if (this.jobs.size) {
        this.cancel()
      }
      throw failure
    } finally {
      while (this.jobs.size) {
        await Promise.allSettled(this.jobs)
      }
      clearTimeout(timeout)
      this.rejectRun = undefined
      this.running = false
      if (this.cancelled) {
        this.dispose()
      }
    }
  }

  cancel(): void {
    this.cancelled = true
    this.abort.abort(new Error(`${this.options.name} script was cancelled or exceeded its time limit`))
    this.rejectRun?.(new Error(`${this.options.name} script was cancelled or exceeded its time limit`))
    if (!this.running) {
      this.dispose()
    }
  }

  private dispose(): void {
    this.vm?.dispose()
    this.vm = undefined
    this.documented = false
    this.output = { status: 'ok' }
  }

  private executeJobs(vm: QuickJSContext): void {
    while (vm.runtime.hasPendingJob()) {
      if (this.cancelled || Date.now() > Math.min(this.deadline, this.expiresAt)) {
        this.cancel()
        throw new Error(`${this.options.name} script was cancelled or exceeded its time limit`)
      }
      vm.runtime.executePendingJobs(100).unwrap()
    }
  }

  private write(text: string): void {
    this.output.text = outputTail((this.output.text || '') + '\n' + text, OUTPUT_BYTES)
  }

  private async perform(input: Input): Promise<unknown> {
    const signal = this.abort.signal
    signal.throwIfAborted()
    let abort!: () => void
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
    })
    let result: ScriptResult
    try {
      result = await Promise.race([this.action(input, signal), cancelled])
      signal.throwIfAborted()
    } finally {
      signal.removeEventListener('abort', abort)
    }
    if (this.options.observe(input)) {
      this.write(result.text || JSON.stringify(result.data))
    }
    if (result.image_base64) {
      this.output.image_base64 = result.image_base64
      this.output.image_mime_type = result.image_mime_type
    }
    return result.data ?? { status: result.status, text: result.text }
  }
}

function outputTail(text: string, limit: number): string {
  const bytes = encoder.encode(text)
  if (bytes.length <= limit) {
    return text
  }
  const marker = '[Earlier output truncated]\n'
  let start = bytes.length - limit + marker.length
  while ((bytes[start] & 0xc0) === 0x80) {
    start += 1
  }
  return marker + decoder.decode(bytes.subarray(start))
}
