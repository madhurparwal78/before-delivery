// A workbook's state is derived by folding its genesis content and its ordered op record through
// the shared engine. Nothing derived is stored; every read folds again.
import { type Sheet, type StationClock, type WorkbookContent, WorkbookEngine } from "../shared/engine.js";
import { type Op, applyOp } from "../shared/ops.js";
import { quoteSheetName, areaText } from "../shared/refs.js";
import { isError } from "../shared/values.js";
import { type Queryable } from "./db.js";
import { notFound } from "./errors.js";
import { type SeasonState } from "./rules/season.js";

export interface WorkbookRow {
  id: string;
  station_id: string;
  name: string;
  state: SeasonState;
  closes_at_local: string | null;
  closes_at_utc: Date | null;
  genesis: WorkbookContent;
  head_seq: number;
  sheet_count: number;
  updated_at: Date;
}

/** Ops as stored: the sync ops, plus the restore op that replaces the whole state. */
export type StoredOp = Op | { type: "restore"; versionNumber: number; content: WorkbookContent };

export interface Author {
  id: string;
  name: string;
}

interface Change {
  seq: number;
  author: Author | null;
}

export class DerivedWorkbook {
  readonly history = new Map<string, Change[]>();

  constructor(
    readonly engine: WorkbookEngine,
    public headSeq: number,
  ) {}

  /** Applies a stored op at `seq`, recording which cell inputs it changed and by whom. */
  apply(op: StoredOp, seq: number, author: Author | null): void {
    this.headSeq = seq;
    if (op.type === "restore") {
      for (const c of this.engine.replaceContent(op.content)) this.note(c.sheetId, c.cell, seq, author);
      return;
    }
    const before = op.type === "setCell" ? this.engine.input(op.sheetId, op.cell) : null;
    applyOp(this.engine, op);
    if (op.type === "setCell" && before !== op.input) this.note(op.sheetId, op.cell, seq, author);
  }

  private note(sheetId: string, cell: string, seq: number, author: Author | null): void {
    const k = `${sheetId}!${cell}`;
    const list = this.history.get(k) ?? [];
    list.push({ seq, author });
    this.history.set(k, list);
  }

  /** Conflict detection: was the cell changed after `baseSeq` by someone other than `memberId` (or by a restore)? */
  changedByOther(sheetId: string, cell: string, baseSeq: number, memberId: string): boolean {
    return (this.history.get(`${sheetId}!${cell}`) ?? []).some((c) => c.seq > baseSeq && c.author?.id !== memberId);
  }

  lastAuthor(sheetId: string, cell: string): Author | null {
    const list = this.history.get(`${sheetId}!${cell}`);
    return list?.length ? list[list.length - 1].author : null;
  }
}

export function stationClock(zone: string, at: Date = new Date()): StationClock {
  const ms = at.getTime();
  return { zone, nowMs: () => ms };
}

/** Folds the op record up to `uptoSeq` (default: all of it). */
export async function derive(db: Queryable, row: WorkbookRow, clock: StationClock, uptoSeq?: number): Promise<DerivedWorkbook> {
  const ops = await db.query<{ seq: number; body: StoredOp; author_id: string | null; author_name: string | null }>(
    "SELECT seq, body, author_id, author_name FROM ops WHERE workbook_id = $1 AND seq <= $2 ORDER BY seq",
    [row.id, uptoSeq ?? row.head_seq],
  );
  const derived = new DerivedWorkbook(new WorkbookEngine(row.genesis, clock), 0);
  for (const op of ops.rows) {
    derived.apply(op.body, op.seq, op.author_id ? { id: op.author_id, name: op.author_name ?? "" } : null);
  }
  return derived;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** A workbook of the member's own station; any other id answers exactly like one that does not exist. */
export async function stationWorkbook(db: Queryable, stationId: string, id: string, lock = false): Promise<WorkbookRow> {
  if (!isUuid(id)) throw notFound();
  const r = await db.query<WorkbookRow>(`SELECT * FROM workbooks WHERE id = $1 AND station_id = $2${lock ? " FOR UPDATE" : ""}`, [id, stationId]);
  if (!r.rows[0]) throw notFound();
  return r.rows[0];
}

// ---- response shapes ----

export function summary(row: WorkbookRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    state: row.state,
    closesAt: row.closes_at_local,
    closesAtUtc: row.closes_at_utc ? row.closes_at_utc.toISOString() : null,
    updatedAt: row.updated_at.toISOString(),
    sheetCount: row.sheet_count,
  };
}

export function cellOut(engine: WorkbookEngine, sheetId: string, cell: string): Record<string, unknown> {
  const { value, display } = engine.result(sheetId, cell);
  return isError(value) ? { value: null, display, error: value.error } : { value, display };
}

export function sheetsOut(engine: WorkbookEngine, withInputs: boolean): Array<Record<string, unknown>> {
  return engine.sheets.map((sheet, i) => {
    const cells: Record<string, unknown> = {};
    for (const [cell, stored] of sheet.cells) {
      if (stored.input === "") continue;
      const { value, display, error } = cellOut(engine, sheet.id, cell) as { value: unknown; display: string; error?: string };
      cells[cell] = withInputs
        ? { input: stored.input, value, display, format: stored.format, ...(error ? { error } : {}) }
        : { value, display, format: stored.format, ...(error ? { error } : {}) };
    }
    return withInputs ? { id: sheet.id, name: sheet.name, position: i + 1, cells } : { name: sheet.name, position: i + 1, cells };
  });
}

export function chartsOut(engine: WorkbookEngine): Array<Record<string, unknown>> {
  return engine.charts.map((chart) => {
    const sheet = engine.sheetById(chart.sheetId) as Sheet;
    return { id: chart.id, sheetId: chart.sheetId, sheetName: sheet.name, type: chart.type, title: chart.title, range: `${quoteSheetName(sheet.name)}!${areaText(chart.area)}`, ...engine.chartData(chart) };
  });
}
