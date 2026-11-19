import type { PoolClient } from 'pg';
import type { Ctx } from './apiRoutes.js';
import { ApiError, conflict, forbidden, invalid, notFound, unavailable } from './errors.js';
import { emptyOk, jsonOk, readJsonBody, checkBody, type BodySpec } from './http.js';
import { COPY } from './apiCore.js';
import { SignInLockout, sessionEnd } from './domain/sessions.js';
import { mapPerson, personStatus, type PersonRow, type Role } from './people.js';
import { visibleVaultIds, seesRules, termIsOpen, type TravelRow } from './domain/visibility.js';
import { applyScopeLoss, addReviewLinesForScopes, closePersonSessions } from './domain/scopeChanges.js';
import {
  addDays,
  formatOfficeStamp,
  officeDateString,
  officeLocalInstant,
  officeTimeString,
  offsetAbbreviation,
  parseOfficeDate,
  secondBusinessDayAfter
} from './officeTime.js';
import { randomUUID } from 'node:crypto';

const SEAT_PRICE = '48.00';

export interface PersonSnapshot {
  person: PersonRow;
  status: string;
  seat: 'confirmed' | 'waiting_on_billing' | 'release_waiting' | 'released';
  vaultIds: string[];
  travel: Array<{ id: string; starts_at: string; ends_at: string }>;
}

/** Load a person with their status, seat state, scopes and travel windows. */
export async function loadPersonSnapshot(ctx: Ctx, personId: string): Promise<PersonSnapshot> {
  const rows = await ctx.store.pool.query('SELECT * FROM people WHERE id = $1', [personId]);
  if (rows.rows.length === 0) throw notFound();
  const person = mapPerson(rows.rows[0]);
  const scopes = await ctx.store.pool.query('SELECT vault_id FROM vault_scopes WHERE person_id = $1', [personId]);
  const travelRows = await ctx.store.pool.query(
    'SELECT id, starts_at, ends_at FROM travel_windows WHERE person_id = $1 ORDER BY starts_at DESC',
    [personId]
  );
  const travels: TravelRow[] = travelRows.rows.map((row) => ({
    id: String(row.id),
    starts_at: new Date(row.starts_at as string),
    ends_at: new Date(row.ends_at as string)
  }));
  const now = ctx.store.clock.now();
  const travellingNow = travels.some(
    (travel) => travel.starts_at.getTime() <= now.getTime() && now.getTime() < travel.ends_at.getTime()
  );
  const status = personStatus(person, travellingNow, now);
  const seat = await seatState(ctx, personId);
  const vaultRows = await ctx.store.pool.query(
    'SELECT v.id, v.name, v.formerly, v.off_when_travelling, v.position FROM vaults v JOIN vault_scopes s ON s.vault_id = v.id WHERE s.person_id = $1 ORDER BY v.position',
    [personId]
  );
  const travelView = travels.map((travel) => ({
    id: travel.id,
    starts_at: formatTravel(travel.starts_at, ctx),
    ends_at: formatTravel(travel.ends_at, ctx)
  }));
  return {
    person,
    status,
    seat,
    vaultIds: vaultRows.rows.map((row) => String(row.id)),
    travel: travelView
  };
}

function formatTravel(instant: Date, ctx: Ctx): string {
  const d = new Date(instant);
  const day = officeDateString(d);
  const time = officeTimeString(d);
  return `${day}T${time}`;
}

async function seatState(ctx: Ctx, personId: string): Promise<PersonSnapshot['seat']> {
  const rows = await ctx.store.pool.query(
    'SELECT change, state FROM seat_changes WHERE person_id = $1 ORDER BY since DESC',
    [personId]
  );
  if (rows.rows.length === 0) return 'released';
  const latest = rows.rows[0];
  if (latest.state === 'confirmed') return latest.change === 'add' ? 'confirmed' : 'released';
  if (latest.change === 'add') return 'waiting_on_billing';
  return 'release_waiting';
}

