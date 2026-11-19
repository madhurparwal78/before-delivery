// The grading route: reset, clock, fixtures, save-as, settings, storage redirect.
// Every request needs X-Grading-Key equal to GRADING_KEY.

import { webcrypto } from 'node:crypto';
import { RouteContext } from './api.js';
import { sendJson } from './apibase.js';
import { ApiError } from './errors.js';
import { clock } from './db.js';
import { setStorageEndpoint } from './connections.js';
import { SETTING_DEFAULTS } from './settings.js';
import { runSeed } from './seed.js';

export async function handleGradingRoute(route: RouteContext): Promise<void> {
  const { method, path } = route;

  if (path === '/api/grading/reset' && method === 'POST') return reset(route);
  if (path === '/api/grading/clock' && method === 'POST') return setClock(route);
  if (path === '/api/grading/fixtures' && method === 'POST') return fixtures(route);
  if (path === '/api/grading/session' && method === 'POST') return gradingSession(route);
  if (path === '/api/grading/settings' && method === 'PUT') return settings(route);
  if (path === '/api/grading/storage' && method === 'POST') return storage(route);

  const saveMatch = /^\/api\/grading\/records\/([A-Za-z]+-\d+)\/save$/.exec(path);
  if (saveMatch && method === 'POST') return saveAs(route, saveMatch[1]);

  throw new ApiError(404, 'not_found', 'No such record.');
}

/** Restore seed data, delete the app's objects, restore settings, clear the clock. */
async function reset(route: RouteContext): Promise<void> {
  const db = route.ctx.db;

  await db.query(`DROP SCHEMA public CASCADE`);
  await db.query(`CREATE SCHEMA public`);

  const { schemaSql } = await import('./schema.js');
  await db.query(schemaSql());

  // Settings return to their environment values.
  route.ctx.settings.clear();
  for (const name of Object.keys(SETTING_DEFAULTS)) {
    const env = process.env[name];
    if (env !== undefined && env !== '') route.ctx.settings.set(name, /^\d+$/.test(env) ? Number(env) : env);
  }

  // The server clock returns to real time.
  clock.setOffset(0);
  setStorageEndpoint(null);

  // Delete the app's objects in the bucket.
  await route.ctx.storage.deleteAll().catch(() => undefined);

  await runSeed(db);
  sendJson(route.res, 200, { status: 'reset' });
}

/** Set or advance the server clock, running every due background job first. */
async function setClock(route: RouteContext): Promise<void> {
  const oldNow = clock.nowMs();
  let newNow = oldNow;
  if (typeof route.body.set === 'string') {
    const parsed = Date.parse(route.body.set);
    if (Number.isNaN(parsed)) throw new ApiError(422, 'validation', 'set must be an ISO instant.');
    newNow = parsed;
  } else if (typeof route.body.advance_seconds === 'number') {
    newNow = oldNow + route.body.advance_seconds * 1000;
  } else {
    throw new ApiError(422, 'validation', 'Give set or advance_seconds.');
  }
  clock.setOffset(newNow - Date.now());

  // Run every background job due between the old and new instants, in order.
  const { runDueWork } = await import('./background.js');
  await runDueWork(route.ctx, oldNow, newNow);

  sendJson(route.res, 200, { server_time: new Date(clock.nowMs()).toISOString() });
}

/** Create any published fixture in one transaction. */
async function fixtures(route: RouteContext): Promise<void> {
  const { applyFixtures } = await import('./fixtures.js');
  const created = await applyFixtures(route.ctx, route.body);
  sendJson(route.res, 201, { created });
}

/** A session for a chosen user, for grading browser journeys. */
async function gradingSession(route: RouteContext): Promise<void> {
  const username = String(route.body.username ?? '');
  const token = randomToken();
  await route.ctx.db.query(`INSERT INTO sessions(token, username) VALUES ($1,$2)`, [token, username]);
  route.res.setHeader('Set-Cookie', `switchyard_session=${token}; Path=/; HttpOnly; SameSite=Lax`);
  sendJson(route.res, 200, { ok: true });
}

/** Change runtime limits. */
async function settings(route: RouteContext): Promise<void> {
  const body = route.body as Record<string, string | number>;
  for (const [name, value] of Object.entries(body)) {
    if (!(name in SETTING_DEFAULTS)) {
      throw new ApiError(422, 'validation', `Unknown setting "${name}".`);
    }
    route.ctx.settings.set(name, value);
  }
  sendJson(route.res, 200, { settings: Object.fromEntries(route.ctx.settings.entries()) });
}

/** Point the storage client at another endpoint until set back to null. */
async function storage(route: RouteContext): Promise<void> {
  const endpoint = route.body.endpoint === null || route.body.endpoint === undefined ? null : String(route.body.endpoint);
  setStorageEndpoint(endpoint);
  // Re-probe at once so the new state is visible in the response.
  await route.ctx.storage.probe();
  const { flushQueuedUploads } = await import('./background.js');
  await flushQueuedUploads(route.ctx);
  route.ctx.live.publish('storage', 'status', { storage: route.ctx.storage.isAvailable ? 'available' : 'unavailable' });
  sendJson(route.res, 200, { endpoint });
}

/** Save a record as a chosen user with a chosen version. */
async function saveAs(route: RouteContext, number: string): Promise<void> {
  const as = String(route.body.as ?? 'oona');
  const fields = (route.body.fields ?? {}) as Record<string, { value: unknown; version?: number }>;

  const { loadSnapshot } = await import('./recordengine.js');
  const snap = await loadSnapshot(route.ctx.db, number);
  if (!snap) throw new ApiError(404, 'not_found', 'No such record.');

  const person = await route.ctx.db.query(`SELECT roles, department, display_name, time_zone FROM people WHERE username = $1`, [as]);
  if (!person.rows.length) throw new ApiError(404, 'not_found', 'No such record.');

  const viewer = {
    username: as,
    display_name: String(person.rows[0].display_name),
    roles: (person.rows[0].roles ?? []) as never,
    department: String(person.rows[0].department ?? ''),
    time_zone: String(person.rows[0].time_zone ?? 'Europe/Berlin'),
  };

  const { saveRecord } = await import('./recordservice.js');
  const outcome = await saveRecord(route.ctx.db, snap, fields, { username: as, actingFor: null });
  const { syncSlas } = await import('./slarunner.js');
  await syncSlas(route.ctx.db, outcome.record, route.ctx.live);
  route.ctx.live.publish(`record:${number}`, 'updated', { number });
  const { recordBody } = await import('./routes/recordbody.js');
  sendJson(route.res, 200, { record: await recordBody(route, viewer as never, outcome.record) });
}

function randomToken(): string {
  const bytes = new Uint8Array(24);
  webcrypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}
