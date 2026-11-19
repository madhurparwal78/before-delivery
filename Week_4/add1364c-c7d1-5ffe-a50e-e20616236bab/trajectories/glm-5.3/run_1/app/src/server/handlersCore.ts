import type { Ctx } from './apiRoutes.js';
import { ApiError, conflict, forbidden, invalid, notFound, unavailable } from './errors.js';
import { emptyOk, jsonOk, readJsonBody, checkBody, type BodySpec } from './http.js';
import { COPY } from './apiCore.js';
import { mapPerson, personStatus, type PersonRow, type Role } from './people.js';
import { visibleVaultIds, termIsOpen, type TravelRow } from './domain/visibility.js';
import { addReviewLinesForScopes, closePersonSessions } from './domain/scopeChanges.js';
import { loadPersonSnapshot, personView, mapVaultRow } from './handlersPeople.js';
import { sessionEnd, SignInLockout } from './domain/sessions.js';
import { formatOfficeStamp, officeDateString, officeLocalInstant, officeTimeString, offsetAbbreviation, parseOfficeDate, secondBusinessDayAfter, addDays } from './officeTime.js';
import { randomUUID } from 'node:crypto';

const VALID_ROLES: Role[] = ['office_manager', 'managing_partner', 'staff_accountant', 'outside_bookkeeper'];

export function requireRole(ctx: Ctx, ...roles: Role[]): void {
  if (!ctx.person || !roles.includes(ctx.person.role)) {
    throw forbidden();
  }
}

export async function loadVaults(ctx: Ctx): Promise<Array<{ id: string; name: string; formerly: string | null; off_when_travelling: boolean; position: number }>> {
  const rows = await ctx.store.pool.query('SELECT id, name, formerly, off_when_travelling, position FROM vaults ORDER BY position');
  return rows.rows.map(mapVaultRow);
}

export async function loadTravelRows(ctx: Ctx, personId: string): Promise<TravelRow[]> {
  const rows = await ctx.store.pool.query(
    'SELECT id, starts_at, ends_at FROM travel_windows WHERE person_id = $1',
    [personId]
  );
  return rows.rows.map((row) => ({
    id: String(row.id),
    starts_at: new Date(row.starts_at as string),
    ends_at: new Date(row.ends_at as string)
  }));
}

/** The vaults the caller may see now, decided in the one place visibility is decided. */
export async function visibleNow(ctx: Ctx, person: PersonRow): Promise<string[]> {
  const vaults = await loadVaults(ctx);
  const scopeRows = await ctx.store.pool.query('SELECT vault_id FROM vault_scopes WHERE person_id = $1', [person.id]);
  const scopes = new Set(scopeRows.rows.map((row) => String(row.vault_id)));
  const travels = await loadTravelRows(ctx, person.id);
  return visibleVaultIds(person, scopes, travels, vaults, ctx.store.clock.now());
}

export async function signOut(ctx: Ctx): Promise<void> {
  if (ctx.sessionId) {
    await ctx.store.pool.query('UPDATE sessions SET ended_reason = $2 WHERE id = $1 AND ended_reason IS NULL', [
      ctx.sessionId,
      'signed_out'
    ]);
  }
  emptyOk(ctx.res, 204, {
    'Set-Cookie': 'lockset_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'
  });
}

export async function getMe(ctx: Ctx): Promise<void> {
  if (!ctx.person || !ctx.sessionEndsAt) throw notFound();
  const snap = await loadPersonSnapshot(ctx, ctx.person.id);
  jsonOk(ctx.res, 200, {
    person: personView(snap),
    session_ends_at: ctx.sessionEndsAt.toISOString()
  });
}

export async function getClock(ctx: Ctx): Promise<void> {
  const now = ctx.store.clock.now();
  jsonOk(ctx.res, 200, {
    now: now.toISOString(),
    office_date: officeDateString(now),
    office_time: officeTimeString(now),
    offset: offsetAbbreviation(now),
    time_zone: 'America/Chicago'
  });
}

export async function getHealth(ctx: Ctx): Promise<void> {
  jsonOk(ctx.res, 200, { status: 'ok' });
}

export async function getEvents(ctx: Ctx): Promise<void> {
  if (!ctx.person) throw notFound();
  const res = ctx.res;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive'
  });
  res.write(': open\n\n');
  const personId = ctx.person.id;
  ctx.store.events.add(personId, res);
  ctx.req.on('close', () => {
    ctx.store.events.remove(personId, res);
  });
}

export async function listPeople(ctx: Ctx): Promise<void> {
  requireRole(ctx, 'office_manager', 'managing_partner');
  const rows = await ctx.store.pool.query('SELECT * FROM people ORDER BY created_seq');
  const views: Record<string, unknown>[] = [];
  for (const row of rows.rows) {
    const snap = await loadPersonSnapshot(ctx, String(row.id));
    views.push(personView(snap));
  }
  jsonOk(ctx.res, 200, { people: views });
}

/**
 * Idempotency: a request carrying `Idempotency-Key` is remembered for 24 hours,
 * per person and endpoint. A replay with the same key and body returns the
 * stored response; the same key with a different body answers 409.
 */
export interface IdemContext {
  key: string | null;
  stored: { status: number; body: unknown } | null;
  conflictError: ApiError | null;
}

export async function beginIdempotent(ctx: Ctx, endpoint: string, body: Record<string, unknown>): Promise<IdemContext> {
  const header = ctx.req.headers['idempotency-key'];
  const key = typeof header === 'string' && header.length >= 1 && header.length <= 100 && header.trim().length === header.length ? header : null;
  if (key === null) return { key: null, stored: null, conflictError: null };
  const personId = ctx.person?.id ?? 'anonymous';
  const hash = simpleHash(JSON.stringify(body));
  const rows = await ctx.store.pool.query(
    'SELECT status, response_body, request_hash FROM idempotency_keys WHERE person_id = $1 AND endpoint = $2 AND key = $3',
    [personId, endpoint, key]
  );
  if (rows.rows.length > 0) {
    const stored = rows.rows[0];
    if (String(stored.request_hash) !== hash) {
      return { key, stored: null, conflictError: conflict('idempotency_conflict', 'This idempotency key was used with a different request.') };
    }
    // A stored response is returned only once the original request finished.
    if (Number(stored.status) === 0) {
      return { key, stored: null, conflictError: conflict('idempotency_conflict', 'This idempotency key is still in use. Try again.') };
    }
    return { key, stored: { status: Number(stored.status), body: JSON.parse(String(stored.response_body)) }, conflictError: null };
  }
  await ctx.store.pool.query(
    `INSERT INTO idempotency_keys (id, person_id, endpoint, key, request_hash, status, response_body, created_at, expires_at)
     VALUES ($1,$2,$3,$4,$5,0,'{}',$6,$7)
     ON CONFLICT (person_id, endpoint, key) DO NOTHING`,
    [randomUUID(), personId, endpoint, key, hash, new Date(), new Date(Date.now() + 24 * 3600 * 1000)]
  );
  return { key, stored: null, conflictError: null };
}

export async function finishIdempotent(ctx: Ctx, endpoint: string, idem: IdemContext, status: number, body: unknown): Promise<void> {
  if (idem.key === null) return;
  const personId = ctx.person?.id ?? 'anonymous';
  await ctx.store.pool.query(
    'UPDATE idempotency_keys SET status = $4, response_body = $5 WHERE person_id = $1 AND endpoint = $2 AND key = $3',
    [personId, endpoint, idem.key, status, JSON.stringify(body)]
  );
}

function simpleHash(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return String(hash);
}
