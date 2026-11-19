/** The World view: `application "World view"` with every `data-*` hook, its canvas and overlay, the simulation, the camera
 *  and photo mode, input (keys, pointer, touch, joystick) and the taking of a photo. The page owns time; the scene only draws. */
import { inFrame } from '../../../shared/frame'
import { HEADINGS, HEADING_ANGLE, creatureById, type Heading, type Island, type Tile } from '../../../shared/island'
import type { Graphics, Lighthouse, PhotoAnswer, WorldEvent } from '../../../shared/types'
import { createWorldScene } from '../../engine'
import type { View, WorldScene } from '../../engine/api'
import { call, failureMessage } from '../../lib/api'
import { h, reducedMotion } from '../../lib/dom'
import { playEffect } from '../../lib/sound'
import type { Status } from '../../lib/status'
import type { Hud } from './hud'
import type { Overlay } from './overlay'
import { Simulation, shortestPath, type Snapshot } from './sim'

const EXPLORE_ZOOMS = [1, 2, 3, 4]
const PHOTO_ZOOMS = [1, 2, 4]
const FOCUSES = [2, 4, 8, 16]
const TAP_PX = 6
const STICK_PX = 16
const PINCH_PX = 40
const DIRECTION_KEYS: Record<string, Heading> = {
  w: 'N', arrowup: 'N', a: 'W', arrowleft: 'W', s: 'S', arrowdown: 'S', d: 'E', arrowright: 'E',
}
const NEARBY_TILES = 6

interface WorldDeps {
  island: Island
  tile: Tile
  heading: Heading
  preset: Graphics
  lighthouse: Lighthouse
  world: WorldEvent
  hud: Hud
  overlay: Overlay
  worldStatus: Status
  photoStatus: Status
  onMoved(tile: Tile, heading: Heading): void
  onPhotoKept(answer: PhotoAnswer['photo'], opener: HTMLElement | null): void
  openMap(): void
  openAlbum(): void
}

const mod360 = (degrees: number): number => ((degrees % 360) + 360) % 360
const signedHalf = (px: number): number => Math.sign(px) * Math.round(Math.abs(px) / 2)

export class WorldView {
  readonly el: HTMLElement
  readonly canvas = h('canvas', { class: 'world-canvas' })
  readonly scene: WorldScene
  readonly sim: Simulation
  island: Island
  mode: 'explore' | 'photo' = 'explore'
  private world: WorldEvent
  private exploreYaw: number
  private exploreZoom = 2
  private photoZoom = 1
  private focus = 4
  private preset: Graphics
  private lighthouse: Lighthouse
  private hooks = new Map<string, string>()
  private ready = false
  private raf = 0
  private width = 0
  private height = 0
  private spotted = new Set<string>()
  private scoring = false
  private shutterRunning = false
  private thumbnailUrl: string | null = null
  private pointers = new Map<number, { x: number; y: number }>()
  private gesture:
    | { kind: 'one'; startX: number; startY: number; startYaw: number; moved: boolean }
    | { kind: 'two'; startMidX: number; startDistance: number; startYaw: number; startZoomIndex: number }
    | null = null
  private stick: { x: number; y: number; id: number; heading: Heading | null } | null = null

  constructor(private deps: WorldDeps) {
    this.island = deps.island
    this.world = deps.world
    this.preset = deps.preset
    this.lighthouse = deps.lighthouse
    this.exploreYaw = HEADING_ANGLE[deps.heading]
    this.el = h('div', { role: 'application', 'aria-label': 'World view', tabindex: 0, class: 'world-view' }, this.canvas, deps.overlay.el)
    this.scene = createWorldScene({ canvas: this.canvas, island: deps.island.id, environment: this.environment() })
    this.sim = new Simulation(deps.island, deps.tile, deps.heading, {
      onStep: (step, snapshot) => this.stepped(step, snapshot),
      onTileChange: (tile, heading) => { this.nearby(); deps.onMoved(tile, heading) },
    })
    this.bind()
    this.paintAll()
    this.scene.setCreatures(this.creaturesHere())
    this.scene.setExplorer(this.sim.snapshot())
    this.pushView(true)
    this.raf = requestAnimationFrame(this.loop)
  }

