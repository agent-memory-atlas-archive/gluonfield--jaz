import occtScript from 'occt-import-js/dist/occt-import-js.js?url'
import occtWasm from 'occt-import-js/dist/occt-import-js.wasm?url'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { ViewerFrame } from './ViewerFrame'

type OcctMesh = {
  attributes: { position: { array: number[] }; normal?: { array: number[] } }
  index: { array: number[] }
  color?: [number, number, number]
}
type OcctResult = { success: boolean; meshes: OcctMesh[] }
type OcctReader = (bytes: Uint8Array, params: null) => OcctResult
type Occt = { ReadStepFile: OcctReader; ReadIgesFile: OcctReader; ReadBrepFile: OcctReader }
type Model = { object: THREE.Object3D; bodies: number; zUp: boolean; units: string }
type View = 'iso' | 'top' | 'front' | 'right'

declare global {
  interface Window {
    occtimportjs?: (options: { locateFile: (file: string) => string }) => Promise<Occt>
  }
}

const directions: Record<View, [number, number, number]> = {
  iso: [1, 0.85, 1],
  top: [0, 1, 0.0001],
  front: [0, 0, 1],
  right: [1, 0, 0],
}

let occt: Promise<Occt> | null = null

// occt-import-js ships as a classic script that defines a global factory.
function loadOcct(): Promise<Occt> {
  occt ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = occtScript
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('could not load the CAD reader'))
    document.head.appendChild(script)
  }).then(() => window.occtimportjs!({ locateFile: () => occtWasm }))
  return occt
}

function solid(geometry: THREE.BufferGeometry, color?: THREE.Color): THREE.Group {
  const group = new THREE.Group()
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals()
  group.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: color ?? new THREE.Color(0xb8bcc4), metalness: 0.35, roughness: 0.45, side: THREE.DoubleSide })))
  if (geometry.getAttribute('position').count < 600000) {
    group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 28), new THREE.LineBasicMaterial({ color: 0x1f1e1d, transparent: true, opacity: 0.28 })))
  }
  return group
}

async function loadModel(src: string, kind: string): Promise<Model> {
  if (['step', 'stp', 'iges', 'igs', 'brep', 'brp'].includes(kind)) {
    const reader = await loadOcct()
    const bytes = new Uint8Array(await (await fetch(src)).arrayBuffer())
    const read = kind.startsWith('br') ? reader.ReadBrepFile : kind.startsWith('ig') ? reader.ReadIgesFile : reader.ReadStepFile
    const result = read(bytes, null)
    if (!result.success || !result.meshes.length) throw new Error('no solid geometry in the file')
    const group = new THREE.Group()
    for (const mesh of result.meshes) {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.attributes.position.array, 3))
      if (mesh.attributes.normal) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.attributes.normal.array, 3))
      geometry.setIndex(mesh.index.array)
      // Readers report black for uncoloured faces; treat it as no colour.
      const tinted = mesh.color && mesh.color.some((channel) => channel > 0.02)
      group.add(solid(geometry, tinted ? new THREE.Color().setRGB(...mesh.color!, THREE.LinearSRGBColorSpace) : undefined))
    }
    return { object: group, bodies: result.meshes.length, zUp: true, units: 'mm' }
  }
  if (kind === 'stl' || kind === 'ply') {
    const buffer = await (await fetch(src)).arrayBuffer()
    const geometry = kind === 'stl' ? new STLLoader().parse(buffer) : new PLYLoader().parse(buffer)
    // Exported normals are often zero; recompute rather than render black.
    geometry.deleteAttribute('normal')
    return { object: solid(geometry), bodies: 1, zUp: true, units: 'mm' }
  }
  const object = kind === 'obj'
    ? new OBJLoader().parse(await (await fetch(src)).text())
    : kind === '3mf' ? await new ThreeMFLoader().loadAsync(src) : (await new GLTFLoader().loadAsync(src)).scene
  const meshes: THREE.Mesh[] = []
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) meshes.push(child)
  })
  if (kind === 'obj') {
    for (const mesh of meshes) {
      mesh.parent!.add(solid(mesh.geometry))
      mesh.removeFromParent()
    }
  }
  return { object, bodies: meshes.length, zUp: kind === '3mf', units: kind === '3mf' ? 'mm' : kind === 'obj' ? '' : 'm' }
}

