import type {
  Authority,
  Conflict,
  Deadlock,
  LayoutContent,
  SessionSnapshot,
  SessionBlock,
  SessionTrain,
  SessionTurnout,
} from '../shared/domain';
import { scaleSpeedAdvance } from '../shared/speed';
import { fastClockLabel } from '../shared/scaleUnits';

/**
 * The session engine is the one decision place for occupancy, counters,
 * authorities, conflicts and deadlocks. State is a plain object held in the
 * run_sessions.state column and rewritten on each committed change.
 */

export interface SessionState {
  trains: SessionTrain[];
  blocks: SessionBlock[];
  turnouts: SessionTurnout[];
  authorities: Authority[];
  conflicts: Conflict[];
  deadlocks: Deadlock[];
  timetable_progress: { entry_id: string; arrived_fast_seconds: number | null }[];
  counters: SessionSnapshot['counters'];
}

export function buildSessionState(
  sessionId: string,
  layoutVersionId: string,
  layoutVersionNumber: number,
  timetableVersion: number,
  content: LayoutContent,
  ratio: number,
): SessionState {
  const trains: SessionTrain[] = content.trains.map((t) => {
    const block = content.blocks.find((b) => b.id === t.start_block_id);
    return {
      id: t.id,
      number: t.number,
      name: t.name,
      direction: t.direction,
      speed_mph: t.speed_mph,
      length_mm: t.length_mm,
      start_block_id: t.start_block_id,
      start_head_offset_mm: t.head_offset_mm,
      head_block_id: t.start_block_id,
      head_offset_mm: t.head_offset_mm,
      trail_block_ids: [t.start_block_id],
      occupied_block_ids: [t.start_block_id],
      distance_run_mm: 0,
      carry: 0,
      authority_id: null,
      revision: 1,
    };
  });
  const blocks: SessionBlock[] = content.blocks.map((b) => ({
    id: b.id,
    number: b.number,
    name: b.name,
    kind: b.kind,
    length_mm: b.length_mm,
    state: 'free',
    train_number: null,
    authority_id: null,
  }));
  const turnouts: SessionTurnout[] = content.turnouts.map((t) => ({
    id: t.id,
    position: 'normal',
    locked_by_authority_id: null,
  }));
  const timetable_progress = content.timetable.entries.map((e) => ({
    entry_id: e.id,
    arrived_fast_seconds: null,
  }));
  const state: SessionState = {
    trains,
    blocks,
    turnouts,
    authorities: [],
    conflicts: [],
    deadlocks: [],
    timetable_progress,
    counters: { occupied_blocks: 0, reserved_blocks: 0, free_blocks: 0, trains: trains.length, open_conflicts: 0 },
  };
  deriveOccupancy(state);
  recount(state);
  return state;
}

/** Occupancy derived only from each train's committed head position, length and trail. */
export function deriveOccupancy(state: SessionState): void {
  const blockById = new Map(state.blocks.map((b) => [b.id, b]));
  for (const b of state.blocks) {
    if (b.state !== 'out_of_service') {
      b.state = 'free';
      b.train_number = null;
    }
  }
  for (const train of state.trains) {
    const trail = trailOf(train, state);
    train.occupied_block_ids = trail;
    for (const blockId of trail) {
      const b = blockById.get(blockId);
      if (b && b.state !== 'out_of_service') {
        b.state = 'occupied';
        b.train_number = train.number;
      }
    }
  }
  for (const a of state.authorities) {
    if (a.state !== 'Granted') continue;
    for (const blockId of a.remaining_block_ids) {
      const b = blockById.get(blockId);
      if (b && b.state === 'free') {
        b.state = 'reserved';
        b.authority_id = a.id;
      }
    }
  }
}