  get tile(): Tile { return this.sim.tile }
  get heading(): Heading { return this.sim.heading }
  get presetNow(): Graphics { return this.preset }
  private get yaw(): number { return this.mode === 'photo' ? HEADING_ANGLE[this.sim.heading] : this.exploreYaw }
  private get zoom(): number { return this.mode === 'photo' ? this.photoZoom : this.exploreZoom }

  // ---- hooks ----------------------------------------------------------------------------------------------

  private hook(name: string, value: string | number): void {
    const text = String(value)
    if (this.hooks.get(name) === text) return
    this.hooks.set(name, text)
    this.el.setAttribute(`data-${name}`, text)
  }

  private creaturesHere(): { id: string; x: number; y: number; heading: Heading }[] {
    return this.world.creatures.filter((creature) => creature.island === this.island.id)
  }

  private environment(): Parameters<WorldScene['setEnvironment']>[0] {
    const { hour, minute, weather, dusk } = this.world
    return { hour, minute, weather, dusk, lighthouse: this.lighthouse, preset: this.preset }
  }

  private paintAll(): void {
    this.hook('state', this.ready ? 'ready' : 'loading')
    this.hook('step', this.sim.step)
    this.hook('island', this.island.id)
    this.paintMovement()
    this.hook('mode', this.mode)
    this.paintCamera()
    this.paintWorld()
    this.hook('lighthouse', this.lighthouse)
    this.hook('preset', this.preset)
    this.hook('camera', '')
    this.hook('guide', 'hidden')
    this.hook('shutter', 'idle')
    this.hook('host-island', '')
    this.hook('host-tile', '')
  }

  private paintMovement(): void {
    const { tile, heading, gait } = this.sim
    this.hook('tile', `${tile[0]},${tile[1]}`)
    this.hook('heading', heading)
    this.hook('gait', gait)
  }

  private paintCamera(): void {
    this.hook('yaw', this.yaw)
    this.hook('zoom', this.zoom)
    this.hook('focus', this.mode === 'photo' ? this.focus : '')
    this.updateFrame()
    this.deps.overlay.setReadouts(this.photoZoom, this.focus)
  }

  private paintWorld(): void {
    const { world } = this
    this.hook('tick', world.tick)
    this.hook('weather', world.weather)
    this.hook('world-hour', world.hour)
    this.hook('creatures', this.creaturesHere().map((c) => `${c.id}@${c.x},${c.y},${c.heading}`).join(';'))
    this.deps.hud.time.textContent = world.time
  }

  setHost(host: { island: number; tile: Tile } | null): void {
    this.hook('host-island', host ? host.island : '')
    this.hook('host-tile', host ? `${host.tile[0]},${host.tile[1]}` : '')
  }

  // ---- frame loop -----------------------------------------------------------------------------------------

  private loop = (): void => {
    const now = performance.now()
    if (!this.ready) {
      this.ready = true
      this.sim.start(now)
      this.hook('state', 'ready')
    } else {
      this.sim.catchUp(now)
    }
    if (this.el.clientWidth !== this.width || this.el.clientHeight !== this.height) {
      this.width = this.el.clientWidth
      this.height = this.el.clientHeight
      this.scene.resize(this.width, this.height)
    }
    this.hook('camera', this.scene.frame(now))
    this.raf = requestAnimationFrame(this.loop)
  }

  destroy(): void {
    cancelAnimationFrame(this.raf)
    window.removeEventListener('keyup', this.keyup)
    this.scene.dispose()
    if (this.thumbnailUrl) URL.revokeObjectURL(this.thumbnailUrl)
  }

