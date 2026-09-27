import { app, BrowserWindow } from 'electron'
import console from 'node:console'
import { Buffer } from 'node:buffer'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import process from 'node:process'
import { setTimeout } from 'node:timers/promises'
import assert from 'node:assert/strict'

app.whenReady().then(async () => {
  console.log('Electron ready')
  app.dock?.hide()
  const sdk = await import(process.env.JAZ_COMPUTER_DRIVER_MODULE || '@trycua/cua-driver')
  console.log('Native SDK loaded')
  const driver = sdk.CuaDriver.create(undefined)
  console.log('Native runtime created')
  const call = async (name, args = {}) => {
    const result = await driver.callTool(name, JSON.stringify(args))
    assert.equal(result.isError, false, result.text)
    return { ...result, data: result.structuredJson ? JSON.parse(result.structuredJson) : {} }
  }
  let exitCode = 1
  let canvasWindow
  let launchedPid
  try {
    const permissions = process.platform === 'darwin' ? sdk.currentMacOsPermissionStatus() : undefined
    const apps = await call('list_apps')
    const windows = await call('list_windows')
    console.log(JSON.stringify({
      electron: process.versions.electron,
      permissions,
      apps: apps.data.apps?.length,
      windows: windows.data.windows?.length,
    }))
    if (process.platform !== 'darwin') {
      throw new Error('This live Calculator acceptance test currently targets macOS')
    }
    if (!permissions.accessibility || !permissions.screenRecording) {
      throw new Error('Native AX, capture and input are blocked by macOS permissions for this test host. No permission prompt was requested.')
    }
    const foreground = apps.data.apps.find((item) => item.active)?.pid
    const cursor = (await call('get_cursor_position')).data
    await call('launch_app', { bundle_id: 'com.apple.calculator', creates_new_application_instance: true })
    let target
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const after = await call('list_apps')
      const calculator = after.data.apps.find((item) => item.bundle_id === 'com.apple.calculator' && !apps.data.apps.some((old) => old.running && old.pid === item.pid))
      if (calculator) {
        launchedPid = calculator.pid
        const list = await call('list_windows', { pid: calculator.pid })
        target = list.data.windows?.find((window) => window.pid === calculator.pid)
        if (target) {
          break
        }
      }
      await setTimeout(100)
    }
    assert.ok(target, 'A separate Calculator window must be available')
    const identity = { pid: target.pid, window_id: target.window_id }
    const before = await call('get_window_state', identity)
    assert.ok(before.data.elements?.length, 'Native AX tree is empty')
    assert.ok(before.images.length, 'Native screenshot is missing')
    for (const key of ['escape', '6', '*', '7', 'return']) {
      await call('press_key', { ...identity, key, delivery_mode: 'background' })
    }
    const after = await call('get_window_state', identity)
    assert.ok(after.data.elements.some((element) => [element.value, element.label].some((value) => String(value).trim() === '42')), 'Calculator did not show 42')
    const image = after.images.at(-1)
    assert.ok(image)
    const screenshot = join(tmpdir(), 'jaz-computer-calculator.png')
    await writeFile(screenshot, Buffer.from(image.dataBase64, 'base64'))
    assert.equal((await call('list_apps')).data.apps.find((item) => item.active)?.pid, foreground, 'Foreground app changed')
    assert.deepEqual((await call('get_cursor_position')).data, cursor, 'Hardware pointer changed')
    canvasWindow = new BrowserWindow({ show: false, width: 480, height: 360, webPreferences: { sandbox: true, contextIsolation: true } })
    await canvasWindow.loadURL('data:text/html,' + encodeURIComponent(`<style>body{margin:0}canvas{width:100vw;height:100vh}</style><canvas width="480" height="360"></canvas><script>
const canvas = document.querySelector('canvas')
const pen = canvas.getContext('2d')
window.strokes = {down:0,moves:0,up:0}
canvas.onpointerdown = event => {
  window.strokes.down += 1
  canvas.setPointerCapture(event.pointerId)
  pen.beginPath()
  pen.moveTo(event.offsetX,event.offsetY)
}
canvas.onpointermove = event => {
  if(event.buttons) {
    window.strokes.moves += 1
    pen.lineTo(event.offsetX,event.offsetY)
    pen.stroke()
  }
}
canvas.onpointerup = () => {
  window.strokes.up += 1
}
</script>`))
    canvasWindow.showInactive()
    const canvasTarget = (await call('list_windows', { pid: process.pid })).data.windows.find((window) => window.pid === process.pid)
    assert.ok(canvasTarget, 'Canvas window missing')
    const canvasIdentity = { pid: process.pid, window_id: canvasTarget.window_id }
    const canvasState = await call('get_window_state', { ...canvasIdentity, include_accessibility_tree: false })
    const width = canvasState.data.screenshot_width
    const height = canvasState.data.screenshot_height
    assert.ok(width > 0 && height > 0)
    await call('drag', { ...canvasIdentity, from_x: width * 0.2, from_y: height * 0.5, to_x: width * 0.8, to_y: height * 0.5, delivery_mode: 'background', duration_ms: 500 })
    const strokes = await canvasWindow.webContents.executeJavaScript('window.strokes')
    assert.ok(strokes.down === 1 && strokes.moves > 1 && strokes.up === 1, JSON.stringify(strokes))
    console.log(JSON.stringify({ result: 'passed', calculation: 42, strokes, screenshot }))
    exitCode = 0
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
  } finally {
    canvasWindow?.destroy()
    try {
      if (launchedPid) {
        await call('kill_app', { pid: launchedPid })
      }
    } finally {
      try {
        await driver.shutdown()
      } finally {
        driver.uniffiDestroy()
      }
    }
    app.exit(exitCode)
  }
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
