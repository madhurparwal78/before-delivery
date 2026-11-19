// Link bounds, the forward and backward passes, group rollups and the late flag:
// the one place every screen and export reads its dates from.

import { IsoDate, WorkingCalendar } from './calendar.ts';

export type LinkType = 'FS' | 'SS' | 'FF' | 'SF';
export type ItemKind = 'task' | 'milestone' | 'group';

export interface LinkCore {
  id: string;
  from: string;
  to: string;
  type: LinkType;
  lag: number;
}

export interface ItemCore {
  id: string;
  row: number;
  name: string;
  kind: ItemKind;
  group: string | null;
  chosenStart: IsoDate | null;
  duration: number;
  percent: number;
}

export interface ComputedLink extends LinkCore {
  critical: boolean;
}

export interface ComputedItem {
  id: string;
  start: IsoDate | null;
  end: IsoDate | null;
  duration: number;
  percent: number;
  critical: boolean;
  float: number | null;
  late: boolean;
}

export interface ScheduleResult {
  items: Map<string, ComputedItem>;
  finish: IsoDate | null;
  links: Map<string, ComputedLink>;
  /** Working-day-number bound source per item, for the constraint sentence. */
  boundBy: Map<string, { from: string; fromRow: number } | null>;
}

/** The start bound a link imposes on its successor, in working-day numbers. */
function startBound(link: LinkCore, sA: number, fA: number, durationB: number): number {
  switch (link.type) {
    case 'FS':
      return fA + link.lag;
    case 'SS':
      return sA + link.lag;
    case 'FF':
      return fA + link.lag - durationB;
    case 'SF':
      return sA + link.lag - durationB;
  }
}

/** The late finish a link imposes on its predecessor, in working-day numbers. */
function lateFinishBound(link: LinkCore, lfB: number, lsB: number, durationA: number): number {
  switch (link.type) {
    case 'FS':
      return lsB - link.lag;
    case 'SS':
      return lsB - link.lag + durationA;
    case 'FF':
      return lfB - link.lag;
    case 'SF':
      return lfB - link.lag + durationA;
  }
}

export function schedule(cores: ItemCore[], links: LinkCore[], calendar: WorkingCalendar, today: IsoDate): ScheduleResult {
  const items = new Map<string, ItemCore>();
  for (const core of cores) items.set(core.id, core);
  const incoming = new Map<string, LinkCore[]>();
  const outgoing = new Map<string, LinkCore[]>();
  for (const id of items.keys()) {
    incoming.set(id, []);
    outgoing.set(id, []);
  }
  for (const link of links) {
    if (!items.has(link.from) || !items.has(link.to)) continue;
    incoming.get(link.to)!.push(link);
    outgoing.get(link.from)!.push(link);
  }

  // Topological order over links between tasks and milestones.
  const order: string[] = [];
  const indegree = new Map<string, number>();
  for (const id of items.keys()) indegree.set(id, incoming.get(id)!.length);
  const queue: string[] = [];
  for (const id of items.keys()) if (indegree.get(id) === 0) queue.push(id);
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const link of outgoing.get(id)!) {
      const left = indegree.get(link.to)! - 1;
      indegree.set(link.to, left);
      if (left === 0) queue.push(link.to);
    }
  }

  const S = new Map<string, number>();
  const F = new Map<string, number>();
  const boundBy = new Map<string, { from: string; fromRow: number } | null>();
  const workingNumber = (date: IsoDate): number => calendar.workingNumber(date);

  for (const id of order) {
    const core = items.get(id)!;
    if (core.kind === 'group') continue;
    const chosenNumber = Math.max(1, workingNumber(core.chosenStart ?? calendar.nextWorking(today)));
    let start = chosenNumber;
    let source: { from: string; fromRow: number } | null = null;
    for (const link of incoming.get(id)!) {
      const fromRow = items.get(link.from)!.row;
      const candidate = startBound(link, S.get(link.from)!, F.get(link.from)!, core.duration);
      if (candidate > start) {
        start = candidate;
        source = { from: link.from, fromRow };
      } else if (candidate === start && candidate > chosenNumber && (source === null || fromRow < source.fromRow)) {
        source = { from: link.from, fromRow };
      }
    }
    if (start < 1) start = 1;
    boundBy.set(id, start > chosenNumber ? source : null);
    S.set(id, start);
    F.set(id, start + core.duration);
  }

  // The calendar date of working-day number `n`.
  const workingDateOf = (n: number): IsoDate => calendar.workingDay(n);
  const computed = new Map<string, ComputedItem>();
  const childrenOf = new Map<string, ItemCore[]>();
  for (const core of cores) if (core.kind === 'group') childrenOf.set(core.id, []);
  for (const core of cores) {
    if (core.group !== null) childrenOf.get(core.group)?.push(core);
  }
  for (const core of cores) {
    if (core.kind !== 'group') continue;
    const children = childrenOf.get(core.id)!;
    let start: IsoDate | null = null;
    let end: IsoDate | null = null;
    for (const child of children) {
      const cs = workingDateOf(S.get(child.id)!);
      const ce = workingDateOf(F.get(child.id)! - 1);
      if (start === null || cs < start) start = cs;
      if (end === null || ce > end) end = ce;
    }
    const duration = start === null || end === null ? 0 : calendar.spanDuration(start, end);
    computed.set(core.id, {
      id: core.id,
      start,
      end,
      duration,
      percent: groupPercent(children),
      critical: false,
      float: null,
      late: false,
    });
  }

  let finishNumber: number | null = null;
  for (const core of cores) {
    if (core.kind === 'group') continue;
    const f = F.get(core.id)!;
    if (finishNumber === null || f > finishNumber) finishNumber = f;
  }
  // F is the exclusive end bound, so the finish is the working day before it.
  const finish = finishNumber === null ? null : workingDateOf(finishNumber - 1);

  const LF = new Map<string, number>();
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const id = order[i];
    const core = items.get(id)!;
    if (core.kind === 'group') continue;
    let lf = finishNumber ?? 0;
    for (const link of outgoing.get(id)!) {
      const target = items.get(link.to)!;
      const lfB = LF.get(link.to)!;
      const lsB = lfB - target.duration;
      const candidate = lateFinishBound(link, lfB, lsB, core.duration);
      if (candidate < lf) lf = candidate;
    }
    LF.set(id, lf);
  }

  for (const core of cores) {
    if (core.kind === 'group') continue;
    // A task starts on working day S and ends on working day F - 1; a milestone happens at the
    // end of its day, so its shown start and end are both working day S - 1.
    const shownStart = core.kind === 'milestone' ? workingDateOf(S.get(core.id)! - 1) : workingDateOf(S.get(core.id)!);
    const shownEnd = core.kind === 'milestone' ? shownStart : workingDateOf(F.get(core.id)! - 1);
    const f = F.get(core.id)!;
    const lf = LF.get(core.id)!;
    computed.set(core.id, {
      id: core.id,
      start: shownStart,
      end: shownEnd,
      duration: core.duration,
      percent: core.percent,
      critical: lf === f,
      float: lf - f,
      late: shownEnd < today && core.percent < 100,
    });
  }

  const computedLinks = new Map<string, ComputedLink>();
  for (const link of links) {
    const from = computed.get(link.from);
    const to = computed.get(link.to);
    computedLinks.set(link.id, {
      ...link,
      critical: from !== undefined && to !== undefined && from.critical && to.critical,
    });
  }

  return { items: computed, finish, links: computedLinks, boundBy };
}