  private stepped(step: number, snapshot: Snapshot): void {
    this.hook('step', step)
    this.paintMovement()
    this.scene.setExplorer(snapshot)
    this.updateFrame()
  }

  // ---- world state ----------------------------------------------------------------------------------------

  setWorld(next: WorldEvent): void {
    const previous = this.world
    this.world = next
    if (next.weather !== previous.weather) this.deps.worldStatus.say(next.weather === 'rain' ? 'Rain begins on the islands.' : 'The rain stops.')
    if (next.dusk !== previous.dusk) this.deps.worldStatus.say(next.dusk ? 'Dusk falls on the islands.' : 'Dusk is over.')
    this.paintWorld()
    this.scene.setEnvironment(this.environment())
    this.scene.setCreatures(this.creaturesHere())
    this.updateFrame()
    this.nearby()
  }

  setLighthouse(lighthouse: Lighthouse): void {
    this.lighthouse = lighthouse
    this.hook('lighthouse', lighthouse)
    this.scene.setEnvironment(this.environment())
  }

  setPreset(preset: Graphics): void {
    this.preset = preset
    this.hook('preset', preset)
    this.scene.setEnvironment(this.environment())
  }

  /** The explorer arrives on `island` at `tile`: a deep link, a sail, Back or a restart. */
  arrive(island: Island, tile: Tile, heading: Heading): void {
    if (this.mode === 'photo') this.leavePhoto()
    this.island = island
    this.sim.place(island, tile, heading)
    this.exploreYaw = HEADING_ANGLE[heading]
    this.exploreZoom = 2
    this.spotted.clear()
    this.hook('island', island.id)
    this.scene.setIsland(island.id)
    this.scene.setCreatures(this.creaturesHere())
    this.scene.setExplorer(this.sim.snapshot())
    this.paintMovement()
    this.paintWorld()
    this.paintCamera()
    this.pushView(true)
  }

  /** `You spot a <Creature name>.` the first time a present creature is within 6 tiles in both axes since arriving. */
  nearby(): void {
    const [x, y] = this.sim.tile
    for (const creature of this.creaturesHere()) {
      if (this.spotted.has(creature.id) || Math.abs(creature.x - x) > NEARBY_TILES || Math.abs(creature.y - y) > NEARBY_TILES) continue
      this.spotted.add(creature.id)
      this.deps.worldStatus.say(`You spot a ${creatureById(creature.id)?.name}.`)
    }
  }

  // ---- camera ---------------------------------------------------------------------------------------------

  private pushView(cut = false): void {
    const view: View = { mode: this.mode, yaw: this.yaw, zoom: this.zoom, focus: this.mode === 'photo' ? this.focus : 0 }
    this.scene.setView(view, { cut: cut || reducedMotion() })
  }

  private changed(): void {
    this.paintCamera()
    this.pushView()
  }

  private orbit(quarters: number): void {
    this.exploreYaw = mod360(this.exploreYaw + quarters * 90)
    this.changed()
  }

  private stepZoom(delta: number): void {
    const list = this.mode === 'photo' ? PHOTO_ZOOMS : EXPLORE_ZOOMS
    const at = list.indexOf(this.zoom)
    const next = list[Math.min(list.length - 1, Math.max(0, at + delta))] as number
    if (this.mode === 'photo') this.photoZoom = next
    else this.exploreZoom = next
    this.changed()
  }

  private home(): void {
    this.exploreYaw = HEADING_ANGLE[this.sim.heading]
    this.exploreZoom = 2
    this.changed()
  }

  private turn(heading: Heading): void {
    this.sim.heading = heading
    this.hook('heading', heading)
    this.scene.setExplorer(this.sim.snapshot())
    this.changed()
  }

  private turnQuarter(quarters: number): void {
    const at = HEADINGS.indexOf(this.sim.heading)
    this.turn(HEADINGS[(at + quarters + 4) % 4] as Heading)
  }

