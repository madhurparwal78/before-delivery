// The embedded file store: one SQLite file per serving port. Records are JSON documents with the
// columns each lookup needs; every write is synchronous, so a request's checks and writes are atomic.
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { HistoryEntry, Line, MoveStatus, Role, TonnageBand, VesselSummary } from "../shared/types.js";

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: Role;
  agency_code: string | null;
  salt: string;
  hash: string;
}

interface AgencyRecord {
  code: string;
  name: string;
  agent_email: string;
  killbill_account_id: string | null;
}

export interface VesselRecord extends VesselSummary {
  agency_code: string;
  speed_kn: number;
  draught_mm: number;
}

export interface PilotRecord {
  id: string;
  name: string;
  licence_class: string;
  position: number;
}

export interface DutyRecord {
  id: string;
  pilot_id: string;
  move_ref: string | null;
  start: number;
  end: number;
}

export interface CommittedWindow {
  boarding_at: string;
  pinch_waypoint: string;
  margin_mm: number;
  tide_version: number;
}

export interface DetentionSpan {
  start: number;
  end: number | null;
}

export interface MoveRecord {
  ref: string;
  seq: number;
  version: number;
  status: MoveStatus;
  agency_code: string;
  vessel: VesselSummary;
  draught_mm: number;
  speed_kn: number;
  duty_minutes: number;
  boarding_at: string;
  committed: CommittedWindow | null;
  pilot_id: string | null;
  pilots_ever: string[];
  late_amendments: number;
  detention: DetentionSpan[];
  history: HistoryEntry[];
  dispatcher_notes: { at: string; by: string; text: string }[];
  rest_override: { reason: string; pilot_id: string; by: string; at: string } | null;
  ladder_reports: string[];
}

export interface NoticeRecord {
  id: string;
  seq: number;
  move_ref: string;
  kind: string;
  to: string[];
  subject: string;
  body: string;
  photo_ids: string[];
  state: "pending" | "sent";
}

export type BillingEventKind = "Completed" | "Cancelled late" | "Refused at ladder";

export interface InvoiceRecord {
  id: string;
  seq: number;
  move_ref: string;
  agency_code: string;
  event: BillingEventKind;
  revision_id: string;
  lines: Line[];
  total_cents: number;
  charge_state: "pending" | "posted";
  charge_attempts: string[];
  killbill_invoice_id: string | null;
  issue_requested_by: string | null;
  state: "pending" | "issued";
  number: string | null;
  balance_cents: number | null;
  balance_confirmed_at: number | null;
}

export interface TariffRevisionRecord {
  id: string;
  label: string;
  effective_at: string;
  effective_instant: number;
  draft_foot_cents: number;
  minimum_cents: number;
  tonnage_bands: TonnageBand[];
  night_percent: number;
  detention_half_hour_cents: number;
  detention_allowance_half_hours: number;
  cancellation_cents: number;
}

export interface TideEvent {
  at: string;
  type: "high" | "low";
  height_mm: number;
}

interface TideRevisionRecord {
  date: string;
  version: number;
  events: TideEvent[];
}

export interface PhotoRecord {
  id: string;
  move_ref: string;
  uploader_id: string;
  sha256: string;
  size_bytes: number;
  content_type: string;
  key: string;
}

interface PilotCardRecord {
  id: string;
  seq: number;
  vessel_id: string;
  sha256: string;
  size_bytes: number;
  key: string;
}

export interface LadderReportRecord {
  id: string;
  seq: number;
  move_ref: string;
  compliant: boolean;
  defects: string[];
  refused: boolean;
  location: "deck" | "pilot_boat";
  note: string;
  photo_ids: string[];
  filed_by: string;
  filed_at: string;
}

interface SkipRecord {
  id: string;
  seq: number;
  pilot_id: string;
  reasons: string[];
  move_ref: string;
  at: string;
}

interface OverrideRecord {
  id: string;
  seq: number;
  move_ref: string;
  pilot_id: string;
  reason: string;
  by: string;
  at: string;
}

interface IdempotencyRecord {
  id: string;
  fingerprint: string;
  status: number;
  body: string;
  created: number;
}

interface SessionRecord {
  id: string;
  user_id: string;
}

type Index<T> = Record<string, (doc: T) => SQLInputValue>;

/** One document table; `by` reads through a secondary column. */
class Table<T> {
  private readonly columns: string[];

  constructor(
    private readonly db: DatabaseSync,
    private readonly name: string,
    private readonly keyOf: (doc: T) => string,
    private readonly indexes: Index<T> = {},
  ) {
    this.columns = Object.keys(indexes);
    const extra = this.columns.map((c) => `, ${c}`).join("");
    db.exec(`CREATE TABLE IF NOT EXISTS ${name} (id TEXT PRIMARY KEY, doc TEXT NOT NULL${extra})`);
    for (const c of this.columns) db.exec(`CREATE INDEX IF NOT EXISTS ${name}_${c} ON ${name} (${c})`);
  }

