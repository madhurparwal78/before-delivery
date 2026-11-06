import { randomUUID } from 'node:crypto';
import { limits } from '../config.js';
import { pool } from '../db.js';
import type { SessionAction } from '../domain/sessions.js';
import { notFound } from '../http/errors.js';
import type { AuthContext, Route } from '../http/router.js';
import { isoTimeField, nameField, textField, wholeNumberField } from '../http/validate.js';
import {
  assertMentor,
  loadMembership,
  sessionView,
  soleRow,
  type SessionRow,
} from '../repository.js';
import { claimBaton, moveSession, passBaton } from '../services/batonWrites.js';

async function reachableSession(
  ctx: AuthContext,
): Promise<{ session: SessionRow; role: 'mentor' | 'student' }> {
  const sessionId = ctx.params['session_id'] ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) throw notFound();
  const { rows } = await pool.query<SessionRow>(
    `select id, project_id, title, state, scheduled_for, driver_id, version
       from project_sessions where id = $1`,
    [sessionId],
  );
  const session = rows[0];
  if (session === undefined) throw notFound();
  const membership = await loadMembership(pool, session.project_id, ctx.user.id);
  return { session, role: membership.role };
}

function transitionRoute(action: SessionAction): Route {
  return {
    method: 'POST',
    pattern: `/api/sessions/:session_id/${action}`,
    scope: 'auth',
    body: 'none',
    handler: async (ctx) => {
      const { session, role } = await reachableSession(ctx);
      assertMentor(role);
      return { status: 200, payload: { session: await moveSession(session.id, ctx.user.id, action) } };
    },
  };
}

export const sessionRoutes: Route[] = [
  {
    method: 'POST',
    pattern: '/api/projects/:project_id/sessions',
    scope: 'project',
    body: 'json',
    handler: async (ctx) => {
      assertMentor(ctx.role);
      const fields = ctx.fields();
      const title = nameField(
        fields,
        'title',
        `Give the session a title of 1 to ${limits.nameChars} characters.`,
      );
      const scheduledFor = isoTimeField(fields, 'scheduled_for');
      const id = randomUUID();
      const { rows } = await pool.query<SessionRow>(
        `insert into project_sessions (id, project_id, title, state, scheduled_for, driver_id, version)
         values ($1, $2, $3, 'scheduled', $4, null, 0)
         returning id, project_id, title, state, scheduled_for, driver_id, version`,
        [id, ctx.project.id, title, scheduledFor],
      );
      return { status: 201, payload: { session: sessionView(soleRow(rows)) } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/sessions/:session_id',
    scope: 'auth',
    body: 'none',
    handler: async (ctx) => {
      const { session } = await reachableSession(ctx);
      return { status: 200, payload: { session: sessionView(session) } };
    },
  },
  transitionRoute('start'),
  transitionRoute('pause'),
  transitionRoute('resume'),
  transitionRoute('end'),
  {
    method: 'POST',
    pattern: '/api/sessions/:session_id/baton/claim',
    scope: 'auth',
    body: 'json',
    handler: async (ctx) => {
      const { session } = await reachableSession(ctx);
      const version = wholeNumberField(
        ctx.fields(),
        'version',
        0,
        Number.MAX_SAFE_INTEGER,
        'Send the session version you last saw.',
      );
      return {
        status: 200,
        payload: { session: await claimBaton(session.id, ctx.user.id, version) },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/sessions/:session_id/baton/pass',
    scope: 'auth',
    body: 'json',
    handler: async (ctx) => {
      const { session } = await reachableSession(ctx);
      const fields = ctx.fields();
      const toUserId = textField(
        fields,
        'to_user_id',
        'Pass the baton to a participant of this project.',
      );
      const version = wholeNumberField(
        fields,
        'version',
        0,
        Number.MAX_SAFE_INTEGER,
        'Send the session version you last saw.',
      );
      return {
        status: 200,
        payload: { session: await passBaton(session.id, ctx.user.id, toUserId, version) },
      };
    },
  },
];