  private cycleFocus(): void {
    this.focus = FOCUSES[(FOCUSES.indexOf(this.focus) + 1) % FOCUSES.length] as number
    this.changed()
  }

  // ---- photo mode -----------------------------------------------------------------------------------------

  togglePhoto(): void {
    if (this.mode === 'photo') this.leavePhoto()
    else this.enterPhoto()
  }

  enterPhoto(): void {
    if (this.mode === 'photo') return
    this.mode = 'photo'
    this.photoZoom = 1
    this.focus = 4
    this.sim.frozen = true
    this.sim.cancelPath()
    this.hook('mode', 'photo')
    this.deps.hud.camera.setAttribute('aria-pressed', 'true')
    this.deps.hud.photoControls.hidden = false
    this.hook('guide', 'drawing')
    this.deps.overlay.drawGuide(() => { if (this.mode === 'photo') this.hook('guide', 'drawn') })
    this.changed()
  }

  leavePhoto(): void {
    if (this.mode === 'explore') return
    this.mode = 'explore'
    this.sim.frozen = false
    this.hook('mode', 'explore')
    this.deps.hud.camera.setAttribute('aria-pressed', 'false')
    this.deps.hud.photoControls.hidden = true
    this.hook('guide', 'hidden')
    this.deps.overlay.hideGuide()
    this.deps.overlay.frameGuide.clear()
    this.changed()
  }

  /** The frame rule on the server-sent positions: `data-in-view` and the `Frame guide` message. */
  private updateFrame(): void {
    if (this.mode !== 'photo') {
      this.hook('in-view', '')
      return
    }
    const subjects = inFrame(this.sim.tile, this.sim.heading, this.photoZoom, this.creaturesHere())
    this.hook('in-view', subjects.map((s) => s.id).join(','))
    const first = subjects[0]
    const message = first ? `${creatureById(first.id)?.name} in frame` : 'No creature in frame'
    if (this.deps.overlay.frameGuide.latest() !== message) this.deps.overlay.frameGuide.say(message)
    this.deps.overlay.setLock(first !== undefined)
  }

  // ---- taking a photo -------------------------------------------------------------------------------------

  async takePhoto(): Promise<void> {
    if (this.mode !== 'photo' || this.scoring) return
    this.scoring = true
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const { photoStatus, hud } = this.deps
    photoStatus.clear()
    photoStatus.say('Scoring…')
    hud.take.setAttribute('aria-busy', 'true')
    if (!reducedMotion() && !this.shutterRunning) {
      this.shutterRunning = true
      this.hook('shutter', 'moving')
      this.deps.overlay.runShutter(() => { this.shutterRunning = false; this.hook('shutter', 'idle') })
    }
    playEffect('shutter')
    const [x, y] = this.sim.tile
    const pose = {
      island: this.island.id, tile: [x, y], camera: [x, y], heading: this.sim.heading, zoom: this.photoZoom,
      focus: this.focus, tick: this.world.tick,
    }
    try {
      const blob = await this.scene.capture(960).catch(() => this.scene.capture(960))
      if (this.thumbnailUrl) URL.revokeObjectURL(this.thumbnailUrl)
      this.thumbnailUrl = URL.createObjectURL(blob)
      this.deps.overlay.showThumbnail(this.thumbnailUrl)
      const form = new FormData()
      form.set('image', blob, 'photo.jpg')
      form.set('pose', JSON.stringify(pose))
      const answer = await call<PhotoAnswer>('POST', '/api/photos', form, { 'Shot-Key': crypto.randomUUID() })
      const { photo } = answer
      photoStatus.clear()
      photoStatus.say(`${photo.creature_name}: ${photo.score.total} points. Size ${photo.score.size}, centring ${photo.score.centring}, facing ${photo.score.facing}, sharpness ${photo.score.sharpness}.`)
      if (photo.album.page_filled) photoStatus.say(`Album page filled: ${photo.creature_name}.`)
      this.deps.onPhotoKept(photo, opener)
    } catch (error) {
      photoStatus.clear()
      photoStatus.say(failureMessage(error), { error: true })
    } finally {
      this.scoring = false
      hud.take.removeAttribute('aria-busy')
      this.deps.overlay.hideThumbnail()
    }
  }

