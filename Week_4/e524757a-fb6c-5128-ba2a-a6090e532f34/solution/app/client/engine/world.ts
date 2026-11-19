/** The island scene: terrain, water, sky, explorer, creatures, weather and the camera. The page owns time and input;
 *  this class only draws what it is told and tweens on the clock passed to `frame`. */
import {
  DirectionalLight, FogExp2, Group, HemisphereLight, MathUtils, PCFShadowMap, PerspectiveCamera, Plane, Raycaster,
  Scene, Vector2, Vector3, type WebGLRenderer, type Material, Mesh,
} from 'three'
import { creatureById, GRID, type Heading, HEADING_ANGLE, isLand, islandById, type Tile } from '../../shared/island'
import type { Graphics } from '../../shared/types'
import { reducedMotion } from '../lib/dom'
import type { Environment, ExplorerPose, SceneCreature, View, WorldScene, WorldSceneOptions } from './api'
import { angleDelta, approach, createRenderer, ease } from './common'
import { buildCreature, type CreatureRig } from './creatures'
import { buildDecor, createGrassUniforms, type Decor } from './decor'
import { DepthOfField } from './dof'
import { buildExplorer, EYE_HEIGHT, poseExplorer } from './explorer'
import { createParticles, type Particles } from './particles'
import { applySkyState, createSkyDome, createSkyUniforms, skyState, type SkyState } from './sky'
import { buildTerrain, LAND_TOP, PALETTES, type Terrain } from './terrain'
import { createWaterUniforms, Water } from './water'

const GLIDE_MS = 320
const EXPLORE_DISTANCE = [0, 13, 9, 6, 4]
const EXPLORE_ELEVATION = (36 * Math.PI) / 180
const FRAME_INTERVAL = 33

/** Height of a ground creature's body, where the lens aims. */
const SUBJECT_HEIGHT = 0.35

interface Pose { position: Vector3; target: Vector3; fov: number }

interface Actor {
  rig: CreatureRig
  x: number
  z: number
  tx: number
  tz: number
  angle: number
  targetAngle: number
  phase: number
}

const radians = (heading: Heading): number => (HEADING_ANGLE[heading] * Math.PI) / 180

export class WorldView implements WorldScene {
  readonly canvas: HTMLCanvasElement
  private readonly renderer: WebGLRenderer
  private readonly scene = new Scene()
  private readonly camera = new PerspectiveCamera(50, 1, 0.1, 700)
  private readonly sky = createSkyUniforms()
  private readonly waterUniforms = createWaterUniforms()
  private readonly grass = createGrassUniforms()
  private readonly dome = createSkyDome(this.sky)
  private readonly hemi = new HemisphereLight(0xffffff, 0x444444, 1)
  private readonly sun = new DirectionalLight(0xffffff, 1)
  private readonly fog = new FogExp2(0xffffff, 0.007)
  private readonly water = new Water(this.sky, this.waterUniforms)
  private readonly explorer = buildExplorer(0xc9812e)
  private readonly actors = new Map<string, Actor>()
  private readonly raycaster = new Raycaster()
  private dof: DepthOfField | null = null

  private islandId = 0
  private terrain!: Terrain
  private decor!: Decor
  private particles!: Particles
  private worldGroup = new Group()
  private env: Environment
  private lighting!: SkyState
  private preset: Graphics | null = null

  private width = 1
  private height = 1
  private dirty = true
  private lastNow: number | null = null
  private lastRender = -1e9

  // explorer, as drawn
  private ex = 3.5
  private ez = 12.5
  private etx = 3.5
  private etz = 12.5
  private eAngle = radians('E')
  private eTargetAngle = radians('E')
  private ePhase = 0
  private jump = 0
  private pose: ExplorerPose = { tile: [3, 12], heading: 'E', gait: 'idle', jumpStep: 0 }
  private snapExplorer = true

