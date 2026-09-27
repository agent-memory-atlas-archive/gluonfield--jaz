import { app, BrowserWindow } from 'electron'
import process from 'node:process'

app.whenReady().then(async () => {
  app.dock?.hide()
  const window = new BrowserWindow({ show: false, width: 480, height: 360, webPreferences: { sandbox: true, contextIsolation: true } })
  await window.loadURL('data:text/html,' + encodeURIComponent(`<style>body{margin:0}canvas{width:100vw;height:100vh}</style><canvas width="480" height="360"></canvas><script>
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
  window.showInactive()
  await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  process.on('message', async () => {
    process.send(await window.webContents.executeJavaScript('window.strokes'))
  })
  process.send('ready')
}).catch(() => app.exit(1))

process.on('disconnect', () => app.quit())
