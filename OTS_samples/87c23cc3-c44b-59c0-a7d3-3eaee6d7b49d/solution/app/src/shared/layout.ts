import {
  CELLS_PER_ROW,
  CELL_DX,
  CELL_DY,
  DEFAULT_ENTITY_COLOR,
  DEFAULT_GROUP_COLOR,
  GRID_MAX,
  type EntityLayout,
  type Layout,
} from './domain.ts'
import type { Model } from './mortise.ts'

function cellPosition(k: number): { x: number; y: number } {
  return { x: CELL_DX * (k % CELLS_PER_ROW), y: Math.min(GRID_MAX, CELL_DY * Math.floor(k / CELLS_PER_ROW)) }
}

/** Keeps the layout of the entities and groups the parse still holds and places new entities in the next free cells. */
export function reconcileLayout(layout: Layout, model: Model): Layout {
  const entities: Record<string, EntityLayout> = {}
  const occupied = new Set<string>()
  for (const entity of model.entities) {
    const known = layout.entities[entity.name]
    if (known) {
      entities[entity.name] = { ...known }
      occupied.add(`${known.x},${known.y}`)
    }
  }
  let cell = 0
  for (const entity of model.entities) {
    if (entities[entity.name]) continue
    let spot = cellPosition(cell)
    while (occupied.has(`${spot.x},${spot.y}`)) spot = cellPosition(++cell)
    occupied.add(`${spot.x},${spot.y}`)
    entities[entity.name] = { ...spot, color: DEFAULT_ENTITY_COLOR }
  }
  const groups: Layout['groups'] = {}
  for (const group of model.groups) {
    groups[group.name] = { color: layout.groups[group.name]?.color ?? DEFAULT_GROUP_COLOR }
  }
  return { entities, groups }
}

export function arrangeLayout(layout: Layout, model: Model): Layout {
  const entities: Record<string, EntityLayout> = {}
  model.entities.forEach((entity, k) => {
    entities[entity.name] = { ...cellPosition(k), color: layout.entities[entity.name]?.color ?? DEFAULT_ENTITY_COLOR }
  })
  return { entities, groups: layout.groups }
}