export default function CadViewer({ id, src, kind, focused }: { id: string; src: string; kind: string; focused: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const controls = useRef<{ setView: (view: View) => void; enable: (on: boolean) => void } | null>(null)
  const [status, setStatus] = useState('Reading…')
  const [view, setView] = useState<View>('iso')
  useEffect(() => {
    const element = host.current!
    let disposed = false
    let cleanup = () => {}
    const run = async () => {
      const model = await loadModel(src, kind)
      if (disposed) return
      const raw = new THREE.Box3().setFromObject(model.object).getSize(new THREE.Vector3())
      const holder = new THREE.Group()
      holder.add(model.object)
      if (model.zUp) model.object.rotation.x = -Math.PI / 2
      holder.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(holder)
      model.object.position.sub(box.getCenter(new THREE.Vector3()))
      const radius = box.getSize(new THREE.Vector3()).length() / 2
      const scene = new THREE.Scene()
      scene.add(holder)
      scene.add(new THREE.HemisphereLight(0xffffff, 0x6b6a65, 2.4))
      const key = new THREE.DirectionalLight(0xffffff, 2.4)
      key.position.set(1, 1.6, 1.2)
      scene.add(key)
      const fill = new THREE.DirectionalLight(0xffffff, 0.8)
      fill.position.set(-1.2, -0.4, -0.8)
      scene.add(fill)
      const camera = new THREE.PerspectiveCamera(30, 1, radius / 100, radius * 40)
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
      renderer.setPixelRatio(Math.min(3, devicePixelRatio * 1.5))
      const orbit = new OrbitControls(camera, renderer.domElement)
      orbit.enabled = false
      const draw = () => renderer.render(scene, camera)
      const place = (name: View) => {
        const distance = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.08
        camera.position.set(...directions[name]).normalize().multiplyScalar(distance)
        orbit.target.set(0, 0, 0)
        orbit.update()
        draw()
      }
      const resize = () => {
        renderer.setSize(element.clientWidth, element.clientHeight)
        camera.aspect = element.clientWidth / Math.max(1, element.clientHeight)
        camera.updateProjectionMatrix()
        draw()
      }
      orbit.addEventListener('change', draw)
      const observer = new ResizeObserver(resize)
      observer.observe(element)
      element.appendChild(renderer.domElement)
      resize()
      place('iso')
      controls.current = { setView: place, enable: (on) => (orbit.enabled = on) }
      const size = [raw.x, model.zUp ? raw.y : raw.z, model.zUp ? raw.z : raw.y].map((n) => n.toFixed(1)).join(' × ')
      setStatus(`${kind.toUpperCase()} · ${model.bodies} ${model.bodies === 1 ? 'body' : 'bodies'} · ${size}${model.units ? ` ${model.units}` : ''}`)
      cleanup = () => {
        observer.disconnect()
        orbit.dispose()
        renderer.dispose()
        renderer.domElement.remove()
      }
    }
    run().catch((error: Error) => setStatus(`Could not open ${kind.toUpperCase()}: ${error.message}`))
    return () => {
      disposed = true
      controls.current = null
      cleanup()
    }
  }, [src, kind])
  useEffect(() => {
    controls.current?.enable(focused)
  }, [focused, status])
  const choose = (name: View) => {
    setView(name)
    controls.current?.setView(name)
  }
  return (
    <ViewerFrame
      id={id}
      status={status}
      focusable
      controls={(['iso', 'top', 'front', 'right'] as const).map((name) => (
        <button key={name} type="button" className={view === name ? 'on' : ''} onClick={() => choose(name)}>
          {name[0].toUpperCase() + name.slice(1)}
        </button>
      ))}
    >
      <div ref={host} className="canvas-fill" />
    </ViewerFrame>
  )
}
