import { ScriptRepl } from '@/lib/scriptRepl'
import { BROWSER_API, BROWSER_DOCUMENTATION, type BrowserAction, type BrowserActionResult } from '@/lib/browserApi'

export class BrowserRepl extends ScriptRepl<BrowserAction> {
  constructor(action: (input: BrowserAction, signal: AbortSignal) => Promise<BrowserActionResult>, timeoutMS = 60000) {
    super(action, {
      name: 'browser',
      api: BROWSER_API,
      documentation: BROWSER_DOCUMENTATION,
      observe: (input) => ['state', 'ax_state', 'find'].includes(input.action),
    }, timeoutMS)
  }
}