/** Walk back length_mm from the head along the trail; a block is occupied when any part lies in it. */
function trailOf(train: SessionTrain, state: SessionState): string[] {
  const blockById = new Map(state.blocks.map((b) => [b.id, b]));
  const trail: string[] = [train.head_block_id];
  let remaining = train.length_mm;
  let offset = train.head_offset_mm;
  let current = train.head_block_id;
  const guard = new Set<string>([train.head_block_id]);
  while (remaining > 0) {
    const block = blockById.get(current);
    if (!block) break;
    const inBlock = offset;
    if (inBlock >= remaining) break;
    remaining -= inBlock;
    const next = nextBlockBack(current, train, state);
    if (!next || guard.has(next)) break;
    guard.add(next);
    trail.push(next);
    const nb = blockById.get(next);
    if (!nb) break;
    offset = nb.length_mm;
    current = next;
  }
  return trail;
}

/** The block behind the head along the direction of travel. */
function nextBlockBack(blockId: string, train: SessionTrain, state: SessionState): string | null {
  const idx = train.trail_block_ids.indexOf(blockId);
  if (idx < 0) return null;
  const nextIdx = idx + 1;
  if (nextIdx >= train.trail_block_ids.length) return null;
  return train.trail_block_ids[nextIdx] ?? null;
}

export function recount(state: SessionState): void {
  let occupied = 0;
  let reserved = 0;
  let free = 0;
  for (const b of state.blocks) {
    if (b.state === 'out_of_service' || b.state === 'occupied') occupied++;
    else if (b.state === 'reserved') reserved++;
    else free++;
  }
  state.counters = {
    occupied_blocks: occupied,
    reserved_blocks: reserved,
    free_blocks: free,
    trains: state.trains.length,
    open_conflicts: state.conflicts.filter((c) => c.state === 'Open').length,
  };
}

/** Route graph edges: the plain mainline sequence plus the turnout edges. */
export function blockGraph(content: LayoutContent): Map<string, { east: string[]; west: string[] }> {
  const graph = new Map<string, { east: string[]; west: string[] }>();
  for (const b of content.blocks) graph.set(b.id, { east: [], west: [] });
  const link = (from: string, to: string, dir: 'east' | 'west') => {
    const g = graph.get(from);
    if (g && !g[dir].includes(to)) g[dir].push(to);
  };
  const seq = content.block_sequence ?? [];
  for (let i = 0; i < seq.length - 1; i++) {
    const from = seq[i];
    const to = seq[i + 1];
    if (from && to) {
      link(from, to, 'east');
      link(to, from, 'west');
    }
  }
  for (const t of content.turnouts) {
    // A turnout connects its stem with both legs in both directions of travel.
    link(t.stem_block_id, t.normal_block_id, 'east');
    link(t.stem_block_id, t.reverse_block_id, 'east');
    link(t.normal_block_id, t.stem_block_id, 'west');
    link(t.reverse_block_id, t.stem_block_id, 'west');
    link(t.normal_block_id, t.stem_block_id, 'east');
    link(t.reverse_block_id, t.stem_block_id, 'east');
    link(t.stem_block_id, t.normal_block_id, 'west');
    link(t.stem_block_id, t.reverse_block_id, 'west');
  }
  return graph;
}

