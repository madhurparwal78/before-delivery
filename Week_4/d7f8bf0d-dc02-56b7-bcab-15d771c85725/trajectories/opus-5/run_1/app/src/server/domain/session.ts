import type {
  BlockContent,
  BlockState,
  Direction,
  LayoutContent,
  SessionSnapshot,
  SessionStatus,
  SnapshotAuthority,
  SnapshotBlock,
  SnapshotConflict,
  SnapshotCounters,
  SnapshotDeadlock,
  SnapshotTrain,
  SnapshotTurnout,
  TickDetail,
  TimetableProgress,
} from '../../shared/protocol.js';
import { fastClockLabel } from '../../shared/units.js';
import { newId } from './hash.js';
import { advancePerTick } from './speed.js';

export const MAX_ROUTE_BLOCKS = 8;
export const DEFAULT_TIME_LIMIT_FAST_SECONDS = 3600;
export const MIN_TIME_LIMIT_FAST_SECONDS = 6;
export const MAX_TIME_LIMIT_FAST_SECONDS = 43_200;

export interface TrainRuntime {
  id: string;
  number: string;
  name: string;
  direction: Direction;
  speed_mph: number;
  length_mm: number;
  head_block_id: string;
  head_offset_mm: number;
  trail_block_ids: string[];
  distance_run_mm: number;
  carry: number;
  revision: number;
  start_block_id: string;
  start_head_offset_mm: number;
}

export interface SessionStateDoc {
  content: LayoutContent;
  trains: TrainRuntime[];
  authorities: SnapshotAuthority[];
  conflicts: SnapshotConflict[];
  deadlocks: SnapshotDeadlock[];
  turnouts: SnapshotTurnout[];
  out_of_service_block_ids: string[];
  timetable_progress: TimetableProgress[];
}

export interface SessionRecord {
  id: string;
  workspace_id: string;
  layout_id: string;
  name: string;
  status: SessionStatus;
  hold_reason: 'operator' | 'valkey' | null;
  ratio: number;
  revision: number;
  control_revision: number;
  session_version: number;
  tick: number;
  layout_version_id: string;
  layout_version_number: number;
  timetable_version: number;
  state: SessionStateDoc;
}

/** The committed state a session starts from, taken from its pinned version. */
export function initialSessionState(content: LayoutContent): SessionStateDoc {
  const state: SessionStateDoc = {
    content,
    trains: content.trains.map((train) => ({
      id: train.id,
      number: train.number,
      name: train.name,
      direction: train.direction,
      speed_mph: train.speed_mph,
      length_mm: train.length_mm,
      head_block_id: train.start_block_id,
      head_offset_mm: train.start_head_offset_mm,
      trail_block_ids: [train.start_block_id],
      distance_run_mm: 0,
      carry: 0,
      revision: 0,
      start_block_id: train.start_block_id,
      start_head_offset_mm: train.start_head_offset_mm,
    })),
    authorities: [],
    conflicts: [],
    deadlocks: [],
    turnouts: content.turnouts.map((turnout) => ({
      id: turnout.id,
      position: 'normal',
      locked_by_authority_id: null,
    })),
    out_of_service_block_ids: [],
    timetable_progress: content.timetable.entries.map((entry) => ({
      entry_id: entry.id,
      arrived_fast_seconds: null,
    })),
  };
  return state;
}

export function blockMap(content: LayoutContent): Map<string, BlockContent> {
  return new Map(content.blocks.map((block) => [block.id, block]));
}

export function neighboursOf(block: BlockContent, direction: Direction): string[] {
  return direction === 'east' ? block.east_neighbour_ids : block.west_neighbour_ids;
}

/** Blocks a train covers, newest first, walking its length back along the trail. */
export function occupiedBlockIds(train: TrainRuntime, blocks: Map<string, BlockContent>): string[] {
  const covered: string[] = [];
  let remaining = train.length_mm;
  for (let index = 0; index < train.trail_block_ids.length && remaining > 0; index += 1) {
    const blockId = train.trail_block_ids[index];
    const block = blocks.get(blockId);
    if (!block) break;
    const available = index === 0 ? train.head_offset_mm : block.length_mm;
    const used = Math.min(remaining, available);
    if (used > 0) covered.push(blockId);
    remaining -= used;
  }
  if (covered.length === 0) covered.push(train.head_block_id);
  return covered;
}

