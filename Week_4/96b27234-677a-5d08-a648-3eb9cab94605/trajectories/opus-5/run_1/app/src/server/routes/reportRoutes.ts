import { randomUUID } from 'node:crypto';
import { one, query } from '../db.js';
import { conflict, invalid, notFound } from '../errors.js';
import { personOrThrow, readJsonBody, route, sendJson } from '../http.js';
import { worldNow } from '../clock.js';
import { publishPersonEvent } from '../events.js';
import { getOpenSession, leaveSession } from '../sessions.js';
import { onlineIds } from '../services/valkey.js';

const CATEGORIES = ['harassment', 'hateful-content', 'impersonation', 'other'];

export const REPORT_TEXT = {
  category: 'Choose a category.',
  details: 'Write 1 to 1000 characters.',
  self: 'You cannot report yourself.',
  badMove: 'This report cannot move that way.',
  action: 'Choose warn or suspend.',
  state: 'Choose a valid state.'
} as const;

interface ReportRow {
  id: string;
  world_id: string;
  person_id: string;
  session_id: string;
  category: string;
  details: string;
  state: string;
  action: string | null;
  created_at: Date;
}

async function reportView(row: ReportRow): Promise<Record<string, unknown>> {
  const person = await one<{ display_name: string }>('select display_name from people where id = $1', [row.person_id]);
  const room = await one<{ name: string }>(
    `select a.name from sessions s join assets a on a.id = s.room_asset_id where s.id = $1`,
    [row.session_id]
  );
  return {
    id: row.id,
    personId: row.person_id,
    personName: person?.display_name ?? '',
    sessionId: row.session_id,
    roomName: room?.name ?? '',
    category: row.category,
    details: row.details,
    state: row.state,
    action: row.action,
    createdAt: row.created_at.toISOString()
  };
}

route('POST', '/api/reports', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const body = await readJsonBody(ctx);
  const targetId = typeof body['personId'] === 'string' ? body['personId'] : '';
  const sessionId = typeof body['sessionId'] === 'string' ? body['sessionId'] : '';
  const target = await one<{ id: string }>('select id from people where id = $1 and world_id = $2', [
    targetId,
    person.world_id
  ]);
  if (target === null) throw notFound();
  const session = await one<{ id: string }>('select id from sessions where id = $1 and world_id = $2', [
    sessionId,
    person.world_id
  ]);
  if (session === null) throw notFound();
  const wasInside = await one('select 1 from session_members where session_id = $1 and person_id = $2', [
    sessionId,
    person.id
  ]);
  if (wasInside === null) throw notFound();
  const category = body['category'];
  if (typeof category !== 'string' || !CATEGORIES.includes(category)) throw invalid(REPORT_TEXT.category);
  const details = body['details'];
  if (typeof details !== 'string' || details.length < 1 || details.length > 1000) throw invalid(REPORT_TEXT.details);
  if (targetId === person.id) throw invalid(REPORT_TEXT.self);
  const now = await worldNow(person.world_id);
  const id = randomUUID();
  await query(
    `insert into reports (id, world_id, filer_id, person_id, session_id, category, details, state, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, 'open', $8)`,
    [id, person.world_id, person.id, targetId, sessionId, category, details, now]
  );
  sendJson(ctx.res, 201, { id, state: 'open' });
});

route('GET', '/api/moderation/reports', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  if (person.site_role !== 'moderator') throw notFound();
  const rows = await query<ReportRow>(
    'select * from reports where world_id = $1 order by created_at asc',
    [person.world_id]
  );
  const reports = [];
  for (const row of rows) reports.push(await reportView(row));
  sendJson(ctx.res, 200, { reports });
});

async function applyDecision(worldId: string, personId: string, action: string): Promise<void> {
  const online = await onlineIds([personId]);
  if (action === 'warn') {
    if (online.has(personId)) await publishPersonEvent(personId, { type: 'warned' });
    else
      await query('insert into pending_notices (id, person_id, kind) values ($1, $2, $3)', [
        randomUUID(),
        personId,
        'warned'
      ]);
    return;
  }
  await query('update people set suspended = true where id = $1', [personId]);
  await query('delete from auth_tokens where person_id = $1', [personId]);
  const memberships = await query<{ session_id: string; display_name: string }>(
    `select m.session_id, p.display_name from session_members m
       join sessions s on s.id = m.session_id
       join people p on p.id = m.person_id
      where m.person_id = $1 and m.active = true and s.status = 'open' and s.world_id = $2`,
    [personId, worldId]
  );
  await publishPersonEvent(personId, { type: 'suspended' });
  for (const membership of memberships) {
    const session = await getOpenSession(membership.session_id);
    if (session === null) continue;
    await leaveSession(session, personId, membership.display_name);
  }
}

route('POST', '/api/moderation/reports/:id/move', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  if (person.site_role !== 'moderator') throw notFound();
  const row = await one<ReportRow>('select * from reports where id = $1 and world_id = $2', [
    ctx.params['id'] ?? '',
    person.world_id
  ]);
  if (row === null) throw notFound();
  const body = await readJsonBody(ctx);
  const state = body['state'];
  if (state !== 'reviewing' && state !== 'upheld' && state !== 'dismissed') throw invalid(REPORT_TEXT.state);
  const legal =
    (row.state === 'open' && state === 'reviewing') ||
    (row.state === 'reviewing' && (state === 'upheld' || state === 'dismissed'));
  if (!legal) throw conflict(REPORT_TEXT.badMove);
  const action = body['action'];
  if (state === 'upheld' && action !== 'warn' && action !== 'suspend') throw invalid(REPORT_TEXT.action);
  await query('update reports set state = $2, action = $3 where id = $1', [
    row.id,
    state,
    state === 'upheld' ? (action as string) : null
  ]);
  if (state === 'upheld') await applyDecision(person.world_id, row.person_id, action as string);
  const updated = await one<ReportRow>('select * from reports where id = $1', [row.id]);
  if (updated === null) throw notFound();
  sendJson(ctx.res, 200, await reportView(updated));
});
