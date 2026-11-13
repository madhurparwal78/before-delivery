// The published lane rule for overlapping events, and the day pieces a block
// is cut into at midnight in the viewer's zone.

import type { EventRecord } from "./api";
import { inZone, instantOf, minutesOfDay, parseLocal, type Wall, wallDate } from "./time";

/** displayWall gives the clock time a viewer reads an occurrence's edge at.
 *  An occurrence in the viewer's own zone reads its own shown clock time,
 *  which a recorded zone rule can shift; one in another zone is read from its
 *  instant. */
export function displayWall(occurrence: EventRecord, edge: "start" | "end", viewerZone: string): Wall {
  const local = edge === "start" ? occurrence.start_local : occurrence.end_local;
  if (occurrence.zone === viewerZone || occurrence.all_day) return parseLocal(local);
  const instant = edge === "start" ? occurrence.start_utc : occurrence.end_utc;
  if (!instant) return parseLocal(local);
  return inZone(Date.parse(instant), viewerZone);
}

export type Block = {
  occurrence: EventRecord;
  id: string;
  date: string;
  startMinutes: number;
  endMinutes: number;
  startInstant: number;
  endInstant: number;
  lane: number;
  lanes: number;
};

export function occurrenceID(occurrence: EventRecord): string {
  return occurrence.occurrence_id ?? occurrence.id ?? "";
}

/** isAllDayBand reports whether an occurrence sits in the top band: all-day
 *  events and timed events of 24 hours or more. */
export function isAllDayBand(occurrence: EventRecord): boolean {
  if (occurrence.all_day) return true;
  if (!occurrence.start_utc || !occurrence.end_utc) return false;
  return Date.parse(occurrence.end_utc) - Date.parse(occurrence.start_utc) >= 24 * 3600 * 1000;
}

/** bandDates lists the dates a top-band occurrence covers in a zone. */
export function bandDates(occurrence: EventRecord, zone: string): string[] {
  const dates: string[] = [];
  if (occurrence.all_day) {
    let date = occurrence.start_local.slice(0, 10);
    const last = occurrence.end_local.slice(0, 10);
    while (date <= last) {
      dates.push(date);
      date = nextDate(date);
    }
    return dates;
  }
  if (!occurrence.start_utc || !occurrence.end_utc) return dates;
  let date = wallDate(inZone(Date.parse(occurrence.start_utc), zone));
  const last = wallDate(inZone(Date.parse(occurrence.end_utc) - 60000, zone));
  while (date <= last) {
    dates.push(date);
    date = nextDate(date);
  }
  return dates;
}

function nextDate(date: string): string {
  const wall = parseLocal(date);
  const moved = new Date(Date.UTC(wall.y, wall.m - 1, wall.d) + 86400000);
  return moved.toISOString().slice(0, 10);
}

/** timedPieces cuts a timed occurrence at each midnight in the viewer's zone,
 *  giving one block for each of its days. */
export function timedPieces(occurrence: EventRecord, zone: string): Block[] {
  if (!occurrence.start_utc || !occurrence.end_utc) return [];
  const startWall = displayWall(occurrence, "start", zone);
  const endWall = displayWall(occurrence, "end", zone);
  const startInstant = instantOf(startWall, zone);
  const endInstant = instantOf(endWall, zone);
  const startDate = wallDate(startWall);
  const endDate = wallDate(endWall);
  const id = occurrenceID(occurrence);
  if (startDate === endDate || minutesOfDay(endWall) === 0) {
    return [
      {
        occurrence,
        id,
        date: startDate,
        startMinutes: minutesOfDay(startWall),
        endMinutes: minutesOfDay(endWall) === 0 ? 24 * 60 : minutesOfDay(endWall),
        startInstant,
        endInstant,
        lane: 0,
        lanes: 1,
      },
    ];
  }
  return [
    {
      occurrence, id, date: startDate, startMinutes: minutesOfDay(startWall), endMinutes: 24 * 60,
      startInstant, endInstant, lane: 0, lanes: 1,
    },
    {
      occurrence, id, date: endDate, startMinutes: 0, endMinutes: minutesOfDay(endWall),
      startInstant, endInstant, lane: 0, lanes: 1,
    },
  ];
}

/** assignLanes places a day's blocks by the published rule: one group per set
 *  of overlapping instants, longest first, then earliest, then event id, each
 *  in the leftmost lane it fits. */
export function assignLanes(blocks: Block[]): void {
  const sorted = [...blocks].sort((a, b) => a.startInstant - b.startInstant);
  let group: Block[] = [];
  let groupEnd = -Infinity;
  const finish = () => {
    if (group.length) layoutGroup(group);
    group = [];
    groupEnd = -Infinity;
  };
  for (const block of sorted) {
    if (group.length && block.startInstant >= groupEnd) finish();
    group.push(block);
    groupEnd = Math.max(groupEnd, block.endInstant);
  }
  finish();
}

function layoutGroup(group: Block[]): void {
  const order = [...group].sort((a, b) => {
    const durationA = a.endInstant - a.startInstant;
    const durationB = b.endInstant - b.startInstant;
    if (durationA !== durationB) return durationB - durationA;
    if (a.startInstant !== b.startInstant) return a.startInstant - b.startInstant;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const lanes: Block[][] = [];
  for (const block of order) {
    let placed = false;
    for (let index = 0; index < lanes.length; index += 1) {
      if (lanes[index].every((other) => block.startInstant >= other.endInstant || block.endInstant <= other.startInstant)) {
        lanes[index].push(block);
        block.lane = index;
        placed = true;
        break;
      }
    }
    if (!placed) {
      block.lane = lanes.length;
      lanes.push([block]);
    }
  }
  for (const block of group) block.lanes = lanes.length;
}
