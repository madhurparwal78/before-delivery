import type { Assignee, Item, ItemKind, Link, LinkType } from '../../shared/types.js';
import { Calendar } from '../../shared/calendar.js';
import { fromIso, type IsoDate } from '../../shared/dates.js';

export interface StoredItem {
  id: string;
  name: string;
  kind: ItemKind;
  group: string | null;
  chosenStart: IsoDate | null;
  duration: number;
  percent: number;
  version: number;
  assignees: Assignee[];
}

export interface StoredLink {
  id: string;
  from: string;
  to: string;
  type: LinkType;
  lag: number;
}

export interface StoredBaseline {
  name: string;
  finish: IsoDate | null;
  items: Map<string, { start: IsoDate; end: IsoDate }>;
}

export interface ScheduleInput {
  /** Items in row order; a group is immediately followed by its own items. */
  items: readonly StoredItem[];
  links: readonly StoredLink[];
  holidays: readonly IsoDate[];
  today: IsoDate;
  baseline: StoredBaseline | null;
}

export interface ScheduledItem extends Item {
  /** The forward-pass working-day numbers; null for groups. */
  startNumber: number | null;
  finishNumber: number | null;
}

export interface Schedule {
  calendar: Calendar;
  items: ScheduledItem[];
  byId: Map<string, ScheduledItem>;
  links: Link[];
  finish: IsoDate | null;
  finishVariance: number | null;
  criticalCount: number;
}

function isSchedulable(kind: ItemKind): boolean {
  return kind !== 'group';
}

/** Kahn order over the link graph of tasks and milestones. */
function topologicalOrder(ids: readonly string[], links: readonly StoredLink[]): string[] {
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const id of ids) {
    incoming.set(id, 0);
    outgoing.set(id, []);
  }
  for (const link of links) {
    if (!incoming.has(link.to) || !outgoing.has(link.from)) continue;
    incoming.set(link.to, (incoming.get(link.to) ?? 0) + 1);
    outgoing.get(link.from)!.push(link.to);
  }
  const queue = ids.filter((id) => incoming.get(id) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of outgoing.get(id) ?? []) {
      const left = (incoming.get(next) ?? 0) - 1;
      incoming.set(next, left);
      if (left === 0) queue.push(next);
    }
  }
  return order;
}

/** The lower bound a link puts on its successor's start number. */
function startBound(
  type: LinkType,
  lag: number,
  predecessorStart: number,
  predecessorFinish: number,
  successorDuration: number,
): number {
  switch (type) {
    case 'FS':
      return predecessorFinish + lag;
    case 'SS':
      return predecessorStart + lag;
    case 'FF':
      return predecessorFinish + lag - successorDuration;
    case 'SF':
      return predecessorStart + lag - successorDuration;
  }
}

/** The upper bound an outgoing link puts on its predecessor's late finish. */
function lateFinishBound(
  type: LinkType,
  lag: number,
  successorLateStart: number,
  successorLateFinish: number,
  predecessorDuration: number,
): number {
  switch (type) {
    case 'FS':
      return successorLateStart - lag;
    case 'SS':
      return successorLateStart - lag + predecessorDuration;
    case 'FF':
      return successorLateFinish - lag;
    case 'SF':
      return successorLateFinish - lag + predecessorDuration;
  }
}

function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

/**
 * The one place the schedule is decided: the forward pass, the backward pass, total float,
 * the critical path, the group rollup, the late flag and the baseline variance.
 */
