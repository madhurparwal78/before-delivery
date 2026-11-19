import {
  buildTimeline,
  cellIsLate,
  cellStateAt,
  slotOf,
  type CellState,
  type RestRule,
  type Timeline,
} from '../domain/rest-rules.js';
import {
  clockChangeKind,
  clockChangeLabel,
  offsetAt,
  shipDayBounds,
  shipDayCells,
  shipDateOf,
  type VesselClock,
  localReadingAt,
} from '../domain/ship-time.js';
import { shipDayStatus, type DayState } from '../domain/day-state.js';
import { computeWindow, type RestWindow } from '../domain/window-values.js';
import type { RuleSetPeriod } from '../domain/rule-sets.js';
import type { PositionFix } from '../domain/position.js';
import { HALF_HOUR_MS, HOUR_MS, formatInstant } from '../domain/time.js';
import * as store from '../db/store.js';

const TIMELINE_LOOKBACK_MS = 200 * HOUR_MS;
const TIMELINE_LOOKAHEAD_MS = 48 * HOUR_MS;

export type CrewContext = {
  crew: store.Crew;
  vessel: store.Vessel;
  clock: VesselClock;
  fixes: PositionFix[];
  ruleSets: RuleSetPeriod[];
  timeline: Timeline;
  entries: store.WatchEntryRow[];
};

export async function loadCrewContext(
  crew: store.Crew,
  fromMs: number,
  toMs: number,
): Promise<CrewContext> {
  const vessel = (await store.findVesselById(crew.vesselId)) as store.Vessel;
  const [clock, fixes, ruleSets] = await Promise.all([
    store.loadVesselClock(vessel),
    store.listFixes(vessel.id),
    store.listRuleSets(vessel.id),
  ]);
  const timelineFrom = fromMs - TIMELINE_LOOKBACK_MS;
  const timelineTo = toMs + TIMELINE_LOOKAHEAD_MS;
  const entries = await store.listEntriesInRange(crew.id, timelineFrom, timelineTo);
  const timeline = buildTimeline(
    entries
      .filter((entry) => entry.applied)
      .map((entry) => ({
        startMs: entry.startMs,
        endMs: entry.endMs,
        kind: entry.kind,
        late: entry.late,
      })),
    timelineFrom,
    timelineTo,
  );
  return { crew, vessel, clock, fixes, ruleSets, timeline, entries };
}

function windowInputs(context: CrewContext): {
  clock: VesselClock;
  fixes: PositionFix[];
  ruleSets: RuleSetPeriod[];
  timeline: Timeline;
} {
  return {
    clock: context.clock,
    fixes: context.fixes,
    ruleSets: context.ruleSets,
    timeline: context.timeline,
  };
}

export function computeWindowFor(
  context: CrewContext,
  startMs: number,
  hours: 24 | 168,
): RestWindow {
  return computeWindow(windowInputs(context), startMs, hours);
}

/** Records every breach found in computed windows: the first computation of a failing window records it. */
export async function recordBreachesFrom(
  crewId: string,
  windows: readonly RestWindow[],
  nowMs: number,
): Promise<void> {
  const breaches: {
    rule: RestRule;
    windowHours: 24 | 168;
    windowStartMs: number;
    ruleSet: 'standard' | 'flag_exception';
    restHours: number;
  }[] = [];
  for (const window of windows) {
    if (window.verdict !== 'breach') continue;
    for (const rule of window.rules_failed) {
      breaches.push({
        rule,
        windowHours: window.hours,
        windowStartMs: new Date(window.start_utc).getTime(),
        ruleSet: window.rule_set,
        restHours: window.rest_hours,
      });
    }
  }
  await store.recordBreaches(crewId, breaches, nowMs);
}

