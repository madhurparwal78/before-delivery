import type { Pool, PoolClient } from 'pg';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { boardFeetString, priceCents, volumeMm3 } from '../domain/money.js';
import { computeFit, longestClearRun, type PieceInput, type Zone } from '../domain/geometry.js';
import { OPEN_STATUSES, PUBLIC_VIEW_STATUSES, RETIRED_STATUSES, type BoardStatus, type HoldStatus, type TicketStatus } from '../domain/constants.js';

export interface User {
  id: number;
  name: string;
  email: string;
  role: 'owner' | 'hand' | 'maker';
}

export interface Lot {
  id: string;
  name: string;
  origin: string;
  built_year: number;
}

export interface BoardRecord {
  tag: string;
  species: string;
  grade: string | null;
  status: BoardStatus;
  lot: Lot;
  length_mm: number;
  width_mm: number;
  thickness_mm: number;
  parent_tag: string | null;
  from_intake: boolean;
  created_at: string;
  defects: Zone[];
}

export interface PhotoRecord {
  id: string;
  board_tag: string;
  content_type: string;
  key: string;
  width: number;
  height: number;
  position: number;
}

export interface RateVersion {
  species: string;
  grade: string;
  rate_cents: number;
  effective_at: string;
  created_at: string;
}

export interface HoldRecord {
  id: string;
  board_tag: string;
  maker_id: number;
  status: HoldStatus;
  release_reason: string | null;
  pieces: PieceInput[];
  cuts_mm: number[];
  take_mm: number | null;
  sale: 'cut' | 'whole' | null;
  offcut_mm: number | null;
  price_cents: number;
  deposit_cents: number;
  created_at: string;
  held_at: string | null;
  expires_at: string | null;
  killbill_payment_id: string | null;
}

export interface TicketRecord {
  id: string;
  board_tag: string;
  maker_id: number;
  status: TicketStatus;
  pieces: PieceInput[];
  cuts_mm: number[];
  take_mm: number;
  sale: 'cut' | 'whole';
  offcut_tag: string | null;
  offcut_planned_mm: number | null;
  offcut_measured_mm: number | null;
  pdf_key: string;
  created_at: string;
}

export interface TicketEvent {
  kind: 'issued' | 'started' | 'done';
  by_user_id: number;
  at: string;
}

export interface InvoiceRecord {
  id: string;
  ticket_id: string;
  board_tag: string;
  maker_id: number;
  price_cents: number;
  deposit_cents: number;
  amount_cents: number;
  lines: Array<{ label: string; length_mm: number; amount_cents: number }>;
  killbill_payment_id: string;
  paid_at: string;
}

export interface MovementEntry {
  account: string;
  volume_mm3: string;
}

export interface MovementRecord {
  id: number;
  kind: 'intake' | 'split' | 'whole-sale' | 'trim' | 'adjustment';
  ticket: string | null;
  by_user_id: number | null;
  created_at: string;
  entries: MovementEntry[];
}