function trimTrail(train: TrainRuntime, blocks: Map<string, BlockContent>): void {
  train.trail_block_ids = occupiedBlockIds(train, blocks);
}

export function grantedAuthorityOf(
  state: SessionStateDoc,
  trainId: string,
): SnapshotAuthority | undefined {
  return state.authorities.find(
    (authority) => authority.train_id === trainId && authority.state === 'Granted',
  );
}

function blockStates(state: SessionStateDoc, blocks: Map<string, BlockContent>): Map<
  string,
  { state: BlockState; train_number: string | null; authority_id: string | null }
> {
  const result = new Map<
    string,
    { state: BlockState; train_number: string | null; authority_id: string | null }
  >();
  for (const block of state.content.blocks) {
    result.set(block.id, { state: 'free', train_number: null, authority_id: null });
  }

  for (const authority of state.authorities) {
    if (authority.state !== 'Granted') continue;
    for (const blockId of authority.remaining_block_ids) {
      const entry = result.get(blockId);
      if (entry) {
        entry.state = 'reserved';
        entry.authority_id = authority.id;
      }
    }
  }

  for (const train of state.trains) {
    const authority = grantedAuthorityOf(state, train.id);
    for (const blockId of occupiedBlockIds(train, blocks)) {
      const entry = result.get(blockId);
      if (entry) {
        entry.state = 'occupied';
        entry.train_number = train.number;
        entry.authority_id = authority?.id ?? null;
      }
    }
  }

  for (const blockId of state.out_of_service_block_ids) {
    const entry = result.get(blockId);
    if (entry) {
      entry.state = 'out_of_service';
      entry.authority_id = null;
    }
  }

  return result;
}

export function snapshotBlocks(state: SessionStateDoc): SnapshotBlock[] {
  const blocks = blockMap(state.content);
  const derived = blockStates(state, blocks);
  return [...state.content.blocks]
    .sort((a, b) => a.number - b.number)
    .map((block) => {
      const entry = derived.get(block.id);
      return {
        id: block.id,
        number: block.number,
        name: block.name,
        kind: block.kind,
        length_mm: block.length_mm,
        state: entry?.state ?? 'free',
        train_number: entry?.train_number ?? null,
        authority_id: entry?.authority_id ?? null,
      };
    });
}

export function countersOf(blocks: SnapshotBlock[], state: SessionStateDoc): SnapshotCounters {
  let occupied = 0;
  let reserved = 0;
  let free = 0;
  for (const block of blocks) {
    if (block.state === 'occupied' || block.state === 'out_of_service') occupied += 1;
    else if (block.state === 'reserved') reserved += 1;
    else free += 1;
  }
  return {
    occupied_blocks: occupied,
    reserved_blocks: reserved,
    free_blocks: free,
    trains: state.trains.length,
    open_conflicts: state.conflicts.filter((conflict) => conflict.state === 'Open').length,
  };
}

export function snapshotTrains(state: SessionStateDoc): SnapshotTrain[] {
  const blocks = blockMap(state.content);
  return state.trains.map((train) => ({
    id: train.id,
    number: train.number,
    name: train.name,
    direction: train.direction,
    speed_mph: train.speed_mph,
    length_mm: train.length_mm,
    head_block_id: train.head_block_id,
    head_offset_mm: train.head_offset_mm,
    trail_block_ids: train.trail_block_ids,
    occupied_block_ids: occupiedBlockIds(train, blocks),
    distance_run_mm: train.distance_run_mm,
    carry: train.carry,
    authority_id: grantedAuthorityOf(state, train.id)?.id ?? null,
    revision: train.revision,
  }));
}

