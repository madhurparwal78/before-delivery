/** The score of a photo: decided here and nowhere else (brief: Score). */
import { frameOffsets, inFrame } from '../shared/frame'
import { OPPOSITE, type Heading, type Tile } from '../shared/island'
import type { Measures, Score, WorldCreature } from '../shared/types'

interface ScoredPose { tile: Tile; heading: Heading; zoom: number; focus: number }

/** The most each score row can earn; the four rows total 100. */
export const MAX_SIZE = 30
export const MAX_CENTRING = 25
export const MAX_FACING = 25

interface Scored { creature: WorldCreature; score: Score; measures: Measures }

/** The subject is the in-frame creature with the smallest forward distance; null when nothing is in frame. */
export function scorePhoto(pose: ScoredPose, present: readonly WorldCreature[]): Scored | null {
  const subject = inFrame(pose.tile, pose.heading, pose.zoom, present)[0]
  if (!subject) return null
  const creature = present.find((c) => c.id === subject.id) as WorldCreature
  const { a, l } = frameOffsets(pose.tile, pose.heading, [creature.x, creature.y])
  const bestDistance = 2 * pose.zoom * creature.size
  const size = Math.max(0, MAX_SIZE - 10 * Math.abs(a - bestDistance))
  const centring = Math.max(0, MAX_CENTRING - 10 * Math.abs(l) * pose.zoom)
  const creatureFacing: Measures['creature_facing'] = creature.heading === OPPOSITE[pose.heading] ? 'toward' : creature.heading === pose.heading ? 'away' : 'side'
  const facing = { toward: MAX_FACING, side: 15, away: 0 }[creatureFacing]
  const sharpness = Math.max(0, 20 - 5 * Math.abs(pose.focus - a))
  return {
    creature,
    score: { size, centring, facing, sharpness, total: size + centring + facing + sharpness },
    measures: { distance: a, best_distance: bestDistance, offset: Math.abs(l), focus_error: Math.abs(pose.focus - a), creature_facing: creatureFacing },
  }
}