export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(plain, salt, 32).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const derived = scryptSync(plain, parts[1], 32);
  const expected = Buffer.from(parts[2], 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export class Store {
  constructor(private readonly pool: Pool) {}

  client(): Promise<PoolClient> {
    return this.pool.connect();
  }

  async yardId(): Promise<string> {
    const result = await this.pool.query(`SELECT value FROM app_meta WHERE key = 'yard_id'`);
    if (result.rowCount !== 1) throw new Error('yard id missing');
    return result.rows[0].value as string;
  }

  async userByEmail(email: string): Promise<User | null> {
    const result = await this.pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return result.rowCount === 1 ? mapUser(result.rows[0]) : null;
  }

  async userById(id: number): Promise<User | null> {
    const result = await this.pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rowCount === 1 ? mapUser(result.rows[0]) : null;
  }

  async passwordHash(id: number): Promise<string | null> {
    const result = await this.pool.query('SELECT password_hash FROM users WHERE id = $1', [id]);
    return result.rowCount === 1 ? (result.rows[0].password_hash as string) : null;
  }

  async nextLotId(): Promise<string> {
    const result = await this.pool.query('SELECT id FROM lots ORDER BY id DESC LIMIT 1');
    const last = result.rowCount === 1 ? (result.rows[0].id as string) : 'LOT-00';
    const number = Number(last.replace('LOT-', '')) + 1;
    return `LOT-${String(number).padStart(2, '0')}`;
  }

  async sessionUser(token: string): Promise<User | null> {
    const result = await this.pool.query(
      'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1',
      [token],
    );
    return result.rowCount === 1 ? mapUser(result.rows[0]) : null;
  }

  async createSession(userId: number): Promise<string> {
    const token = newSessionToken();
    await this.pool.query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, userId]);
    return token;
  }

  async deleteSession(token: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE token = $1', [token]);
  }

  async lots(): Promise<Lot[]> {
    const result = await this.pool.query('SELECT * FROM lots ORDER BY id');
    return result.rows.map(mapLot);
  }

  async lot(id: string): Promise<Lot | null> {
    const result = await this.pool.query('SELECT * FROM lots WHERE id = $1', [id]);
    return result.rowCount === 1 ? mapLot(result.rows[0]) : null;
  }

  async speciesNames(): Promise<string[]> {
    const result = await this.pool.query('SELECT name FROM species ORDER BY name');
    return result.rows.map((r) => r.name as string);
  }

  async boards(where: { statuses?: string[]; species?: string[]; grades?: string[]; minLengthMm?: number; minClearMm?: number; lot?: string }): Promise<BoardRecord[]> {
    await this.releaseExpiredHolds();
    const values: unknown[] = [];
    let sql = 'SELECT b.*, l.id AS lot_id, l.name AS lot_name, l.origin AS lot_origin, l.built_year FROM boards b JOIN lots l ON l.id = b.lot_id WHERE 1=1';
    if (where.statuses && where.statuses.length > 0) {
      values.push(where.statuses);
      sql += ` AND b.status = ANY($${values.length})`;
    } else {
      sql += ` AND b.status = ANY($1)`;
      values.unshift(['available', 'held']);
    }
    if (where.species && where.species.length > 0) {
      values.push(where.species);
      sql += ` AND b.species = ANY($${values.length})`;
    }
    if (where.grades && where.grades.length > 0) {
      values.push(where.grades);
      sql += ` AND b.grade = ANY($${values.length})`;
    }
    if (where.lot) {
      values.push(where.lot);
      sql += ` AND b.lot_id = $${values.length}`;
    }
    sql += ' ORDER BY b.tag';
    const result = await this.pool.query(sql, values);
    const boards = result.rows.map(mapBoard);
    const filtered: BoardRecord[] = [];
    for (const board of boards) {
      board.defects = await this.defects(board.tag);
      if (where.minLengthMm !== undefined && board.length_mm < where.minLengthMm) continue;
      if (where.minClearMm !== undefined && longestClearRun(board.length_mm, board.defects) < where.minClearMm) continue;
      filtered.push(board);
    }
    return filtered;
  }

  async board(tag: string): Promise<BoardRecord | null> {
    await this.releaseExpiredHolds();
    const result = await this.pool.query(
      'SELECT b.*, l.id AS lot_id, l.name AS lot_name, l.origin AS lot_origin, l.built_year FROM boards b JOIN lots l ON l.id = b.lot_id WHERE b.tag = $1',
      [tag],
    );
    if (result.rowCount !== 1) return null;
    const board = mapBoard(result.rows[0]);
    board.defects = await this.defects(board.tag);
    return board;
  }

  async defects(tag: string): Promise<Zone[]> {
    const result = await this.pool.query(
      'SELECT kind, start_mm, end_mm FROM defect_zones WHERE board_tag = $1 ORDER BY position, start_mm, end_mm',
      [tag],
    );
    return result.rows.map((r) => ({ kind: r.kind as string, start_mm: r.start_mm as number, end_mm: r.end_mm as number }));
  }

  async photos(tag: string): Promise<PhotoRecord[]> {
    const result = await this.pool.query('SELECT * FROM photos WHERE board_tag = $1 ORDER BY position, id', [tag]);
    return result.rows.map(mapPhoto);
  }

  async photo(id: string): Promise<PhotoRecord | null> {
    const result = await this.pool.query('SELECT * FROM photos WHERE id = $1', [id]);
    return result.rowCount === 1 ? mapPhoto(result.rows[0]) : null;
  }

  async photoCount(tag: string): Promise<number> {
    const result = await this.pool.query('SELECT count(*)::int AS n FROM photos WHERE board_tag = $1', [tag]);
    return result.rows[0].n as number;
  }

  async rateInForce(species: string, grade: string, at: Date): Promise<number | null> {
    const result = await this.pool.query(
      `SELECT rate_cents FROM rate_versions WHERE species = $1 AND grade = $2 AND effective_at <= $3
       ORDER BY effective_at DESC, id DESC LIMIT 1`,
      [species, grade, at],
    );
    return result.rowCount === 1 ? (result.rows[0].rate_cents as number) : null;
  }

  async allRatesInForce(at: Date): Promise<RateVersion[]> {
    const result = await this.pool.query(
      `SELECT DISTINCT ON (species, grade) species, grade, rate_cents, effective_at, created_at
       FROM rate_versions WHERE effective_at <= $1
       ORDER BY species, grade, effective_at DESC, id DESC`,
      [at],
    );
    return result.rows.map(mapRate);
  }

  async scheduledRates(at: Date): Promise<RateVersion[]> {
    const result = await this.pool.query(
      `SELECT species, grade, rate_cents, effective_at, created_at FROM rate_versions
       WHERE effective_at > $1 ORDER BY effective_at ASC, species ASC, grade ASC`,
      [at],
    );
    return result.rows.map(mapRate);
  }

  async insertRateVersion(species: string, grade: string, rateCents: number, effectiveAt: Date): Promise<RateVersion> {
    const result = await this.pool.query(
      `INSERT INTO rate_versions (species, grade, rate_cents, effective_at, created_at) VALUES ($1, $2, $3, $4, now()) RETURNING *`,
      [species, grade, rateCents, effectiveAt],
    );
    return mapRate(result.rows[0]);
  }

  /** Release any expired holds, called on reads so untouched records show the truth. */
  async releaseExpiredHolds(): Promise<void> {
    await this.pool.query(
      `UPDATE holds SET status = 'released', release_reason = 'expired' WHERE status = 'held' AND expires_at + interval '5 seconds' <= now()`,
    );
    await this.pool.query(`UPDATE boards SET status = 'available' WHERE status = 'held' AND tag NOT IN
      (SELECT board_tag FROM holds WHERE status IN ('pending-payment', 'held'))`);
  }

  async holds(where: { makerId?: number; status?: string[] } = {}): Promise<HoldRecord[]> {
    await this.releaseExpiredHolds();
    const values: unknown[] = [];
    let sql = 'SELECT * FROM holds WHERE 1=1';
    if (where.makerId !== undefined) {
      values.push(where.makerId);
      sql += ` AND maker_id = $${values.length}`;
    }
    if (where.status && where.status.length > 0) {
      values.push(where.status);
      sql += ` AND status = ANY($${values.length})`;
    }
    sql += ' ORDER BY id DESC';
    const result = await this.pool.query(sql, values);
    return result.rows.map(mapHold);
  }

  async hold(id: string): Promise<HoldRecord | null> {
    const result = await this.pool.query('SELECT * FROM holds WHERE id = $1', [id]);
    return result.rowCount === 1 ? mapHold(result.rows[0]) : null;
  }

  async tickets(where: { makerId?: number; status?: string[] } = {}): Promise<TicketRecord[]> {
    const values: unknown[] = [];
    let sql = 'SELECT * FROM tickets WHERE 1=1';
    if (where.makerId !== undefined) {
      values.push(where.makerId);
      sql += ` AND maker_id = $${values.length}`;
    }
    if (where.status && where.status.length > 0) {
      values.push(where.status);
      sql += ` AND status = ANY($${values.length})`;
    }
    sql += ' ORDER BY id DESC';
    const result = await this.pool.query(sql, values);
    return result.rows.map(mapTicket);
  }

  async ticket(id: string): Promise<TicketRecord | null> {
    const result = await this.pool.query('SELECT * FROM tickets WHERE id = $1', [id]);
    return result.rowCount === 1 ? mapTicket(result.rows[0]) : null;
  }

  async ticketEvents(ticketId: string): Promise<TicketEvent[]> {
    const result = await this.pool.query(
      'SELECT kind, by_user_id, at FROM ticket_events WHERE ticket_id = $1 ORDER BY id',
      [ticketId],
    );
    return result.rows.map((r) => ({ kind: r.kind as TicketEvent['kind'], by_user_id: r.by_user_id as number, at: iso(r.at) }));
  }

  async ticketByOffcut(offcutTag: string): Promise<TicketRecord | null> {
    const result = await this.pool.query('SELECT * FROM tickets WHERE offcut_tag = $1', [offcutTag]);
    return result.rowCount === 1 ? mapTicket(result.rows[0]) : null;
  }

  async invoices(where: { makerId?: number } = {}): Promise<InvoiceRecord[]> {
    const values: unknown[] = [];
    let sql = 'SELECT * FROM invoices WHERE 1=1';
    if (where.makerId !== undefined) {
      values.push(where.makerId);
      sql += ` AND maker_id = $${values.length}`;
    }
    sql += ' ORDER BY id DESC';
    const result = await this.pool.query(sql, values);
    return result.rows.map(mapInvoice);
  }

  async invoice(id: string): Promise<InvoiceRecord | null> {
    const result = await this.pool.query('SELECT * FROM invoices WHERE id = $1', [id]);
    return result.rowCount === 1 ? mapInvoice(result.rows[0]) : null;
  }

  async movements(account?: string): Promise<MovementRecord[]> {
    const params: unknown[] = [];
    let join = '';
    let where = '';
    if (account) {
      params.push(account);
      join = ' JOIN ledger_entries e ON e.movement_id = m.id';
      where = ' AND e.account = $1';
    }
    const result = await this.pool.query(
      `SELECT m.* FROM ledger_movements m${join} WHERE 1=1${where} ORDER BY m.id`,
      params,
    );
    const movements: MovementRecord[] = [];
    for (const row of result.rows) {
      const entries = await this.pool.query('SELECT account, volume_mm3 FROM ledger_entries WHERE movement_id = $1 ORDER BY id', [row.id]);
      movements.push({
        id: row.id as number,
        kind: row.kind as MovementRecord['kind'],
        ticket: row.ticket as string | null,
        by_user_id: (row.by_user_id as number | null) ?? null,
        created_at: iso(row.created_at),
        entries: entries.rows.map((e) => ({ account: e.account as string, volume_mm3: String(e.volume_mm3) })),
      });
    }
    return movements;
  }

  async storedLayout(makerId: number, tag: string): Promise<Record<string, unknown> | null> {
    const result = await this.pool.query('SELECT file FROM stored_layouts WHERE maker_id = $1 AND board_tag = $2', [makerId, tag]);
    return result.rowCount === 1 ? (result.rows[0].file as Record<string, unknown>) : null;
  }

  async saveStoredLayout(makerId: number, tag: string, file: Record<string, unknown>): Promise<void> {
    await this.pool.query(
      `INSERT INTO stored_layouts (maker_id, board_tag, file, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (maker_id, board_tag) DO UPDATE SET file = EXCLUDED.file, updated_at = now()`,
      [makerId, tag, JSON.stringify(file)],
    );
  }

  async idempotencyLookup(makerId: number, key: string): Promise<{ status: number; body: string; fingerprint: string } | null> {
    const result = await this.pool.query(
      'SELECT status, body, fingerprint FROM idempotency_keys WHERE maker_id = $1 AND key = $2',
      [makerId, key],
    );
    return result.rowCount === 1
      ? { status: result.rows[0].status as number, body: result.rows[0].body as string, fingerprint: result.rows[0].fingerprint as string }
      : null;
  }

  async idempotencySave(client: PoolClient, makerId: number, key: string, status: number, body: string, fingerprint: string): Promise<void> {
    await client.query(
      `INSERT INTO idempotency_keys (maker_id, key, status, body, fingerprint) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (maker_id, key) DO NOTHING`,
      [makerId, key, status, body, fingerprint],
    );
  }

  async stockRows(): Promise<{ species: StockRow[]; totals: StockTotals }> {
    const speciesList = await this.speciesNames();
    const result = await this.pool.query(
      `SELECT species,
              count(*) FILTER (WHERE status = ANY($1))::int AS open_boards,
              count(*) FILTER (WHERE status = 'available')::int AS on_rack,
              count(*) FILTER (WHERE status = 'held')::int AS held
       FROM boards GROUP BY species`,
      [['tagged', 'graded', 'available', 'held']],
    );
    const counts = new Map(result.rows.map((r) => [r.species as string, r]));
    const rows: StockRow[] = [];
    const totals: StockTotals = { open_boards: 0, on_rack: 0, held: 0, volume_mm3: 0n, board_feet: '0.00' };
    for (const species of speciesList) {
      const countsRow = counts.get(species) ?? { open_boards: 0, on_rack: 0, held: 0 };
      const volume = await this.speciesOpenVolume(species);
      rows.push({
        species,
        open_boards: countsRow.open_boards as number,
        on_rack: countsRow.on_rack as number,
        held: countsRow.held as number,
        volume_mm3: volume,
        board_feet: boardFeetString(Number(volume)),
      });
      totals.open_boards += countsRow.open_boards as number;
      totals.on_rack += countsRow.on_rack as number;
      totals.held += countsRow.held as number;
      totals.volume_mm3 += volume;
    }
    totals.board_feet = boardFeetString(Number(totals.volume_mm3));
    return { species: rows, totals };
  }

  async speciesOpenVolume(species: string): Promise<bigint> {
    // A board's balance is always thickness*width*length while open
    const result = await this.pool.query(
      `SELECT COALESCE(sum(length_mm::bigint * width_mm * thickness_mm), 0)::bigint AS v FROM boards WHERE species = $1 AND status = ANY($2)`,
      [species, ['tagged', 'graded', 'available', 'held']],
    );
    return BigInt(result.rows[0].v as string);
  }
}