/** Recomputes and records breaches for every window that covers a changed stretch of the timeline. */
export async function recordBreachesAround(
  crew: store.Crew,
  changedFromMs: number,
  changedToMs: number,
  nowMs: number,
): Promise<void> {
  const context = await loadCrewContext(crew, changedFromMs - 168 * HOUR_MS, changedToMs);
  const windows: RestWindow[] = [];
  for (const hours of [24, 168] as const) {
    const firstStart = changedFromMs - hours * HOUR_MS + HALF_HOUR_MS;
    for (let startMs = firstStart; startMs < changedToMs; startMs += HALF_HOUR_MS) {
      windows.push(computeWindowFor(context, startMs, hours));
    }
  }
  await recordBreachesFrom(crew.id, windows, nowMs);
}

type DayCellPayload = {
  start_utc: string;
  ship_time: string;
  repeated: boolean;
  state: CellState;
  late: boolean;
};

export function dayCellsPayload(context: CrewContext, shipDate: string): DayCellPayload[] {
  return shipDayCells(context.clock, shipDate).map((cell) => {
    const slot = slotOf(context.timeline, cell.startMs);
    return {
      start_utc: formatInstant(cell.startMs),
      ship_time: cell.shipTime,
      repeated: cell.repeated,
      state: cellStateAt(context.timeline, slot),
      late: cellIsLate(context.timeline, slot),
    };
  });
}

export function dayRestHours(cells: readonly DayCellPayload[]): number {
  return cells.filter((cell) => cell.state === 'rest').length / 2;
}

export function entryPayload(entry: store.WatchEntryRow): Record<string, unknown> {
  return {
    id: entry.id,
    entry_key: entry.entryKey,
    start_utc: formatInstant(entry.startMs),
    end_utc: formatInstant(entry.endMs),
    kind: entry.kind,
    ship_date: entry.shipDate,
    late: entry.late,
    applied: entry.applied,
    received_at_utc: formatInstant(entry.receivedAtMs),
  };
}

function notePayload(note: store.NoteRow): Record<string, unknown> {
  return {
    id: note.id,
    ship_date: note.shipDate,
    text: note.text,
    event_id: note.eventId,
    author_role: note.authorRole,
    created_at_utc: formatInstant(note.createdAtMs),
  };
}

/** An event is a record mismatch while it overlaps logged rest and carries no note from either person. */
function eventMismatch(
  context: CrewContext,
  event: store.EventRow,
  notes: readonly store.NoteRow[],
): boolean {
  if (notes.some((note) => note.eventId === event.id)) return false;
  for (let ms = event.startMs; ms < event.endMs; ms += HALF_HOUR_MS) {
    const state = cellStateAt(context.timeline, slotOf(context.timeline, ms));
    if (state === 'rest' || state === 'short_break') return true;
  }
  return false;
}

export function eventPayload(
  context: CrewContext,
  event: store.EventRow,
  notes: readonly store.NoteRow[],
): Record<string, unknown> {
  return {
    id: event.id,
    crew_id: event.crewId,
    kind: event.kind,
    start_utc: formatInstant(event.startMs),
    end_utc: formatInstant(event.endMs),
    description: event.description,
    mismatch: eventMismatch(context, event, notes),
  };
}

type DayDetail = {
  ship_date: string;
  state: DayState;
  closes_at_utc: string;
  closes_at_ship_time: string;
  can_edit: boolean;
  server_now_utc: string;
  start_utc: string;
  end_utc: string;
  cell_count: number;
  cells: DayCellPayload[];
  rest_hours: number;
  entries: Record<string, unknown>[];
  notes: Record<string, unknown>[];
  events: Record<string, unknown>[];
  signed_at_utc: string | null;
  countersigned_at_utc: string | null;
};

