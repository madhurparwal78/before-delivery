import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, type BufferGeometry, type Material } from 'three'
import { COLORS, DURATION, STOCK_LIFT, worldX, worldY, worldZ } from './constants'
import { Step } from './easing'
import type { SceneTrain } from './contract'
import { trailPosition, type LayoutView } from './layout-view'

// Invented low-poly freight stock: a locomotive and wagons laid back along the committed trail.

interface Pose { x: number; y: number; z: number; yaw: number }

const ENGINE_COLOURS = [COLORS.accentDeep, COLORS.pink, COLORS.violet, '#12A7A0']
const WAGON_COLOURS = ['#FFD23F', '#FFFFFF', COLORS.accent, '#FF7A59']
const CHASSIS = new MeshLambertMaterial({ color: '#3A4160' })
const ROOF = new MeshLambertMaterial({ color: '#4A5270' })
const LAMP = new MeshBasicMaterial({ color: '#FFF3B0' })
const HALO = new MeshBasicMaterial({ color: COLORS.accent })
const LOAD = new MeshLambertMaterial({ color: COLORS.ink })
const WHEEL = new CylinderGeometry(0.05, 0.05, 0.03, 10).rotateX(Math.PI / 2)

function turnToward(from: number, to: number, t: number): number {
  let delta = to - from
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  return from + delta * t
}

function carCount(lengthMm: number): number {
  return Math.max(1, Math.min(8, Math.round(lengthMm / 400)))
}

class TrainModel {
  readonly group = new Group()
  readonly cars: Group[] = []
  readonly halos: Mesh[] = []
  private from: Pose[] = []
  private to: Pose[] = []
  private glide: Step | null = null

  constructor(readonly number: string, readonly lengthMm: number, index: number) {
    const count = carCount(lengthMm)
    const carLength = lengthMm / 1000 / count
    for (let i = 0; i < count; i += 1) {
      const car = new Group()
      const colour = new MeshLambertMaterial({ color: i === 0 ? ENGINE_COLOURS[index % ENGINE_COLOURS.length] : WAGON_COLOURS[(index + i) % WAGON_COLOURS.length] })
      const add = (geometry: BufferGeometry, material: Material, x: number, y: number, z = 0): void => {
        const mesh = new Mesh(geometry, material)
        mesh.position.set(x, y, z)
        mesh.userData = { kind: 'train', number }
        car.add(mesh)
      }
      for (const axle of [-0.3, 0.3]) for (const side of [-1, 1]) add(WHEEL, CHASSIS, axle * carLength, 0.045, side * 0.07)
      // An engine's frame narrows under the hood: at a throat two noses stand closer than a car is wide.
      if (i === 0) {
        add(new BoxGeometry(carLength * 0.45, 0.05, 0.19), CHASSIS, -carLength * 0.225, 0.1)
        add(new BoxGeometry(carLength * 0.45, 0.05, 0.12), CHASSIS, carLength * 0.225, 0.1)
      } else {
        add(new BoxGeometry(carLength * 0.9, 0.05, 0.19), CHASSIS, 0, 0.1)
      }
      add(new BoxGeometry(carLength * 0.12, 0.03, 0.05), CHASSIS, carLength * 0.47, 0.09)
      add(new BoxGeometry(carLength * 0.12, 0.03, 0.05), CHASSIS, -carLength * 0.47, 0.09)
      if (i === 0) {
        add(new BoxGeometry(carLength * 0.52, 0.17, 0.12), colour, carLength * 0.16, 0.21)
        add(new BoxGeometry(carLength * 0.3, 0.25, 0.2), colour, -carLength * 0.27, 0.245)
        add(new BoxGeometry(carLength * 0.34, 0.025, 0.23), ROOF, -carLength * 0.27, 0.38)
        add(new BoxGeometry(0.05, 0.1, 0.05), CHASSIS, carLength * 0.28, 0.33)
        add(new BoxGeometry(0.03, 0.05, 0.08), LAMP, carLength * 0.43, 0.21)
      } else if (i % 2 === 0) {
        add(new BoxGeometry(carLength * 0.82, 0.14, 0.2), colour, 0, 0.19)
        add(new BoxGeometry(carLength * 0.7, 0.03, 0.15), LOAD, 0, 0.27)
      } else {
        add(new BoxGeometry(carLength * 0.82, 0.18, 0.2), colour, 0, 0.215)
        add(new BoxGeometry(carLength * 0.86, 0.02, 0.22), ROOF, 0, 0.315)
      }
      const halo = new Mesh(new BoxGeometry(carLength * 1.04, 0.01, 0.4), HALO)
      halo.position.y = 0.003
      halo.visible = false
      halo.userData = { kind: 'train', number }
      car.add(halo)
      this.halos.push(halo)
      this.cars.push(car)
      this.group.add(car)
    }
  }