export interface StockRow {
  species: string;
  open_boards: number;
  on_rack: number;
  held: number;
  volume_mm3: bigint;
  board_feet: string;
}

export interface StockTotals {
  open_boards: number;
  on_rack: number;
  held: number;
  volume_mm3: bigint;
  board_feet: string;
}

export function fingerprintOf(method: string, path: string, body: string): string {
  return createHash('sha256').update(`${method} ${path} ${body}`).digest('hex');
}

export function mapUser(row: Record<string, unknown>): User {
  return {
    id: row.id as number,
    name: row.name as string,
    email: row.email as string,
    role: row.role as User['role'],
  };
}

function mapLot(row: Record<string, unknown>): Lot {
  return {
    id: row.id as string,
    name: row.lot_name as string,
    origin: row.origin as string,
    built_year: row.built_year as number,
  };
}

export function mapBoard(row: Record<string, unknown>): BoardRecord {
  return {
    tag: row.tag as string,
    species: row.species as string,
    grade: (row.grade as string | null) ?? null,
    status: row.status as BoardStatus,
    lot: {
      id: row.lot_id as string,
      name: row.lot_name as string,
      origin: row.lot_origin as string,
      built_year: row.built_year as number,
    },
    length_mm: row.length_mm as number,
    width_mm: row.width_mm as number,
    thickness_mm: row.thickness_mm as number,
    parent_tag: (row.parent_tag as string | null) ?? null,
    from_intake: row.from_intake as boolean,
    created_at: iso(row.created_at),
    defects: [],
  };
}

