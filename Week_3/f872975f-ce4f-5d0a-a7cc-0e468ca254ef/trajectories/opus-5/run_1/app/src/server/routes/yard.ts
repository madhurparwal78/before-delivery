import { SPECIES } from '../../shared/constants';
import { boardFeet } from '../../shared/money';
import { pool, query, rows } from '../db/pool';
import { OPEN_STATUSES } from '../domain/boards';
import { releaseExpiredHolds } from '../domain/holds';
import { movementId } from '../domain/ledger';
import { isGrade, isSpecies, ratesInForce, readEffectiveAt, scheduledRates } from '../domain/rates';
import { FieldErrors } from '../errors';
import { Reply, RequestContext, STAFF, jsonReply, requireRole } from '../http';
import { Route, route } from './types';

async function readLots(): Promise<Reply> {
  const lots = await query<{ id: string; name: string; origin: string; built_year: number }>(
    'SELECT id, name, origin, built_year FROM lots ORDER BY id'
  );
  return jsonReply(200, { lots });
}

async function createLot(context: RequestContext): Promise<Reply> {
  requireRole(context, STAFF);
  const errors = new FieldErrors();
  const name = context.json.name;
  const origin = context.json.origin;
  const builtYear = context.json.built_year;
  if (typeof name !== 'string' || name.length < 1 || name.length > 80) errors.add('name', 'Give a name of 1 to 80 characters.');
  if (typeof origin !== 'string' || origin.length < 1 || origin.length > 200) {
    errors.add('origin', 'Give an origin of 1 to 200 characters.');
  }
  if (typeof builtYear !== 'number' || !Number.isInteger(builtYear) || builtYear < 1600 || builtYear > 2026) {
    errors.add('built_year', 'Give a year from 1600 to 2026.');
  }
  errors.throwIfAny();

  const allocated = await query<{ value: string }>("SELECT nextval('lot_id_seq')::text AS value");
  const sequence = allocated[0]?.value;
  if (sequence === undefined) throw new Error('lot id was not allocated');
  const id = `LOT-${sequence.padStart(2, '0')}`;
  await query('INSERT INTO lots (id, name, origin, built_year) VALUES ($1, $2, $3, $4)', [id, name, origin, builtYear]);
  return jsonReply(201, { lot: { id, name, origin, built_year: builtYear } });
}

async function readRates(context: RequestContext): Promise<Reply> {
  const inForce = await ratesInForce(pool, context.now);
  return jsonReply(200, { rates: inForce.shapes(), scheduled: await scheduledRates(pool, context.now) });
}

async function saveRate(context: RequestContext): Promise<Reply> {
  requireRole(context, ['owner']);
  const errors = new FieldErrors();
  const species = context.json.species;
  const grade = context.json.grade;
  const rateCents = context.json.rate_cents;
  if (!isSpecies(species)) errors.add('species', 'Choose one of the yard species.');
  if (!isGrade(grade)) errors.add('grade', 'Choose Select, Character or Rustic.');
  if (typeof rateCents !== 'number' || !Number.isInteger(rateCents) || rateCents < 1 || rateCents > 1_000_000) {
    errors.add('rate_cents', 'Give a whole number of cents from 1 to 1000000.');
  }
  errors.throwIfAny();
  const effectiveAt = readEffectiveAt(context.json.effective_at, context.now);
  await query('INSERT INTO rate_versions (species, grade, rate_cents, effective_at, created_at) VALUES ($1, $2, $3, $4, $5)', [
    species,
    grade,
    rateCents,
    effectiveAt,
    context.now
  ]);
  return jsonReply(200, {
    rate: { species, grade, rate_cents: rateCents, effective_at: effectiveAt.toISOString() }
  });
}

interface StockBoardRow {
  species: string;
  status: string;
  balance: string;
}

async function readStock(context: RequestContext): Promise<Reply> {
  requireRole(context, STAFF);
  await releaseExpiredHolds(pool, context.now);
  const found = await query<StockBoardRow>(
    `SELECT b.species, b.status, COALESCE(SUM(e.volume_mm3), 0)::text AS balance
     FROM boards b LEFT JOIN movement_entries e ON e.account = 'board:' || b.tag
     WHERE b.status = ANY($1::text[])
     GROUP BY b.tag, b.species, b.status`,
    [OPEN_STATUSES]
  );

  const species = [...SPECIES].sort((a, b) => a.localeCompare(b));
  const rowsOut = species.map((name) => {
    const mine = found.filter((row) => row.species === name);
    return {
      species: name,
      open_boards: mine.length,
      on_rack: mine.filter((row) => row.status === 'available').length,
      held: mine.filter((row) => row.status === 'held').length,
      volume_mm3: mine.reduce((sum, row) => sum + Number(row.balance), 0),
      board_feet: ''
    };
  });
  const withFeet = rowsOut.map((row) => ({ ...row, board_feet: boardFeet(row.volume_mm3) }));
  const totalVolume = withFeet.reduce((sum, row) => sum + row.volume_mm3, 0);
  return jsonReply(200, {
    species: withFeet,
    totals: {
      open_boards: withFeet.reduce((sum, row) => sum + row.open_boards, 0),
      on_rack: withFeet.reduce((sum, row) => sum + row.on_rack, 0),
      held: withFeet.reduce((sum, row) => sum + row.held, 0),
      volume_mm3: totalVolume,
      board_feet: boardFeet(totalVolume)
    }
  });
}

interface MovementRecord {
  id: string;
  kind: string;
  created_at: Date;
  ticket_id: string | null;
  by_name: string | null;
}

async function readLedger(context: RequestContext): Promise<Reply> {
  requireRole(context, ['owner']);
  const account = context.url.searchParams.get('account');
  const movements = await rows<MovementRecord>(
    pool,
    `SELECT m.id::text AS id, m.kind, m.created_at, m.ticket_id, u.name AS by_name
     FROM movements m LEFT JOIN users u ON u.id = m.by_user_id
     WHERE $1::text IS NULL OR EXISTS (
       SELECT 1 FROM movement_entries e WHERE e.movement_id = m.id AND e.account = $1
     )
     ORDER BY m.id`,
    [account]
  );
  const entries = await rows<{ movement_id: string; account: string; volume_mm3: string }>(
    pool,
    `SELECT movement_id::text AS movement_id, account, volume_mm3::text AS volume_mm3 FROM movement_entries ORDER BY id`
  );
  const byMovement = new Map<string, Array<{ account: string; volume_mm3: number }>>();
  for (const entry of entries) {
    const list = byMovement.get(entry.movement_id) ?? [];
    list.push({ account: entry.account, volume_mm3: Number(entry.volume_mm3) });
    byMovement.set(entry.movement_id, list);
  }
  return jsonReply(200, {
    movements: movements.map((movement) => ({
      id: movementId(movement.id),
      kind: movement.kind,
      created_at: movement.created_at.toISOString(),
      ticket: movement.ticket_id,
      by: movement.by_name === null ? null : { name: movement.by_name },
      entries: byMovement.get(movement.id) ?? []
    }))
  });
}

export const yardRoutes: Route[] = [
  route('GET', '/api/lots', false, readLots),
  route('POST', '/api/lots', true, createLot),
  route('GET', '/api/rates', false, readRates),
  route('PUT', '/api/rates', true, saveRate),
  route('GET', '/api/stock', true, readStock),
  route('GET', '/api/ledger', true, readLedger)
];
