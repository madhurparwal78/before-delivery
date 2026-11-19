/** Wump in a viewfinder: a moss-backed tide-newt on a sandy tide-pool shelf, with pebbles and rocks far behind it so the
 *  reel's depth of field has something to blur. The page owns every number; this draws them. */
import {
  CircleGeometry, CylinderGeometry, DirectionalLight, Group, HemisphereLight, Mesh, MeshLambertMaterial, PCFShadowMap, PerspectiveCamera, Scene,
  type WebGLRenderer,
} from 'three'
import { reducedMotion } from '../lib/dom'
import type { GuideScene, GuideView } from './api'
import { createRenderer, hash2 } from './common'
import { DepthOfField } from './dof'
import { buildNewt } from './newt'
import { paint, part, SPHERE } from './parts'

const BASE_DISTANCE = 4.4
const BREATH_MS = 1500
const BACKDROP = 0xf6f5f1

export class GuideView3D implements GuideScene {
  readonly canvas: HTMLCanvasElement
  private readonly renderer: WebGLRenderer
  private readonly scene = new Scene()
  private readonly camera = new PerspectiveCamera(30, 16 / 9, 0.1, 200)
  private readonly newt = buildNewt()
  private readonly wump = new Group()
  private readonly disposables: { dispose(): void }[] = []
  private dof: DepthOfField | null = null
  private view: GuideView = { spin: 0, zoom: 1, stretch: 0, hop: 0 }
  private dirty = true
  private breathStart = -1
  private nextBreath: number | null = null
  private breaths = 0
  private breath = 0

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = createRenderer(canvas, true)
    this.renderer.setClearColor(BACKDROP, 1)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFShadowMap
    this.scene.background = null

    const hemi = new HemisphereLight(0xfff6e4, 0xc8d4c0, 1.9)
    const sun = new DirectionalLight(0xfff2d6, 2.6)
    sun.position.set(-3, 6, 4)
    sun.castShadow = true
    sun.shadow.mapSize.set(1024, 1024)
    sun.shadow.camera.left = -4
    sun.shadow.camera.right = 4
    sun.shadow.camera.top = 4
    sun.shadow.camera.bottom = -4
    sun.shadow.radius = 4
    sun.shadow.bias = -0.0008
    this.scene.add(hemi, sun)

    const shelfGeo = new CylinderGeometry(7, 7.6, 0.4, 40)
    const shelf = new Mesh(shelfGeo, new MeshLambertMaterial({ color: 0xe9e3d0 }))
    shelf.position.y = -0.2
    shelf.receiveShadow = true
    const poolGeo = new CircleGeometry(1.7, 32)
    poolGeo.rotateX(-Math.PI / 2)
    const pool = new Mesh(poolGeo, new MeshLambertMaterial({ color: 0xa9d6d2 }))
    pool.position.set(1.9, 0.005, -1.1)
    this.scene.add(shelf, pool)
    this.disposables.push(shelfGeo, poolGeo, shelf.material as MeshLambertMaterial, pool.material as MeshLambertMaterial)

    const tones = [0xc9bfa6, 0xb7ab8f, 0xd8cfb8, 0x9f9a8a, 0x8aa58a]
    for (let i = 0; i < 46; i++) {
      const angle = hash2(i, 1, 2) * Math.PI * 2
      const radius = 1.8 + hash2(i, 2, 2) * 12
      const size = 0.08 + hash2(i, 3, 2) * (0.1 + radius * 0.035)
      const pebble = part(SPHERE, paint(tones[i % tones.length] as number), { at: [Math.cos(angle) * radius, size * 0.5, Math.sin(angle) * radius - 2], scale: [size, size * 0.65, size] })
      pebble.receiveShadow = true
      this.scene.add(pebble)
    }

    this.wump.add(this.newt.group)
    this.newt.group.scale.setScalar(1.6)
    this.newt.group.position.z = -0.35
    this.scene.add(this.wump)
    this.resize(canvas.clientWidth || 640, canvas.clientHeight || 360)
    this.set(this.view)
  }

  set(view: GuideView): void {
    this.view = view
    this.dirty = true
  }

  private place(): void {
    const { spin, zoom, stretch, hop } = this.view
    this.wump.rotation.y = Math.PI * 0.8 - (spin * Math.PI) / 180
    this.wump.position.y = Math.sin(Math.PI * Math.min(1, Math.max(0, hop))) * 0.6
    const breathe = 1 + 0.035 * Math.sin(Math.PI * this.breath)
    this.newt.body.scale.set(1 - 0.2 * stretch, (1 - 0.12 * stretch) * breathe, 1 + 0.55 * stretch)
    const distance = BASE_DISTANCE / zoom
    this.camera.position.set(0, 1.55 * (distance / BASE_DISTANCE) + 0.45, distance)
    this.camera.lookAt(0, 0.3, 0)
    this.camera.updateMatrixWorld()
  }

  frame(now: number): void {
    if (!reducedMotion()) {
      if (this.nextBreath === null) this.nextBreath = now + 1500
      if (this.breathStart < 0 && now >= this.nextBreath) { this.breathStart = now }
      if (this.breathStart >= 0) {
        const p = (now - this.breathStart) / BREATH_MS
        this.breath = p >= 1 ? 0 : p
        this.dirty = true
        if (p >= 1) {
          this.breathStart = -1
          this.breaths++
          this.nextBreath = now + 3000 + ((this.breaths * 1731) % 2000)
        }
      }
    } else if (this.breath !== 0) {
      this.breath = 0
      this.dirty = true
    }
    if (!this.dirty) return
    this.dirty = false
    this.place()
    const focus = this.view.focus
    if (focus) {
      this.dof ??= new DepthOfField(this.renderer.domElement.width, this.renderer.domElement.height)
      this.dof.render(this.renderer, this.scene, this.camera, focus, BASE_DISTANCE / 4)
    } else {
      this.renderer.render(this.scene, this.camera)
    }
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(Math.max(1, width), Math.max(1, height), false)
    this.camera.aspect = Math.max(1, width) / Math.max(1, height)
    this.camera.updateProjectionMatrix()
    this.dof?.resize(this.renderer.domElement.width, this.renderer.domElement.height)
    this.dirty = true
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose()
    this.dof?.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
  }
}
