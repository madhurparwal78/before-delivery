import { config } from '../config.js';
import { now } from '../clock.js';
import { query, queryOne, withTransaction } from '../db.js';
import { json, route, type Ctx } from '../http.js';
import { ImportInvalidError } from '../errors.js';
import { newId, hashPassword, foldEmail, isEmail } from '../util.js';
import { callerActor } from '../auth.js';
import { writeAudit } from '../audit.js';
import { withIdempotency } from '../idempotency.js';
import { announceBookingChange } from '../domain/dayengine.js';
import type { PoolClient } from 'pg';

/**
 * The client import. The file is applied whole: any bad row writes nothing and is named
 * by its physical line, the column's header name and a code.
 */
const HEADER = 'owner_name,owner_email,owner_phone,horse_name,barn_name,stall,cycle_weeks';
const COLUMNS = HEADER.split(',');
const MAX_ROWS = 5000;

interface RowError {
  line: number;
  column: string;
  code: string;
}

interface ParsedRecord {
  line: number;
  cells: string[];
}

/** Standard CSV: a byte-order mark, CRLF or LF line ends, and quoted commas and newlines. */
function parseCsv(text: string): ParsedRecord[] {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: ParsedRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  let started = false;

  const pushCell = (): void => {
    cells.push(cell);
    cell = '';
  };
  const pushRecord = (): void => {
    pushCell();
    records.push({ line: recordLine, cells });
    cells = [];
    started = false;
  };

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index] as string;
    if (!started && !quoted) {
      recordLine = line;
      started = true;
    }
    if (quoted) {
      if (char === '"') {
        if (body[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else quoted = false;
      } else {
        if (char === '\n') line += 1;
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ',') {
      pushCell();
      continue;
    }
    if (char === '\r') continue;
    if (char === '\n') {
      pushRecord();
      line += 1;
      continue;
    }
    cell += char;
  }
  if (started || cell !== '' || cells.length > 0) pushRecord();
  return records.filter((record) => !(record.cells.length === 1 && record.cells[0] === ''));
}

interface OwnerSeen {
  id: string | null;
  name: string;
  email: string;
}

interface ImportResult {
  created_owners: number;
  matched_owners: number;
  created_horses: number;
  updated_horses: number;
  rows: number;
}

async function applyImport(
  db: PoolClient,
  text: string,
): Promise<{ result: ImportResult; stallChanges: { horseId: string }[] }> {
  const records = parseCsv(text);
  const header = records[0];
  if (header === undefined || header.cells.join(',').trim() !== HEADER) {
    throw new ImportInvalidError([{ line: 1, column: 'header', code: 'bad_header' }]);
  }
  const dataRows = records.slice(1);
  if (dataRows.length > MAX_ROWS) {
    throw new ImportInvalidError([{ line: 1, column: 'header', code: 'too_many_rows' }]);
  }

  const barns = await query<{ id: string; name_folded: string }>(db, 'SELECT id, name_folded FROM barns');
  const barnByName = new Map(barns.map((barn) => [barn.name_folded, barn.id]));

  const errors: RowError[] = [];
  const seenOwners = new Map<string, OwnerSeen>();
  const seenHorses = new Set<string>();
  const seenStalls = new Map<string, string>();

  interface Candidate {
    line: number;
    ownerName: string;
    ownerEmail: string;
    ownerPhone: string;
    horseName: string;
    barnId: string;
    stall: string;
    cycleWeeks: number;
  }
  const candidates: Candidate[] = [];

  for (const record of dataRows) {
    const cells = COLUMNS.map((_, index) => (record.cells[index] ?? '').trim());
    const [ownerName, ownerEmail, ownerPhone, horseName, barnName, stall, cycleWeeks] = cells as [
      string, string, string, string, string, string, string,
    ];
    const rowErrors: RowError[] = [];

    COLUMNS.forEach((column, index) => {
      if ((cells[index] ?? '') === '') rowErrors.push({ line: record.line, column, code: 'missing_value' });
    });

    if (ownerEmail !== '' && !isEmail(ownerEmail)) {
      rowErrors.push({ line: record.line, column: 'owner_email', code: 'invalid_email' });
    }
    const barnId = barnName === '' ? undefined : barnByName.get(barnName.toLowerCase());
    if (barnName !== '' && barnId === undefined) {
      rowErrors.push({ line: record.line, column: 'barn_name', code: 'unknown_barn' });
    }
    const cycle = Number(cycleWeeks);
    if (cycleWeeks !== '' && (!Number.isInteger(cycle) || cycle < 5 || cycle > 8)) {
      rowErrors.push({ line: record.line, column: 'cycle_weeks', code: 'cycle_out_of_range' });
    }

    const folded = foldEmail(ownerEmail);
    if (folded !== '' && horseName !== '') {
      const horseKey = `${folded}|${horseName.toLowerCase()}`;
      if (seenHorses.has(horseKey)) {
        rowErrors.push({ line: record.line, column: 'horse_name', code: 'duplicate_row' });
      } else seenHorses.add(horseKey);
    }

    // An owner matched earlier in the file or in the database must keep its name.
    if (folded !== '' && ownerName !== '') {
      const earlier = seenOwners.get(folded);
      if (earlier !== undefined) {
        if (earlier.name !== ownerName) {
          rowErrors.push({ line: record.line, column: 'owner_name', code: 'owner_name_mismatch' });
        }
      } else {
        const stored = await queryOne<{ id: string; name: string }>(
          db,
          'SELECT id, name FROM users WHERE email_folded = $1',
          [folded],
        );
        if (stored !== null && stored.name !== ownerName) {
          rowErrors.push({ line: record.line, column: 'owner_name', code: 'owner_name_mismatch' });
        }
        seenOwners.set(folded, { id: stored?.id ?? null, name: ownerName, email: ownerEmail });
      }
    }

    if (barnId !== undefined && stall !== '') {
      const stallKey = `${barnId}|${stall}`;
      const holder = `${folded}|${horseName.toLowerCase()}`;
      const earlierHolder = seenStalls.get(stallKey);
      if (earlierHolder !== undefined && earlierHolder !== holder) {
        rowErrors.push({ line: record.line, column: 'stall', code: 'stall_taken' });
      } else {
        const occupant = await queryOne<{ id: string; name_folded: string; owner_email: string }>(
          db,
          `SELECT h.id, h.name_folded, u.email_folded AS owner_email
           FROM horses h JOIN users u ON u.id = h.owner_id
           WHERE h.barn_id = $1 AND h.stall = $2`,
          [barnId, stall],
        );
        if (
          occupant !== null &&
          `${occupant.owner_email}|${occupant.name_folded}` !== holder
        ) {
          rowErrors.push({ line: record.line, column: 'stall', code: 'stall_taken' });
        }
        seenStalls.set(stallKey, holder);
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      continue;
    }
    candidates.push({
      line: record.line,
      ownerName,
      ownerEmail,
      ownerPhone,
      horseName,
      barnId: barnId as string,
      stall,
      cycleWeeks: cycle,
    });
  }

  if (errors.length > 0) {
    errors.sort(
      (left, right) =>
        left.line - right.line || COLUMNS.indexOf(left.column) - COLUMNS.indexOf(right.column),
    );
    throw new ImportInvalidError(errors);
  }

  const at = now();
  const result: ImportResult = {
    created_owners: 0,
    matched_owners: 0,
    created_horses: 0,
    updated_horses: 0,
    rows: candidates.length,
  };
  const stallChanges: { horseId: string }[] = [];
  const passwordHash = await hashPassword(config.importDefaultPassword);
  const handledOwners = new Set<string>();

  for (const candidate of candidates) {
    const folded = foldEmail(candidate.ownerEmail);
    let owner = await queryOne<{ id: string }>(db, 'SELECT id FROM users WHERE email_folded = $1', [
      folded,
    ]);
    if (owner === null) {
      const id = newId();
      await query(
        db,
        `INSERT INTO users (id, name, email, email_folded, phone, role, password_hash, created_at)
         VALUES ($1,$2,$3,$4,$5,'owner',$6,$7)`,
        [id, candidate.ownerName, candidate.ownerEmail, folded, candidate.ownerPhone, passwordHash, at],
      );
      owner = { id };
      if (!handledOwners.has(folded)) result.created_owners += 1;
    } else if (!handledOwners.has(folded)) {
      result.matched_owners += 1;
    }
    handledOwners.add(folded);

    const existing = await queryOne<{
      id: string;
      barn_id: string;
      stall: string;
      cycle_weeks: number;
    }>(
      db,
      'SELECT id, barn_id, stall, cycle_weeks FROM horses WHERE owner_id = $1 AND name_folded = $2',
      [owner.id, candidate.horseName.toLowerCase()],
    );
    if (existing === null) {
      await query(
        db,
        `INSERT INTO horses (id, name, name_folded, owner_id, barn_id, stall, cycle_weeks, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          newId(),
          candidate.horseName,
          candidate.horseName.toLowerCase(),
          owner.id,
          candidate.barnId,
          candidate.stall,
          candidate.cycleWeeks,
          at,
        ],
      );
      result.created_horses += 1;
      continue;
    }
    const unchanged =
      existing.barn_id === candidate.barnId &&
      existing.stall === candidate.stall &&
      existing.cycle_weeks === candidate.cycleWeeks;
    if (unchanged) continue;
    if (existing.stall !== candidate.stall) stallChanges.push({ horseId: existing.id });
    await query(db, 'UPDATE horses SET barn_id = $2, stall = $3, cycle_weeks = $4 WHERE id = $1', [
      existing.id,
      candidate.barnId,
      candidate.stall,
      candidate.cycleWeeks,
    ]);
    result.updated_horses += 1;
  }

  return { result, stallChanges };
}

/** A stall change reaches every open barn day stream that lists the horse's booking. */
async function announceStallChanges(
  db: PoolClient,
  changes: readonly { horseId: string }[],
  at: Date,
): Promise<void> {
  for (const change of changes) {
    const bookings = await query<{ id: string; barn_day_id: string }>(
      db,
      `SELECT bk.id, bk.barn_day_id FROM bookings bk JOIN barn_days d ON d.id = bk.barn_day_id
       WHERE bk.horse_id = $1 AND bk.status NOT IN ('held','released','lapsed','removed')
         AND d.status IN ('published','in_progress')`,
      [change.horseId],
    );
    for (const booking of bookings) {
      await announceBookingChange(db, booking.barn_day_id, booking.id, 'booking_moved', at);
    }
  }
}

export function registerImportRoutes(): void {
  route({
    method: 'POST',
    path: '/api/imports',
    roles: ['farrier'],
    bodyKind: 'csv',
    needsIdempotency: true,
    handler: async (ctx: Ctx) => {
      const response = await withIdempotency(
        ctx.caller,
        'import',
        ctx.idempotencyKey as string,
        ctx.raw,
        async () => {
          const body = await withTransaction(async (db) => {
            const at = now();
            const outcome = await applyImport(db, ctx.raw.toString('utf8'));
            const id = newId();
            await query(
              db,
              `INSERT INTO imports (id, created_owners, matched_owners, created_horses,
                                    updated_horses, rows, at)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [
                id,
                outcome.result.created_owners,
                outcome.result.matched_owners,
                outcome.result.created_horses,
                outcome.result.updated_horses,
                outcome.result.rows,
                at,
              ],
            );
            await writeAudit(db, {
              actor: callerActor(ctx.caller),
              action: 'import',
              entityType: 'import',
              entityId: id,
              at,
              requestId: ctx.requestId,
            });
            await announceStallChanges(db, outcome.stallChanges, at);
            return { id, ...outcome.result };
          });
          return { status: 201, body };
        },
      );
      return json(response.status, response.body);
    },
  });
}