/** Find the shortest route ahead of a train, in millimetres, honouring via and turnout positions. */
export function findRoute(
  state: SessionState,
  content: LayoutContent,
  trainId: string,
  destinationBlockId: string,
  viaBlockId: string | null,
): { blockIds: string[] | null; conflictBlockId: string | null; otherTrainId: string | null; reason: 'no_route' | 'ok' | 'conflict' | null } {
  const train = state.trains.find((t) => t.id === trainId);
  if (!train) return { blockIds: null, conflictBlockId: null, otherTrainId: null, reason: 'no_route' };
  const graph = blockGraph(content);
  const dir = train.direction;
  const headBlock = state.blocks.find((b) => b.id === train.head_block_id);
  if (!headBlock) return { blockIds: null, conflictBlockId: null, otherTrainId: null, reason: 'no_route' };
  const headNumber = headBlock.number;

  // BFS shortest by millimetres with tie on lower block numbers.
  const best = new Map<string, { dist: number; path: string[] }>();
  const queue: string[] = [];
  const startCandidates = neighboursAhead(graph, train.head_block_id, dir);
  for (const start of startCandidates) {
    best.set(start, { dist: blockLength(state, start), path: [start] });
    queue.push(start);
  }
  while (queue.length > 0) {
    queue.sort((a, b) => {
      const da = best.get(a)?.dist ?? Infinity;
      const db = best.get(b)?.dist ?? Infinity;
      if (da !== db) return da - db;
      return blockNumber(state, a) - blockNumber(state, b);
    });
    const current = queue.shift();
    if (!current) break;
    const cur = best.get(current);
    if (!cur) continue;
    for (const next of neighboursAhead(graph, current, dir)) {
      const nd = cur.dist + blockLength(state, next);
      const prev = best.get(next);
      if (!prev || nd < prev.dist || (nd === prev.dist && blockNumber(state, next) < blockNumber(state, prev.path[prev.path.length - 1] ?? next))) {
        const better = nd < (prev?.dist ?? Infinity);
        if (!prev || better) {
          best.set(next, { dist: nd, path: [...cur.path, next] });
          if (!queue.includes(next)) queue.push(next);
        }
      }
    }
  }

  if (viaBlockId) {
    const toVia = best.get(viaBlockId);
    if (!toVia) return { blockIds: null, conflictBlockId: null, otherTrainId: null, reason: 'no_route' };
    const fromVia = routeFrom(graph, state, viaBlockId, destinationBlockId, dir);
    if (!fromVia) return { blockIds: null, conflictBlockId: null, otherTrainId: null, reason: 'no_route' };
    const path = [...toVia.path, ...fromVia];
    return checkConflicts(state, path);
  }
  const dest = best.get(destinationBlockId);
  if (!dest) return { blockIds: null, conflictBlockId: null, otherTrainId: null, reason: 'no_route' };
  return checkConflicts(state, dest.path);
}

function routeFrom(graph: Map<string, { east: string[]; west: string[] }>, state: SessionState, from: string, to: string, dir: 'east' | 'west'): string[] | null {
  const best = new Map<string, { dist: number; path: string[] }>();
  const queue: string[] = [from];
  best.set(from, { dist: 0, path: [] });
  while (queue.length > 0) {
    queue.sort((a, b) => {
      const da = best.get(a)?.dist ?? Infinity;
      const db = best.get(b)?.dist ?? Infinity;
      if (da !== db) return da - db;
      return blockNumber(state, a) - blockNumber(state, b);
    });
    const current = queue.shift();
    if (!current) break;
    const cur = best.get(current);
    if (!cur) continue;
    for (const next of neighboursAhead(graph, current, dir)) {
      const nd = cur.dist + blockLength(state, next);
      const prev = best.get(next);
      if (!prev || nd < prev.dist) {
        best.set(next, { dist: nd, path: [...cur.path, next] });
        if (!queue.includes(next)) queue.push(next);
      }
    }
  }
  const dest = best.get(to);
  return dest ? dest.path : null;
}

function checkConflicts(state: SessionState, path: string[]): { blockIds: string[] | null; conflictBlockId: string | null; otherTrainId: string | null; reason: 'no_route' | 'ok' | 'conflict' | null } {
  for (const blockId of path) {
    const block = state.blocks.find((b) => b.id === blockId);
    if (!block) return { blockIds: null, conflictBlockId: null, otherTrainId: null, reason: 'no_route' };
    if (block.state !== 'free') {
      const holder = holderOf(state, blockId);
      return { blockIds: path, conflictBlockId: blockId, otherTrainId: holder, reason: 'conflict' };
    }
  }
  return { blockIds: path, conflictBlockId: null, otherTrainId: null, reason: 'ok' };
}

/** The train that holds a block: occupying it or holding a Granted authority over it. */
function holderOf(state: SessionState, blockId: string): string | null {
  const occupier = state.trains.find((t) => t.occupied_block_ids.includes(blockId));
  if (occupier) return occupier.id;
  for (const a of state.authorities) {
    if (a.state !== 'Granted') continue;
    if (a.remaining_block_ids.includes(blockId)) {
      return a.train_id;
    }
  }
  return null;
}

