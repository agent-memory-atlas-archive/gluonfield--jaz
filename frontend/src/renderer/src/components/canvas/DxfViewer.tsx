import { DxfViewer as Viewer } from 'dxf-viewer'
import font from 'katex/dist/fonts/KaTeX_SansSerif-Regular.ttf?url'
import { useEffect, useRef, useState } from 'react'
import { Color } from 'three'
import { ViewerFrame } from './ViewerFrame'

export default function DxfViewer({ id, src }: { id: string; src: string }) {
  const host = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState('Reading DXF…')
  useEffect(() => {
    const viewer = new Viewer(host.current!, { autoResize: true, clearColor: new Color('#ffffff'), colorCorrection: true, antialias: true })
    viewer
      .Load({ url: src, fonts: [font] })
      .then(() => setStatus('DXF · 2D drawing'))
      .catch((error: Error) => setStatus(`Could not open DXF: ${error.message}`))
    return () => viewer.Destroy()
  }, [src])
  // The viewer makes its container position:relative, so it gets an inner
  // host instead of the absolutely positioned frame body.
  return (
    <ViewerFrame id={id} status={status} focusable paper>
      <div className="canvas-fill">
        <div ref={host} className="size-full" />
      </div>
    </ViewerFrame>
  )
}
