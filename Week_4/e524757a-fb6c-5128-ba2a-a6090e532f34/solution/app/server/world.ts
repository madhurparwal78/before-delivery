/** The world clock, the weather and the creature routes: all decided on the server. */
import { config } from './config'
import { type Db, one, rows } from './db'
import { CREATURES, type CreatureDef, type Heading } from '../shared/island'
import type { World, WorldCreature, WorldEvent } from '../shared/types'

interface WorldClock { id: string; tick: number }

const NOW_MS = '(extract(epoch from clock_timestamp()) * 1000)::bigint'

interface ClockRow { id: string; frozen: boolean; tick: number; anchor_tick: number; anchor_ms: number; now_ms: number }

function tickOf(row: ClockRow): number {
  return row.frozen ? row.tick : row.anchor_tick + Math.floor((row.now_ms - row.anchor_ms) / config.worldTickMs)
}

/** The current tick of every listed world. */
export async function readClocks(db: Db, ids: readonly string[]): Promise<WorldClock[]> {
  const found = await rows<ClockRow>(db, `SELECT id, frozen, tick, anchor_tick, anchor_ms, ${NOW_MS} AS now_ms FROM worlds WHERE id = ANY($1)`, [ids])
  return found.map((row) => ({ id: row.id, tick: tickOf(row) }))
}

export async function readTick(db: Db, worldId: string): Promise<number> {
  const row = await one<ClockRow>(db, `SELECT id, frozen, tick, anchor_tick, anchor_ms, ${NOW_MS} AS now_ms FROM worlds WHERE id = $1`, [worldId])
  return tickOf(row as ClockRow)
}

function hourOf(tick: number): number {
  return Math.floor(((tick % config.worldDayTicks) * 24) / config.worldDayTicks)
}

function minuteOf(tick: number): number {
  const hourTicks = config.worldDayTicks / 24
  return Math.floor(((tick % hourTicks) * 60) / hourTicks)
}

const isDusk = (hour: number): boolean => hour >= config.duskStartHour && hour < config.duskEndHour
const isRaining = (hour: number): boolean => hour >= config.rainStartHour && hour < config.rainEndHour

const HEADING_TOWARD: Record<string, Heading> = { '1,0': 'E', '-1,0': 'W', '0,1': 'S', '0,-1': 'N' }

/** The route rule: a patrol from A to B covers L tiles at p ticks per tile (brief: Route rule). */
function placeOf(creature: CreatureDef, tick: number): { x: number; y: number; heading: Heading } {
  if ('stay' in creature.route) {
    const { at, heading } = creature.route.stay
    return { x: at[0], y: at[1], heading }
  }
  const { from, to, ticksPerTile } = creature.route.patrol
  const length = Math.abs(to[0] - from[0]) + Math.abs(to[1] - from[1])
  const step: readonly [number, number] = [Math.sign(to[0] - from[0]), Math.sign(to[1] - from[1])]
  const k = Math.floor(tick / ticksPerTile) % (2 * length)
  if (k < length) return { x: from[0] + step[0] * k, y: from[1] + step[1] * k, heading: HEADING_TOWARD[`${step[0]},${step[1]}`] as Heading }
  const back = k - length
  return { x: to[0] - step[0] * back, y: to[1] - step[1] * back, heading: HEADING_TOWARD[`${-step[0]},${-step[1]}`] as Heading }
}

export function creaturesAt(tick: number): WorldCreature[] {
  const hour = hourOf(tick)
  return CREATURES.filter((creature) => creature.present === 'always' || (creature.present === 'dusk only' ? isDusk(hour) : isRaining(hour)))
    .map((creature) => ({ id: creature.id, name: creature.name, island: creature.island, size: creature.size, ...placeOf(creature, tick) }))
    .sort((p, q) => (p.id < q.id ? -1 : 1))
}

export function worldEvent(tick: number): WorldEvent {
  const hour = hourOf(tick)
  const minute = minuteOf(tick)
  return {
    tick,
    hour,
    minute,
    time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    weather: isRaining(hour) ? 'rain' : 'clear',
    dusk: isDusk(hour),
    creatures: creaturesAt(tick),
  }
}

export function worldAnswer(worldId: string, tick: number, lighthouse: World['lighthouse']): World {
  return { world: worldId, ...worldEvent(tick), lighthouse }
}