export async function dayDetail(
  context: CrewContext,
  shipDate: string,
  nowMs: number,
): Promise<DayDetail> {
  const bounds = shipDayBounds(context.clock, shipDate);
  const signature = await store.findSignature(context.crew.id, shipDate);
  const status = shipDayStatus(bounds, signature, nowMs);
  const cells = dayCellsPayload(context, shipDate);
  const notes = await store.listNotes(context.crew.id, shipDate, shipDate);
  const allNotes = await store.listNotesForCrew(context.crew.id);
  const events = (await store.listEventsForCrew(context.crew.id)).filter(
    (event) => event.endMs > bounds.startMs && event.startMs < bounds.endMs,
  );
  const entries = await store.listEntriesForDay(context.crew.id, shipDate);
  return {
    ship_date: shipDate,
    state: status.state,
    closes_at_utc: formatInstant(status.closesAtMs),
    closes_at_ship_time: formatInstant(localReadingAt(context.clock, status.closesAtMs))
      .slice(0, 16)
      .replace('T', ' '),
    can_edit: status.canEdit,
    server_now_utc: formatInstant(nowMs),
    start_utc: formatInstant(bounds.startMs),
    end_utc: formatInstant(bounds.endMs),
    cell_count: bounds.cellCount,
    cells,
    rest_hours: dayRestHours(cells),
    entries: entries.map(entryPayload),
    notes: notes.map(notePayload),
    events: events.map((event) => eventPayload(context, event, allNotes)),
    signed_at_utc: signature?.signedAtMs == null ? null : formatInstant(signature.signedAtMs),
    countersigned_at_utc:
      signature?.countersignedAtMs == null ? null : formatInstant(signature.countersignedAtMs),
  };
}

type StripPayload = {
  start_utc: string;
  end_utc: string;
  cells: {
    start_utc: string;
    ship_date: string;
    ship_time: string;
    state: CellState;
    late: boolean;
  }[];
  clock_changes: Record<string, unknown>[];
  fixes: Record<string, unknown>[];
  windows: { '24': (RestWindow & { step: number })[]; '168': (RestWindow & { step: number })[] };
};

export const STRIP_HOURS = 336;

export function stripStartDefault(latestCellEndMs: number | null, nowMs: number): number {
  const anchor =
    latestCellEndMs ?? Math.ceil(nowMs / HALF_HOUR_MS) * HALF_HOUR_MS;
  return anchor - STRIP_HOURS * HOUR_MS;
}

export function buildStrip(context: CrewContext, startMs: number): StripPayload {
  const endMs = startMs + STRIP_HOURS * HOUR_MS;
  const cells: StripPayload['cells'] = [];
  for (let ms = startMs; ms < endMs; ms += HALF_HOUR_MS) {
    const slot = slotOf(context.timeline, ms);
    const localMs = ms + offsetAt(context.clock, ms) * 60_000;
    const hours = new Date(localMs).getUTCHours();
    const minutes = new Date(localMs).getUTCMinutes();
    cells.push({
      start_utc: formatInstant(ms),
      ship_date: shipDateOf(context.clock, ms),
      ship_time: `${hours < 10 ? '0' : ''}${hours}:${minutes < 10 ? '0' : ''}${minutes}`,
      state: cellStateAt(context.timeline, slot),
      late: cellIsLate(context.timeline, slot),
    });
  }
  const windows24: (RestWindow & { step: number })[] = [];
  for (let step = 0; step <= 624; step += 1) {
    windows24.push({ step, ...computeWindowFor(context, startMs + step * HALF_HOUR_MS, 24) });
  }
  const windows168: (RestWindow & { step: number })[] = [];
  for (let step = 0; step <= 336; step += 1) {
    windows168.push({ step, ...computeWindowFor(context, startMs + step * HALF_HOUR_MS, 168) });
  }
  return {
    start_utc: formatInstant(startMs),
    end_utc: formatInstant(endMs),
    cells,
    clock_changes: context.clock.changes
      .filter((change) => change.changesAtMs >= startMs && change.changesAtMs <= endMs)
      .map((change) => ({
        id: change.id,
        changes_at_utc: formatInstant(change.changesAtMs),
        old_offset_minutes: change.oldOffsetMinutes,
        new_offset_minutes: change.newOffsetMinutes,
        kind: clockChangeKind(change),
        label: clockChangeLabel(change),
        ship_date: shipDateOf(context.clock, change.changesAtMs),
      })),
    fixes: context.fixes
      .filter((fix) => fix.atMs >= startMs && fix.atMs <= endMs)
      .map((fix) => ({
        id: fix.id,
        at_utc: formatInstant(fix.atMs),
        latitude: fix.latitude,
        longitude: fix.longitude,
      })),
    windows: { '24': windows24, '168': windows168 },
  };
}

