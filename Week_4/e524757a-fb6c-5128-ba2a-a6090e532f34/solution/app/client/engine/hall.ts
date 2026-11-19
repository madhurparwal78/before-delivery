/** The gallery hall: a bright room of 6 by 14 tiles with the hung photos on its long walls and a visitor walking through it. */
import {
  BoxGeometry, CanvasTexture, Color, DirectionalLight, Float32BufferAttribute, Group, HemisphereLight, MathUtils, Mesh, MeshBasicMaterial,
  MeshLambertMaterial, PCFShadowMap, PerspectiveCamera, PlaneGeometry, Scene, SRGBColorSpace, TextureLoader, Vector3, type WebGLRenderer,
} from 'three'
import { type Heading, HEADING_ANGLE, type Tile } from '../../shared/island'
import type { Graphics } from '../../shared/types'
import { reducedMotion } from '../lib/dom'
import type { Gait, HallFrameImage, HallScene } from './api'
import { angleDelta, approach, createRenderer } from './common'
import { buildExplorer, poseExplorer } from './explorer'
import { paint, part, BOX } from './parts'

const WIDTH = 6
const DEPTH = 14
const WALL_HEIGHT = 3.2
const FRAME_Y = 1.75
const SLOT_START = 1.9
const SLOT_GAP = 2.2

const radians = (heading: Heading): number => (HEADING_ANGLE[heading] * Math.PI) / 180

function plaque(text: string): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 384
  canvas.height = 80
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
  ctx.fillStyle = '#f4f1e8'
  ctx.fillRect(0, 0, 384, 80)
  ctx.fillStyle = '#0b0b0c'
  ctx.font = '600 30px "Albert Sans", system-ui, sans-serif'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  ctx.fillText(text.length > 26 ? `${text.slice(0, 25)}…` : text, 192, 42)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

