/**
 * The key-guarded grading route. Without the right key every path here answers
 * 404, as if it did not exist.
 */

import { iso, now, nowMs, resetToRealTime, setTo, advanceSeconds, offset } from '../clock';
import { applySettings, isSettingName, resetSettings, settings } from '../config';
import { query, saveClockOffset, setSequence, transaction } from '../db';
import { notFound, validation } from '../errors';
import { isRoleKey } from '../domain/roles';
import {
  clearRateLimits,
  createSession,
  sessionCookie,
  type RequestContext,
} from '../http/context';
import { runDueWork } from '../services/background';
import { Engine } from '../services/engine';
import { loadPerson } from '../services/store';
import { patchRecord, recordJson, type FieldSave } from '../services/recordops';
import { deleteObject, listKeys, redirectStorage, probeStorage } from '../services/storage';
import { reseed } from '../seed';
import { applyFixtures } from '../services/fixtures';
import { ok, route, created } from './router';

export function gradingKeyOf(context: RequestContext): string | undefined {
  const raw = context.request.headers['x-grading-key'];
  return Array.isArray(raw) ? raw[0] : raw;
}

function guard(context: RequestContext): void {
  if (gradingKeyOf(context) !== settings().GRADING_KEY) throw notFound();
}

route('POST', '/api/grading/reset', async (context) => {
  guard(context);
  await reseed();
  for (const prefix of ['attachments/', 'imports/', 'exports/', 'config-sets/']) {
    for (const key of await listKeys(prefix)) await deleteObject(key);
  }
  resetSettings();
  redirectStorage(null);
  resetToRealTime();
  await saveClockOffset(0);
  clearRateLimits();
  await probeStorage();
  return ok({ status: 'reset' });
});

/**
 * Moves the clock, then runs every background job due between the old and the
 * new instant before answering.
 */
route('POST', '/api/grading/clock', async (context) => {
  guard(context);
  const before = nowMs();
  if (typeof context.body.set === 'string') {
    const at = Date.parse(context.body.set);
    if (Number.isNaN(at)) throw validation('A clock instant must be ISO 8601.', { set: 'A clock instant must be ISO 8601.' });
    setTo(new Date(at));
  } else if (context.body.advance_seconds !== undefined) {
    const seconds = Number(context.body.advance_seconds);
    if (!Number.isFinite(seconds)) {
      throw validation('advance_seconds must be a number.', { advance_seconds: 'advance_seconds must be a number.' });
    }
    advanceSeconds(seconds);
  }
  await saveClockOffset(offset());

  // Due work runs in time order, so its effects are already visible.
  const target = nowMs();
  if (target > before) {
    const steps = Math.min(64, Math.max(1, Math.ceil((target - before) / 60_000)));
    const span = target - before;
    for (let step = 1; step <= steps; step += 1) {
      setTo(new Date(before + Math.round((span * step) / steps)));
      await runDueWork();
    }
    setTo(new Date(target));
  }
  await runDueWork();
  return ok({ server_time: iso(now()) });
});

route('POST', '/api/grading/fixtures', async (context) => {
  guard(context);
  const createdItems = await applyFixtures(context.body);
  return created({ created: createdItems });
});

route('POST', '/api/grading/records/:number/save', async (context, params) => {
  guard(context);
  const username = String(context.body.as ?? '');
  const person = await loadPerson(username);
  if (!person) throw validation('That person does not exist.', { as: 'That person does not exist.' });
  const engine = await Engine.load('live');
  const caller = {
    username: person.username,
    roles: person.roles,
    department: person.department,
    timeZone: person.timeZone,
    displayName: person.displayName,
    actor: person.username,
    impersonating: false,
    workspace: 'live' as const,
  };
  const raw = (context.body.fields ?? {}) as Record<string, { value: unknown; version?: unknown }>;
  const fields: Record<string, FieldSave> = {};
  for (const [name, entry] of Object.entries(raw)) {
    fields[name] = { value: entry.value, version: Number(entry.version ?? 1) };
  }
  engine.requireVisible(caller, params.number);
  const result = await patchRecord(engine, caller, params.number, { fields });
  return ok({ record: await recordJson(engine, caller, result.record, result.slas) });
});

route('POST', '/api/grading/session', async (context) => {
  guard(context);
  const username = String(context.body.username ?? '');
  const person = await loadPerson(username);
  if (!person) throw validation('That person does not exist.', { username: 'That person does not exist.' });
  const id = await createSession(username);
  return {
    status: 200,
    body: { user: { username: person.username, display_name: person.displayName, roles: person.roles } },
    headers: { 'set-cookie': `${sessionCookie}=${id}; Path=/; HttpOnly; SameSite=Lax` },
  };
});

route('PUT', '/api/grading/settings', async (context) => {
  guard(context);
  const accepted: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(context.body)) {
    if (!isSettingName(name)) continue;
    accepted[name] = value;
  }
  applySettings(accepted);
  return ok({ settings: settings() });
});

route('POST', '/api/grading/storage', async (context) => {
  guard(context);
  const endpoint = context.body.endpoint === null || context.body.endpoint === undefined
    ? null
    : String(context.body.endpoint);
  redirectStorage(endpoint);
  await probeStorage();
  return ok({ endpoint });
});

export { setSequence, transaction, query, isRoleKey };