  get gliding(): boolean {
    return this.glide !== null
  }

  retarget(poses: Pose[], cut: boolean): void {
    const changed = this.to.length !== poses.length || poses.some((p, i) => p.x !== this.to[i].x || p.z !== this.to[i].z || p.yaw !== this.to[i].yaw)
    if (!changed) return
    const first = this.to.length === 0
    this.from = first ? poses : this.cars.map(car => ({ x: car.position.x, y: car.position.y, z: car.position.z, yaw: car.rotation.y }))
    this.to = poses
    this.glide = first || cut ? null : new Step(DURATION.glide)
    if (this.glide === null) this.apply(1)
  }

  advance(now: number): void {
    if (this.glide === null) return
    const t = this.glide.eased(now)
    this.apply(t)
    if (this.glide.done(now)) this.glide = null
  }

  private apply(t: number): void {
    this.cars.forEach((car, i) => {
      const a = this.from[i]
      const b = this.to[i]
      car.position.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t)
      car.rotation.y = turnToward(a.yaw, b.yaw, t)
    })
  }
}

export class Stock {
  readonly group = new Group()
  private readonly models = new Map<string, TrainModel>()

  sync(view: LayoutView, trains: SceneTrain[], cut: boolean): void {
    const wanted = new Set(trains.map(train => train.id))
    for (const [id, model] of this.models) {
      if (!wanted.has(id)) {
        this.group.remove(model.group)
        this.models.delete(id)
      }
    }
    trains.forEach((train, index) => {
      let model = this.models.get(train.id)
      if (model === undefined || model.lengthMm !== train.length_mm) {
        if (model !== undefined) this.group.remove(model.group)
        model = new TrainModel(train.number, train.length_mm, index)
        this.models.set(train.id, model)
        this.group.add(model.group)
      }
      const count = model.cars.length
      const carMm = train.length_mm / count
      const poses: Pose[] = []
      for (let i = 0; i < count; i += 1) {
        const back = carMm * (i + 0.5)
        const centre = trailPosition(view, train, back)
        const front = trailPosition(view, train, Math.max(back - carMm * 0.35, 0))
        const rear = trailPosition(view, train, back + carMm * 0.35)
        if (centre === null || front === null || rear === null) continue
        const dx = worldX(front.x_mm) - worldX(rear.x_mm)
        const dz = worldZ(front.y_mm) - worldZ(rear.y_mm)
        poses.push({ x: worldX(centre.x_mm), y: worldY(centre.elevation_mm) + STOCK_LIFT, z: worldZ(centre.y_mm), yaw: Math.atan2(-dz, dx) })
      }
      if (poses.length === count) model.retarget(poses, cut)
    })
  }

  advance(now: number): boolean {
    let gliding = false
    for (const model of this.models.values()) {
      model.advance(now)
      gliding = gliding || model.gliding
    }
    return gliding
  }

  highlight(number: string | null): void {
    for (const model of this.models.values()) model.halos.forEach(halo => { halo.visible = model.number === number })
  }
}