export function buildSnapshot(record: SessionRecord): SessionSnapshot {
  const blocks = snapshotBlocks(record.state);
  const fastSeconds = record.tick * record.ratio;
  return {
    id: record.id,
    name: record.name,
    status: record.status,
    hold_reason: record.hold_reason,
    ratio: record.ratio,
    revision: record.revision,
    control_revision: record.control_revision,
    session_version: record.session_version,
    tick: record.tick,
    fast_clock_seconds: fastSeconds,
    fast_clock_label: fastClockLabel(fastSeconds),
    layout_id: record.layout_id,
    layout_version_id: record.layout_version_id,
    layout_version_number: record.layout_version_number,
    timetable_version: record.timetable_version,
    trains: snapshotTrains(record.state),
    blocks,
    turnouts: record.state.turnouts,
    authorities: record.state.authorities,
    conflicts: record.state.conflicts,
    deadlocks: record.state.deadlocks,
    timetable_progress: record.state.timetable_progress,
    counters: countersOf(blocks, record.state),
    stations: record.state.content.stations,
    timetable: record.state.content.timetable,
  };
}

function compareRoutes(
  a: { cost: number; numbers: number[] },
  b: { cost: number; numbers: number[] },
): number {
  if (a.cost !== b.cost) return a.cost - b.cost;
  const length = Math.min(a.numbers.length, b.numbers.length);
  for (let index = 0; index < length; index += 1) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] - b.numbers[index];
  }
  return a.numbers.length - b.numbers.length;
}

/** The shortest road in millimetres ahead of a block, ties taking the lower block numbers. */
function shortestLeg(
  content: LayoutContent,
  fromBlockId: string,
  direction: Direction,
  toBlockId: string,
): string[] | null {
  const blocks = blockMap(content);
  const best = new Map<string, { cost: number; numbers: number[]; route: string[] }>();
  const start = blocks.get(fromBlockId);
  if (!start) return null;
  const queue: { cost: number; numbers: number[]; route: string[]; at: string }[] = [];

  for (const neighbourId of neighboursOf(start, direction)) {
    const neighbour = blocks.get(neighbourId);
    if (!neighbour) continue;
    queue.push({
      cost: neighbour.length_mm,
      numbers: [neighbour.number],
      route: [neighbourId],
      at: neighbourId,
    });
  }

  let answer: string[] | null = null;
  let answerKey: { cost: number; numbers: number[] } | null = null;

  while (queue.length > 0) {
    queue.sort(compareRoutes);
    const current = queue.shift();
    if (!current) break;
    const seen = best.get(current.at);
    if (seen && compareRoutes(seen, current) <= 0) continue;
    best.set(current.at, { cost: current.cost, numbers: current.numbers, route: current.route });

    if (current.at === toBlockId) {
      if (!answerKey || compareRoutes(current, answerKey) < 0) {
        answerKey = { cost: current.cost, numbers: current.numbers };
        answer = current.route;
      }
      continue;
    }
    if (current.route.length >= MAX_ROUTE_BLOCKS * 2) continue;

    const at = blocks.get(current.at);
    if (!at) continue;
    for (const neighbourId of neighboursOf(at, direction)) {
      if (current.route.includes(neighbourId)) continue;
      const neighbour = blocks.get(neighbourId);
      if (!neighbour) continue;
      queue.push({
        cost: current.cost + neighbour.length_mm,
        numbers: [...current.numbers, neighbour.number],
        route: [...current.route, neighbourId],
        at: neighbourId,
      });
    }
  }

  return answer;
}

export function findRoute(
  content: LayoutContent,
  fromBlockId: string,
  direction: Direction,
  destinationBlockId: string,
  viaBlockId: string | null,
): string[] | null {
  if (!viaBlockId) return shortestLeg(content, fromBlockId, direction, destinationBlockId);
  const first = shortestLeg(content, fromBlockId, direction, viaBlockId);
  if (!first) return null;
  if (viaBlockId === destinationBlockId) return first;
  const second = shortestLeg(content, viaBlockId, direction, destinationBlockId);
  if (!second) return null;
  return [...first, ...second];
}