export function personView(snap: PersonSnapshot): Record<string, unknown> {
  const person = snap.person;
  return {
    id: person.id,
    full_name: person.full_name,
    email: person.email,
    handle: person.handle,
    role: person.role,
    aliases: person.aliases,
    status: snap.status,
    vault_ids: snap.vaultIds,
    term: person.role === 'outside_bookkeeper' && person.term_starts_on && person.term_ends_on
      ? { starts_on: person.term_starts_on, ends_on: person.term_ends_on }
      : null,
    travel: snap.travel,
    seat: snap.seat,
    left_at: person.left_at ? person.left_at.toISOString() : null
  };
}

/** Sign in: check the lockout, verify with Keycloak, create a session, decide the landing route. */
export async function signIn(ctx: Ctx, lockout: SignInLockout): Promise<void> {
  const limit = 16384;
  const body = await readJsonBody(ctx.req, ctx.res, limit);
  if (body instanceof ApiError) throw body;
  const spec: BodySpec = {
    username: { type: 'string', required: true },
    password: { type: 'string', required: true },
    next: { type: 'string', required: false }
  };
  const bodyError = checkBody(spec, body);
  if (bodyError) throw bodyError;
  const username = String(body.username ?? '');
  const password = String(body.password ?? '');
  const now = ctx.store.clock.now();
  const lock = await lockout.lockState(username, now);
  if (lock.locked && lock.until) {
    const retryAfter = Math.max(1, Math.ceil((lock.until.getTime() - now.getTime()) / 1000));
    throw new ApiError(
      429,
      'sign_in_locked',
      `${COPY.lockedPrefix}${formatOfficeStamp(lock.until)}.`,
      undefined,
      { 'Retry-After': String(retryAfter) }
    );
  }
  const officeKey = ctx.store.settings.officeKey;
  const keycloakUsername = `${officeKey}.${username}`;
  const check = await ctx.store.keycloak.checkPassword(keycloakUsername, password);
  if (check.kind === 'unreachable') {
    throw unavailable('sign_in_unavailable', COPY.signInUnavailable);
  }
  if (check.kind === 'bad_credentials') {
    const fail = await lockout.recordFailure(username, now);
    if (fail.locked && fail.until) {
      const retryAfter = Math.max(1, Math.ceil((fail.until.getTime() - now.getTime()) / 1000));
      throw new ApiError(
        429,
        'sign_in_locked',
        `${COPY.lockedPrefix}${formatOfficeStamp(fail.until)}.`,
        undefined,
        { 'Retry-After': String(retryAfter) }
      );
    }
    throw new ApiError(401, 'bad_credentials', COPY.signInBadCredentials);
  }
  if (check.kind === 'account_disabled') {
    throw new ApiError(401, 'account_disabled', COPY.signInDisabled);
  }
  const rows = await ctx.store.pool.query('SELECT * FROM people WHERE handle = $1 AND status <> $2', [username, 'left']);
  if (rows.rows.length === 0) {
    throw new ApiError(401, 'bad_credentials', COPY.signInBadCredentials);
  }
  const person = mapPerson(rows.rows[0]);
  if (person.role === 'outside_bookkeeper' && !termIsOpen(person, now)) {
    throw new ApiError(401, 'account_disabled', COPY.signInDisabled);
  }
  const failed = await lockout.recordFailure(username, now).catch(() => null);
  void failed;
  await lockout.reset(username);
  const sessionId = randomUUID();
  const startedAt = now;
  const endsAt = sessionEnd(startedAt, ctx.store.settings.revealSessionSeconds);
  await ctx.store.pool.query(
    'INSERT INTO sessions (id, person_id, started_at, ends_at) VALUES ($1,$2,$3,$4)',
    [sessionId, person.id, startedAt, endsAt]
  );
  await ctx.store.pool.query('UPDATE people SET first_signed_in_at = COALESCE(first_signed_in_at, $2) WHERE id = $1', [
    person.id,
    startedAt
  ]);
  const landing = await decideLanding(ctx, person, typeof body.next === 'string' ? body.next : undefined);
  jsonOk(
    ctx.res,
    201,
    {
      person: await personViewOf(ctx, person.id),
      session_ends_at: endsAt.toISOString(),
      landing
    },
    {
      'Set-Cookie': `lockset_session=${sessionId}; HttpOnly; SameSite=Lax; Path=/`,
      'Cache-Control': 'no-store'
    }
  );
}

