import { query } from "./db.js";
import { ShipTimeline } from "./timeline.js";
import { CellSample, RestPeriod, restHoursIn, restPeriodsFromCells, RuleSetKind, judgeWindow } from "./rest-rules.js";
import {
  DAY_MS, HALF_HOUR_MS, HOUR_MS, fromUtcString, isAligned, toShipDate, toShipTimeString, toUtcString,
} from "../shared/time.js";

export const DAY_CLOSE_SECONDS = Number(process.env.DAY_CLOSE_SECONDS ?? "172800");
const DAY_CLOSE_MS = DAY_CLOSE_SECONDS * 1000;

export interface CrewDayCell {
  start_utc: string;
  ship_time: string;
  repeated: boolean;
  state: "not_logged" | "rest" | "work" | "short_break" | "late";
}

export interface CrewDayView {
  ship_date: string;
  state: "open" | "closed" | "signed" | "countersigned";
  closes_at_utc: string;
  can_edit: boolean;
  server_now_utc: string;
  start_utc: string;
  end_utc: string;
  cell_count: number;
  cells: CrewDayCell[];
  rest_hours: number;
  entries: WatchEntryView[];
  notes: NoteView[];
  events: EventView[];
  signed_at_utc: string | null;
  countersigned_at_utc: string | null;
}

export interface WatchEntryView {
  id: string;
  entry_key: string;
  start_utc: string;
  end_utc: string;
  kind: "rest" | "work";
  ship_date: string;
  late: boolean;
  applied: boolean;
  received_at_utc: string;
}

export interface NoteView {
  id: string;
  ship_date: string;
  text: string;
  event_id: string | null;
  author_role: "owner_master" | "crew";
  created_at_utc: string;
}

export interface EventView {
  id: string;
  kind: "drill" | "call_out";
  start_utc: string;
  end_utc: string;
  description: string;
  mismatch: boolean;
}

/** Everything the crew-record endpoints need about one crew member. */
export class CrewRecord {
  readonly ruleSets: { from: string; until: string }[];

  constructor(
    readonly crewId: string,
    readonly vesselId: string,
    readonly timeline: ShipTimeline,
    ruleSets: { from: string; until: string }[],
    readonly now: number
  ) {
    this.ruleSets = ruleSets;
  }

  /** The rule set in force at an instant. */
  ruleSetAt(ms: number): RuleSetKind {
    for (const period of this.ruleSets) {
      const from = fromUtcString(period.from)!;
      const until = fromUtcString(period.until)!;
      if (ms >= from && ms < until) return "flag_exception";
    }
    return "standard";
  }

  /** The last half-hour cell logged by this crew member, or null with none. */
  async latestLoggedCellEnd(): Promise<number | null> {
    const rows = await query<{ max_end: string | null }>(
      `SELECT max(end_utc) AS max_end FROM watch_entries WHERE crew_id = $1 AND applied = true`, [this.crewId]);
    const maxEnd = rows[0]?.max_end;
    return maxEnd ? fromUtcString(maxEnd) : null;
  }

  /** Applied entries ordered as the server applied them. */
  async appliedEntries(): Promise<{ startMs: number; endMs: number; kind: "rest" | "work" }[]> {
    const rows = await query<{ start_utc: string; end_utc: string; kind: "rest" | "work" }>(
      `SELECT start_utc, end_utc, kind FROM watch_entries WHERE crew_id = $1 AND applied = true ORDER BY applied_order`,
      [this.crewId]);
    return rows.map((r) => ({ startMs: fromUtcString(r.start_utc)!, endMs: fromUtcString(r.end_utc)!, kind: r.kind }));
  }

  /**
   * The half-hour cell states a UTC range covers. A cell starting before
   * `fromMs` and ending after it counts, so windows starting mid-run keep
   * their full edge. A later entry replaces earlier ones cell by cell, in
   * the order the server applied them.
   */
  async cellStates(fromMs: number, toMs: number): Promise<Map<number, "rest" | "work">> {
    const entries = await this.appliedEntries();
    const states = new Map<number, "rest" | "work">();
    const firstCell = Math.floor(fromMs / HALF_HOUR_MS) * HALF_HOUR_MS;
    for (const entry of entries) {
      for (let t = Math.max(entry.startMs, firstCell); t < Math.min(entry.endMs, toMs); t += HALF_HOUR_MS) {
        states.set(t, entry.kind);
      }
    }
    return states;
  }

  /** The ship's date states recorded for the crew member, keyed by ship's date. */
  async dayStates(): Promise<Map<string, { state: "signed" | "countersigned"; signedAt: string | null; countersignedAt: string | null }>> {
    const rows = await query<{ ship_date: string; state: "signed" | "countersigned"; signed_at_utc: string | null; countersigned_at_utc: string | null }>(
      `SELECT ship_date, state, signed_at_utc, countersigned_at_utc FROM day_states WHERE crew_id = $1`, [this.crewId]);
    return new Map(rows.map((r) => [r.ship_date, { state: r.state, signedAt: r.signed_at_utc, countersignedAt: r.countersigned_at_utc }]));
  }