export function neighboursAhead(graph: Map<string, { east: string[]; west: string[] }>, blockId: string, dir: 'east' | 'west'): string[] {
  return graph.get(blockId)?.[dir] ?? [];
}

function blockLength(state: SessionState, blockId: string): number {
  return state.blocks.find((b) => b.id === blockId)?.length_mm ?? 0;
}

function blockNumber(state: SessionState, blockId: string): number {
  return state.blocks.find((b) => b.id === blockId)?.number ?? 0;
}

/** One tick: advance trains, derive occupancy, record arrivals, end and revoke authorities, check deadlock. */
export interface TickResult {
  arrivals: { entry_id: string; arrived_fast_seconds: number }[];
  authorities_released: { id: string; ended_reason: string }[];
  authorities_revoked: { id: string; ended_reason: string }[];
  deadlocks_raised: { id: string; train_numbers: string[] }[];
}

export function commitTick(state: SessionState, content: LayoutContent, fastClockSeconds: number, tick: number): TickResult {
  const result: TickResult = { arrivals: [], authorities_released: [], authorities_revoked: [], deadlocks_raised: [] };
  const graph = blockGraph(content);

  for (const train of state.trains) {
    const authority = state.authorities.find((a) => a.id === train.authority_id && a.state === 'Granted');
    if (!authority) continue;
    const { advance, carry } = scaleSpeedAdvance(train.speed_mph, train.carry);
    let move = advance;
    // Cut at the far end of the last granted block.
    const roomLeft = remainingToLimit(state, train, authority);
    if (move > roomLeft) move = Math.max(0, roomLeft);
    train.carry = carry;
    if (move > 0) {
      moveTrain(state, graph, train, move, authority);
      train.distance_run_mm += move;
    }
  }

  deriveOccupancy(state);

  // Timetable arrivals: first entry of a station whose block the head first enters.
  for (const train of state.trains) {
    const block = state.blocks.find((b) => b.id === train.head_block_id);
    if (!block) continue;
    const station = content.stations.find((s) => s.block_ids.includes(block.id));
    if (!station) continue;
    for (const progress of state.timetable_progress) {
      if (progress.arrived_fast_seconds !== null) continue;
      const entry = content.timetable.entries.find((e) => e.id === progress.entry_id);
      if (!entry || entry.station_id !== station.id || entry.train_id !== train.id) continue;
      progress.arrived_fast_seconds = fastClockSeconds;
      result.arrivals.push({ entry_id: entry.id, arrived_fast_seconds: fastClockSeconds });
    }
  }

  // Granted blocks are given back as the tail clears them.
  for (const a of state.authorities) {
    if (a.state !== 'Granted') continue;
    const train = state.trains.find((t) => t.id === a.train_id);
    if (!train) continue;
    const headIdx = a.remaining_block_ids.indexOf(train.head_block_id);
    a.remaining_block_ids = a.remaining_block_ids.filter((id) => {
      if (train.occupied_block_ids.includes(id)) return true;
      return a.remaining_block_ids.indexOf(id) >= headIdx;
    });
  }

  // Authority release when the head reaches the end of the limit block.
  for (const a of state.authorities) {
    if (a.state !== 'Granted') continue;
    const train = state.trains.find((t) => t.id === a.train_id);
    if (!train) continue;
    const limitBlock = state.blocks.find((b) => b.id === a.limit_block_id);
    if (!limitBlock) continue;
    if (train.head_block_id === a.limit_block_id && train.head_offset_mm >= limitBlock.length_mm) {
      a.state = 'Released';
      a.ended_reason = 'completed';
      train.authority_id = null;
      train.revision += 1;
      result.authorities_released.push({ id: a.id, ended_reason: 'completed' });
      releaseTurnouts(state, a);
    }
  }

  // Expiry on the committed tick at or past the limit.
  for (const a of state.authorities) {
    if (a.state !== 'Granted') continue;
    if (fastClockSeconds >= a.expires_fast_seconds) {
      a.state = 'Revoked';
      a.ended_reason = 'expired';
      const train = state.trains.find((t) => t.id === a.train_id);
      if (train) {
        train.authority_id = null;
        train.revision += 1;
      }
      result.authorities_revoked.push({ id: a.id, ended_reason: 'expired' });
      releaseTurnouts(state, a);
    }
  }

  deriveOccupancy(state);
  recount(state);
  return result;
}