async function personViewOf(ctx: Ctx, personId: string): Promise<Record<string, unknown>> {
  const snap = await loadPersonSnapshot(ctx, personId);
  return personView(snap);
}

/** The one place the landing route is decided, per the published rules. */
export async function decideLanding(ctx: Ctx, person: PersonRow, next: string | undefined): Promise<string> {
  if (typeof next === 'string' && isSafeNext(next)) {
    const path = next.split('?')[0] ?? next;
    if (deskRouteForRole(path, person.role) || (path.startsWith('/desk/vaults/') && (await vaultVisible(ctx, person, path.slice('/desk/vaults/'.length))))) {
      return next;
    }
  }
  const vaultRows = await ctx.store.pool.query('SELECT id, name, formerly, off_when_travelling, position FROM vaults ORDER BY position');
  const vaults = vaultRows.rows.map(mapVaultRow);
  const scopes = await ctx.store.pool.query('SELECT vault_id FROM vault_scopes WHERE person_id = $1', [person.id]);
  const scopeSet = new Set(scopes.rows.map((row) => String(row.vault_id)));
  const travelRows = await ctx.store.pool.query(
    'SELECT id, starts_at, ends_at FROM travel_windows WHERE person_id = $1',
    [person.id]
  );
  const travels: TravelRow[] = travelRows.rows.map((row) => ({
    id: String(row.id),
    starts_at: new Date(row.starts_at as string),
    ends_at: new Date(row.ends_at as string)
  }));
  const visible = await visibleVaultIds(person, scopeSet, travels, vaults, ctx.store.clock.now());
  if (visible.length > 0) return `/desk/vaults/${visible[0]}`;
  return '/desk';
}

function isSafeNext(next: string): boolean {
  return next.startsWith('/') && !next.startsWith('//') && !next.includes('\\');
}

const DESK_ROUTES: Array<{ path: string; roles: Role[] }> = [
  { path: '/desk', roles: ['office_manager', 'managing_partner', 'staff_accountant', 'outside_bookkeeper'] },
  { path: '/rotations', roles: ['office_manager', 'managing_partner'] },
  { path: '/reviews', roles: ['office_manager', 'managing_partner'] },
  { path: '/people', roles: ['office_manager', 'managing_partner'] },
  { path: '/travel', roles: ['staff_accountant', 'outside_bookkeeper'] },
  { path: '/billing', roles: ['office_manager', 'managing_partner'] },
  { path: '/health', roles: ['office_manager', 'managing_partner'] },
  { path: '/import', roles: ['office_manager'] },
  { path: '/audit', roles: ['office_manager', 'managing_partner'] }
];

export function deskRouteForRole(path: string, role: Role): boolean {
  const entry = DESK_ROUTES.find((route) => route.path === path);
  if (entry) return entry.roles.includes(role);
  if (path.startsWith('/desk/vaults/')) return true;
  return false;
}

async function vaultVisible(ctx: Ctx, person: PersonRow, vaultId: string): Promise<boolean> {
  const vaultRows = await ctx.store.pool.query('SELECT id, name, formerly, off_when_travelling, position FROM vaults ORDER BY position');
  const vaults = vaultRows.rows.map(mapVaultRow);
  const scopes = await ctx.store.pool.query('SELECT vault_id FROM vault_scopes WHERE person_id = $1', [person.id]);
  const scopeSet = new Set(scopes.rows.map((row) => String(row.vault_id)));
  const travelRows = await ctx.store.pool.query('SELECT id, starts_at, ends_at FROM travel_windows WHERE person_id = $1', [person.id]);
  const travels: TravelRow[] = travelRows.rows.map((row) => ({
    id: String(row.id),
    starts_at: new Date(row.starts_at as string),
    ends_at: new Date(row.ends_at as string)
  }));
  const visible = await visibleVaultIds(person, scopeSet, travels, vaults, ctx.store.clock.now());
  return visible.includes(vaultId);
}

export function mapVaultRow(row: Record<string, unknown>): { id: string; name: string; formerly: string | null; off_when_travelling: boolean; position: number } {
  return {
    id: String(row.id),
    name: String(row.name),
    formerly: row.formerly ? String(row.formerly) : null,
    off_when_travelling: Boolean(row.off_when_travelling),
    position: Number(row.position)
  };
}