  // camera
  private view: View = { mode: 'explore', yaw: 90, zoom: 2, focus: 0 }
  private hasView = false
  private glide: { from: Pose; start: number } | null = null
  private current: Pose = { position: new Vector3(), target: new Vector3(), fov: 50 }

  constructor(options: WorldSceneOptions) {
    this.canvas = options.canvas
    this.env = options.environment
    this.renderer = createRenderer(options.canvas, options.environment.preset !== 'light')
    this.scene.fog = this.fog
    this.scene.add(this.dome, this.hemi, this.sun, this.sun.target, ...this.water.meshes, this.explorer.group)
    this.scene.add(this.worldGroup)
    this.sun.shadow.camera.left = -20
    this.sun.shadow.camera.right = 20
    this.sun.shadow.camera.top = 20
    this.sun.shadow.camera.bottom = -20
    this.sun.shadow.camera.near = 1
    this.sun.shadow.camera.far = 120
    this.sun.shadow.bias = -0.0006
    this.sun.shadow.normalBias = 0.04
    this.sun.target.position.set(12, 0, 12)
    this.resize(options.canvas.clientWidth || 640, options.canvas.clientHeight || 400)
    this.setIsland(options.island)
    this.setEnvironment(options.environment)
  }

  setIsland(island: number): void {
    if (island === this.islandId) return
    this.islandId = island
    this.terrain?.dispose()
    this.decor?.dispose()
    this.particles?.dispose()
    this.worldGroup.removeFromParent()
    this.worldGroup = new Group()
    const def = islandById(island)
    if (!def) throw new Error(`no island ${island}`)
    const palette = PALETTES[island]
    if (!palette) throw new Error(`no palette ${island}`)
    this.terrain = buildTerrain(def, palette)
    this.decor = buildDecor(def, palette, this.terrain, this.grass)
    this.particles = createParticles(def)
    this.worldGroup.add(this.terrain.group, this.decor.group, this.particles.group)
    this.scene.add(this.worldGroup)
    this.waterUniforms.uShore.value = this.terrain.shore
    this.waterUniforms.uDeep.value.set(palette.water)
    this.waterUniforms.uShallow.value.set(palette.shallow)
    for (const actor of this.actors.values()) this.scene.remove(actor.rig.group)
    this.actors.clear()
    this.snapExplorer = true
    this.decor.setLighthouse(this.env?.lighthouse === 'open')
    this.refreshMaterials()
    this.dirty = true
  }

  setEnvironment(environment: Environment): void {
    const presetChanged = environment.preset !== this.preset
    this.env = environment
    this.lighting = skyState(environment.hour, environment.minute, environment.weather)
    const state = this.lighting
    applySkyState(this.sky, state)
    this.hemi.color.copy(state.hemiSky)
    this.hemi.groundColor.copy(state.hemiGround)
    this.hemi.intensity = state.hemiIntensity
    this.sun.color.copy(state.sunColor)
    this.sun.intensity = state.sunIntensity
    this.sun.position.copy(state.sunDir).multiplyScalar(60).add(this.sun.target.position)
    this.fog.color.copy(state.horizon)
    this.waterUniforms.uFogColor.value.copy(state.horizon)
    this.waterUniforms.uLight.value = (0.22 + 0.78 * state.day) * (environment.weather === 'rain' ? 0.8 : 1)
    this.decor.setLighthouse(environment.lighthouse === 'open')
    if (presetChanged) this.applyPreset(environment.preset)
    this.dirty = true
  }