  get(id: string): T | null {
    const row = this.db.prepare(`SELECT doc FROM ${this.name} WHERE id = ?`).get(id);
    return row ? (JSON.parse(String(row.doc)) as T) : null;
  }

  all(): T[] {
    return this.db
      .prepare(`SELECT doc FROM ${this.name} ORDER BY rowid`)
      .all()
      .map((row) => JSON.parse(String(row.doc)) as T);
  }

  by(column: string, value: SQLInputValue): T[] {
    return this.db
      .prepare(`SELECT doc FROM ${this.name} WHERE ${column} = ? ORDER BY rowid`)
      .all(value)
      .map((row) => JSON.parse(String(row.doc)) as T);
  }

  put(doc: T): T {
    const values = this.columns.map((c) => this.indexes[c]?.(doc) ?? null);
    const marks = this.columns.map(() => ", ?").join("");
    const names = this.columns.map((c) => `, ${c}`).join("");
    this.db
      .prepare(`INSERT OR REPLACE INTO ${this.name} (id, doc${names}) VALUES (?, ?${marks})`)
      .run(this.keyOf(doc), JSON.stringify(doc), ...values);
    return doc;
  }

  remove(id: string): void {
    this.db.prepare(`DELETE FROM ${this.name} WHERE id = ?`).run(id);
  }
}

export class Store {
  readonly db: DatabaseSync;
  readonly users: Table<UserRecord>;
  readonly sessions: Table<SessionRecord>;
  readonly agencies: Table<AgencyRecord>;
  readonly vessels: Table<VesselRecord>;
  readonly pilots: Table<PilotRecord>;
  readonly duties: Table<DutyRecord>;
  readonly moves: Table<MoveRecord>;
  readonly notices: Table<NoticeRecord>;
  readonly invoices: Table<InvoiceRecord>;
  readonly tariffRevisions: Table<TariffRevisionRecord>;
  readonly tideRevisions: Table<TideRevisionRecord>;
  readonly photos: Table<PhotoRecord>;
  readonly pilotCards: Table<PilotCardRecord>;
  readonly ladderReports: Table<LadderReportRecord>;
  readonly skips: Table<SkipRecord>;
  readonly overrides: Table<OverrideRecord>;
  readonly idempotency: Table<IdempotencyRecord>;

  constructor(appRoot: string, port: number) {
    const dir = path.join(appRoot, "data");
    mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(path.join(dir, `store-${port}.sqlite`));
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
    this.db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const db = this.db;
    this.users = new Table(db, "users", (u) => u.id, { email: (u) => u.email });
    this.sessions = new Table(db, "sessions", (s) => s.id);
    this.agencies = new Table(db, "agencies", (a) => a.code);
    this.vessels = new Table(db, "vessels", (v) => v.id);
    this.pilots = new Table(db, "pilots", (p) => p.id);
    this.duties = new Table(db, "duties", (d) => d.id, { pilot_id: (d) => d.pilot_id, move_ref: (d) => d.move_ref });
    this.moves = new Table(db, "moves", (m) => m.ref, { status: (m) => m.status });
    this.notices = new Table(db, "notices", (n) => n.id, { move_ref: (n) => n.move_ref, state: (n) => n.state });
    this.invoices = new Table(db, "invoices", (i) => i.id, { move_ref: (i) => i.move_ref });
    this.tariffRevisions = new Table(db, "tariff_revisions", (r) => r.id, { effective_instant: (r) => r.effective_instant });
    this.tideRevisions = new Table(db, "tide_revisions", (t) => t.date);
    this.photos = new Table(db, "photos", (p) => p.id);
    this.pilotCards = new Table(db, "pilot_cards", (c) => c.id, { vessel_id: (c) => c.vessel_id });
    this.ladderReports = new Table(db, "ladder_reports", (r) => r.id, { move_ref: (r) => r.move_ref });
    this.skips = new Table(db, "skips", (s) => s.id);
    this.overrides = new Table(db, "overrides", (o) => o.id);
    this.idempotency = new Table(db, "idempotency", (k) => k.id, { created: (k) => k.created });
  }

  meta(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
    return row ? String(row.value) : null;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(key, value);
  }

  /** The next number of a named sequence, starting after `first - 1`. */
  next(sequence: string, first = 1): number {
    const value = Number(this.meta(`seq:${sequence}`) ?? first - 1) + 1;
    this.setMeta(`seq:${sequence}`, String(value));
    return value;
  }

  tideVersion(): number {
    return Number(this.meta("tide_version") ?? 1);
  }

  createdAt(): number {
    return Number(this.meta("created_at"));
  }

  transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