export function computeSchedule(input: ScheduleInput): Schedule {
  const calendar = new Calendar(input.holidays);
  const todayDay = fromIso(input.today);

  const schedulable = input.items.filter((item) => isSchedulable(item.kind));
  const ids = schedulable.map((item) => item.id);
  const stored = new Map(input.items.map((item) => [item.id, item]));
  const rowOf = new Map(input.items.map((item, index) => [item.id, index + 1]));

  const startNumber = new Map<string, number>();
  const finishNumber = new Map<string, number>();
  const incomingLinks = new Map<string, StoredLink[]>();
  const outgoingLinks = new Map<string, StoredLink[]>();
  for (const id of ids) {
    incomingLinks.set(id, []);
    outgoingLinks.set(id, []);
  }
  for (const link of input.links) {
    incomingLinks.get(link.to)?.push(link);
    outgoingLinks.get(link.from)?.push(link);
  }

  const order = topologicalOrder(ids, input.links);

  for (const id of order) {
    const item = stored.get(id)!;
    const chosen =
      item.kind === 'milestone'
        ? calendar.indexOfIso(item.chosenStart!) + 1
        : calendar.indexOfIso(item.chosenStart!);
    let start = chosen;
    for (const link of incomingLinks.get(id) ?? []) {
      const predecessorStart = startNumber.get(link.from);
      const predecessorFinish = finishNumber.get(link.from);
      if (predecessorStart === undefined || predecessorFinish === undefined) continue;
      const bound = startBound(link.type, link.lag, predecessorStart, predecessorFinish, item.duration);
      if (bound > start) start = bound;
    }
    startNumber.set(id, start);
    finishNumber.set(id, start + item.duration);
  }

  const projectFinishNumber = ids.length > 0 ? Math.max(...ids.map((id) => finishNumber.get(id)!)) : null;

  const lateFinish = new Map<string, number>();
  for (const id of [...order].reverse()) {
    const item = stored.get(id)!;
    let value = projectFinishNumber!;
    for (const link of outgoingLinks.get(id) ?? []) {
      const successor = stored.get(link.to);
      const successorLateFinish = lateFinish.get(link.to);
      if (!successor || successorLateFinish === undefined) continue;
      const successorLateStart = successorLateFinish - successor.duration;
      const bound = lateFinishBound(
        link.type,
        link.lag,
        successorLateStart,
        successorLateFinish,
        item.duration,
      );
      if (bound < value) value = bound;
    }
    lateFinish.set(id, value);
  }

  const dates = new Map<string, { start: IsoDate; end: IsoDate }>();
  for (const id of ids) {
    const item = stored.get(id)!;
    const s = startNumber.get(id)!;
    const f = finishNumber.get(id)!;
    if (item.kind === 'milestone') {
      const iso = calendar.isoAt(s - 1);
      dates.set(id, { start: iso, end: iso });
    } else {
      dates.set(id, { start: calendar.isoAt(s), end: calendar.isoAt(f - 1) });
    }
  }

  const childrenOf = new Map<string, StoredItem[]>();
  for (const item of input.items) {
    if (item.kind === 'group') childrenOf.set(item.id, []);
  }
  for (const item of input.items) {
    if (item.group) childrenOf.get(item.group)?.push(item);
  }

  const items: ScheduledItem[] = input.items.map((item) => {
    if (item.kind === 'group') {
      const children = childrenOf.get(item.id) ?? [];
      const childDates = children.map((child) => dates.get(child.id)!);
      const start = childDates.length
        ? childDates.reduce((a, b) => (fromIso(b.start) < fromIso(a) ? b.start : a), childDates[0].start)
        : null;
      const end = childDates.length
        ? childDates.reduce((a, b) => (fromIso(b.end) > fromIso(a) ? b.end : a), childDates[0].end)
        : null;
      const tasks = children.filter((child) => child.kind === 'task');
      const totalDuration = tasks.reduce((sum, task) => sum + task.duration, 0);
      const percent =
        totalDuration > 0
          ? roundHalfUp(tasks.reduce((sum, task) => sum + task.duration * task.percent, 0) / totalDuration)
          : 0;
      const duration =
        start && end ? calendar.indexOfIso(end) - calendar.indexOfIso(start) + 1 : 0;
      return {
        id: item.id,
        row: rowOf.get(item.id)!,
        name: item.name,
        kind: 'group',
        group: null,
        chosenStart: null,
        start,
        end,
        duration,
        percent,
        critical: false,
        float: null,
        late: end !== null && fromIso(end) < todayDay && percent < 100,
        version: item.version,
        assignees: [],
        baseline: null,
        startNumber: null,
        finishNumber: null,
      };
    }

    const { start, end } = dates.get(item.id)!;
    const f = finishNumber.get(item.id)!;
    const float = lateFinish.get(item.id)! - f;
    const baselineEntry = input.baseline?.items.get(item.id) ?? null;
    return {
      id: item.id,
      row: rowOf.get(item.id)!,
      name: item.name,
      kind: item.kind,
      group: item.group,
      chosenStart: item.chosenStart,
      start,
      end,
      duration: item.duration,
      percent: item.percent,
      critical: float === 0,
      float,
      late: fromIso(end) < todayDay && item.percent < 100,
      version: item.version,
      assignees: item.assignees,
      baseline: baselineEntry
        ? {
            start: baselineEntry.start,
            end: baselineEntry.end,
            variance: calendar.signedWorkingDaysBetween(baselineEntry.end, end),
          }
        : null,
      startNumber: startNumber.get(item.id)!,
      finishNumber: f,
    };
  });

  const byId = new Map(items.map((item) => [item.id, item]));
  const links: Link[] = input.links.map((link) => ({
    id: link.id,
    from: link.from,
    to: link.to,
    type: link.type,
    lag: link.lag,
    critical: Boolean(byId.get(link.from)?.critical && byId.get(link.to)?.critical),
  }));

  const finish = projectFinishNumber === null ? null : calendar.isoAt(projectFinishNumber - 1);
  const baselineFinish = input.baseline?.finish ?? null;
  const finishVariance =
    finish && baselineFinish ? calendar.signedWorkingDaysBetween(baselineFinish, finish) : null;

  return {
    calendar,
    items,
    byId,
    links,
    finish,
    finishVariance,
    criticalCount: items.filter((item) => item.critical).length,
  };
}

/** The predecessor whose link gives the greatest start bound, for the constraint sentence. */
export function bindingPredecessor(
  schedule: Schedule,
  itemId: string,
  links: readonly StoredLink[],
): { name: string; start: IsoDate } | null {
  const item = schedule.byId.get(itemId);
  if (!item || item.startNumber === null) return null;
  let best: { name: string; row: number; bound: number } | null = null;
  for (const link of links) {
    if (link.to !== itemId) continue;
    const predecessor = schedule.byId.get(link.from);
    if (!predecessor || predecessor.startNumber === null || predecessor.finishNumber === null) continue;
    const bound = startBound(
      link.type,
      link.lag,
      predecessor.startNumber,
      predecessor.finishNumber,
      item.duration,
    );
    if (!best || bound > best.bound || (bound === best.bound && predecessor.row < best.row)) {
      best = { name: predecessor.name, row: predecessor.row, bound };
    }
  }
  if (!best) return null;
  return { name: best.name, start: item.start! };
}