function groupPercent(children: readonly ItemCore[]): number {
  let weight = 0;
  let weighted = 0;
  for (const child of children) {
    if (child.kind !== 'task') continue;
    weight += child.duration;
    weighted += child.duration * child.percent;
  }
  if (weight === 0) return 0;
  return Math.floor(weighted / weight + 0.5);
}

/** Signed working-day variance from a baseline end to the current end. */
export function variance(currentEnd: IsoDate, baselineEnd: IsoDate, calendar: WorkingCalendar): number {
  if (currentEnd === baselineEnd) return 0;
  const diff = calendar.workDiff(baselineEnd, currentEnd);
  return currentEnd > baselineEnd ? Math.abs(diff) : -Math.abs(diff);
}

export function varianceText(n: number): string {
  if (n === 0) return 'On baseline';
  if (n === 1) return `1 working day later than baseline`;
  if (n === -1) return `1 working day earlier than baseline`;
  if (n > 0) return `${n} working days later than baseline`;
  return `${n} working days earlier than baseline`;
}

/** The fewest-links cycle through `start`, closed, or null when there is none.
 *  Ties are broken by the lowest row numbers, read in order. */
export function findCycle(edges: readonly { from: string; to: string }[], rowOf: (id: string) => number, start: string): string[] | null {
  const adjacency = new Map<string, string[]>();
  const nodes = new Set<string>([start]);
  for (const edge of edges) {
    const list = adjacency.get(edge.from) ?? [];
    list.push(edge.to);
    adjacency.set(edge.from, list);
    nodes.add(edge.from);
    nodes.add(edge.to);
  }
  for (const list of adjacency.values()) list.sort((a, b) => rowOf(a) - rowOf(b));

  const search = (node: string, path: string[], seen: Set<string>, depth: number): string[] | null => {
    for (const next of adjacency.get(node) ?? []) {
      if (next === start) return path;
    }
    if (path.length >= depth) return null;
    for (const next of adjacency.get(node) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      const found = search(next, [...path, next], seen, depth);
      seen.delete(next);
      if (found !== null) return found;
    }
    return null;
  };

  for (let depth = 1; depth <= nodes.size; depth += 1) {
    const path = search(start, [start], new Set([start]), depth);
    if (path !== null) return [...path, start];
  }
  return null;
}
