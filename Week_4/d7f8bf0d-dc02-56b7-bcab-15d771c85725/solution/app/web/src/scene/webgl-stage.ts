import {
  Color, DoubleSide, Group, Material, Mesh, MeshBasicMaterial, MeshLambertMaterial, PerspectiveCamera, Raycaster, Scene, Sprite, SpriteMaterial, TorusGeometry,
  Vector2, Vector3, WebGLRenderer, type BufferGeometry, type Intersection, type Object3D, type Texture,
} from 'three'
import type { BlockState } from '../../../shared/domain'
import type { StageCallbacks, StageController, StageInputs, StagePick, StageReport } from './contract'
import {
  BAND_LIFT, BUILD_STAGES, COLORS, DURATION, FOV_DEG, PITCH_DEG, RIBBON_LIFT, STRIP_HALF_WIDTH, STRIP_PERIOD, TABLE_Y, worldX, worldZ,
} from './constants'
import { Hall, Pigeon } from './environment'
import { Step } from './easing'
import { attachGestures } from './gestures'
import { buildLayoutView, layoutSignature, type LayoutView } from './layout-view'
import { MeshData } from './mesh-data'
import { LimitFlag, Ribbons, previewMaterial } from './ribbons'
import { Stock } from './stock'
import { boardTexture, chevronTexture, hatchTexture, trainGlyphTexture } from './textures'
import {
  blockMidPoint, buildBoards, buildModules, buildOpenEndMarkers, buildPickMeshes, buildSignals, buildStrips, buildTrack, toPoint,
  type Board, type ModuleFascia, type OpenEndMarkers, type Signals,
} from './track-builder'
import { ViewState } from './view-state'

// Clear space kept round the layout, and how much of the window's height its depth may take.
const SIDE_MARGIN_M = 0.6
const DEPTH_MARGIN_M = 0.9
const LAYOUT_SHARE_OF_HEIGHT = 0.52

const LAMP_COLOURS: Record<BlockState, string> = {
  free: COLORS.field, reserved: COLORS.accent, occupied: COLORS.action, out_of_service: COLORS.ink,
}

function disposeTree(root: Object3D, keep: Set<Material>): void {
  root.traverse(child => {
    if (!(child instanceof Mesh)) return
    const geometry: BufferGeometry = child.geometry
    geometry.dispose()
    const materials: Material[] = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) {
      if (keep.has(material)) continue
      const map = (material as Material & { map?: Texture | null }).map
      map?.dispose()
      material.dispose()
    }
  })
}

class WebglStage implements StageController {
  private readonly renderer: WebGLRenderer
  private readonly scene = new Scene()
  private readonly camera = new PerspectiveCamera(FOV_DEG, 1, 0.5, 400)
  private readonly view = new ViewState()
  private readonly stock = new Stock()
  private readonly flag = new LimitFlag()
  private readonly raycaster = new Raycaster()
  private readonly hall = new Hall(this.scene)
  private readonly detach: () => void
  private readonly resizeObserver: ResizeObserver
  private stagesBuilt = 0
  private insetRight = 0
  private insetSlide: { step: Step; from: number; to: number } | null = null

  private readonly stateMaterials: Record<BlockState, Material>
  private readonly conflictMaterial: Material
  private readonly fasciaTones: [Material, Material]
  private readonly selectedFascia: Material
  private readonly ribbons: Ribbons
  private readonly previews: Ribbons
  private readonly shared = new Set<Material>()

  private inputs: StageInputs | null = null
  private layout: LayoutView | null = null
  private content = new Group()
  private strips = new Map<number, Mesh>()
  private fascias: ModuleFascia[] = []
  private trainsSource = ''
  private signals: Signals | null = null
  private boards = new Map<string, Board>()
  private markers: OpenEndMarkers = { mesh: null, ids: [], labels: [], points: [] }
  private endLabel: { text: string; sprite: Sprite } | null = null
  private picks = new Group()
  private highlight = new Group()
  private highlightKey = ''
  // Replaced scenery, freed only after the next render: its successors have picked up the same compiled shaders by then.
  private retired: Group[] = []
  // Set on the last frame sent to the GPU: a slow GPU skips in-between frames of a motion rather than queueing them ahead
  // of the whole page's paint. The frame a motion settles on is always drawn.
  private fence: WebGLSync | null = null
  private conflict: Mesh | null = null
  private conflictBlock: number | null = null
  private slide: { group: Group; step: Step; dx: number; dz: number } | null = null
  private knownPieces = new Set<string>()
  private pigeon: Pigeon | null = null
  private built = false
  private lost = false
  private firstRendered = false
  private disposed = false
  private scheduled = 0
  private lastReport = ''
  private width = 1
  private height = 1
  private fit = 20