  // ---- walking --------------------------------------------------------------------------------------------

  walkTo(tile: Tile): void {
    if (this.mode !== 'explore') return
    const path = shortestPath(this.island, this.sim.tile, tile)
    if (path === null) this.deps.worldStatus.say('No path to that spot.')
    else if (path.length > 0) this.sim.walkPath(path, performance.now())
  }

  toggleRun(): void {
    this.deps.hud.run.setAttribute('aria-pressed', String(this.sim.toggleRun(performance.now())))
  }

  jump(): void {
    this.sim.requestJump(performance.now())
  }

  // ---- input ----------------------------------------------------------------------------------------------

  private bind(): void {
    const { el, deps } = this
    const { hud } = deps
    el.addEventListener('keydown', (event) => this.keydown(event))
    window.addEventListener('keyup', this.keyup)
    el.addEventListener('blur', () => this.sim.releaseAll(performance.now()))
    el.addEventListener('contextmenu', (event) => { event.preventDefault(); this.enterPhoto() })
    el.addEventListener('pointerdown', (event) => this.pointerDown(event))
    el.addEventListener('pointermove', (event) => this.pointerMove(event))
    el.addEventListener('pointerup', (event) => this.pointerUp(event))
    el.addEventListener('pointercancel', (event) => this.pointerEnd(event))
    hud.camera.addEventListener('click', () => this.togglePhoto())
    hud.zoomIn.addEventListener('click', () => this.stepZoom(1))
    hud.zoomOut.addEventListener('click', () => this.stepZoom(-1))
    hud.focus.addEventListener('click', () => this.cycleFocus())
    hud.take.addEventListener('click', () => void this.takePhoto())
    hud.run.addEventListener('click', () => this.toggleRun())
    hud.jump.addEventListener('click', () => this.jump())
    hud.joystick.addEventListener('pointerdown', (event) => this.stickDown(event))
    hud.joystick.addEventListener('pointermove', (event) => this.stickMove(event))
    hud.joystick.addEventListener('pointerup', (event) => this.stickEnd(event))
    hud.joystick.addEventListener('pointercancel', (event) => this.stickEnd(event))
  }

