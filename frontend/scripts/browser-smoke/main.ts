import { app, BrowserWindow, ipcMain, session, webContents } from 'electron'
import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http'
import { createServer as createSecureServer } from 'node:https'
import { X509Certificate } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { installBrowserControl } from '@main/browserControl'
import { attachWindowOpenHandler } from '@main/browserPopups'
import { attachPreviewWebviews, configurePreviewSession } from '@main/previewSession'
import { installBrowserPasswords } from '@main/browserPasswords'
import { BrowserPasswordStore } from '@main/browserPasswordStore'
import { PREVIEW_PARTITION } from '@shared/preview'
import { assertUntrustedProfileCaller, prepareProfileFixture } from './profiles'
import { accessibilityFixture, accessibilityFrame } from './accessibility'
import { exerciseBrowserPopups } from './popups'

app.setName('Jaz')
app.setPath('userData', join(process.env.JAZ_BROWSER_SMOKE_DIR!, `profile-${process.pid}`))
const timeout = Number(process.env.JAZ_BROWSER_SMOKE_TIMEOUT_MS || 30000)
const openedURLs: string[] = []
const popupURLs: string[] = []
app.on('web-contents-created', (_event, contents) => attachWindowOpenHandler(contents, async (url) => {
  openedURLs.push(url)
}))
installBrowserControl()
installBrowserPasswords()
process.on('unhandledRejection', (error) => {
  console.error(error)
  app.exit(1)
})
ipcMain.handle('smoke:backend', () => process.env.JAZ_BROWSER_SMOKE_BACKEND)
ipcMain.handle('smoke:browser-exists', (_event, id: number) => Boolean(webContents.fromId(id)))
ipcMain.handle('smoke:opened-urls', () => openedURLs)
ipcMain.handle('smoke:popup-urls', () => popupURLs)