export interface TurnoutRequirement {
  turnoutId: string;
  position: 'normal' | 'reverse';
  throughBlockId: string;
}

/** Turnouts a road runs through, with the position each one needs. */
export function turnoutsOnRoute(
  content: LayoutContent,
  headBlockId: string,
  route: string[],
): TurnoutRequirement[] {
  const path = [headBlockId, ...route];
  const requirements: TurnoutRequirement[] = [];
  for (let index = 0; index + 1 < path.length; index += 1) {
    const a = path[index];
    const b = path[index + 1];
    for (const turnout of content.turnouts) {
      const pair = [a, b];
      if (pair.includes(turnout.stem_block_id) && pair.includes(turnout.normal_block_id)) {
        requirements.push({ turnoutId: turnout.id, position: 'normal', throughBlockId: b });
      } else if (pair.includes(turnout.stem_block_id) && pair.includes(turnout.reverse_block_id)) {
        requirements.push({ turnoutId: turnout.id, position: 'reverse', throughBlockId: b });
      }
    }
  }
  return requirements;
}

export interface RouteDecision {
  route: string[];
  conflictBlockId: string | null;
  otherTrainNumber: string | null;
  reachableBlockIds: string[];
}

export function decideRoute(
  state: SessionStateDoc,
  train: TrainRuntime,
  route: string[],
): RouteDecision {
  const blocks = snapshotBlocks(state);
  const states = new Map(blocks.map((block) => [block.id, block]));
  const locked = new Map(
    state.turnouts
      .filter((turnout) => turnout.locked_by_authority_id !== null)
      .map((turnout) => [turnout.id, turnout]),
  );

  for (let index = 0; index < route.length; index += 1) {
    const blockId = route[index];
    const block = states.get(blockId);
    if (block && block.state !== 'free') {
      return {
        route,
        conflictBlockId: blockId,
        otherTrainNumber: block.train_number ?? trainHolding(state, blockId),
        reachableBlockIds: route.slice(0, index),
      };
    }
  }

  for (const requirement of turnoutsOnRoute(state.content, train.head_block_id, route)) {
    const turnout = locked.get(requirement.turnoutId);
    if (!turnout) continue;
    const current = state.turnouts.find((entry) => entry.id === requirement.turnoutId);
    if (current && current.position !== requirement.position) {
      const holder = state.authorities.find(
        (authority) => authority.id === turnout.locked_by_authority_id,
      );
      const holdingTrain = state.trains.find((entry) => entry.id === holder?.train_id);
      const index = route.indexOf(requirement.throughBlockId);
      return {
        route,
        conflictBlockId: requirement.throughBlockId,
        otherTrainNumber: holdingTrain?.number ?? null,
        reachableBlockIds: route.slice(0, index < 0 ? 0 : index),
      };
    }
  }

  return { route, conflictBlockId: null, otherTrainNumber: null, reachableBlockIds: route };
}

function trainHolding(state: SessionStateDoc, blockId: string): string | null {
  for (const authority of state.authorities) {
    if (authority.state !== 'Granted') continue;
    if (!authority.remaining_block_ids.includes(blockId)) continue;
    const train = state.trains.find((entry) => entry.id === authority.train_id);
    if (train) return train.number;
  }
  return null;
}

export function grantAuthority(
  state: SessionStateDoc,
  train: TrainRuntime,
  route: string[],
  fastSeconds: number,
  timeLimitFastSeconds: number,
): SnapshotAuthority {
  const authority: SnapshotAuthority = {
    id: newId('auth'),
    train_id: train.id,
    state: 'Granted',
    block_ids: [...route],
    remaining_block_ids: [...route],
    limit_block_id: route[route.length - 1],
    expires_fast_seconds: fastSeconds + timeLimitFastSeconds,
    ended_reason: null,
    revision: 0,
  };
  state.authorities.push(authority);
  for (const requirement of turnoutsOnRoute(state.content, train.head_block_id, route)) {
    const turnout = state.turnouts.find((entry) => entry.id === requirement.turnoutId);
    if (turnout) {
      turnout.position = requirement.position;
      turnout.locked_by_authority_id = authority.id;
    }
  }
  train.revision += 1;
  closeConflictsFor(state, train.id);
  return authority;
}

