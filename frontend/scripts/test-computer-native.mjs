import { app } from 'electron'
import console from 'node:console'
import { Buffer } from 'node:buffer'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import process from 'node:process'
import { setTimeout } from 'node:timers/promises'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath, URL } from 'node:url'

const { AbortSignal } = globalThis

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
  let canvasHost
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
    let before
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const after = await call('list_apps')
      const calculator = after.data.apps.find((item) => item.bundle_id === 'com.apple.calculator' && !apps.data.apps.some((old) => old.running && old.pid === item.pid))
      if (calculator) {
        launchedPid = calculator.pid
        const list = await call('list_windows', { pid: calculator.pid })
        target = list.data.windows?.find((window) => window.pid === calculator.pid)
        if (target) {
          before = await call('get_window_state', { pid: target.pid, window_id: target.window_id })
          if (before.data.elements?.length) {
            break
          }
        }
      }
      await setTimeout(100)
    }
    assert.ok(target, 'A separate Calculator window must be available')
    const identity = { pid: target.pid, window_id: target.window_id }
    assert.ok(before.data.elements?.length, 'Native AX tree is empty')
    assert.ok(before.images.length, 'Native screenshot is missing')
    for (const input of [
      { key: 'escape' },
      { key: '6' },
      { key: '8', modifiers: ['shift'] },
      { key: '7' },
      { key: 'return' },
    ]) {
      await call('press_key', { ...identity, ...input, delivery_mode: 'background' })
    }
    const after = await call('get_window_state', identity)
    const image = after.images.at(-1)
    assert.ok(image)
    const screenshot = join(tmpdir(), 'jaz-computer-calculator.png')
    await writeFile(screenshot, Buffer.from(image.dataBase64, 'base64'))
    await writeFile(join(tmpdir(), 'jaz-computer-calculator.json'), JSON.stringify(after.data, null, 2))
    console.log('Calculator evidence:', screenshot)
    const readback = spawnSync('swift', ['-e', `
import Foundation
import Vision
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
let handler = VNImageRequestHandler(url: URL(fileURLWithPath: CommandLine.arguments[1]))
try handler.perform([request])
let found = request.results?.contains { observation in
  observation.boundingBox.minY > 0.6 && observation.topCandidates(1).first?.string == CommandLine.arguments[2]
} ?? false
if !found {
  exit(1)
}
`, screenshot, '42'], { encoding: 'utf8', timeout: 30000 })
    assert.equal(readback.status, 0, readback.stderr || 'Calculator screenshot did not show 42')
    const backgroundForeground = (await call('list_apps')).data.apps.find((item) => item.active)?.pid
    const backgroundCursor = (await call('get_cursor_position')).data
    canvasHost = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/computer-canvas.mjs', import.meta.url))], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] })
    const [ready] = await once(canvasHost, 'message', { signal: AbortSignal.timeout(15000) })
    assert.equal(ready, 'ready')
    const canvasTarget = (await call('list_windows', { pid: canvasHost.pid })).data.windows.find((window) => window.pid === canvasHost.pid)
    assert.ok(canvasTarget, 'Canvas window missing')
    console.log(JSON.stringify({ canvas: canvasTarget }))
    const canvasIdentity = { pid: canvasHost.pid, window_id: canvasTarget.window_id }
    let canvasState
    let captureError
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        canvasState = await call('get_window_state', { ...canvasIdentity, include_accessibility_tree: false })
        break
      } catch (error) {
        captureError = error
        await setTimeout(100)
      }
    }
    assert.ok(canvasState, captureError?.message)
    const width = canvasState.data.screenshot_width
    const height = canvasState.data.screenshot_height
    assert.ok(width > 0 && height > 0)
    await call('drag', { ...canvasIdentity, from_x: width * 0.2, from_y: height * 0.5, to_x: width * 0.8, to_y: height * 0.5, delivery_mode: 'foreground', duration_ms: 500 })
    const observed = once(canvasHost, 'message', { signal: AbortSignal.timeout(5000) })
    canvasHost.send('inspect')
    const [strokes] = await observed
    console.log(JSON.stringify({ calculation: 42, strokes }))
    assert.ok(strokes.down === 1 && strokes.moves > 1 && strokes.up === 1, JSON.stringify(strokes))
    assert.equal(backgroundForeground, foreground, 'Foreground app changed during background input')
    assert.deepEqual(backgroundCursor, cursor, 'Hardware pointer moved during background input')
    assert.equal((await call('list_apps')).data.apps.find((item) => item.active)?.pid, foreground, 'Foreground app changed')
    console.log(JSON.stringify({ result: 'passed', calculation: 42, strokes, screenshot }))
    exitCode = 0
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
  } finally {
    if (canvasHost && canvasHost.exitCode === null && canvasHost.signalCode === null) {
      const exited = once(canvasHost, 'exit')
      canvasHost.kill()
      await exited
    }
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
