/** The explorer's simulation: fixed steps of 100 ms of page time counted from when the World view became ready.
 *  A late frame runs every step it owes, in order. A key counts as held for a step when it went down before the
 *  step's own moment and came up at or after it, so holding for N x 100 ms always gives N held steps. */
import { HEADINGS, HEADING_STEP, isLand, type Heading, type Island, type Tile } from '../../../shared/island'
import type { Gait } from '../../engine/api'

const STEP_MS = 100
const JUMP_STEPS = 4

interface Hold { id: string; heading: Heading | null; down: number; up: number | null }

export interface Snapshot { tile: Tile; heading: Heading; gait: Gait; jumpStep: number }

interface SimHooks {
  /** Called after every simulated step. */
  onStep(step: number, snapshot: Snapshot): void
  /** Called whenever the explorer ends a step on another tile. */
  onTileChange(tile: Tile, heading: Heading): void
}

/** The shortest 4-direction path over land; among equal paths each tile takes the first of north, east, south, west
 *  that still lies on a shortest path. Null when there is none; empty when already there. */
export function shortestPath(island: Island, from: Tile, to: Tile): Tile[] | null {
  if (!isLand(island, to[0], to[1])) return null
  const key = (x: number, y: number): number => y * 24 + x
  const distance = new Map<number, number>([[key(to[0], to[1]), 0]])
  const queue: Tile[] = [to]
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i] as Tile
    const here = distance.get(key(x, y)) as number
    for (const heading of HEADINGS) {
      const [dx, dy] = HEADING_STEP[heading]
      const nx = x + dx
      const ny = y + dy
      if (isLand(island, nx, ny) && !distance.has(key(nx, ny))) {
        distance.set(key(nx, ny), here + 1)
        queue.push([nx, ny])
      }
    }
  }
  let left = distance.get(key(from[0], from[1]))
  if (left === undefined) return null
  const path: Tile[] = []
  let [x, y] = from
  while (left > 0) {
    const next = HEADINGS.map((heading) => [x + HEADING_STEP[heading][0], y + HEADING_STEP[heading][1]] as const)
      .find(([nx, ny]) => distance.get(key(nx, ny)) === (left as number) - 1) as readonly [number, number]
    ;[x, y] = next
    path.push([x, y])
    left--
  }
  return path
}

export class Simulation {
  step = 0
  tile: Tile
  heading: Heading
  gait: Gait = 'idle'
  jumpStep = 0
  /** Photo mode: the explorer stands still (turning is the page's business). */
  frozen = false
  runToggle = false
  private startedAt = 0
  private holds: Hold[] = []
  private heldCount = 0
  private heldHeading: Heading | null = null
  private jumpPending = false
  private path: Tile[] | null = null
  private pathCount = 0

  constructor(private island: Island, tile: Tile, heading: Heading, private hooks: SimHooks) {
    this.tile = tile
    this.heading = heading
  }

  start(now: number): void {
    this.startedAt = now
  }

  /** Move to another island (or tile) at once, cancelling anything in progress. */
  place(island: Island, tile: Tile, heading: Heading): void {
    this.island = island
    this.tile = tile
    this.heading = heading
    this.path = null
    this.jumpStep = 0
    this.jumpPending = false
    this.gait = 'idle'
    this.heldCount = 0
    this.heldHeading = null
  }

  snapshot(): Snapshot {
    return { tile: this.tile, heading: this.heading, gait: this.gait, jumpStep: this.jumpStep }
  }

  /** Run every step owed up to `now`. */
  catchUp(now: number): void {
    while (this.startedAt + (this.step + 1) * STEP_MS <= now) this.runStep(this.startedAt + (this.step + 1) * STEP_MS)
  }

  press(id: string, heading: Heading | null, now: number): void {
    this.catchUp(now)
    if (this.holds.some((hold) => hold.id === id && hold.up === null)) return
    this.holds.push({ id, heading, down: now, up: null })
  }

  release(id: string, now: number): void {
    this.catchUp(now)
    for (const hold of this.holds) if (hold.id === id && hold.up === null) hold.up = now
  }

  releaseAll(now: number): void {
    this.catchUp(now)
    for (const hold of this.holds) if (hold.up === null) hold.up = now
  }

  requestJump(now: number): void {
    this.catchUp(now)
    this.jumpPending = true
  }

  toggleRun(now: number): boolean {
    this.catchUp(now)
    this.runToggle = !this.runToggle
    return this.runToggle
  }

  walkPath(path: Tile[], now: number): void {
    this.catchUp(now)
    this.path = path
    this.pathCount = 0
  }

  cancelPath(): void {
    this.path = null
  }

  get walking(): boolean {
    return this.path !== null
  }

  private heldAt(moment: number, shift: boolean): Hold | undefined {
    let found: Hold | undefined
    for (const hold of this.holds) {
      if ((hold.heading === null) !== shift || !(hold.down < moment && (hold.up === null || hold.up >= moment))) continue
      if (!found || hold.down >= found.down) found = hold
    }
    return found
  }

  private moveTo(tile: Tile): void {
    this.tile = tile
    this.hooks.onTileChange(tile, this.heading)
  }

  private ahead(tile: Tile, heading: Heading, distance: number): Tile {
    const [dx, dy] = HEADING_STEP[heading]
    return [tile[0] + dx * distance, tile[1] + dy * distance]
  }

  private runStep(moment: number): void {
    this.step++
    this.holds = this.holds.filter((hold) => hold.up === null || hold.up >= moment)
    const running = this.runToggle || this.heldAt(moment, true) !== undefined
    const held = this.frozen ? undefined : this.heldAt(moment, false)?.heading ?? undefined

    if (this.jumpStep > 0 || this.jumpPending) {
      this.heldCount = 0
      this.heldHeading = null
      this.path = null
      this.jumpPending = false
      this.jumpStep++
      this.gait = 'jump'
      if (this.jumpStep === JUMP_STEPS) {
        const target = this.ahead(this.tile, this.heading, 2)
        if (isLand(this.island, target[0], target[1])) this.moveTo(target)
      }
      this.hooks.onStep(this.step, this.snapshot())
      if (this.jumpStep === JUMP_STEPS) this.jumpStep = 0
      return
    }

    if (held) {
      this.path = null
      this.heldCount = held === this.heldHeading ? this.heldCount + 1 : 1
      this.heldHeading = held
      this.heading = held
      this.gait = running ? 'run' : 'walk'
      if (running || this.heldCount % 2 === 1) {
        const target = this.ahead(this.tile, held, 1)
        if (isLand(this.island, target[0], target[1])) this.moveTo(target)
      }
    } else {
      this.heldCount = 0
      this.heldHeading = null
      if (this.path && !this.frozen) {
        this.pathCount++
        this.gait = running ? 'run' : 'walk'
        if (running || this.pathCount % 2 === 1) {
          const next = this.path.shift() as Tile
          this.heading = this.headingTo(this.tile, next)
          this.moveTo(next)
          if (this.path.length === 0) this.path = null
        }
      } else {
        this.gait = 'idle'
      }
    }
    this.hooks.onStep(this.step, this.snapshot())
  }

  private headingTo(from: Tile, to: Tile): Heading {
    return HEADINGS.find((heading) => HEADING_STEP[heading][0] === to[0] - from[0] && HEADING_STEP[heading][1] === to[1] - from[1]) as Heading
  }
}