function mapPhoto(row: Record<string, unknown>): PhotoRecord {
  return {
    id: row.id as string,
    board_tag: row.board_tag as string,
    content_type: row.content_type as string,
    key: row.key as string,
    width: row.width as number,
    height: row.height as number,
    position: row.position as number,
  };
}

function mapRate(row: Record<string, unknown>): RateVersion {
  return {
    species: row.species as string,
    grade: row.grade as string,
    rate_cents: row.rate_cents as number,
    effective_at: iso(row.effective_at),
    created_at: iso(row.created_at),
  };
}

export function mapHold(row: Record<string, unknown>): HoldRecord {
  return {
    id: row.id as string,
    board_tag: row.board_tag as string,
    maker_id: row.maker_id as number,
    status: row.status as HoldStatus,
    release_reason: (row.release_reason as string | null) ?? null,
    pieces: row.pieces as PieceInput[],
    cuts_mm: row.cuts_mm as number[],
    take_mm: (row.take_mm as number | null) ?? null,
    sale: (row.sale as 'cut' | 'whole' | null) ?? null,
    offcut_mm: (row.offcut_mm as number | null) ?? null,
    price_cents: row.price_cents as number,
    deposit_cents: row.deposit_cents as number,
    created_at: iso(row.created_at),
    held_at: row.held_at ? iso(row.held_at) : null,
    expires_at: row.expires_at ? iso(row.expires_at) : null,
    killbill_payment_id: (row.killbill_payment_id as string | null) ?? null,
  };
}

