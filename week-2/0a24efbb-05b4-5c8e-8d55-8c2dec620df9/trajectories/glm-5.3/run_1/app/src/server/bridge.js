import { query } from '../db/pg.js';
import { loadSession, touchSession, SESSION_COOKIE } from './sessions.js';
import { currentManagerIds } from './people.js';

/** Resolve the caller from the session, reading role and lines live from the store. */
export async function resolveViewer(request) {
  const authHeader = request.headers?.get
    ? request.headers.get('authorization')
    : request.headers?.authorization;
  const token = bearerFromAuth(authHeader) ?? request.cookies?.[SESSION_COOKIE] ?? null;
  if (!token) return { token: null, state: 'none' };
  const loaded = await loadSession(token);
  if (!loaded || loaded.kind === 'unknown') return { token, state: 'none' };
  if (loaded.kind === 'ended') return { token, state: 'ended' };
  // touch before answering, whatever the answer
  await touchSession(loaded.session.id);
  const person = await getPerson(loaded.person.id);
  if (!person) return { token, state: 'ended' };
  const directReportIds = person.role === 'manager' ? await currentManagerIds(person.id) : [];
  return {
    token,
    state: 'ok',
    viewer: {
      id: person.id,
      name: person.name,
      work_address: person.work_address,
      role: person.role,
      active: person.active,
      directReportIds,
    },
    session: loaded.session,
  };
}

function bearerFromAuth(header) {
  if (header && /^Bearer /i.test(header)) return header.slice(7);
  return null;
}

async function getPerson(id) {
  const rows = await query('SELECT * FROM person WHERE id = $1', [id]);
  return rows[0] || null;
}