  /** The day's state, closed by the server's clock past `closes_at_utc` (Business rules). */
  dayStateOf(shipDate: string, recorded: { state: "signed" | "countersigned" } | undefined, nowMs: number): {
    state: "open" | "closed" | "signed" | "countersigned";
    closesAtMs: number;
    canEdit: boolean;
  } {
    const closesAt = this.dayEndMs(shipDate) + DAY_CLOSE_MS;
    let state: "open" | "closed" | "signed" | "countersigned";
    if (recorded?.state === "countersigned") state = "countersigned";
    else if (recorded?.state === "signed") state = "signed";
    else if (nowMs >= closesAt) state = "closed";
    else state = "open";
    return { state, closesAtMs: closesAt, canEdit: state === "open" };
  }

  /** The end instant of a ship's date: the next ship's day's start. */
  dayEndMs(shipDate: string): number {
    return this.timeline.dayStartUtc(addDay(shipDate));
  }

  /** Full day view for `GET /api/crew/{crew_id}/days/{ship_date}`. */
  async dayView(shipDate: string): Promise<CrewDayView> {
    const startMs = this.timeline.dayStartUtc(shipDate);
    const endMs = this.dayEndMs(shipDate);
    const states = await this.cellStates(startMs, endMs);
    const cells: CrewDayCell[] = [];
    for (let t = startMs; t < endMs; t += HALF_HOUR_MS) {
      const state = states.get(t);
      const shipTime = toShipTimeString(t, this.timeline.offsetAt(t));
      const repeated = this.timeline.isSecondPassOfRetard(t);
      let cellState: CrewDayCell["state"] = "not_logged";
      if (state === "rest") cellState = "rest";
      else if (state === "work") cellState = "work";
      cells.push({ start_utc: toUtcString(t), ship_time: shipTime, repeated, state: cellState });
    }
    // short_break and late markings come from runs and unapplied entries.
    markShortBreaks(cells);
    const lateSet = await this.lateCells(startMs, endMs);
    for (const cell of cells) {
      if (lateSet.has(cell.start_utc)) cell.state = "late";
    }
    const periods = restPeriodsFromCells(cells.map((c) => ({
      startMs: fromUtcString(c.start_utc)!,
      state: c.state === "rest" || c.state === "late" ? "rest" : c.state === "work" ? "work" : "not_logged",
    })));
    const restHours = restHoursIn(periods, startMs, endMs);

    const entries = await this.entryViewsForDay(shipDate);
    const notes = await this.noteViewsForDay(shipDate);
    const events = await this.eventViewsForDay(shipDate, notes);
    const recorded = (await this.dayStates()).get(shipDate);
    const { state, closesAtMs, canEdit } = this.dayStateOf(shipDate, recorded, this.now);
    return {
      ship_date: shipDate,
      state,
      closes_at_utc: toUtcString(closesAtMs),
      can_edit: canEdit,
      server_now_utc: toUtcString(this.now),
      start_utc: toUtcString(startMs),
      end_utc: toUtcString(endMs),
      cell_count: cells.length,
      cells,
      rest_hours: restHours,
      entries,
      notes,
      events,
      signed_at_utc: recorded?.signedAt ?? null,
      countersigned_at_utc: recorded?.countersignedAt ?? null,
    };
  }

  /** Late cells: applied entries with `late:true` that cover instants of this day. */
  async lateCells(startMs: number, endMs: number): Promise<Set<string>> {
    const rows = await query<{ start_utc: string; end_utc: string }>(
      `SELECT start_utc, end_utc FROM watch_entries WHERE crew_id = $1 AND applied = true AND late = true`, [this.crewId]);
    const lateSet = new Set<string>();
    for (const row of rows) {
      const from = Math.max(fromUtcString(row.start_utc)!, startMs);
      const to = Math.min(fromUtcString(row.end_utc)!, endMs);
      for (let t = from; t < to; t += HALF_HOUR_MS) lateSet.add(toUtcString(t));
    }
    return lateSet;
  }

  async entryViewsForDay(shipDate: string): Promise<WatchEntryView[]> {
    const rows = await query<{ id: string; entry_key: string; start_utc: string; end_utc: string; kind: "rest" | "work"; ship_date: string; late: boolean; applied: boolean; received_at_utc: string }>(
      `SELECT id, entry_key, start_utc, end_utc, kind, ship_date, late, applied, received_at_utc
       FROM watch_entries WHERE crew_id = $1 AND ship_date = $2 ORDER BY applied_order`, [this.crewId, shipDate]);
    return rows.map((r) => ({
      id: r.id, entry_key: r.entry_key, start_utc: r.start_utc, end_utc: r.end_utc, kind: r.kind,
      ship_date: r.ship_date, late: r.late, applied: r.applied, received_at_utc: r.received_at_utc,
    }));
  }