export function refuseAuthority(
  state: SessionStateDoc,
  train: TrainRuntime,
  decision: RouteDecision,
): { authority: SnapshotAuthority; conflict: SnapshotConflict } {
  const conflictBlockId = decision.conflictBlockId ?? '';
  const authority: SnapshotAuthority = {
    id: newId('auth'),
    train_id: train.id,
    state: 'Refused',
    block_ids: [...decision.route],
    remaining_block_ids: [],
    limit_block_id: conflictBlockId,
    expires_fast_seconds: 0,
    ended_reason: null,
    revision: 0,
  };
  const other = state.trains.find((entry) => entry.number === decision.otherTrainNumber);
  const conflict: SnapshotConflict = {
    id: newId('cf'),
    state: 'Open',
    train_id: train.id,
    other_train_id: other?.id ?? null,
    block_id: conflictBlockId,
    note: '',
    revision: 0,
  };
  state.authorities.push(authority);
  state.conflicts.push(conflict);
  train.revision += 1;
  return { authority, conflict };
}

export function closeConflictsFor(state: SessionStateDoc, trainId: string): SnapshotConflict[] {
  const closed: SnapshotConflict[] = [];
  for (const conflict of state.conflicts) {
    if (conflict.state !== 'Open') continue;
    if (conflict.train_id !== trainId && conflict.other_train_id !== trainId) continue;
    conflict.state = 'Closed';
    conflict.revision += 1;
    closed.push(conflict);
  }
  return closed;
}

export function endAuthority(
  state: SessionStateDoc,
  authority: SnapshotAuthority,
  endState: 'Released' | 'Revoked',
  reason: 'completed' | 'cancelled' | 'expired' | 'moved',
): void {
  authority.state = endState;
  authority.ended_reason = reason;
  authority.remaining_block_ids = [];
  authority.revision += 1;
  for (const turnout of state.turnouts) {
    if (turnout.locked_by_authority_id === authority.id) turnout.locked_by_authority_id = null;
  }
}

export function openDeadlockFor(
  state: SessionStateDoc,
  trainId: string,
): SnapshotDeadlock | undefined {
  const train = state.trains.find((entry) => entry.id === trainId);
  if (!train) return undefined;
  return state.deadlocks.find(
    (deadlock) => deadlock.state === 'Open' && deadlock.train_numbers.includes(train.number),
  );
}

export function clearDeadlocksFor(state: SessionStateDoc, trainId: string): SnapshotDeadlock[] {
  const train = state.trains.find((entry) => entry.id === trainId);
  if (!train) return [];
  const cleared: SnapshotDeadlock[] = [];
  for (const deadlock of state.deadlocks) {
    if (deadlock.state !== 'Open') continue;
    if (!deadlock.train_numbers.includes(train.number)) continue;
    deadlock.state = 'Cleared';
    cleared.push(deadlock);
  }
  return cleared;
}

function detectDeadlockCycle(state: SessionStateDoc): string[] | null {
  const edges = new Map<string, string>();
  for (const conflict of state.conflicts) {
    if (conflict.state !== 'Open' || !conflict.other_train_id) continue;
    if (!edges.has(conflict.train_id)) edges.set(conflict.train_id, conflict.other_train_id);
  }
  for (const start of edges.keys()) {
    const path: string[] = [];
    let current: string | undefined = start;
    while (current && edges.has(current)) {
      if (path.includes(current)) return path.slice(path.indexOf(current));
      path.push(current);
      current = edges.get(current);
    }
  }
  return null;
}

