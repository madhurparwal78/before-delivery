import { addDays, dayNumber, daysBetween, mondayOf, type IsoDate, WorkCalendar } from "../shared/calendar";
import type { Item, Link, LinkType, Project } from "../shared/types";

export const DAY_PX = 32;
export const ROW_PX = 44;
export const MONTH_ROW_PX = 24;
export const DAY_ROW_PX = 44;
export const HEADER_PX = MONTH_ROW_PX + DAY_ROW_PX;

export interface ChartDay {
  date: IsoDate;
  working: boolean;
  holiday: string | null;
}

/** The chart runs from the Monday a week before the earliest start to the Sunday two weeks after the finish week. */
export function chartDays(project: Project, today: IsoDate, calendar: WorkCalendar): ChartDay[] {
  const starts = project.items.flatMap((item) => (item.start ? [item.start] : []));
  const earliest = starts.length ? starts.reduce((a, b) => (a < b ? a : b)) : today;
  const first = addDays(mondayOf(earliest), -7);
  const last = addDays(mondayOf(project.finish ?? today), 6 + 14);
  const holidays = new Map(project.holidays.map((holiday) => [holiday.date, holiday.name]));
  return Array.from({ length: dayNumber(last) - dayNumber(first) + 1 }, (_, offset) => {
    const date = addDays(first, offset);
    return { date, working: calendar.isWorking(date), holiday: holidays.get(date) ?? null };
  });
}

export interface Place {
  left: number;
  width: number;
  row: number;
}

export function placeOf(item: Item, first: IsoDate, start: IsoDate, end: IsoDate): Place {
  const left = daysBetween(first, start) * DAY_PX;
  return { left, width: (daysBetween(start, end) + 1) * DAY_PX, row: item.row - 1 };
}

/** Columns a float tail covers after a bar's end column: through the last of its float's working days. */
export function tailColumns(endColumn: number, float: number, days: readonly ChartDay[]): number {
  let column = endColumn + 1;
  let remaining = float;
  while (remaining > 0 && column < days.length) {
    if (days[column].working) remaining--;
    column++;
  }
  return column - (endColumn + 1);
}

/** The elbow connector between two bars, as an SVG path; `shift` moves each end for a bar mid-slide. */
export function connectorPath(link: Link, from: Place, to: Place, fromShift: number, toShift: number): string {
  const leavesFromEnd: Record<LinkType, boolean> = { FS: true, FF: true, SS: false, SF: false };
  const entersAtStart: Record<LinkType, boolean> = { FS: true, SS: true, FF: false, SF: false };
  const fromEnd = leavesFromEnd[link.type];
  const toStart = entersAtStart[link.type];
  const sx = from.left + fromShift + (fromEnd ? from.width : 0);
  const ex = to.left + toShift + (toStart ? 0 : to.width);
  const sy = from.row * ROW_PX + ROW_PX / 2;
  const ey = to.row * ROW_PX + ROW_PX / 2;
  const leave = fromEnd ? 10 : -10;
  const approach = toStart ? -10 : 10;
  const turnX = sx + leave;
  const lastX = ex + approach;
  const head = toStart ? "m-5 -3 l5 3 l-5 3" : "m5 -3 l-5 3 l5 3";
  const direct = (lastX - turnX) * leave > 0 && toStart === fromEnd;
  if (direct) return `M${sx} ${sy} H${turnX} V${ey} H${ex} ${head}`;
  const midY = (sy + ey) / 2;
  return `M${sx} ${sy} H${turnX} V${midY} H${lastX} V${ey} H${ex} ${head}`;
}
