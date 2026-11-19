import type { IsoDate, WorkCalendar } from "../shared/calendar";
import type { ItemKind, LinkType } from "../shared/types";

/** A task or milestone as the schedule sees it. */
export interface WorkItem {
  id: string;
  kind: Exclude<ItemKind, "group">;
  group: string | null;
  chosenStart: IsoDate;
  duration: number;
  percent: number;
}

interface ScheduleLink {
  id: string;
  from: string;
  to: string;
  type: LinkType;
  lag: number;
}

interface WorkSchedule {
  start: IsoDate;
  end: IsoDate;
  duration: number;
  percent: number;
  critical: boolean;
  float: number;
  late: boolean;
}

export interface ItemSchedule {
  start: IsoDate | null;
  end: IsoDate | null;
  duration: number;
  percent: number;
  critical: boolean;
  float: number | null;
  late: boolean;
}

export interface Schedule {
  items: Record<string, ItemSchedule>;
  /** For each task or milestone pushed past its chosen start, the predecessor whose link gives the greatest bound. */
  pushedBy: Record<string, string | undefined>;
  criticalLinks: Set<string>;
  finish: IsoDate | null;
}

interface Slot {
  startNumber: number;
  finishNumber: number;
  lateFinishNumber: number;
}

/** The link bound on the successor's start, in working-day numbers, given the predecessor's slot. */
function startBound(link: ScheduleLink, predecessor: Slot, successorDuration: number): number {
  switch (link.type) {
    case "FS":
      return predecessor.finishNumber + link.lag;
    case "SS":
      return predecessor.startNumber + link.lag;
    case "FF":
      return predecessor.finishNumber + link.lag - successorDuration;
    case "SF":
      return predecessor.startNumber + link.lag - successorDuration;
  }
}

/** The late-finish bound a link puts on its predecessor, given the successor's late finish. */
function lateFinishBound(link: ScheduleLink, successor: Slot, successorDuration: number, predecessorDuration: number): number {
  const lateStartNumber = successor.lateFinishNumber - successorDuration;
  switch (link.type) {
    case "FS":
      return lateStartNumber - link.lag;
    case "SS":
      return lateStartNumber - link.lag + predecessorDuration;
    case "FF":
      return successor.lateFinishNumber - link.lag;
    case "SF":
      return successor.lateFinishNumber - link.lag + predecessorDuration;
  }
}

function topologicalOrder(ids: string[], links: readonly ScheduleLink[]): string[] {
  const waiting = new Map(ids.map((id) => [id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const link of links) {
    waiting.set(link.to, (waiting.get(link.to) ?? 0) + 1);
    outgoing.set(link.from, [...(outgoing.get(link.from) ?? []), link.to]);
  }
  const order = ids.filter((id) => waiting.get(id) === 0);
  for (let next = 0; next < order.length; next++) {
    for (const successor of outgoing.get(order[next]) ?? []) {
      const remaining = (waiting.get(successor) ?? 0) - 1;
      waiting.set(successor, remaining);
      if (remaining === 0) order.push(successor);
    }
  }
  return order;
}

/** One recomputation of the whole project: forward pass, backward pass, float, critical path, rollups, late flags. */
export function computeSchedule(
  calendar: WorkCalendar,
  work: readonly WorkItem[],
  groupIds: readonly string[],
  links: readonly ScheduleLink[],
  today: IsoDate,
): Schedule {
  const workById: Record<string, WorkItem> = Object.fromEntries(work.map((item) => [item.id, item]));
  const order = topologicalOrder(work.map((item) => item.id), links);
  const incoming: Record<string, ScheduleLink[]> = Object.fromEntries(work.map((item) => [item.id, []]));
  const outgoing: Record<string, ScheduleLink[]> = Object.fromEntries(work.map((item) => [item.id, []]));
  for (const link of links) {
    incoming[link.to].push(link);
    outgoing[link.from].push(link);
  }

  const rowIndex: Record<string, number> = Object.fromEntries(work.map((item, index) => [item.id, index]));
  const slots: Record<string, Slot> = {};
  const pushedBy: Record<string, string | undefined> = {};
  for (const id of order) {
    const item = workById[id];
    const chosenNumber = calendar.workingDayNumber(calendar.nextWorking(item.chosenStart)) + (item.kind === "milestone" ? 1 : 0);
    let startNumber = chosenNumber;
    for (const link of incoming[id]) {
      const bound = startBound(link, slots[link.from], item.duration);
      const current = pushedBy[id];
      const beatsCurrent = bound > startNumber || (bound === startNumber && current !== undefined && rowIndex[link.from] < rowIndex[current]);
      if (beatsCurrent) {
        startNumber = bound;
        pushedBy[id] = link.from;
      }
    }
    slots[id] = { startNumber, finishNumber: startNumber + item.duration, lateFinishNumber: 0 };
  }

  const projectFinishNumber = Math.max(0, ...order.map((id) => slots[id].finishNumber));
  for (const id of [...order].reverse()) {
    const bounds = outgoing[id].map((link) => lateFinishBound(link, slots[link.to], workById[link.to].duration, workById[id].duration));
    slots[id].lateFinishNumber = Math.min(projectFinishNumber, ...bounds);
  }

  const result: Record<string, ItemSchedule> = {};
  const placed: Record<string, WorkSchedule> = {};
  for (const item of work) {
    const slot = slots[item.id];
    const start = calendar.dateOfWorkingDay(item.kind === "milestone" ? slot.startNumber - 1 : slot.startNumber);
    const end = item.kind === "milestone" ? start : calendar.dateOfWorkingDay(slot.finishNumber - 1);
    const float = slot.lateFinishNumber - slot.finishNumber;
    placed[item.id] = { start, end, duration: item.duration, percent: item.percent, critical: float === 0, float, late: end < today && item.percent < 100 };
    result[item.id] = placed[item.id];
  }

  for (const groupId of groupIds) {
    const members = work.filter((item) => item.group === groupId);
    const start = members.length ? members.map((item) => placed[item.id].start).reduce((a, b) => (a < b ? a : b)) : null;
    const end = members.length ? members.map((item) => placed[item.id].end).reduce((a, b) => (a > b ? a : b)) : null;
    const tasks = members.filter((item) => item.kind === "task");
    const taskDays = tasks.reduce((sum, item) => sum + item.duration, 0);
    const weighted = tasks.reduce((sum, item) => sum + item.duration * item.percent, 0);
    const percent = taskDays === 0 ? 0 : Math.floor((2 * weighted + taskDays) / (2 * taskDays));
    result[groupId] = {
      start,
      end,
      duration: start && end ? calendar.workingSpan(start, end) : 0,
      percent,
      critical: false,
      float: null,
      late: end !== null && end < today && percent < 100,
    };
  }

  const ends = Object.values(result).flatMap((entry) => (entry.end ? [entry.end] : []));
  const criticalLinks = new Set(links.filter((link) => result[link.from].critical && result[link.to].critical).map((link) => link.id));
  return { items: result, pushedBy, criticalLinks, finish: ends.length ? ends.reduce((a, b) => (a > b ? a : b)) : null };
}

/** Signed working days from the baseline end to the current end on the current calendar. */
export function varianceInWorkingDays(calendar: WorkCalendar, baselineEnd: IsoDate, currentEnd: IsoDate): number {
  return calendar.workingDayNumber(currentEnd) - calendar.workingDayNumber(baselineEnd);
}