  constructor(private readonly host: HTMLElement, private readonly callbacks: StageCallbacks, renderer: WebGLRenderer) {
    this.renderer = renderer
    this.stateMaterials = {
      free: new MeshBasicMaterial({ color: COLORS.field, side: DoubleSide }),
      reserved: new MeshBasicMaterial({ color: COLORS.accentDeep, side: DoubleSide }),
      occupied: new MeshBasicMaterial({ map: trainGlyphTexture(), side: DoubleSide }),
      out_of_service: new MeshBasicMaterial({ map: hatchTexture(COLORS.ink, '#9AA3BD'), side: DoubleSide }),
    }
    this.conflictMaterial = new MeshBasicMaterial({ map: hatchTexture(COLORS.action, COLORS.ink), side: DoubleSide })
    const fascia = (color: string): Material => new MeshLambertMaterial({ color, side: DoubleSide })
    this.fasciaTones = [fascia(COLORS.lip), fascia(COLORS.lipPale)]
    this.selectedFascia = fascia(COLORS.accent)
    const ribbonMaterial = new MeshBasicMaterial({ map: chevronTexture(COLORS.accent, '#FFFFFF'), side: DoubleSide })
    const paleMaterial = previewMaterial(chevronTexture('#BFE3F7', '#FFFFFF'))
    this.ribbons = new Ribbons(ribbonMaterial, true)
    this.previews = new Ribbons(paleMaterial, false)
    for (const m of [...Object.values(this.stateMaterials), this.conflictMaterial, ...this.fasciaTones, this.selectedFascia, ribbonMaterial, paleMaterial]) this.shared.add(m)

    this.scene.add(this.content, this.picks, this.highlight, this.stock.group, this.ribbons.group, this.previews.group, this.flag.group)
    this.stageBuilt()

    const canvas = renderer.domElement
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;outline:none'
    host.appendChild(canvas)
    this.detach = attachGestures(canvas, {
      pan: (dx, dy) => this.panScreen(dx, dy),
      zoom: factor => { this.view.zoomBy(factor); this.requestFrame() },
      rotate: delta => { this.view.rotateBy(delta); this.requestFrame() },
      tap: event => this.pick(event),
    })
    canvas.addEventListener('webglcontextlost', this.onLost)
    canvas.addEventListener('webglcontextrestored', this.onRestored)
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(host)
    this.resize()
    void document.fonts.load('600 56px Fredoka').then(() => this.redrawBoards())
  }

  // The boards are first drawn before the display face has arrived; they are drawn again once it has.
  private redrawBoards(): void {
    if (this.disposed) return
    for (const board of this.boards.values()) {
      board.material.map?.dispose()
      board.material.map = boardTexture(board.name)
      board.material.needsUpdate = true
    }
    this.requestFrame()
  }

  private readonly onLost = (event: Event): void => {
    event.preventDefault()
    this.lost = true
    this.fence = null
    this.callbacks.onContextLost()
  }

  private readonly onRestored = (): void => {
    this.lost = false
    this.callbacks.onContextRestored()
    this.requestFrame()
  }

  // Build progress is the share of stages that have really finished: hall, modules, track, details, first frame.
  private stageBuilt(): void {
    this.stagesBuilt += 1
    this.callbacks.onProgress(this.stagesBuilt / BUILD_STAGES)
  }

  private resize(): void {
    this.width = Math.max(this.host.clientWidth, 1)
    this.height = Math.max(this.host.clientHeight, 1)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(this.width, this.height, false)
    this.camera.aspect = this.width / this.height
    this.fitDistance()
    this.requestFrame()
  }