export class HallView implements HallScene {
  readonly canvas: HTMLCanvasElement
  private readonly renderer: WebGLRenderer
  private readonly scene = new Scene()
  private readonly camera = new PerspectiveCamera(55, 1, 0.1, 100)
  private readonly hemi = new HemisphereLight(0xfff8ee, 0xb8a48a, 2.1)
  private readonly sun = new DirectionalLight(0xfff0d8, 1.8)
  private readonly visitor = buildExplorer(0x3f6f78)
  private readonly frames = new Group()
  private readonly loader = new TextureLoader()
  private readonly disposables: { dispose(): void }[] = []
  private width = 1
  private height = 1
  private dirty = true
  private lastNow: number | null = null
  private vx = 2.5
  private vz = 13.5
  private tx = 2.5
  private tz = 13.5
  private angle = 0
  private targetAngle = 0
  private gait: Gait = 'idle'
  private phase = 0
  private lift = 0
  private snapped = true
  private cam = new Vector3(2.5, 2.4, 17)
  private camTarget = new Vector3()

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = createRenderer(canvas, true)
    this.renderer.setClearColor(0xf1efe9, 1)
    this.sun.position.set(2, 9, 6)
    this.sun.target.position.set(3, 0, 7)
    this.sun.shadow.camera.left = -9
    this.sun.shadow.camera.right = 9
    this.sun.shadow.camera.top = 9
    this.sun.shadow.camera.bottom = -9
    this.sun.shadow.mapSize.set(1024, 1024)
    this.sun.shadow.radius = 3
    this.sun.shadow.bias = -0.0006
    this.scene.add(this.hemi, this.sun, this.sun.target, this.frames, this.visitor.group)
    this.buildRoom()
    this.resize(canvas.clientWidth || 640, canvas.clientHeight || 400)
  }

  private buildRoom(): void {
    const floorGeo = new PlaneGeometry(WIDTH, DEPTH, WIDTH, DEPTH)
    floorGeo.rotateX(-Math.PI / 2)
    floorGeo.translate(WIDTH / 2, 0, DEPTH / 2)
    const colours: number[] = []
    const position = floorGeo.getAttribute('position')
    const oak = [new Color(0xb98b5a), new Color(0xc49a68), new Color(0xad7f4f)]
    for (let i = 0; i < position.count; i++) {
      const plank = Math.floor(position.getX(i) * 1.0 + 0.001) % 3
      const c = oak[Math.abs(plank)] as Color
      colours.push(c.r, c.g, c.b)
    }
    floorGeo.setAttribute('color', new Float32BufferAttribute(colours, 3))
    const floor = new Mesh(floorGeo, new MeshLambertMaterial({ vertexColors: true }))
    floor.receiveShadow = true
    this.scene.add(floor)
    this.disposables.push(floorGeo, floor.material as MeshLambertMaterial)

    const wallMaterial = new MeshLambertMaterial({ color: 0xf3f1ec })
    const trimMaterial = new MeshLambertMaterial({ color: 0x3a2f26 })
    const longGeo = new BoxGeometry(0.2, WALL_HEIGHT, DEPTH + 0.4)
    const shortGeo = new BoxGeometry(WIDTH + 0.4, WALL_HEIGHT, 0.2)
    const trimLong = new BoxGeometry(0.06, 0.16, DEPTH)
    const trimShort = new BoxGeometry(WIDTH, 0.16, 0.06)
    const place = (geometry: BoxGeometry, material: MeshLambertMaterial, x: number, y: number, z: number): void => {
      const mesh = new Mesh(geometry, material)
      mesh.position.set(x, y, z)
      mesh.receiveShadow = true
      this.scene.add(mesh)
    }
    place(longGeo, wallMaterial, -0.1, WALL_HEIGHT / 2, DEPTH / 2)
    place(longGeo, wallMaterial, WIDTH + 0.1, WALL_HEIGHT / 2, DEPTH / 2)
    place(shortGeo, wallMaterial, WIDTH / 2, WALL_HEIGHT / 2, -0.1)
    place(shortGeo, wallMaterial, WIDTH / 2, WALL_HEIGHT / 2, DEPTH + 0.1)
    place(trimLong, trimMaterial, 0.03, 0.08, DEPTH / 2)
    place(trimLong, trimMaterial, WIDTH - 0.03, 0.08, DEPTH / 2)
    place(trimShort, trimMaterial, WIDTH / 2, 0.08, 0.03)
    place(trimShort, trimMaterial, WIDTH / 2, 0.08, DEPTH - 0.03)
    this.disposables.push(wallMaterial, trimMaterial, longGeo, shortGeo, trimLong, trimShort)
    // a long bench down the middle to give the room depth
    const bench = part(BOX, paint(0x5b4630), { at: [WIDTH / 2, 0.22, 7], scale: [0.7, 0.44, 4.2] })
    bench.receiveShadow = true
    this.scene.add(bench)
  }

  setFrames(frames: readonly HallFrameImage[]): void {
    for (const child of [...this.frames.children]) {
      this.frames.remove(child)
      child.traverse((object) => {
        if (object instanceof Mesh) {
          object.geometry.dispose()
          const material = object.material as MeshBasicMaterial
          material.map?.dispose()
          material.dispose()
        }
      })
    }
    frames.slice(0, 12).forEach((image, index) => {
      const west = index % 2 === 0
      const z = SLOT_START + Math.floor(index / 2) * SLOT_GAP
      const holder = new Group()
      holder.position.set(west ? 0.04 : WIDTH - 0.04, FRAME_Y, z)
      holder.rotation.y = west ? Math.PI / 2 : -Math.PI / 2
      const border = new Mesh(new BoxGeometry(1.8, 1.2, 0.06), paint(0x14110f, 0, false))
      const picture = new Mesh(new PlaneGeometry(1.6, 1.0), new MeshBasicMaterial({ color: 0xd8d6d0 }))
      picture.position.z = 0.04
      const label = new Mesh(new PlaneGeometry(1.1, 0.23), new MeshBasicMaterial({ map: plaque(image.caption || image.creatureName) }))
      label.position.set(0, -0.82, 0.02)
      holder.add(border, picture, label)
      this.frames.add(holder)
      this.loader.load(image.url, (texture) => {
        texture.colorSpace = SRGBColorSpace
        const material = picture.material as MeshBasicMaterial
        material.color.set(0xffffff)
        material.map = texture
        material.needsUpdate = true
        this.dirty = true
      })
    })
    this.dirty = true
  }

  setVisitor(pose: { tile: Tile; heading: Heading; gait: Gait }): void {
    this.tx = pose.tile[0] + 0.5
    this.tz = pose.tile[1] + 0.5
    this.targetAngle = radians(pose.heading)
    this.gait = pose.gait
    if (this.snapped || reducedMotion()) {
      this.vx = this.tx
      this.vz = this.tz
      this.angle = this.targetAngle
      this.snapped = false
    }
    this.dirty = true
  }

  setPreset(preset: Graphics): void {
    const pr = preset === 'full' ? 1.5 : 1
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pr))
    this.renderer.setSize(this.width, this.height, false)
    this.renderer.shadowMap.enabled = preset === 'full'
    this.renderer.shadowMap.autoUpdate = false
    this.renderer.shadowMap.type = PCFShadowMap
    this.sun.castShadow = preset === 'full'
    this.sun.shadow.map?.dispose()
    this.sun.shadow.map = null
    this.scene.traverse((object) => {
      if (object instanceof Mesh) (object.material as MeshLambertMaterial).needsUpdate = true
    })
    this.dirty = true
  }

  frame(now: number): void {
    const dt = this.lastNow === null ? 0 : MathUtils.clamp((now - this.lastNow) / 1000, 0, 0.1)
    this.lastNow = now
    const reduce = reducedMotion()
    let moving = false
    const dx = this.tx - this.vx
    const dz = this.tz - this.vz
    const turn = angleDelta(this.angle, this.targetAngle)
    if (Math.abs(dx) > 0.002 || Math.abs(dz) > 0.002 || Math.abs(turn) > 0.002) {
      const k = reduce ? 1 : approach(dt, this.gait === 'run' ? 0.05 : 0.09)
      this.vx += dx * k
      this.vz += dz * k
      this.angle += turn * (reduce ? 1 : approach(dt, 0.06))
      moving = true
    }
    const liftTarget = this.gait === 'jump' ? 0.5 : 0
    if (Math.abs(liftTarget - this.lift) > 0.002) { this.lift += (liftTarget - this.lift) * (reduce ? 1 : approach(dt, 0.07)); moving = true }
    if (!reduce && (this.gait === 'walk' || this.gait === 'run')) { this.phase += dt * (this.gait === 'run' ? 16 : 10); moving = true }
    poseExplorer(this.visitor, reduce ? 'idle' : this.gait, this.phase)
    this.visitor.group.position.set(this.vx, this.lift, this.vz)
    this.visitor.group.rotation.y = -this.angle

    const forward = new Vector3(Math.sin(this.angle), 0, -Math.cos(this.angle))
    const wanted = new Vector3(this.vx, 2.05, this.vz).addScaledVector(forward, -3.3)
    wanted.x = MathUtils.clamp(wanted.x, 0.35, WIDTH - 0.35)
    wanted.z = MathUtils.clamp(wanted.z, 0.35, DEPTH - 0.35)
    const k = reduce ? 1 : approach(dt, 0.22)
    if (this.cam.distanceTo(wanted) > 0.002) { this.cam.lerp(wanted, k); moving = true }
    // Look down the hall at frame height: against a wall the camera sits just behind the visitor and sees over their head.
    this.camTarget.set(this.vx, FRAME_Y - 0.25 + this.lift, this.vz).addScaledVector(forward, 6)
    this.camera.position.copy(this.cam)
    this.camera.lookAt(this.camTarget)
    if (this.dirty || moving) {
      this.dirty = false
      if (this.renderer.shadowMap.enabled) this.renderer.shadowMap.needsUpdate = true
      this.renderer.render(this.scene, this.camera)
    }
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, Math.round(width))
    this.height = Math.max(1, Math.round(height))
    this.renderer.setSize(this.width, this.height, false)
    this.camera.aspect = this.width / this.height
    this.camera.updateProjectionMatrix()
    this.dirty = true
  }

  dispose(): void {
    this.setFrames([])
    for (const item of this.disposables) item.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
  }
}
