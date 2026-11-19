import type { Direction, LayoutTurnout, RoutePreview } from '../../../shared/domain'
import { rule } from '../../http/errors'
import { blockById, blockStates, trainById, type PinnedBlock, type SessionState, type StoredTrain } from './state'

const MAX_ROUTE_BLOCKS = 8

// East means increasing block number; trains never reverse under an authority.
function blocksAhead(state: SessionState, block: PinnedBlock, direction: Direction): PinnedBlock[] {
  return block.neighbour_ids
    .map(id => state.blocks.find(candidate => candidate.id === id))
    .filter((candidate): candidate is PinnedBlock => candidate !== undefined)
    .filter(candidate => (direction === 'east' ? candidate.number > block.number : candidate.number < block.number))
}

function allPaths(state: SessionState, from: PinnedBlock, to: string, direction: Direction): PinnedBlock[][] {
  const found: PinnedBlock[][] = []
  const walk = (at: PinnedBlock, path: PinnedBlock[]): void => {
    for (const next of blocksAhead(state, at, direction)) {
      const extended = [...path, next]
      if (next.id === to) found.push(extended)
      else walk(next, extended)
    }
  }
  walk(from, [])
  return found
}

function cost(path: PinnedBlock[]): number {
  return path.reduce((sum, block) => sum + block.length_mm, 0)
}

function lowerNumbers(a: PinnedBlock[], b: PinnedBlock[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) if (a[i].number !== b[i].number) return a[i].number - b[i].number
  return a.length - b.length
}

// Shortest road ahead in millimetres, through the via block when given; ties take the lower block numbers.
export function findRoute(state: SessionState, train: StoredTrain, destinationId: string, viaId: string | null): string[] {
  const head = blockById(state, train.head_block_id)
  const destination = blockById(state, destinationId)
  const candidates = allPaths(state, head, destinationId, train.direction)
    .filter(path => viaId === null || path.some(block => block.id === viaId))
    .sort((a, b) => cost(a) - cost(b) || lowerNumbers(a, b))
  if (candidates.length === 0) throw rule('no_route', `There is no road from here to ${destination.name}.`)
  if (candidates[0].length > MAX_ROUTE_BLOCKS) {
    throw rule('route_too_long', 'That road is more than 8 blocks. Choose a nearer destination.')
  }
  return candidates[0].map(block => block.id)
}

interface Crossing { turnout: LayoutTurnout; position: 'normal' | 'reverse'; entering_block_id: string }

// Each turnout the road passes through, with the position it needs, for the pairs head->route[0], route[i]->route[i+1].
export function crossings(state: SessionState, headBlockId: string, route: string[]): Crossing[] {
  const found: Crossing[] = []
  const chain = [headBlockId, ...route]
  for (let i = 0; i < route.length; i += 1) {
    const pair = [chain[i], chain[i + 1]]
    for (const turnout of state.turnout_defs) {
      if (!pair.includes(turnout.stem_block_id)) continue
      if (pair.includes(turnout.normal_block_id)) found.push({ turnout, position: 'normal', entering_block_id: chain[i + 1] })
      if (pair.includes(turnout.reverse_block_id)) found.push({ turnout, position: 'reverse', entering_block_id: chain[i + 1] })
    }
  }
  return found
}

export interface RouteBlocker {
  block_id: string
  // The train that holds the block, or none when the block is out of service.
  other_train_number: string | null
}

// The first block, in route order, that is not free or whose turnout is locked the other way.
export function firstBlocker(state: SessionState, train: StoredTrain, route: string[]): RouteBlocker | null {
  const states = new Map(blockStates(state).map(block => [block.id, block]))
  const crossed = crossings(state, train.head_block_id, route)
  const trainOf = (authorityId: string | null): string | null => {
    const authority = state.authorities.find(candidate => candidate.id === authorityId)
    return authority === undefined ? null : trainById(state, authority.train_id)?.number ?? null
  }
  for (const blockId of route) {
    const block = states.get(blockId)
    if (block === undefined) continue
    if (block.state === 'out_of_service') return { block_id: blockId, other_train_number: null }
    if (block.state === 'occupied') return { block_id: blockId, other_train_number: block.train_number }
    if (block.state === 'reserved') return { block_id: blockId, other_train_number: trainOf(block.authority_id) }
    for (const crossing of crossed.filter(item => item.entering_block_id === blockId)) {
      const turnout = state.turnouts.find(candidate => candidate.id === crossing.turnout.id)
      if (turnout?.locked_by_authority_id != null && turnout.position !== crossing.position) {
        return { block_id: blockId, other_train_number: trainOf(turnout.locked_by_authority_id) }
      }
    }
  }
  return null
}

export function previewRoute(state: SessionState, train: StoredTrain, destinationId: string, viaId: string | null): RoutePreview {
  const route = findRoute(state, train, destinationId, viaId)
  const blocker = firstBlocker(state, train, route)
  return {
    route_block_ids: route,
    limit_block_id: route[route.length - 1],
    clear: blocker === null,
    conflict_block_id: blocker?.block_id ?? null,
    other_train_number: blocker?.other_train_number ?? null,
  }
}