  private fitDistance(): void {
    const bounds = this.layout?.bounds ?? { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 }
    const widthM = (bounds.maxX - bounds.minX) / 1000 + 2 * SIDE_MARGIN_M
    const depthM = (bounds.maxY - bounds.minY) / 1000 + 2 * DEPTH_MARGIN_M
    const pitch = (PITCH_DEG * Math.PI) / 180
    const vertical = Math.tan((FOV_DEG * Math.PI) / 360)
    const horizontal = (vertical * (this.width - this.insetRight)) / this.height
    // The front edge of the layout is nearer the camera than its centre, so it is the edge that has to fit.
    const nearer = (depthM / 2) * Math.cos(pitch)
    this.fit = nearer + Math.max(widthM / 2 / horizontal, ((depthM / 2) * Math.sin(pitch)) / (vertical * LAYOUT_SHARE_OF_HEIGHT))
  }

  private distance(): number {
    return this.fit / this.view.zoom
  }

  private panScreen(dx: number, dy: number): void {
    const perPixel = ((2 * this.distance() * Math.tan((FOV_DEG * Math.PI) / 360)) / this.height) * 1000
    this.view.panScreen(dx, dy, perPixel, perPixel / Math.sin((PITCH_DEG * Math.PI) / 180))
    this.requestFrame()
  }

  // ---- controller ---------------------------------------------------------------------------

  update(inputs: StageInputs): void {
    this.inputs = inputs
    this.view.reduced = inputs.reduced_motion
    this.slideInset(inputs.inset_right_px, inputs.reduced_motion)
    const signature = layoutSignature(inputs.content)
    if (this.layout === null || this.layout.signature !== signature) this.rebuild(inputs)
    this.apply(inputs)
    this.requestFrame()
  }

  private slideInset(to: number, reduced: boolean): void {
    if (to === (this.insetSlide?.to ?? this.insetRight)) return
    if (reduced || !this.built) {
      this.insetSlide = null
      this.insetRight = to
      this.fitDistance()
      return
    }
    this.insetSlide = { step: new Step(DURATION.sheet), from: this.insetRight, to }
  }

  turnHeading(deltaDeg: number): void {
    this.view.turnHeading(deltaDeg)
    this.requestFrame()
  }

  setHeading(deg: number): void {
    this.view.setHeading(deg)
    this.requestFrame()
  }

  panBy(dxPx: number, dyPx: number): void {
    this.panScreen(dxPx, dyPx)
  }

  zoomBy(factor: number): void {
    this.view.zoomBy(factor)
    this.requestFrame()
  }