export function raiseDeadlocks(state: SessionStateDoc, tick: number): SnapshotDeadlock[] {
  const cycle = detectDeadlockCycle(state);
  if (!cycle) return [];
  const numbers = cycle
    .map((trainId) => state.trains.find((train) => train.id === trainId)?.number ?? '')
    .filter((number) => number !== '')
    .sort((a, b) => Number(a) - Number(b));
  const existing = state.deadlocks.find(
    (deadlock) =>
      deadlock.state === 'Open' && deadlock.train_numbers.join(',') === numbers.join(','),
  );
  if (existing) return [];
  const deadlock: SnapshotDeadlock = {
    id: newId('dl'),
    state: 'Open',
    raised_at_tick: tick,
    train_numbers: numbers,
  };
  state.deadlocks.push(deadlock);
  return [deadlock];
}

/** Hop distance over the whole neighbour graph, used by Back to loop. */
function hopDistances(content: LayoutContent, fromBlockId: string): Map<string, number> {
  const blocks = blockMap(content);
  const distances = new Map<string, number>([[fromBlockId, 0]]);
  const queue = [fromBlockId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    const block = blocks.get(current);
    if (!block) continue;
    for (const neighbourId of [...block.east_neighbour_ids, ...block.west_neighbour_ids]) {
      if (distances.has(neighbourId)) continue;
      distances.set(neighbourId, (distances.get(current) ?? 0) + 1);
      queue.push(neighbourId);
    }
  }
  return distances;
}

export function nearestFreeLoop(
  state: SessionStateDoc,
  train: TrainRuntime,
): BlockContent | undefined {
  const states = new Map(snapshotBlocks(state).map((block) => [block.id, block.state]));
  const distances = hopDistances(state.content, train.head_block_id);
  const candidates = state.content.blocks.filter(
    (block) => block.kind === 'loop' && states.get(block.id) === 'free',
  );
  return [...candidates].sort((a, b) => {
    const left = distances.get(a.id) ?? Number.POSITIVE_INFINITY;
    const right = distances.get(b.id) ?? Number.POSITIVE_INFINITY;
    return left !== right ? left - right : a.number - b.number;
  })[0];
}

/** Places a train with its head at the far end of a block, trail reset to that block. */
export function placeTrain(
  state: SessionStateDoc,
  train: TrainRuntime,
  blockId: string,
  headOffsetMm: number,
): void {
  train.head_block_id = blockId;
  train.head_offset_mm = headOffsetMm;
  train.trail_block_ids = [blockId];
  trimTrail(train, blockMap(state.content));
}

export function moveTrainAside(
  state: SessionStateDoc,
  train: TrainRuntime,
  blockId: string,
  headOffsetMm: number,
): void {
  const authority = grantedAuthorityOf(state, train.id);
  if (authority) endAuthority(state, authority, 'Revoked', 'moved');
  placeTrain(state, train, blockId, headOffsetMm);
  closeConflictsFor(state, train.id);
  clearDeadlocksFor(state, train.id);
  train.revision += 1;
}

