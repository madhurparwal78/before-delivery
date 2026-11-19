import { type Heading, type Tile } from './island'

/** Forward distance `a` and lateral offset `l` of a creature from an explorer on `tile` facing `heading` (brief: Frame rule). */
export function frameOffsets(tile: Tile, heading: Heading, creature: Tile): { a: number; l: number } {
  const [ex, ey] = tile
  const [cx, cy] = creature
  switch (heading) {
    case 'N': return { a: ey - cy, l: cx - ex }
    case 'E': return { a: cx - ex, l: cy - ey }
    case 'S': return { a: cy - ey, l: ex - cx }
    case 'W': return { a: ex - cx, l: ey - cy }
  }
}

interface Subject { id: string; a: number; l: number }

interface Placed { id: string; x: number; y: number }

/** Every creature in frame at `zoom`, nearest first, ties by smaller lateral offset, then lower id (brief: Frame rule). */
export function inFrame(tile: Tile, heading: Heading, zoom: number, creatures: readonly Placed[]): Subject[] {
  const found: Subject[] = []
  for (const creature of creatures) {
    const { a, l } = frameOffsets(tile, heading, [creature.x, creature.y])
    if (a >= 1 && a <= 24 && 2 * zoom * Math.abs(l) <= a) found.push({ id: creature.id, a, l })
  }
  return found.sort((p, q) => p.a - q.a || Math.abs(p.l) - Math.abs(q.l) || (p.id < q.id ? -1 : 1))
}