  resetView(): void {
    this.view.reset()
    this.requestFrame()
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.scheduled)
    this.detach()
    this.resizeObserver.disconnect()
    const canvas = this.renderer.domElement
    canvas.removeEventListener('webglcontextlost', this.onLost)
    canvas.removeEventListener('webglcontextrestored', this.onRestored)
    for (const old of this.retired.splice(0)) disposeTree(old, new Set())
    disposeTree(this.scene, new Set())
    for (const material of this.shared) {
      ;(material as Material & { map?: Texture | null }).map?.dispose()
      material.dispose()
    }
    this.renderer.dispose()
    canvas.remove()
  }

  // ---- building -----------------------------------------------------------------------------

  private rebuild(inputs: StageInputs): void {
    const first = !this.built
    const progress = (): void => { if (first) this.stageBuilt() }
    for (const group of [this.content, this.picks, this.highlight]) this.retire(group)
    this.highlightKey = ''
    this.slide = null
    this.layout = buildLayoutView(inputs.content)
    const layout = this.layout
    this.fitDistance()
    const { minX, maxX, minY, maxY } = layout.bounds
    this.hall.fit({ minX: worldX(minX), maxX: worldX(maxX), minZ: worldZ(maxY), maxZ: worldZ(minY) })

    const ids = new Set(layout.pieces.map(track => track.piece.id))
    const arrived = inputs.newest_piece_id !== null && !first && !this.knownPieces.has(inputs.newest_piece_id) && !inputs.reduced_motion
    const sliding = arrived ? layout.pieces.find(track => track.piece.id === inputs.newest_piece_id) : undefined
    this.knownPieces = ids

    const modules = buildModules(layout, this.fasciaTones)
    this.fascias = modules.fascias
    this.content.add(modules.group)
    progress()
    this.content.add(buildTrack(layout.pieces.filter(track => track !== sliding)))
    if (sliding !== undefined) {
      const group = buildTrack([sliding])
      const heading = (sliding.piece.start.heading_deg * Math.PI) / 180
      this.slide = { group, step: new Step(DURATION.sheet), dx: Math.cos(heading) * 0.4, dz: -Math.sin(heading) * 0.4 }
      group.position.set(-this.slide.dx, 0, -this.slide.dz)
      this.content.add(group)
      const end = sliding.piece.end
      this.view.easePanToward(end.x_mm - layout.center.x_mm, end.y_mm - layout.center.y_mm, 0.3)
    }
    progress()

    this.strips = buildStrips(layout, this.stateMaterials.free)
    for (const strip of this.strips.values()) this.content.add(strip)
    this.signals = buildSignals(layout)
    this.content.add(this.signals.group)
    const boards = buildBoards(layout, inputs.station_names)
    this.boards = boards.boards
    this.content.add(boards.group)
    this.markers = buildOpenEndMarkers(layout)
    if (this.markers.mesh !== null) this.content.add(this.markers.mesh)
    this.picks.add(buildPickMeshes(layout))
    this.conflictBlock = null
    this.ribbons.clear()
    this.previews.clear()
    progress()

    if (first && !inputs.reduced_motion) {
      this.pigeon = new Pigeon(this.scene, worldX(minX) - 3, worldX(maxX) + 3, worldZ(maxY) - 1)
    }
    this.built = true
  }

  private apply(inputs: StageInputs): void {
    const layout = this.layout
    if (layout === null) return
    this.stock.sync(layout, inputs.trains, inputs.reduced_motion || inputs.trains_source !== this.trainsSource)
    this.trainsSource = inputs.trains_source
    this.stock.highlight(inputs.mode === 'operate' ? inputs.selection.train_number : null)
    for (const { moduleId, mesh, rest } of this.fascias) mesh.material = moduleId === inputs.selection.module_id ? this.selectedFascia : rest

    for (const [number, strip] of this.strips) {
      const state = inputs.block_states[number] ?? 'free'
      strip.material = this.stateMaterials[state]
      strip.position.y = state === 'free' ? 0 : BAND_LIFT
    }
    const signals = this.signals
    if (signals !== null) {
      signals.blockNumbers.forEach((number, i) => signals.mesh.setColorAt(i, new Color(LAMP_COLOURS[inputs.block_states[number] ?? 'free'])))
      if (signals.mesh.instanceColor !== null) signals.mesh.instanceColor.needsUpdate = true
    }
    for (const [id, board] of this.boards) {
      const name = inputs.station_names[id]
      if (name !== undefined && name !== board.name) {
        board.name = name
        board.material.map?.dispose()
        board.material.map = boardTexture(name)
        board.material.needsUpdate = true
      }
    }

    this.ribbons.sync(layout, inputs.ribbons, inputs.trains, inputs.reduced_motion)
    this.previews.sync(layout, [{ id: 'preview', blocks: inputs.preview_blocks }], inputs.trains, true)
    const flagBlock = inputs.limit_flag_block
    this.flag.sync(layout, flagBlock, flagBlock === null ? 'east' : (this.ribbons.directionOf(flagBlock) ?? 'east'), inputs.reduced_motion)

    if (this.markers.mesh !== null) this.markers.mesh.visible = inputs.mode === 'build'
    this.setConflict(layout, inputs.conflict_block)
    this.setHighlight(layout, inputs)
  }

  private setConflict(layout: LayoutView, block: number | null): void {
    if (block === this.conflictBlock) return
    this.conflictBlock = block
    if (this.conflict !== null) {
      this.content.remove(this.conflict)
      this.conflict.geometry.dispose()
      this.conflict = null
    }
    const path = block === null ? undefined : layout.pathsByNumber.get(block)
    if (path === undefined || path.points.length < 2) return
    const data = new MeshData()
    data.addStrip(path.points.map(p => toPoint(p, RIBBON_LIFT + 0.008)), STRIP_HALF_WIDTH, STRIP_PERIOD)
    this.conflict = new Mesh(data.toGeometry(), this.conflictMaterial)
    this.content.add(this.conflict)
  }

  private retire(group: Group): void {
    if (group.children.length === 0) return
    const old = new Group()
    old.add(...group.children)
    this.retired.push(old)
  }

  private setHighlight(layout: LayoutView, inputs: StageInputs): void {
    const { piece_id: pieceId, open_end_id: openEndId, block_number: blockNumber } = inputs.selection
    const key = JSON.stringify([pieceId, openEndId, blockNumber, inputs.mode])
    if (key === this.highlightKey) return
    this.highlightKey = key
    this.retire(this.highlight)
    const paint = (color: string): MeshBasicMaterial => new MeshBasicMaterial({ color, side: DoubleSide })
    if (pieceId !== null) {
      const track = layout.pieces.find(t => t.piece.id === pieceId)
      if (track !== undefined) {
        const data = new MeshData()
        data.addStrip(track.points.map(p => toPoint(p, 0.0105)), 0.3, 1)
        this.highlight.add(new Mesh(data.toGeometry(), paint(COLORS.accentDeep)))
      }
    }
    const path = blockNumber === null ? undefined : layout.pathsByNumber.get(blockNumber)
    if (path !== undefined && path.points.length > 1) {
      const data = new MeshData()
      data.addStrip(path.points.map(p => toPoint(p, 0.0015)), STRIP_HALF_WIDTH + 0.07, 1)
      this.highlight.add(new Mesh(data.toGeometry(), paint('#FFFFFF')))
    }
    const index = openEndId === null ? -1 : this.markers.ids.indexOf(openEndId)
    if (index >= 0 && inputs.mode === 'build') {
      const ring = new TorusGeometry(0.28, 0.06, 6, 20)
      ring.rotateX(-Math.PI / 2)
      const mesh = new Mesh(ring, paint(COLORS.accentDeep))
      const p = this.markers.points[index]
      mesh.position.set(p.x, p.y + 0.01, p.z)
      this.highlight.add(mesh)
      const sprite = this.endLabelFor(`Open end ${this.markers.labels[index]}`)
      sprite.position.set(p.x, p.y + 0.62, p.z)
      this.highlight.add(sprite)
    }
  }

  private endLabelFor(text: string): Sprite {
    if (this.endLabel?.text === text) return this.endLabel.sprite
    this.endLabel?.sprite.material.map?.dispose()
    this.endLabel?.sprite.material.dispose()
    const sprite = new Sprite(new SpriteMaterial({ map: boardTexture(text), depthTest: false }))
    sprite.scale.set(1.9, 0.475, 1)
    this.endLabel = { text, sprite }
    return sprite
  }

  // ---- picking ------------------------------------------------------------------------------

  private pick(event: PointerEvent): void {
    const inputs = this.inputs
    if (inputs === null || this.lost) return
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.raycaster.setFromCamera(new Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -(((event.clientY - rect.top) / rect.height) * 2 - 1)), this.camera)
    const first = (targets: Object3D[]): Intersection | undefined => this.raycaster.intersectObjects(targets, true)[0]
    let pick: StagePick | null = null
    if (inputs.mode === 'build') {
      const end = this.markers.mesh === null ? undefined : first([this.markers.mesh])
      const piece = first(this.picks.children)
      if (end?.instanceId !== undefined) pick = { kind: 'open_end', id: this.markers.ids[end.instanceId] }
      else if (piece !== undefined) pick = { kind: 'piece', id: String(piece.object.userData.id) }
    } else {
      const train = first([this.stock.group])
      const block = first([...this.strips.values()])
      if (train !== undefined) pick = { kind: 'train', number: String(train.object.userData.number) }
      else if (block !== undefined) pick = { kind: 'block', number: Number(block.object.userData.number) }
    }
    if (pick !== null) this.callbacks.onPick(pick)
  }

  // ---- frames -------------------------------------------------------------------------------

  private requestFrame(): void {
    if (this.scheduled !== 0 || this.disposed) return
    this.scheduled = requestAnimationFrame(now => this.frame(now))
  }

  private frame(now: number): void {
    this.scheduled = 0
    if (this.disposed) return
    const viewMoving = this.view.step(now)
    const gliding = this.stock.advance(now)
    const ribbonsMoving = this.ribbons.advance(now)
    this.previews.advance(now)
    this.flag.advance(now)
    const sliding = this.advanceSlide(now)
    const insetMoving = this.advanceInset(now)
    this.pigeon?.advance(now)
    if (this.pigeon !== null && !this.pigeon.active) this.pigeon = null
    const animating = !(this.inputs?.reduced_motion ?? false) && (this.view.animating || viewMoving || gliding || ribbonsMoving || this.flag.animating || sliding || insetMoving)
    const moving = animating || this.pigeon?.active === true
    const skipped = moving && this.gpuBehind()
    if (!this.lost) {
      this.syncCamera()
      if (!skipped) {
        this.renderer.render(this.scene, this.camera)
        this.fenceFrame()
      }
      if (!this.firstRendered) {
        this.firstRendered = true
        this.stageBuilt()
      }
    }
    if (!skipped) for (const old of this.retired.splice(0)) disposeTree(old, this.shared)
    this.report(animating)
    if (moving) this.requestFrame()
  }

  private fenceFrame(): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext
    if (this.fence !== null) gl.deleteSync(this.fence)
    this.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
    gl.flush()
  }

  private gpuBehind(): boolean {
    if (this.fence === null) return false
    const gl = this.renderer.getContext() as WebGL2RenderingContext
    if (gl.getSyncParameter(this.fence, gl.SYNC_STATUS) !== gl.SIGNALED) return true
    gl.deleteSync(this.fence)
    this.fence = null
    return false
  }

  private advanceSlide(now: number): boolean {
    if (this.slide === null) return false
    const left = 1 - this.slide.step.eased(now)
    this.slide.group.position.set(-this.slide.dx * left, 0, -this.slide.dz * left)
    if (this.slide.step.done(now)) this.slide = null
    return this.slide !== null
  }

  private advanceInset(now: number): boolean {
    const slide = this.insetSlide
    if (slide === null) return false
    this.insetRight = slide.from + (slide.to - slide.from) * slide.step.eased(now)
    this.fitDistance()
    if (slide.step.done(now)) this.insetSlide = null
    return true
  }

  private syncCamera(): void {
    const layout = this.layout
    const centre = layout?.center ?? { x_mm: 0, y_mm: 0 }
    const target = new Vector3(worldX(centre.x_mm + this.view.panX), TABLE_Y, worldZ(centre.y_mm + this.view.panY))
    const heading = (this.view.heading * Math.PI) / 180
    const pitch = (PITCH_DEG * Math.PI) / 180
    const distance = this.distance()
    this.camera.position.set(
      target.x - Math.sin(heading) * distance * Math.cos(pitch),
      TABLE_Y + distance * Math.sin(pitch),
      target.z + Math.cos(heading) * distance * Math.cos(pitch),
    )
    this.camera.lookAt(target)
    this.camera.setViewOffset(this.width, this.height, this.insetRight / 2, 0, this.width, this.height)
    this.camera.near = Math.max(distance * 0.05, 0.3)
    this.camera.far = distance * 6 + 200
    this.camera.updateProjectionMatrix()
    this.camera.updateMatrixWorld()
  }

  private report(animating: boolean): void {
    const rect = this.host.getBoundingClientRect()
    const points: Record<number, [number, number]> = {}
    const layout = this.layout
    if (layout !== null) {
      for (const number of layout.pathsByNumber.keys()) {
        const mid = blockMidPoint(layout, number)
        if (mid === null) continue
        const p = new Vector3(mid.x, mid.y, mid.z).project(this.camera)
        points[number] = [Math.round(rect.left + (p.x * 0.5 + 0.5) * rect.width), Math.round(rect.top + (-p.y * 0.5 + 0.5) * rect.height)]
      }
    }
    const report: StageReport = {
      heading: this.view.reportedHeading(),
      zoom: Math.round(this.view.zoom * 1000) / 1000,
      pan: [Math.round(this.view.panX * 10) / 10, Math.round(this.view.panY * 10) / 10],
      animating,
      block_points: points,
    }
    const key = JSON.stringify(report)
    if (key === this.lastReport) return
    this.lastReport = key
    this.callbacks.onReport(report)
  }
}


export function createWebglStage(host: HTMLElement, callbacks: StageCallbacks): StageController | null {
  const probe = document.createElement('canvas')
  const context = probe.getContext('webgl2') ?? probe.getContext('webgl')
  if (context === null) return null
  context.getExtension('WEBGL_lose_context')?.loseContext()
  return new WebglStage(host, callbacks, new WebGLRenderer({ antialias: true }))
}