function mapTicket(row: Record<string, unknown>): TicketRecord {
  return {
    id: row.id as string,
    board_tag: row.board_tag as string,
    maker_id: row.maker_id as number,
    status: row.status as TicketStatus,
    pieces: row.pieces as PieceInput[],
    cuts_mm: row.cuts_mm as number[],
    take_mm: row.take_mm as number,
    sale: row.sale as 'cut' | 'whole',
    offcut_tag: (row.offcut_tag as string | null) ?? null,
    offcut_planned_mm: (row.offcut_planned_mm as number | null) ?? null,
    offcut_measured_mm: (row.offcut_measured_mm as number | null) ?? null,
    pdf_key: row.pdf_key as string,
    created_at: iso(row.created_at),
  };
}

function mapInvoice(row: Record<string, unknown>): InvoiceRecord {
  return {
    id: row.id as string,
    ticket_id: row.ticket_id as string,
    board_tag: row.board_tag as string,
    maker_id: row.maker_id as number,
    price_cents: row.price_cents as number,
    deposit_cents: row.deposit_cents as number,
    amount_cents: row.amount_cents as number,
    lines: row.lines as InvoiceRecord['lines'],
    killbill_payment_id: row.killbill_payment_id as string,
    paid_at: iso(row.paid_at),
  };
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function fitForBoard(board: BoardRecord, pieces: PieceInput[], rateCents: number | null): ReturnType<typeof computeFit> {
  return computeFit(
    board.length_mm,
    board.width_mm,
    board.defects,
    pieces,
    rateCents,
    (take) => (rateCents === null ? null : priceCents(board.thickness_mm, board.width_mm, take, rateCents)),
    (take) => boardFeetString(volumeMm3(take, board.width_mm, board.thickness_mm)),
  );
}

export function isOpenStatus(status: BoardStatus): boolean {
  return OPEN_STATUSES.has(status);
}

export function isRetired(status: BoardStatus): boolean {
  return RETIRED_STATUSES.has(status);
}

export function isPubliclyVisible(status: BoardStatus): boolean {
  return PUBLIC_VIEW_STATUSES.has(status);
}