  async noteViewsForDay(shipDate: string): Promise<NoteView[]> {
    const rows = await query<{ id: string; text: string; event_id: string | null; author_role: "owner_master" | "crew"; created_at_utc: string }>(
      `SELECT id, text, event_id, author_role, created_at_utc FROM notes WHERE crew_id = $1 AND ship_date = $2 ORDER BY created_at_utc, id`,
      [this.crewId, shipDate]);
    return rows.map((r) => ({
      id: r.id, ship_date: shipDate, text: r.text, event_id: r.event_id, author_role: r.author_role, created_at_utc: r.created_at_utc,
    }));
  }

  /** Events of the crew member overlapping the day, with mismatch checked at read time. */
  async eventViewsForDay(shipDate: string, notes: NoteView[]): Promise<EventView[]> {
    const startMs = this.timeline.dayStartUtc(shipDate);
    const endMs = this.dayEndMs(shipDate);
    const rows = await query<{ id: string; kind: "drill" | "call_out"; start_utc: string; end_utc: string; description: string }>(
      `SELECT id, kind, start_utc, end_utc, description FROM events WHERE crew_id = $1 AND start_utc < $2 AND end_utc > $3
       ORDER BY start_utc`,
      [this.crewId, toUtcString(endMs), toUtcString(startMs)]);
    const states = await this.cellStates(startMs, endMs);
    const noted = new Set(notes.filter((n) => n.event_id).map((n) => n.event_id));
    return rows.map((r) => {
      let overlapsRest = false;
      for (let t = Math.max(fromUtcString(r.start_utc)!, startMs); t < Math.min(fromUtcString(r.end_utc)!, endMs); t += HALF_HOUR_MS) {
        const state = states.get(t);
        if (state === "rest") { overlapsRest = true; break; }
      }
      return {
        id: r.id, kind: r.kind, start_utc: r.start_utc, end_utc: r.end_utc, description: r.description,
        mismatch: overlapsRest && !noted.has(r.id),
      };
    });
  }

  /** Rolling rest totals for the last 24 and 168 elapsed hours at `asOf`. */
  async rolling(asOfMs: number): Promise<{ restHours24: number; restHours168: number; verdict24: "pass" | "breach" | "incomplete"; verdict168: "pass" | "breach" | "incomplete" }> {
    const from168 = asOfMs - 168 * HOUR_MS;
    // A one-hour margin either side keeps runs crossing an edge whole.
    const cells = await this.cellSampleRange(from168 - HOUR_MS, asOfMs + HOUR_MS);
    const periods = restPeriodsFromCells(cells);
    const restHours24 = restHoursIn(periods, asOfMs - 24 * HOUR_MS, asOfMs);
    const restHours168 = restHoursIn(periods, from168, asOfMs);
    const judgement24 = judgeWindow(cells, asOfMs - 24 * HOUR_MS, 24, this.ruleSetAt(asOfMs));
    const judgement168 = judgeWindow(cells, asOfMs - 168 * HOUR_MS, 168, this.ruleSetAt(asOfMs));
    return {
      restHours24,
      restHours168,
      verdict24: verdictOf(judgement24, cellsForWindow(cells, asOfMs - 24 * HOUR_MS, asOfMs)),
      verdict168: verdictOf(judgement168, cellsForWindow(cells, asOfMs - 168 * HOUR_MS, asOfMs)),
    };
  }

  /** Half-hour CellSamples over a UTC range, cell-aligned at both edges. */
  async cellSampleRange(fromMs: number, toMs: number): Promise<CellSample[]> {
    const states = await this.cellStates(fromMs, toMs);
    const cells: CellSample[] = [];
    const firstCell = Math.floor(fromMs / HALF_HOUR_MS) * HALF_HOUR_MS;
    for (let t = firstCell; t < toMs; t += HALF_HOUR_MS) {
      const state = states.get(t);
      cells.push({ startMs: t, state: state ?? "not_logged" });
    }
    return cells;
  }
}

function verdictOf(judgement: { failedRules: string[] }, windowCells: CellSample[]): "pass" | "breach" | "incomplete" {
  if (windowCells.some((c) => c.state === "not_logged")) return "incomplete";
  return judgement.failedRules.length > 0 ? "breach" : "pass";
}

function cellsForWindow(cells: CellSample[], fromMs: number, toMs: number): CellSample[] {
  return cells.filter((c) => c.startMs >= fromMs && c.startMs < toMs);
}

function markShortBreaks(cells: CrewDayCell[]): void {
  // A lone rest cell or a rest run shorter than one hour is a short break.
  const n = cells.length;
  const isRest = (i: number) => cells[i]!.state === "rest";
  for (let i = 0; i < n; i++) {
    if (!isRest(i)) continue;
    let start = i;
    while (start > 0 && isRest(start - 1)) start--;
    let end = i;
    while (end < n - 1 && isRest(end + 1)) end++;
    if (end - start + 1 < 2) cells[i]!.state = "short_break";
  }
}

function addDay(shipDate: string): string {
  return toShipDate(fromUtcString(`${shipDate}T00:00:00Z`)! + DAY_MS);
}