/** Millimetres left to the far end of the authority's limit block. */
function remainingToLimit(state: SessionState, train: SessionTrain, authority: Authority): number {
  const headBlock = state.blocks.find((b) => b.id === train.head_block_id);
  if (!headBlock) return 0;
  const roomInHead = Math.max(0, headBlock.length_mm - train.head_offset_mm);
  const remaining = authority.remaining_block_ids.filter((id) => id !== train.head_block_id);
  let ahead = 0;
  for (const id of remaining) {
    const b = state.blocks.find((x) => x.id === id);
    if (!b) continue;
    ahead += b.length_mm;
  }
  return roomInHead + ahead;
}

/** Move the head forward through the granted blocks, extending the trail. */
function moveTrain(state: SessionState, graph: ReturnType<typeof blockGraph>, train: SessionTrain, distance: number, authority: Authority): void {
  let remaining = distance;
  let offset = train.head_offset_mm;
  let current = train.head_block_id;
  const guard = new Set<string>();
  while (remaining > 0) {
    const block = state.blocks.find((b) => b.id === current);
    if (!block) break;
    const room = block.length_mm - offset;
    if (remaining <= room) {
      offset += remaining;
      remaining = 0;
      break;
    }
    remaining -= room;
    const nexts = neighboursAhead(graph, current, train.direction);
    let next: string | null = null;
    const idx = authority.remaining_block_ids.indexOf(current);
    const nextId = idx >= 0 ? authority.remaining_block_ids[idx + 1] : undefined;
    if (nextId && nexts.includes(nextId)) next = nextId;
    if (!next) {
      const candidates = nexts.filter((n) => authority.remaining_block_ids.includes(n) && !guard.has(n));
      next = candidates[0] ?? null;
    }
    if (!next) {
      offset = block.length_mm;
      remaining = 0;
      break;
    }
    guard.add(next);
    train.trail_block_ids = [next, ...train.trail_block_ids];
    current = next;
    offset = 0;
  }
  train.head_block_id = current;
  train.head_offset_mm = offset;
}

function releaseTurnouts(state: SessionState, authority: Authority): void {
  for (const t of state.turnouts) {
    if (t.locked_by_authority_id === authority.id) t.locked_by_authority_id = null;
  }
}

/** Check the wait-for graph; commit a deadlock when a cycle first appears. */
export function checkDeadlock(state: SessionState, tick: number): { id: string; train_numbers: string[] } | null {
  const edges = new Map<string, string>();
  for (const c of state.conflicts) {
    if (c.state !== 'Open' || !c.other_train_id) continue;
    edges.set(c.train_id, c.other_train_id);
  }
  const seen = new Set<string>();
  for (const start of edges.keys()) {
    if (seen.has(start)) continue;
    const path: string[] = [];
    let cur: string | undefined = start;
    const localSeen = new Set<string>();
    while (cur && !seen.has(cur)) {
      if (localSeen.has(cur)) {
        const cycleStart = path.indexOf(cur);
        const members = path.slice(cycleStart >= 0 ? cycleStart : 0);
        const existing = state.deadlocks.find((d) => d.state === 'Open' && members.every((m) => d.member_train_ids.includes(m)));
        if (existing) return null;
        const numbers = members.map((m) => state.trains.find((t) => t.id === m)?.number ?? m);
        const deadlock: Deadlock = {
          id: `dl-${members.sort().join('-')}`,
          state: 'Open',
          raised_at_tick: tick,
          train_numbers: numbers,
          member_train_ids: members,
        };
        state.deadlocks.push(deadlock);
        return { id: deadlock.id, train_numbers: numbers };
      }
      localSeen.add(cur);
      path.push(cur);
      cur = edges.get(cur);
    }
    for (const p of path) seen.add(p);
  }
  return null;
}