  private keydown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key === 'Shift' ? 'shift' : event.key.toLowerCase()
    const direction = DIRECTION_KEYS[key]
    const now = performance.now()
    const fresh = !event.repeat
    if (direction) {
      event.preventDefault()
      if (this.mode === 'photo') { if (fresh) this.turn(direction) } else this.sim.press(`key:${key}`, direction, now)
    } else if (key === 'shift') {
      this.sim.press('shift', null, now)
    } else if (key === 'enter' && this.mode === 'photo') {
      event.preventDefault()
      if (fresh) void this.takePhoto()
    } else if (key === 'escape' && this.mode === 'photo') {
      this.leavePhoto()
    } else if (!fresh) {
      return
    } else if (key === ' ' && this.mode === 'explore') {
      event.preventDefault()
      this.jump()
    } else if (key === 'r' && this.mode === 'explore') {
      this.toggleRun()
    } else if (key === 'q' || key === 'e') {
      const delta = key === 'q' ? -1 : 1
      if (this.mode === 'photo') this.turnQuarter(delta)
      else this.orbit(delta)
    } else if (key === '+' || key === '-') {
      this.stepZoom(key === '+' ? 1 : -1)
    } else if (key === 'home' && this.mode === 'explore') {
      this.home()
    } else if (key === 'f' && this.mode === 'photo') {
      this.cycleFocus()
    } else if (key === 'c') {
      this.togglePhoto()
    } else if (key === 'm') {
      this.deps.openMap()
    } else if (key === 'j') {
      this.deps.openAlbum()
    }
  }

  private keyup = (event: KeyboardEvent): void => {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key === 'Shift' ? 'shift' : event.key.toLowerCase()
    if (DIRECTION_KEYS[key]) this.sim.release(`key:${key}`, performance.now())
    else if (key === 'shift') this.sim.release('shift', performance.now())
  }

  private pointerDown(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (this.pointers.size === 1) {
      this.gesture = { kind: 'one', startX: event.clientX, startY: event.clientY, startYaw: this.exploreYaw, moved: false }
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }]
      const list = this.mode === 'photo' ? PHOTO_ZOOMS : EXPLORE_ZOOMS
      this.gesture = {
        kind: 'two', startMidX: (a.x + b.x) / 2, startDistance: Math.hypot(a.x - b.x, a.y - b.y),
        startYaw: this.exploreYaw, startZoomIndex: list.indexOf(this.zoom),
      }
    }
  }

  private pointerMove(event: PointerEvent): void {
    const point = this.pointers.get(event.pointerId)
    if (!point || !this.gesture) return
    point.x = event.clientX
    point.y = event.clientY
    const { gesture } = this
    if (gesture.kind === 'one') {
      const dx = event.clientX - gesture.startX
      if (Math.hypot(dx, event.clientY - gesture.startY) >= TAP_PX) gesture.moved = true
      if (gesture.moved && this.mode === 'explore') {
        this.exploreYaw = mod360(gesture.startYaw + signedHalf(dx))
        this.changed()
      }
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }]
      if (this.mode === 'explore') {
        this.exploreYaw = mod360(gesture.startYaw + signedHalf((a.x + b.x) / 2 - gesture.startMidX))
      }
      const list = this.mode === 'photo' ? PHOTO_ZOOMS : EXPLORE_ZOOMS
      const steps = Math.trunc((Math.hypot(a.x - b.x, a.y - b.y) - gesture.startDistance) / PINCH_PX)
      const next = list[Math.min(list.length - 1, Math.max(0, gesture.startZoomIndex + steps))] as number
      if (this.mode === 'photo') this.photoZoom = next
      else this.exploreZoom = next
      this.changed()
    }
  }

  private pointerUp(event: PointerEvent): void {
    const { gesture } = this
    if (gesture?.kind === 'one' && !gesture.moved && this.pointers.size === 1 && this.mode === 'explore') {
      const tile = this.scene.pick(event.clientX, event.clientY)
      if (tile) this.walkTo(tile)
    }
    this.pointerEnd(event)
  }

  private pointerEnd(event: PointerEvent): void {
    this.pointers.delete(event.pointerId)
    this.gesture = null
  }

  private stickDown(event: PointerEvent): void {
    this.stick = { x: event.clientX, y: event.clientY, id: event.pointerId, heading: null }
    this.deps.hud.joystick.setPointerCapture(event.pointerId)
  }

  private stickMove(event: PointerEvent): void {
    const { stick } = this
    if (!stick || stick.id !== event.pointerId) return
    const dx = event.clientX - stick.x
    const dy = event.clientY - stick.y
    const heading: Heading | null = Math.hypot(dx, dy) < STICK_PX ? null : Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : dy > 0 ? 'S' : 'N'
    const reach = Math.min(34, Math.hypot(dx, dy))
    const angle = Math.atan2(dy, dx)
    this.deps.hud.knob.style.transform = `translate(${Math.cos(angle) * reach}px, ${Math.sin(angle) * reach}px)`
    if (heading === stick.heading) return
    const now = performance.now()
    this.sim.release('joystick', now)
    stick.heading = heading
    if (!heading) return
    if (this.mode === 'photo') this.turn(heading)
    else this.sim.press('joystick', heading, now)
  }

  private stickEnd(event: PointerEvent): void {
    if (!this.stick || this.stick.id !== event.pointerId) return
    this.sim.release('joystick', performance.now())
    this.stick = null
    this.deps.hud.knob.style.transform = ''
  }
}
