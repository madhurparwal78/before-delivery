// The one embedded file store. Each serving instance keeps its own store
// under /app, separated by its port, and the schema and seed apply
// idempotently on serve.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { portInstant, formatPortDate } from './porttime.js';
import { computePlan } from './plan.js';
import { eventLines, totalOf, type TariffRevision } from './tariff.js';
import { INITIAL_TIDE_VERSION, STANDARD_DAY, ROUTE } from './route.js';
import type {
  Agency, HistoryEntry, IdempotencyRecord, Invoice, LadderReport, Move, MoveStatus,
  NoticeRecord, OverrideRecord, PendingStep, Pilot, PilotCard, Session, SkipRecord,
  StoredPhoto, TideRevisionRow, TariffRevisionRow, User, Vessel,
} from './types.js';

export interface StorePaths {
  root: string;
}

interface StoreState {
  users: User[];
  sessions: Session[];
  agencies: Agency[];
  vessels: Vessel[];
  pilots: Pilot[];
  pilot_order: string[];
  seeded_duties: Record<string, { start_ms: number; minutes: number }[]>;
  moves: Move[];
  photos: StoredPhoto[];
  pilot_cards: PilotCard[];
  ladder_reports: LadderReport[];
  invoices: Invoice[];
  skips: SkipRecord[];
  overrides: OverrideRecord[];
  idempotency: IdempotencyRecord[];
  pending_steps: PendingStep[];
  tide_revisions: TideRevisionRow[];
  tariff_revisions: TariffRevisionRow[];
  tide_version: number;
  store_created_ms: number;
  store_date: string;
  next_ids: Record<string, number>;
  photo_store: Record<string, string>; // base64 payloads of unconfirmed or confirmed local objects
}

export const SEED_PASSWORD = 'Slackwater-2026';

export const SEED_TARIFF: TariffRevision = {
  label: 'T-2026-A',
  effective_at: '2026-01-01T00:00',
  draft_foot_cents: 4250,
  minimum_cents: 200000,
  tonnage_bands: [
    { from_gt: 0, to_gt: 9999, cents: 48000 },
    { from_gt: 10000, to_gt: 29999, cents: 86000 },
    { from_gt: 30000, to_gt: 59999, cents: 134000 },
    { from_gt: 60000, to_gt: null, cents: 192500 },
  ],
  night_percent: 25,
  detention_half_hour_cents: 16500,
  detention_allowance_half_hours: 1,
  cancellation_cents: 38000,
};

export class Store {
  private state: StoreState;
  private readonly file: string;

  constructor(root: string) {
    this.file = path.join(root, 'store.json');
    this.state = emptyState();
  }

  get createdMs(): number {
    return this.state.store_created_ms;
  }

