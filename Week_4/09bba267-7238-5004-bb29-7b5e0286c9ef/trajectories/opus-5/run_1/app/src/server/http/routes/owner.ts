import { randomBytes } from 'node:crypto';
import { FIELD_MESSAGES } from '../../../shared/copy';
import { hallSeat, seatsOfRowId } from '../../../shared/hall';
import { instantFromVenueWallTime } from '../../../shared/venueTime';
import { query, rows, withTransaction } from '../../db';
import { newPerformanceId, slugify } from '../../domain/ids';
import { loadOrders } from '../../domain/orders';
import { createPerformance, loadPerformances, withPublicTiers, type TierDefinition } from '../../domain/performances';
import { OWNER_TOPIC, recordChange } from '../../live';
import { OWNER_PASSCODE_KEY } from '../../seed';
import { clearedCookie, OWNER_COOKIE_NAME, ownerCookie, parseCookies } from '../context';
import type { RequestContext } from '../context';
import { type ApiResponse, error, json, validationError } from '../respond';
import { field, stringArray, stringField } from '../validate';

export async function createOwnerSession(context: RequestContext): Promise<ApiResponse> {
  const passcode = stringField(context.body, 'passcode');
  const stored = await query<{ value: string }>(`select value from settings where key = $1`, [OWNER_PASSCODE_KEY]);
  if (stored[0]?.value !== passcode) return error(401, 'unauthorized');
  const token = randomBytes(16).toString('hex');
  await query(`insert into owner_sessions (token) values ($1)`, [token]);
  context.cookies.push(ownerCookie(token));
  return { status: 204, body: undefined };
}

export async function deleteOwnerSession(context: RequestContext): Promise<ApiResponse> {
  const token = parseCookies(context.req.headers.cookie).get(OWNER_COOKIE_NAME);
  if (token !== undefined) await query(`delete from owner_sessions where token = $1`, [token]);
  context.cookies.push(clearedCookie(OWNER_COOKIE_NAME));
  return { status: 204, body: undefined };
}

export async function listOwnerPerformances(): Promise<ApiResponse> {
  const performances = await withTransaction((db) => loadPerformances(db, null));
  return json(200, { performances });
}

export async function listOwnerOrders(): Promise<ApiResponse> {
  const orders = await withTransaction((db) => loadOrders(db, { includeCancelled: true }));
  return json(200, { orders });
}

interface OutboxRow {
  id: string;
  recipient: string;
  subject: string;
  kind: string;
  status: string;
  attempts: number;
  created_at: Date;
  sent_at: Date | null;
}

export async function listOwnerOutbox(): Promise<ApiResponse> {
  const messages = await withTransaction((db) =>
    rows<OutboxRow>(
      db,
      `select id, recipient, subject, kind, status, attempts, created_at, sent_at
       from outbox order by created_at desc, id desc`,
    ),
  );
  return json(200, {
    messages: messages.map((message) => ({
      id: message.id,
      to: message.recipient,
      subject: message.subject,
      kind: message.kind,
      status: message.status,
      attempts: message.attempts,
      createdAt: `${message.created_at.toISOString().slice(0, 19)}Z`,
      sentAt: message.sent_at === null ? null : `${message.sent_at.toISOString().slice(0, 19)}Z`,
    })),
  });
}

function tierDefinitions(value: unknown): readonly TierDefinition[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6) return undefined;
  const definitions: TierDefinition[] = [];
  const usedSeats = new Set<string>();
  const usedIds = new Set<string>();
  for (const entry of value) {
    const name = stringField(entry, 'name').trim();
    const faceCents = field(entry, 'faceCents');
    const rowIds = stringArray(field(entry, 'rows') ?? []) ?? undefined;
    const seatIds = stringArray(field(entry, 'seats') ?? []) ?? undefined;
    const tierId = slugify(name);
    if (name.length < 1 || name.length > 40 || tierId === '' || usedIds.has(tierId)) return undefined;
    if (typeof faceCents !== 'number' || !Number.isInteger(faceCents) || faceCents < 100 || faceCents > 100_000) {
      return undefined;
    }
    if (rowIds === undefined || seatIds === undefined) return undefined;
    const seats = new Set<string>();
    for (const rowId of rowIds) {
      const rowSeats = seatsOfRowId(rowId);
      if (rowSeats.length === 0) return undefined;
      for (const seat of rowSeats) seats.add(seat.id);
    }
    for (const seatId of seatIds) {
      if (hallSeat(seatId) === undefined) return undefined;
      seats.add(seatId);
    }
    if (seats.size === 0) return undefined;
    for (const seatId of seats) {
      if (usedSeats.has(seatId)) return undefined;
      usedSeats.add(seatId);
    }
    usedIds.add(tierId);
    definitions.push({ tierId, name, faceCents, seatIds: [...seats] });
  }
  return definitions;
}

export async function createOwnerPerformance(context: RequestContext): Promise<ApiResponse> {
  const fields: Record<string, string> = {};
  const title = stringField(context.body, 'title').trim();
  if (title.length < 1 || title.length > 120) fields.title = FIELD_MESSAGES.title;

  const startsLocal = stringField(context.body, 'startsLocal');
  const resolved = instantFromVenueWallTime(startsLocal);
  if (!resolved.ok) {
    fields.startsLocal =
      resolved.reason === 'malformed' ? FIELD_MESSAGES.startsLocalFormat : FIELD_MESSAGES.startsLocalNonexistent;
  } else if (resolved.instant.getTime() <= Date.now()) {
    fields.startsLocal = FIELD_MESSAGES.startsLocalPast;
  }

  const rawTiers = field(context.body, 'tiers');
  const tiers = tierDefinitions(rawTiers);
  if (!Array.isArray(rawTiers) || rawTiers.length < 1 || rawTiers.length > 6) {
    fields.tiers = FIELD_MESSAGES.tiersCount;
  } else if (tiers === undefined) {
    fields.tiers = FIELD_MESSAGES.tiersDetail;
  }

  if (Object.keys(fields).length > 0 || !resolved.ok || tiers === undefined) return validationError(fields);

  const performanceId = newPerformanceId(title);
  const published = await withTransaction(async (db) => {
    await createPerformance(db, { id: performanceId, title, startsAt: resolved.instant, tiers });
    await recordChange(db, [OWNER_TOPIC]);
    return loadPerformances(db, performanceId);
  });
  const performance = published[0];
  if (!performance) throw new Error(`published performance ${performanceId} could not be read back`);
  return json(201, { performance: withPublicTiers(performance) });
}
