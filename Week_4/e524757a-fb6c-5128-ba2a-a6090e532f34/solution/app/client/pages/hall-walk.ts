/** The hall visitor's walk: fixed 100 ms steps counted from ready, on page time (animation frames and `performance.now`).
 *  Every event first runs the steps already due, so a key counts as held for a step exactly when it went down before that
 *  step's moment and came up at or after it, whatever the frame rate. */
import { HEADING_STEP, type Heading, type Tile } from '../../shared/island'
import type { Gait } from '../engine/api'

const STEP_MS = 100
const JUMP_STEPS = 4
const JUMP_REACH = 2

export interface Walk { tile: Tile; heading: Heading; gait: Gait; step: number }

const DIRECTION_KEYS: Record<string, Heading> = {
  w: 'N', arrowup: 'N', a: 'W', arrowleft: 'W', s: 'S', arrowdown: 'S', d: 'E', arrowright: 'E',
}

interface Walker {
  walk: Walk
  /** Runs every step due by `now`. */
  catchUp(now: number): void
  keyDown(key: string, now: number): boolean
  keyUp(key: string, now: number): boolean
  /** Drops every held key (focus left the hall). */
  release(now: number): void
}

export function createWalker(options: { start: Tile; heading: Heading; readyAt: number; isLand(x: number, y: number): boolean; onStep(walk: Walk): void }): Walker {
  const walk: Walk = { tile: options.start, heading: options.heading, gait: 'idle', step: 0 }
  const held: Heading[] = []
  let shift = false
  let run = false
  let jumpPending = false
  let jumpStep = 0
  let streakHeading: Heading | null = null
  let streak = 0

  const ahead = (from: Tile, heading: Heading, by: number): Tile => [from[0] + HEADING_STEP[heading][0] * by, from[1] + HEADING_STEP[heading][1] * by]

  function takeStep(): void {
    walk.step += 1
    if (jumpStep > 0 || jumpPending) {
      jumpPending = false
      jumpStep += 1
      walk.gait = 'jump'
      if (jumpStep === JUMP_STEPS) {
        const landing = ahead(walk.tile, walk.heading, JUMP_REACH)
        if (options.isLand(landing[0], landing[1])) walk.tile = landing
        jumpStep = 0
      }
    } else {
      const heading = held[held.length - 1]
      if (heading === undefined) {
        streakHeading = null
        streak = 0
        walk.gait = 'idle'
      } else {
        if (heading !== streakHeading) { streakHeading = heading; streak = 0 }
        streak += 1
        walk.heading = heading
        const running = run || shift
        walk.gait = running ? 'run' : 'walk'
        if (running || streak % 2 === 1) {
          const next = ahead(walk.tile, heading, 1)
          if (options.isLand(next[0], next[1])) walk.tile = next
        }
      }
    }
    options.onStep(walk)
  }

  const walker: Walker = {
    walk,
    catchUp(now) {
      while (options.readyAt + (walk.step + 1) * STEP_MS <= now) takeStep()
    },
    keyDown(key, now) {
      const name = key.toLowerCase()
      const heading = DIRECTION_KEYS[name]
      if (heading === undefined && name !== 'shift' && name !== 'r' && name !== ' ') return false
      walker.catchUp(now)
      if (heading !== undefined) {
        const at = held.indexOf(heading)
        if (at >= 0) held.splice(at, 1)
        held.push(heading)
      } else if (name === 'shift') shift = true
      else if (name === 'r') run = !run
      else jumpPending = true
      return true
    },
    keyUp(key, now) {
      const name = key.toLowerCase()
      const heading = DIRECTION_KEYS[name]
      if (heading === undefined && name !== 'shift') return false
      walker.catchUp(now)
      if (heading !== undefined) {
        const at = held.indexOf(heading)
        if (at >= 0) held.splice(at, 1)
      } else shift = false
      return true
    },
    release(now) {
      walker.catchUp(now)
      held.length = 0
      shift = false
    },
  }
  return walker
}