  get storeDate(): string {
    return this.state.store_date;
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw) as StoreState;
      this.state = mergeState(parsed);
    } catch {
      this.state = emptyState();
      await this.seed();
    }
    await this.persist();
  }

  private async persist(): Promise<void> {
    const dir = path.dirname(this.file);
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.state), 'utf8');
    await fs.rename(tmp, this.file);
  }

  // Seeding happens once, when the store is first created.
  private async seed(): Promise<void> {
    const now = Date.now();
    const storeDate = formatPortDate(now);
    this.state.store_created_ms = now;
    this.state.store_date = storeDate;

    this.state.agencies = [
      { code: 'CORV', name: 'Corvane Shipping Agency' },
      { code: 'TIDE', name: 'Tidewell Agencies' },
    ];

    this.state.users = [
      { id: 'U-01', email: 'dispatch1@ebbstone.example', name: 'Hana Lindqvist', role: 'dispatcher', agency_code: null },
      { id: 'U-02', email: 'dispatch2@ebbstone.example', name: 'Callum Adeyemi', role: 'dispatcher', agency_code: null },
      { id: 'U-03', email: 'accounts@ebbstone.example', name: 'Rosalind Pike', role: 'clerk', agency_code: null },
      { id: 'U-04', email: 'agent@corvane.example', name: 'Dario Veitch', role: 'agent', agency_code: 'CORV' },
      { id: 'U-05', email: 'agent@tidewell.example', name: 'Mina Sorrell', role: 'agent', agency_code: 'TIDE' },
    ];

    this.state.vessels = [
      { id: 'V-01', name: 'Tern Arrow', imo: '9700011', agency_code: 'CORV', length_m: 229, gross_tonnage: 43500, block_coefficient: 0.8, default_speed_kn: 10, default_draught_mm: 11200 },
      { id: 'V-02', name: 'Kestrel Bay', imo: '9700023', agency_code: 'CORV', length_m: 148, gross_tonnage: 12400, block_coefficient: 0.72, default_speed_kn: 9, default_draught_mm: 7600 },
      { id: 'V-03', name: 'Halcyon Reef', imo: '9700035', agency_code: 'TIDE', length_m: 190, gross_tonnage: 28900, block_coefficient: 0.78, default_speed_kn: 10, default_draught_mm: 9800 },
      { id: 'V-04', name: 'Marram Light', imo: '9700047', agency_code: 'TIDE', length_m: 289, gross_tonnage: 71200, block_coefficient: 0.82, default_speed_kn: 9, default_draught_mm: 12900 },
      { id: 'V-05', name: 'Sable Quay', imo: '9700059', agency_code: 'TIDE', length_m: 262, gross_tonnage: 64800, block_coefficient: 0.76, default_speed_kn: 8, default_draught_mm: 11400 },
    ];

    const pilotRows: [string, string, 'A' | 'B' | 'C', string][] = [
      ['P-01', 'Maren Holt', 'A', 'p01@ebbstone.example'],
      ['P-02', 'Tobias Reyne', 'B', 'p02@ebbstone.example'],
      ['P-03', 'Anneke Dwyer', 'C', 'p03@ebbstone.example'],
      ['P-04', 'Ruairi Banks', 'A', 'p04@ebbstone.example'],
      ['P-05', 'Owen Castellane', 'B', 'p05@ebbstone.example'],
      ['P-06', 'Nadia Ferreira', 'B', 'p06@ebbstone.example'],
      ['P-07', 'Idris Mallory', 'B', 'p07@ebbstone.example'],
      ['P-08', 'Keziah Tran', 'C', 'p08@ebbstone.example'],
      ['P-09', 'Lucan Ward', 'A', 'p09@ebbstone.example'],
      ['P-10', 'Petra Solis', 'C', 'p10@ebbstone.example'],
    ];
    this.state.pilots = pilotRows.map(([id, name, licence_class, email]) => ({ id, name, licence_class, email }));
    this.state.users.push(
      ...pilotRows.map(([id, , , email]) => ({ id, email, name: this.state.pilots.find((p) => p.id === id)!.name, role: 'pilot' as const, agency_code: null })),
    );
    this.state.pilot_order = pilotRows.map(([id]) => id);

    // Seeded duties, which count for every rest rule.
    this.state.seeded_duties = {};
    const seeded: Record<string, { start_ms: number; minutes: number }[]> = {
      'P-05': [],
      'P-06': [],
      'P-07': [],
    };
    for (let i = 14; i >= 0; i--) {
      seeded['P-05']!.push({ start_ms: portInstant(shiftDate(storeDate, -i), '09:00')!, minutes: 60 });
    }
    for (const i of [1, 2, 3]) {
      seeded['P-06']!.push({ start_ms: portInstant(shiftDate(storeDate, i), '23:00')!, minutes: 300 });
    }
    seeded['P-07']!.push({ start_ms: portInstant(shiftDate(storeDate, 2), '08:00')!, minutes: 480 });
    this.state.seeded_duties = seeded;

    this.state.tariff_revisions = [
      {
        id: 'TR-2',
        label: SEED_TARIFF.label,
        effective_at: SEED_TARIFF.effective_at,
        effective_ms: portInstant(SEED_TARIFF.effective_at.slice(0, 10), SEED_TARIFF.effective_at.slice(11, 16))!,
        body: JSON.stringify(SEED_TARIFF),
      },
    ];

    // Seeded moves.
    const creationStep = Math.floor(now / (5 * 60_000)) * 5 * 60_000;
    const boardingAt = (date: string, time: string) => portInstant(date, time)!;
    const d = (n: number) => shiftDate(storeDate, n);
    const mk = (ref: string, vesselId: string, status: MoveStatus, boardingMs: number, pilotId: string | null, dutyMinutes: number): Move => ({
      ref, version: 1, status,
      agency_code: this.state.vessels.find((v) => v.id === vesselId)!.agency_code,
      vessel_id: vesselId,
      draught_mm: this.state.vessels.find((v) => v.id === vesselId)!.default_draught_mm,
      speed_kn: this.state.vessels.find((v) => v.id === vesselId)!.default_speed_kn,
      duty_minutes: dutyMinutes,
      block_coefficient: this.state.vessels.find((v) => v.id === vesselId)!.block_coefficient,
      length_m: this.state.vessels.find((v) => v.id === vesselId)!.length_m,
      gross_tonnage: this.state.vessels.find((v) => v.id === vesselId)!.gross_tonnage,
      boarding_ms: boardingMs,
      committed: null,
      pilot_id: pilotId,
      notices: [],
      billing_events: [],
      late_amendments: 0,
      detention_spans: [],
      detention_open: false,
      ladder_report_ids: [],
      history: [{ at_ms: now, status, by: 'seed' }],
      dispatcher_notes: [],
      rest_override: null,
      correction: null,
      created_ms: now,
    });

    const seedMoves: Move[] = [];
    seedMoves.push(mk('MV-1001', 'V-01', 'Ordered', boardingAt(d(2), '06:00'), null, 360));
    seedMoves.push(mk('MV-1002', 'V-02', 'Ordered', boardingAt(d(2), '12:00'), null, 240));
    seedMoves.push(mk('MV-1003', 'V-03', 'Window committed', boardingAt(d(2), '05:30'), null, 300));
    seedMoves.push(mk('MV-1004', 'V-05', 'Pilot assigned', boardingAt(d(2), '05:00'), 'P-04', 300));
    seedMoves.push(mk('MV-1005', 'V-02', 'Pilot away', boardingAt(d(1), '08:00'), 'P-10', 240));
    const sixtyBefore = (creationStep - 60 * 60_000);
    seedMoves.push(mk('MV-1006', 'V-03', 'On board', sixtyBefore, 'P-02', 300));
    seedMoves.push(mk('MV-1007', 'V-01', 'On board', sixtyBefore, 'P-09', 300));
    seedMoves.push(mk('MV-1008', 'V-02', 'On board', sixtyBefore, 'P-08', 240));
    seedMoves.push(mk('MV-1009', 'V-01', 'Completed', boardingAt(d(-1), '05:30'), 'P-09', 300));
    seedMoves.push(mk('MV-1010', 'V-03', 'Completed', boardingAt(d(-1), '14:00'), 'P-02', 300));

    // Committed values come from the formula at seeding.
    for (const move of seedMoves) {
      const plan = this.planFor(move);
      if (move.status === 'Window committed' || move.status === 'Pilot assigned') {
        move.committed = {
          boarding_ms: move.boarding_ms,
          pinch_waypoint: pinchName(plan.pinchWaypointId),
          margin_mm: plan.pinchMarginMm,
          tide_version: this.state.tide_version,
        };
      }
    }

    // MV-1009 and MV-1010 have their lines stored at seeding, and the pending
    // step posts their charges.
    for (const move of seedMoves) {
      if (move.ref === 'MV-1009' || move.ref === 'MV-1010') {
        this.raiseBillingEvent(move, 'Completed');
      }
    }
    this.state.moves = seedMoves;
    await this.persist();
  }

  // The plan for a move, computed from its current values.
  planFor(move: Move) {
    return computePlan({
      draught_mm: move.draught_mm,
      speed_kn: move.speed_kn,
      block_coefficient: move.block_coefficient,
      boardingMs: move.boarding_ms,
      tideEventsFor: (date: string) => this.eventsForDate(date),
      tideVersion: this.state.tide_version,
    });
  }

  // The published day table for a date: its revision's events, or the seeded
  // standard day when none was published.
  eventsForDate(date: string) {
    const row = this.state.tide_revisions.find((r) => r.date === date);
    if (row) return JSON.parse(row.events) as { at: string; type: 'high' | 'low'; height_mm: number }[];
    return STANDARD_DAY;
  }

  raiseBillingEvent(move: Move, kind: 'Completed' | 'Cancelled late' | 'Refused at ladder'): void {
    const revision = this.tariffForInstant(move.boarding_ms);
    const detentionSeconds = move.detention_spans.reduce(
      (acc, s) => acc + Math.max(0, Math.floor((s.end_ms - s.start_ms) / 1000)),
      0,
    );
    const lines = eventLines(
      {
        kind,
        draughtMm: move.draught_mm,
        grossTonnage: move.gross_tonnage,
        boardingMs: move.boarding_ms,
        detentionSeconds,
        lateAmendments: move.late_amendments,
        // The half-hour length is 1,800 seconds unless the environment sets it.
        detentionUnitSeconds: Number(process.env.DETENTION_UNIT_SECONDS ?? 1800),
      },
      revision,
    );
    const total = totalOf(lines);
    const invoiceId = `INV-${this.nextInvoiceNumber()}`;
    const index = move.billing_events.length;
    move.billing_events.push({
      kind,
      lines,
      total_cents: total,
      invoice_id: invoiceId,
      at_ms: Date.now(),
    });
    move.late_amendments = 0;
    this.state.invoices.push({
      id: invoiceId,
      move_ref: move.ref,
      agency_code: move.agency_code,
      event_kind: kind,
      lines,
      total_cents: total,
      charge_state: 'pending',
      state: 'pending',
      number: null,
      balance_cents: null,
      kb_invoice_id: null,
      billing_event_index: index,
    });
    this.state.pending_steps.push({
      id: `PS-${this.nextPendingNumber()}`,
      kind: 'charge_post',
      payload: JSON.stringify({ invoice_id: invoiceId }),
      state: 'pending',
      attempts: 0,
      attempt_token: null,
      at_ms: Date.now(),
    });
  }

  tariffForInstant(ms: number): TariffRevision {
    const inForce = this.state.tariff_revisions
      .filter((r) => r.effective_ms <= ms)
      .sort((a, b) => a.effective_ms - b.effective_ms);
    const row = inForce[inForce.length - 1];
    if (!row) throw new Error('no tariff revision in force');
    return JSON.parse(row.body) as TariffRevision;
  }

  // ---- accessors ---------------------------------------------------------
  get users(): User[] { return this.state.users; }
  get moves(): Move[] { return this.state.moves; }
  get vessels(): Vessel[] { return this.state.vessels; }
  get pilots(): Pilot[] { return this.state.pilots; }
  get pilotOrder(): string[] { return this.state.pilot_order; }
  get invoices(): Invoice[] { return this.state.invoices; }
  get skips(): SkipRecord[] { return this.state.skips; }
  get overrides(): OverrideRecord[] { return this.state.overrides; }
  get pendingSteps(): PendingStep[] { return this.state.pending_steps; }
  get idempotency(): IdempotencyRecord[] { return this.state.idempotency; }
  get sessions(): Session[] { return this.state.sessions; }
  get agencies(): Agency[] { return this.state.agencies; }
  get photos(): StoredPhoto[] { return this.state.photos; }
  get ladderReports(): LadderReport[] { return this.state.ladder_reports; }
  get pilotCards(): PilotCard[] { return this.state.pilot_cards; }
  get tariffRevisions(): TariffRevisionRow[] { return this.state.tariff_revisions; }
  get tideRevisions(): TideRevisionRow[] { return this.state.tide_revisions; }
  get tideVersion(): number { return this.state.tide_version; }
  get seededDuties(): Record<string, { start_ms: number; minutes: number }[]> { return this.state.seeded_duties; }
  get storeCreatedMs(): number { return this.state.store_created_ms; }

  set tideVersion(v: number) { this.state.tide_version = v; }
  set pilotOrder(order: string[]) { this.state.pilot_order = order; }

  private nextInvoiceNumber(): number { return this.state.next_ids.invoice = (this.state.next_ids.invoice ?? 0) + 1; }
  private nextPendingNumber(): number { return this.state.next_ids.pending = (this.state.next_ids.pending ?? 0) + 1; }
  private nextMoveNumber(): number { return this.state.next_ids.move = (this.state.next_ids.move ?? 0) + 1; }
  private nextPhotoNumber(): number { return this.state.next_ids.photo = (this.state.next_ids.photo ?? 0) + 1; }
  private nextReportNumber(): number { return this.state.next_ids.report = (this.state.next_ids.report ?? 0) + 1; }
  private nextOverrideNumber(): number { return this.state.next_ids.override = (this.state.next_ids.override ?? 0) + 1; }
  private nextCardNumber(): number { return this.state.next_ids.card = (this.state.next_ids.card ?? 0) + 1; }
  private nextSessionNumber(): number { return this.state.next_ids.session = (this.state.next_ids.session ?? 0) + 1; }

  nextRef(): string {
    const n = this.nextMoveNumber();
    return `MV-${1000 + n}`;
  }

  nextPhotoId(): string { return `PH-${this.nextPhotoNumber()}`; }
  nextReportId(): string { return `LR-${this.nextReportNumber()}`; }
  nextOverrideId(): string { return `OR-${this.nextOverrideNumber()}`; }
  nextPendingId(): string { return `PS-${this.nextPendingNumber()}`; }
  nextInvoiceId(): string { return `INV-${this.nextInvoiceNumber()}`; }
  nextCardId(): string { return `PC-${this.nextCardNumber()}`; }
  nextSessionToken(): string { return `sess-${this.nextSessionNumber()}-${Math.random().toString(36).slice(2)}`; }

  photoPayload(key: string): string | undefined { return this.state.photo_store[key]; }
  setPhotoPayload(key: string, base64: string): void { this.state.photo_store[key] = base64; }
  deletePhotoPayload(key: string): void { delete this.state.photo_store[key]; }

  noticeOf(moveRef: string, kind: string): NoticeRecord | undefined {
    const move = this.state.moves.find((m) => m.ref === moveRef);
    return move?.notices.find((n) => n.kind === kind);
  }

  addHistory(move: Move, status: MoveStatus, by: string): void {
    const entry: HistoryEntry = { at_ms: Date.now(), status, by };
    move.history.push(entry);
    move.version += 1;
  }

  async save(): Promise<void> {
    await this.persist();
  }
}

function emptyState(): StoreState {
  return {
    users: [], sessions: [], agencies: [], vessels: [], pilots: [], pilot_order: [],
    seeded_duties: {}, moves: [], photos: [], pilot_cards: [], ladder_reports: [],
    invoices: [], skips: [], overrides: [], idempotency: [], pending_steps: [],
    tide_revisions: [], tariff_revisions: [], tide_version: INITIAL_TIDE_VERSION,
    store_created_ms: Date.now(), store_date: formatPortDate(Date.now()),
    next_ids: {
      move: 11, photo: 1, report: 1, override: 1, pending: 1, invoice: 1,
      card: 1, session: 1, tariff: 2,
    },
    photo_store: {},
  };
}

function mergeState(parsed: StoreState): StoreState {
  const fresh = emptyState();
  return { ...fresh, ...parsed, next_ids: { ...fresh.next_ids, ...parsed.next_ids }, photo_store: { ...parsed.photo_store } };
}

export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

export function pinchName(waypointId: string): string {
  return ROUTE.find((w) => w.id === waypointId)?.name ?? waypointId;
}

export function nextMoveRefNumber(store: Store): number {
  return store.moves.length;
}