let pendingProxy: { response: ServerResponse; url: string } | undefined
let proxyWaiter: ServerResponse | undefined
let firstNavigation: IncomingHttpHeaders | undefined
let passwordOrigin = ''
const server = createServer(async (request, response) => {
  if (request.url === '/password-origin') {
    response.end(passwordOrigin)
    return
  }
  if (request.url?.startsWith('/accessibility')) {
    response.setHeader('Content-Type', 'text/html')
    response.end(request.url.startsWith('/accessibility-frame')
      ? accessibilityFrame(new URL(request.url, `http://${request.headers.host}`))
      : accessibilityFixture(`http://${request.headers.host}`))
    return
  }
  if (request.url === '/target' && !firstNavigation) {
    firstNavigation = request.headers
  }
  if (request.url === '/browser-identity') {
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ firstNavigation, request: request.headers, chromeVersion: process.versions.chrome, shellUserAgent: session.defaultSession.getUserAgent() }))
    return
  }
  if (request.url === '/profile-session') {
    response.end(request.headers.cookie?.includes('jaz_import_fixture=signed-in-fixture') ? 'Imported session is active' : 'Not signed in')
    return
  }
  if (request.url === '/wait-for-proxy') {
    if (pendingProxy) {
      response.end()
    } else {
      proxyWaiter = response
    }
    return
  }
  if (request.url === '/release-proxy') {
    pendingProxy!.response.end(JSON.stringify({ url: pendingProxy!.url }))
    pendingProxy = undefined
    response.end()
    return
  }
  if (request.url === '/v1/preview/proxies') {
    let body = ''
    for await (const chunk of request) {
      body += chunk
    }
    response.setHeader('Content-Type', 'application/json')
    const url = JSON.parse(body).url as string
    if (new URL(url).pathname === '/cancelled-navigation') {
      pendingProxy = { response, url }
      proxyWaiter?.end()
      proxyWaiter = undefined
      return
    }
    const source = new URL(url)
    if (source.searchParams.get('preview') === 'direct') {
      source.hostname = 'jaz-preview-fixture.localhost'
    }
    response.end(JSON.stringify({ url: source.href }))
    return
  }
  const pathname = new URL(request.url!, 'http://localhost').pathname
  const name = pathname === '/target' ? 'target.html' : /\.(m?js|wasm|css|woff2?)$/.test(pathname) ? pathname.slice(1) : 'index.html'
  response.setHeader('Content-Type', /\.m?js$/.test(name) ? 'text/javascript' : name.endsWith('.wasm') ? 'application/wasm' : name.endsWith('.css') ? 'text/css' : name.endsWith('.woff2') ? 'font/woff2' : 'text/html')
  response.end(await readFile(join(process.env.JAZ_BROWSER_SMOKE_DIR!, name)))
})
server.listen(0, '127.0.0.1', async () => {
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Missing test server address')
  }
  await app.whenReady()
  configurePreviewSession()
  process.env.ELECTRON_RENDERER_URL = `http://127.0.0.1:${address.port}`
  const cert = await readFile(join(process.env.JAZ_BROWSER_SMOKE_DIR!, 'cert.pem'))
  const fingerprint = new X509Certificate(cert).fingerprint256
  session.fromPartition(PREVIEW_PARTITION).setCertificateVerifyProc(({ hostname, certificate }, callback) => {
    callback(hostname === 'localhost' && new X509Certificate(certificate.data).fingerprint256 === fingerprint ? 0 : -3)
  })
  const secureServer = createSecureServer({ cert, key: await readFile(join(process.env.JAZ_BROWSER_SMOKE_DIR!, 'key.pem')) }, async (request, response) => {
    response.setHeader('Content-Type', 'text/html')
    if (request.method === 'POST') {
      request.resume()
      response.writeHead(303, { Location: '/welcome' })
      response.end()
      return
    }
    response.end(request.url === '/welcome' ? '<h1>Signed in</h1>' : `<!doctype html><html><head><style>
body{font:16px system-ui;padding:60px;background:#faf9f6;color:#242424}form{display:grid;gap:16px;max-width:340px}input,button{font:inherit;padding:12px;border:1px solid #ccc;border-radius:8px}h1{font-weight:550}
</style></head><body><h1>Account sign in</h1><form method="post"><label>Email<input name="username" autocomplete="username" type="email"></label><label>Password<input name="password" autocomplete="current-password" type="password"></label><button>Sign in</button></form></body></html>`)
  })
  await new Promise<void>((resolve) => secureServer.listen(0, '127.0.0.1', resolve))
  const secureAddress = secureServer.address()
  if (!secureAddress || typeof secureAddress === 'string') {
    throw new Error('Missing HTTPS fixture address')
  }
  passwordOrigin = `https://localhost:${secureAddress.port}`
  await prepareProfileFixture(process.env.JAZ_BROWSER_SMOKE_DIR!, passwordOrigin)
  const window = new BrowserWindow({
    width: 1050,
    height: 850,
    webPreferences: {
      webviewTag: true,
      backgroundThrottling: false,
      contextIsolation: true,
      sandbox: true,
      preload: join(process.env.JAZ_BROWSER_SMOKE_DIR!, 'preload.js'),
    },
  })
  attachPreviewWebviews(window.webContents, join(process.env.JAZ_BROWSER_SMOKE_DIR!, 'index.js'))
  ipcMain.handle('smoke:password-store', async () => {
    const file = join(app.getPath('userData'), 'browser-passwords.enc')
    const encrypted = await readFile(file)
    const records = new BrowserPasswordStore(file).read()
    return { count: records.length, plaintext: records.some((record) => encrypted.includes(Buffer.from(record.password)) || encrypted.includes(Buffer.from(record.username))) }
  })
  let pointerPressed = false
  ipcMain.handle('smoke:pointer', async (_event, type: 'mouseDown' | 'mouseMove' | 'mouseUp', x: number, y: number) => {
    if (!window.isFocused()) {
      window.focus()
      window.webContents.focus()
    }
    if (type === 'mouseDown') {
      pointerPressed = true
    }
    if (type === 'mouseUp') {
      pointerPressed = false
    }
    window.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1, modifiers: pointerPressed ? ['leftButtonDown'] : [] })
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  window.webContents.on('console-message', ({ level, message }) => {
    if (level === 'warning' || level === 'error') {
      console.error(message)
    }
  })
  ipcMain.handle('smoke:key', async (_event, keyCode: string, modifiers: string[] = []) => {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  await assertUntrustedProfileCaller(process.env.JAZ_BROWSER_SMOKE_DIR!)
  await exerciseBrowserPopups(join(process.env.JAZ_BROWSER_SMOKE_DIR!, 'index.js'), openedURLs)
  app.on('web-contents-created', (_event, contents) => {
    contents.on('did-create-window', (popup, { url }) => {
      popupURLs.push(url)
      popup.destroy()
    })
  })
  ipcMain.handle('smoke:capture', async (_event, name = 'browser') => {
    if (!/^[a-z-]+$/.test(name)) {
      throw new Error('Invalid screenshot name')
    }
    const screenshot = await window.webContents.capturePage()
    await writeFile(join(process.env.JAZ_BROWSER_SMOKE_DIR!, name + '.png'), screenshot.toPNG())
  })
  ipcMain.handle('smoke:resize', (_event, width: number, height: number) => {
    window.setContentSize(width, height)
  })
  ipcMain.on('smoke:result', (_event, result) => {
    console.log(JSON.stringify(result))
    server.close()
    secureServer.close()
    app.exit(result.ok ? 0 : 1)
  })
  await window.loadURL(`http://127.0.0.1:${address.port}?timeout=${timeout}&suite=${encodeURIComponent(process.env.JAZ_BROWSER_SMOKE_SUITE || '')}`)
  window.webContents.debugger.attach('1.3')
  await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
})
setTimeout(() => app.exit(2), timeout + 10000)
