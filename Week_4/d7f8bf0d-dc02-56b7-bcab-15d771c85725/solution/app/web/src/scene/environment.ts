import {
  AmbientLight, BoxGeometry, Color, ConeGeometry, DirectionalLight, DoubleSide, Group, HemisphereLight, Mesh,
  MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry, SphereGeometry, type Scene,
} from 'three'
import { COLORS, DURATION } from './constants'
import { Step } from './easing'
import { floorTexture, hallTexture } from './textures'

const PIGEON_Y = 5
const FLOOR_SIZE = 600
const FLOOR_TILE = 2
const WALL_HEIGHT = 30
const WALL_MARGIN = 3.6
const BAY = 3.2
// Each wall runs on past the corners, behind the wall it meets, so no free wall end shows when the camera stands outside the hall.
const WALL_RUN = 40

interface HallBounds { minX: number; maxX: number; minZ: number; maxZ: number }

// The club hall: a field-green floor and four pale gradient walls drawn inside only, so whichever wall stands between
// the camera and the layout disappears and the far ones fill the top of the view. The walls close in on the layout;
// their columns are painted on, one per repeat of the texture, so they go with their wall.
export class Hall {
  private readonly walls: Mesh[]

  constructor(scene: Scene) {
    scene.background = new Color(COLORS.hall)
    const floor = floorTexture()
    floor.repeat.set(FLOOR_SIZE / FLOOR_TILE, FLOOR_SIZE / FLOOR_TILE)
    const ground = new Mesh(new PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE), new MeshBasicMaterial({ map: floor }))
    ground.rotation.x = -Math.PI / 2
    const shell = new MeshBasicMaterial({ map: hallTexture() })
    this.walls = [0, Math.PI, Math.PI / 2, -Math.PI / 2].map(turn => {
      const wall = new Mesh(new PlaneGeometry(1, WALL_HEIGHT), shell)
      wall.rotation.y = turn
      return wall
    })
    scene.add(ground, ...this.walls)
    scene.add(new AmbientLight('#FFFFFF', 0.55))
    scene.add(new HemisphereLight('#FFFFFF', '#CFD8EE', 0.75))
    const sun = new DirectionalLight('#FFFFFF', 1.05)
    sun.position.set(-6, 14, 9)
    scene.add(sun)
  }

  fit(bounds: HallBounds): void {
    const west = bounds.minX - WALL_MARGIN
    const east = bounds.maxX + WALL_MARGIN
    const north = bounds.minZ - WALL_MARGIN
    const south = bounds.maxZ + WALL_MARGIN
    const middleX = (west + east) / 2
    const middleZ = (north + south) / 2
    const across = east - west + 2 * WALL_RUN
    const along = south - north + 2 * WALL_RUN
    const places: Array<[number, number, number]> = [[middleX, north, across], [middleX, south, across], [west, middleZ, along], [east, middleZ, along]]
    this.walls.forEach((wall, i) => {
      const [x, z, width] = places[i]
      wall.position.set(x, WALL_HEIGHT / 2, z)
      wall.scale.x = width
      const uv = wall.geometry.getAttribute('uv')
      for (let vertex = 0; vertex < uv.count; vertex += 1) uv.setX(vertex, vertex % 2 === 0 ? 0 : Math.round(width / BAY))
      uv.needsUpdate = true
    })
  }
}

// One pigeon crosses under the roof once per stage load, about 3 seconds, then is removed.
export class Pigeon {
  private readonly group = new Group()
  private step: Step | null = new Step(DURATION.pigeon)
  private readonly wings: Mesh[] = []

  constructor(private readonly scene: Scene, private readonly fromX: number, private readonly toX: number, z: number) {
    const grey = new MeshLambertMaterial({ color: '#8E98B5' })
    const pale = new MeshLambertMaterial({ color: '#C9D1E4' })
    const beak = new MeshLambertMaterial({ color: COLORS.action })
    const body = new Mesh(new SphereGeometry(0.2, 8, 6), grey)
    body.scale.set(1.5, 0.8, 0.8)
    const head = new Mesh(new SphereGeometry(0.11, 8, 6), pale)
    head.position.set(0.3, 0.1, 0)
    const tip = new Mesh(new ConeGeometry(0.04, 0.1, 5), beak)
    tip.rotation.z = -Math.PI / 2
    tip.position.set(0.42, 0.09, 0)
    const tail = new Mesh(new BoxGeometry(0.28, 0.02, 0.16), grey)
    tail.position.set(-0.4, 0, 0)
    this.group.add(body, head, tip, tail)
    for (const side of [-1, 1]) {
      const wing = new Mesh(new BoxGeometry(0.26, 0.015, 0.4), new MeshLambertMaterial({ color: '#A6B0CC', side: DoubleSide }))
      wing.position.set(-0.02, 0.06, side * 0.26)
      this.wings.push(wing)
      this.group.add(wing)
    }
    this.group.scale.setScalar(0.6)
    this.group.position.set(fromX, PIGEON_Y, z)
    scene.add(this.group)
  }

  get active(): boolean {
    return this.step !== null
  }

  advance(now: number): void {
    if (this.step === null) return
    const t = this.step.eased(now)
    this.group.position.x = this.fromX + (this.toX - this.fromX) * t
    this.group.position.y = PIGEON_Y + Math.sin(t * Math.PI * 2) * 0.25
    const flap = Math.sin(t * Math.PI * 12) * 0.5
    this.wings.forEach((wing, i) => { wing.rotation.x = (i === 0 ? 1 : -1) * flap })
    if (t >= 1) this.remove()
  }

  remove(): void {
    this.step = null
    this.scene.remove(this.group)
    this.group.traverse(child => {
      if (child instanceof Mesh) {
        child.geometry.dispose()
        ;(child.material as MeshLambertMaterial).dispose()
      }
    })
  }
}