/** One committed tick: trains advance, then occupancy, arrivals, authorities and deadlocks. */
export function runTick(record: SessionRecord): TickDetail {
  const state = record.state;
  const tick = record.tick + 1;
  const fastSeconds = tick * record.ratio;
  const blocks = blockMap(state.content);
  const detail: TickDetail = {
    tick,
    arrivals: [],
    authorities_released: [],
    authorities_revoked: [],
    deadlocks_raised: [],
  };

  const blockEntries = new Set<string>();
  for (const train of state.trains) {
    const authority = grantedAuthorityOf(state, train.id);
    if (!authority) continue;
    const { advanceMm, carry } = advancePerTick(train.speed_mph, train.carry);
    train.carry = carry;

    const path = [train.head_block_id, ...authority.remaining_block_ids];
    let pathIndex = 0;
    let offset = train.head_offset_mm + advanceMm;
    let run = advanceMm;
    for (;;) {
      const currentLength = blocks.get(path[pathIndex])?.length_mm ?? 0;
      if (offset <= currentLength) break;
      if (pathIndex + 1 >= path.length) {
        run -= offset - currentLength;
        offset = currentLength;
        break;
      }
      offset -= currentLength;
      pathIndex += 1;
      train.head_block_id = path[pathIndex];
      train.trail_block_ids.unshift(path[pathIndex]);
      blockEntries.add(`${train.id}:${path[pathIndex]}`);
    }
    train.head_offset_mm = offset;
    train.distance_run_mm += run;
    trimTrail(train, blocks);

    const entered = path.slice(1, pathIndex + 1);
    authority.remaining_block_ids = authority.remaining_block_ids.filter(
      (blockId) => !entered.includes(blockId),
    );
  }

  for (const entry of state.content.timetable.entries) {
    const progress = state.timetable_progress.find((row) => row.entry_id === entry.id);
    if (!progress || progress.arrived_fast_seconds !== null) continue;
    const station = state.content.stations.find((candidate) => candidate.id === entry.station_id);
    if (!station) continue;
    if (!station.block_ids.some((blockId) => blockEntries.has(`${entry.train_id}:${blockId}`))) continue;
    progress.arrived_fast_seconds = fastSeconds;
    detail.arrivals.push({ entry_id: entry.id, arrived_fast_seconds: fastSeconds });
  }

  for (const authority of [...state.authorities]) {
    if (authority.state !== 'Granted') continue;
    const train = state.trains.find((candidate) => candidate.id === authority.train_id);
    if (!train) continue;
    const limitLength = blocks.get(authority.limit_block_id)?.length_mm ?? 0;
    const atLimit =
      train.head_block_id === authority.limit_block_id && train.head_offset_mm >= limitLength;
    if (atLimit) {
      endAuthority(state, authority, 'Released', 'completed');
      detail.authorities_released.push({
        id: authority.id,
        train_number: train.number,
        ended_reason: 'completed',
      });
    }
  }

  for (const authority of [...state.authorities]) {
    if (authority.state !== 'Granted') continue;
    if (fastSeconds < authority.expires_fast_seconds) continue;
    const train = state.trains.find((candidate) => candidate.id === authority.train_id);
    endAuthority(state, authority, 'Revoked', 'expired');
    detail.authorities_revoked.push({
      id: authority.id,
      train_number: train?.number ?? '',
      ended_reason: 'expired',
    });
  }

  for (const turnout of state.turnouts) {
    if (!turnout.locked_by_authority_id) continue;
    const authority = state.authorities.find(
      (candidate) => candidate.id === turnout.locked_by_authority_id,
    );
    if (!authority || authority.state !== 'Granted') {
      turnout.locked_by_authority_id = null;
      continue;
    }
    const train = state.trains.find((candidate) => candidate.id === authority.train_id);
    if (!train) continue;
    const requirement = turnoutsOnRoute(state.content, train.head_block_id, authority.block_ids);
    const stillTouching = requirement.some((entry) => entry.turnoutId === turnout.id);
    const covered = occupiedBlockIds(train, blocks);
    const touchingBlocks = state.content.turnouts
      .filter((entry) => entry.id === turnout.id)
      .flatMap((entry) => [entry.stem_block_id, entry.normal_block_id, entry.reverse_block_id]);
    if (!stillTouching && !covered.some((blockId) => touchingBlocks.includes(blockId))) {
      turnout.locked_by_authority_id = null;
    }
  }

  detail.deadlocks_raised = raiseDeadlocks(state, tick).map((deadlock) => ({
    id: deadlock.id,
    train_numbers: deadlock.train_numbers,
  }));

  record.tick = tick;
  return detail;
}

export function searchSessionBlocks(state: SessionStateDoc, query: string): BlockContent[] {
  const needle = query.trim().toLowerCase();
  return [...state.content.blocks]
    .filter(
      (block) =>
        needle === '' ||
        block.name.toLowerCase().includes(needle) ||
        String(block.number).includes(needle),
    )
    .sort((a, b) => a.number - b.number);
}

export function tickPositions(state: SessionStateDoc): Record<string, unknown> {
  return {
    trains: state.trains.map((train) => ({
      id: train.id,
      head_block_id: train.head_block_id,
      head_offset_mm: train.head_offset_mm,
      trail_block_ids: train.trail_block_ids,
      distance_run_mm: train.distance_run_mm,
      carry: train.carry,
    })),
  };
}
