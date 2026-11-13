import type { IncomingMessage } from 'node:http';
import { pool, withTransaction } from '../db.js';
import { illegalMove, notFound, validation } from '../errors.js';
import { requireOwner, requireStaff } from '../auth.js';
import { readJsonBody } from '../http.js';
import { checkPickupDate, MESSAGES, moneyCents } from '../validate.js';
import {
  currentLocation,
  recordMovement,
  REPAIR,
  SHELF,
  unitBalances,
  unitMovements,
  utilisation,
} from '../../domain/ledger.js';
import { listKitRecords } from '../../domain/catalogue.js';
import { listRateCards, publishRateCard } from '../../domain/ratecards.js';
import type {
  Movement,
  RateCardView,
  UnitHistoryView,
  UtilisationView,
} from '../../shared/types.js';

async function unitClassId(serial: string): Promise<string | null> {
  const result = await pool.query<{ class_id: string }>(
    `SELECT class_id FROM units WHERE serial = $1`,
    [serial],
  );
  return result.rows[0]?.class_id ?? null;
}

export interface MoveResponse {
  serial: string;
  location: string;
  movement: Movement;
}

/** Only the two repair moves are allowed by hand; every other move is refused. */
export async function moveUnit(req: IncomingMessage, serial: string): Promise<MoveResponse> {
  const body = await readJsonBody(req);
  await requireStaff(req);
  if ((await unitClassId(serial)) === null) throw notFound();
  const to = body.to;
  if (to !== SHELF && to !== REPAIR) {
    throw validation({ to: 'Move a unit to the shelf or to repair' });
  }

  await withTransaction(async (client) => {
    await client.query(`SELECT serial FROM units WHERE serial = $1 FOR UPDATE`, [serial]);
    const from = await currentLocation(client, serial);
    if (from === SHELF && to === REPAIR) {
      await recordMovement(client, serial, 'to_repair', SHELF, REPAIR, null);
      return;
    }
    if (from === REPAIR && to === SHELF) {
      await recordMovement(client, serial, 'from_repair', REPAIR, SHELF, null);
      return;
    }
    throw illegalMove(serial, from, to);
  });

  const movements = await unitMovements(pool, serial);
  const movement = movements[movements.length - 1];
  if (movement === undefined) throw new Error(`Unit ${serial} has no movements`);
  return { serial, location: to, movement };
}

export async function unitHistory(
  req: IncomingMessage,
  serial: string,
): Promise<UnitHistoryView> {
  await requireStaff(req);
  const classId = await unitClassId(serial);
  if (classId === null) throw notFound();
  return {
    serial,
    classId,
    location: await currentLocation(pool, serial),
    movements: await unitMovements(pool, serial),
    balances: await unitBalances(pool, serial),
  };
}

export async function getUtilisation(req: IncomingMessage): Promise<UtilisationView> {
  await requireOwner(req);
  return utilisation(pool);
}

export async function getRateCards(
  req: IncomingMessage,
): Promise<{ activeVersion: number; rateCards: RateCardView[] }> {
  await requireStaff(req);
  return listRateCards(pool);
}

export async function postRateCard(req: IncomingMessage): Promise<RateCardView> {
  const body = await readJsonBody(req);
  await requireOwner(req);

  const fields: Record<string, string> = {};
  if (checkPickupDate(body.effectiveDate) !== null) {
    fields.effectiveDate = 'Effective date must be today or later';
  }

  const kits = await listKitRecords(pool);
  const raw = Array.isArray(body.rates) ? body.rates : [];
  const seen = new Map<string, { kitId: string; dayRateCents: number; depositCents: number }>();
  let ratesInvalid = raw.length !== kits.length;
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) {
      ratesInvalid = true;
      continue;
    }
    const record = entry as Record<string, unknown>;
    const kitId = record.kitId;
    const dayRateCents = moneyCents(record.dayRateCents);
    const depositCents = moneyCents(record.depositCents);
    if (typeof kitId !== 'string' || !kits.some((kit) => kit.id === kitId) || seen.has(kitId)) {
      ratesInvalid = true;
      continue;
    }
    if (dayRateCents === null || depositCents === null) {
      fields.rates = MESSAGES.money;
      continue;
    }
    seen.set(kitId, { kitId, dayRateCents, depositCents });
  }
  if (ratesInvalid || seen.size !== kits.length) {
    fields.rates = 'Give a day rate and deposit for every kit';
  }
  if (Object.keys(fields).length > 0) throw validation(fields);

  const ordered = kits.map((kit) => {
    const rate = seen.get(kit.id);
    if (rate === undefined) throw new Error(`Rate for ${kit.id} vanished after validation`);
    return rate;
  });
  return withTransaction((client) =>
    publishRateCard(client, body.effectiveDate as string, ordered),
  );
}