  private applyPreset(preset: Graphics): void {
    this.preset = preset
    const renderer = this.renderer
    const ratio = preset === 'full' ? 1.5 : preset === 'balanced' ? 1.25 : 1
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, ratio))
    renderer.setSize(this.width, this.height, false)
    renderer.shadowMap.enabled = preset !== 'light'
    renderer.shadowMap.autoUpdate = false
    renderer.shadowMap.type = PCFShadowMap
    this.sun.shadow.radius = preset === 'full' ? 3 : 1
    this.sun.castShadow = preset !== 'light'
    this.sun.shadow.mapSize.set(preset === 'full' ? 2048 : 1024, preset === 'full' ? 2048 : 1024)
    this.sun.shadow.map?.dispose()
    this.sun.shadow.map = null
    this.water.setMode(preset === 'full' ? 'reflect' : preset === 'balanced' ? 'sky' : 'flat')
    this.refreshMaterials()
    this.dof?.resize(renderer.domElement.width, renderer.domElement.height)
  }

  private refreshMaterials(): void {
    this.scene.traverse((object) => {
      if (object instanceof Mesh) {
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        for (const material of materials as Material[]) material.needsUpdate = true
      }
    })
  }

  setCreatures(creatures: readonly SceneCreature[]): void {
    const seen = new Set<string>()
    const reduce = reducedMotion()
    for (const creature of creatures) {
      seen.add(creature.id)
      let actor = this.actors.get(creature.id)
      const x = creature.x + 0.5
      const z = creature.y + 0.5
      const angle = radians(creature.heading)
      if (!actor) {
        const def = creatureById(creature.id)
        if (!def) continue
        const rig = buildCreature(def)
        this.scene.add(rig.group)
        actor = { rig, x, z, tx: x, tz: z, angle, targetAngle: angle, phase: 0 }
        this.actors.set(creature.id, actor)
        this.applyActor(actor)
      } else {
        if (Math.hypot(x - actor.x, z - actor.z) > 3 || reduce) { actor.x = x; actor.z = z; actor.angle = angle }
        actor.tx = x
        actor.tz = z
        actor.targetAngle = angle
      }
    }
    for (const [id, actor] of this.actors) {
      if (!seen.has(id)) { this.scene.remove(actor.rig.group); this.actors.delete(id) }
    }
    this.refreshMaterials()
    this.dirty = true
  }

  private applyActor(actor: Actor): void {
    actor.rig.group.position.set(actor.x, this.terrain.heightAt(actor.x, actor.z) + actor.rig.hover, actor.z)
    actor.rig.group.rotation.y = -actor.angle
  }

  setExplorer(pose: ExplorerPose): void {
    this.pose = pose
    this.etx = pose.tile[0] + 0.5
    this.etz = pose.tile[1] + 0.5
    this.eTargetAngle = radians(pose.heading)
    if (this.snapExplorer || Math.hypot(this.etx - this.ex, this.etz - this.ez) > 3 || reducedMotion()) {
      this.ex = this.etx
      this.ez = this.etz
      this.eAngle = this.eTargetAngle
      this.snapExplorer = false
    }
    this.dirty = true
  }

  setView(view: View, options: { cut?: boolean } = {}): void {
    const changed = this.view.mode !== view.mode || this.view.yaw !== view.yaw || this.view.zoom !== view.zoom || this.view.focus !== view.focus
    this.view = view
    if (!changed && this.hasView) return
    this.glide = options.cut || !this.hasView || reducedMotion() ? null : { from: clonePose(this.current), start: performance.now() }
    this.hasView = true
    this.dirty = true
  }

  /** Ground-level point the explorer is drawn at. */
  private explorerGround(): number {
    return this.terrain.heightAt(this.ex, this.ez)
  }

  private livePose(): Pose {
    const view = this.view
    const yaw = (view.yaw * Math.PI) / 180
    const forward = new Vector3(Math.sin(yaw), 0, -Math.cos(yaw))
    const ground = this.explorerGround() + this.jump
    if (view.mode === 'photo') {
      const eye = new Vector3(this.ex, ground + EYE_HEIGHT, this.ez).addScaledVector(forward, 0.12)
      const half = Math.atan(1 / (2 * view.zoom))
      const aspect = this.width / this.height
      const vertical = MathUtils.clamp(2 * Math.atan(Math.tan(half) / aspect), (8 * Math.PI) / 180, (80 * Math.PI) / 180)
      // The lens aims at creature height on the ground at the focus distance, so the subject in focus sits in the frame.
      const target = new Vector3(this.ex, ground + SUBJECT_HEIGHT, this.ez).addScaledVector(forward, Math.max(2, view.focus))
      return { position: eye, target, fov: MathUtils.radToDeg(vertical) }
    }
    const target = new Vector3(this.ex, ground + 0.9, this.ez)
    const distance = EXPLORE_DISTANCE[view.zoom] ?? 9
    const position = target.clone().addScaledVector(forward, -distance * Math.cos(EXPLORE_ELEVATION))
    position.y += distance * Math.sin(EXPLORE_ELEVATION)
    return { position, target, fov: 50 }
  }

  private updateCamera(now: number, reduce: boolean): boolean {
    const live = this.livePose()
    let pose = live
    let moving = false
    if (this.glide && !reduce) {
      const t = (now - this.glide.start) / GLIDE_MS
      if (t >= 1) this.glide = null
      else {
        const k = ease(t)
        const { from } = this.glide
        pose = { position: from.position.clone().lerp(live.position, k), target: from.target.clone().lerp(live.target, k), fov: MathUtils.lerp(from.fov, live.fov, k) }
        moving = true
      }
    } else this.glide = null
    if (this.current.fov !== pose.fov || this.camera.aspect !== this.width / this.height) {
      this.camera.fov = pose.fov
      this.camera.aspect = this.width / this.height
      this.camera.updateProjectionMatrix()
    }
    this.current = pose
    this.camera.position.copy(pose.position)
    this.camera.lookAt(pose.target)
    this.camera.updateMatrixWorld()
    this.explorer.group.visible = !(this.view.mode === 'photo' && !this.glide)
    return moving
  }

  /** Move the figures toward what they were told. Returns whether anything is still moving. */
  private updateActors(dt: number, reduce: boolean): boolean {
    let moving = false
    const gait = this.pose.gait
    const k = reduce ? 1 : approach(dt, gait === 'run' ? 0.05 : 0.09)
    const dx = this.etx - this.ex
    const dz = this.etz - this.ez
    const turn = angleDelta(this.eAngle, this.eTargetAngle)
    if (Math.abs(dx) > 0.002 || Math.abs(dz) > 0.002 || Math.abs(turn) > 0.002) {
      this.ex += dx * k
      this.ez += dz * k
      this.eAngle += turn * (reduce ? 1 : approach(dt, 0.06))
      moving = true
    }
    const jumpTarget = this.pose.jumpStep > 0 ? [0.3, 0.65, 0.65, 0.3][this.pose.jumpStep - 1] ?? 0 : 0
    if (Math.abs(jumpTarget - this.jump) > 0.002) {
      this.jump += (jumpTarget - this.jump) * (reduce ? 1 : approach(dt, 0.06))
      moving = true
    }
    const stride = !reduce && (gait === 'walk' || gait === 'run')
    if (stride) { this.ePhase += dt * (gait === 'run' ? 16 : 10); moving = true }
    poseExplorer(this.explorer, reduce ? 'idle' : gait, this.ePhase)
    this.explorer.group.position.set(this.ex, this.explorerGround() + this.jump, this.ez)
    this.explorer.group.rotation.y = -this.eAngle
    this.grass.uExplorer.value = [this.ex, this.ez]

    for (const actor of this.actors.values()) {
      const ax = actor.tx - actor.x
      const az = actor.tz - actor.z
      const spin = angleDelta(actor.angle, actor.targetAngle)
      const walking = Math.abs(ax) > 0.01 || Math.abs(az) > 0.01
      if (walking || Math.abs(spin) > 0.01) {
        const step = reduce ? 1 : approach(dt, 0.18)
        actor.x += ax * step
        actor.z += az * step
        actor.angle += spin * (reduce ? 1 : approach(dt, 0.1))
        moving = true
      }
      if (walking && !reduce) {
        actor.phase += dt * 9
        actor.rig.legs.forEach((leg, index) => { leg.rotation.x = Math.sin(actor.phase + (index % 3 === 0 ? 0 : Math.PI)) * 0.5 })
      } else actor.rig.legs.forEach((leg) => { leg.rotation.x = 0 })
      this.applyActor(actor)
    }
    return moving
  }

  frame(now: number): string {
    const dt = this.lastNow === null ? 0 : MathUtils.clamp((now - this.lastNow) / 1000, 0, 0.1)
    this.lastNow = now
    const reduce = reducedMotion()
    const lit = this.preset !== 'light'
    let animating = this.updateActors(dt, reduce)
    animating = this.updateCamera(now, reduce) || animating
    const time = reduce ? 0 : now / 1000
    this.grass.uTime.value = time
    this.grass.uWind.value = lit && !reduce ? 1 : 0
    this.grass.uPart.value = lit ? 1 : 0
    const looping = lit && !reduce
    if (looping || this.dirty || animating) {
      this.particles.update(time, {
        rain: lit && this.env.weather === 'rain',
        dusk: lit && this.env.dusk,
        centre: new Vector3(this.ex, 0, this.ez),
      })
    }
    if (this.dirty || animating || (looping && now - this.lastRender >= FRAME_INTERVAL)) {
      this.render()
      this.lastRender = now
      this.dirty = false
    }
    const { position: p, target: t } = this.current
    return [p.x, p.y, p.z, t.x, t.y, t.z].map((n) => n.toFixed(2)).join(',')
  }

  private render(): void {
    if (this.renderer.shadowMap.enabled) this.renderer.shadowMap.needsUpdate = true
    this.dome.position.copy(this.camera.position)
    if (this.view.mode === 'photo' && this.preset !== 'light') {
      this.dof ??= new DepthOfField(this.renderer.domElement.width, this.renderer.domElement.height)
      this.dof.render(this.renderer, this.scene, this.camera, this.view.focus, 1)
    } else {
      this.renderer.render(this.scene, this.camera)
    }
  }

  pick(clientX: number, clientY: number): Tile | null {
    const rect = this.canvas.getBoundingClientRect()
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1))
    this.camera.updateMatrixWorld()
    this.raycaster.setFromCamera(ndc, this.camera)
    const hit = this.raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -(LAND_TOP - 0.05)), new Vector3())
    if (!hit) return null
    const x = Math.floor(hit.x)
    const y = Math.floor(hit.z)
    const island = islandById(this.islandId)
    return island && x >= 0 && y >= 0 && x < GRID && y < GRID && isLand(island, x, y) ? [x, y] : null
  }

  capture(maxWidth: number): Promise<Blob> {
    this.glide = null
    this.updateActors(0, true)
    this.updateCamera(performance.now(), true)
    this.render()
    const width = Math.min(maxWidth, this.canvas.width)
    const height = Math.round((this.canvas.height * width) / this.canvas.width)
    const copy = document.createElement('canvas')
    copy.width = width
    copy.height = height
    ;(copy.getContext('2d') as CanvasRenderingContext2D).drawImage(this.canvas, 0, 0, width, height)
    // Encoded in this task: `toBlob` waits for the browser's idle scheduling, which a busy or frame-starved page may not reach.
    const url = copy.toDataURL('image/jpeg', 0.9)
    if (!url.startsWith('data:image/jpeg;base64,')) return Promise.reject(new Error('capture failed'))
    const binary = atob(url.slice(url.indexOf(',') + 1))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return Promise.resolve(new Blob([bytes], { type: 'image/jpeg' }))
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, Math.round(width))
    this.height = Math.max(1, Math.round(height))
    this.renderer.setSize(this.width, this.height, false)
    this.dof?.resize(this.renderer.domElement.width, this.renderer.domElement.height)
    this.dirty = true
  }

  dispose(): void {
    this.terrain.dispose()
    this.decor.dispose()
    this.particles.dispose()
    this.water.dispose()
    this.dof?.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
  }
}

function clonePose(pose: Pose): Pose {
  return { position: pose.position.clone(), target: pose.target.clone(), fov: pose.fov }
}

