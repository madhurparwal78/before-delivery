import { randomBytes } from 'node:crypto';
import { oneRow, pool } from '../db/pool.js';
import { apiError, unauthenticated } from '../http/errors.js';
import { readString } from '../http/json.js';
import type { ApiResponse, RequestContext, SessionInfo } from '../http/router.js';
import { signInLanding } from '../domain/landing.js';
import { findEnrollmentByAccessCode } from '../store/enrollments.js';

interface SessionRow {
  readonly token: string;
  readonly role: 'dreamer' | 'coach';
  readonly coach_id: string | null;
  readonly enrollment_id: string | null;
  readonly name: string;
}

export const SESSION_COOKIE = 'lf_session';

export async function loadSession(token: string): Promise<SessionInfo | null> {
  const row = await oneRow<SessionRow>(
    `select s.token, s.role, s.coach_id, s.enrollment_id,
            coalesce(h.name, e.name) as name
       from sessions s
       left join coaches h on h.id = s.coach_id
       left join enrollments e on e.id = s.enrollment_id
      where s.token = $1`,
    [token],
  );
  if (row === null) return null;
  return {
    token: row.token,
    role: row.role,
    coachId: row.coach_id,
    enrollmentId: row.enrollment_id,
    name: row.name,
  };
}

function sessionBody(session: SessionInfo): Record<string, unknown> {
  return {
    role: session.role,
    name: session.name,
    id: session.role === 'coach' ? session.coachId : session.enrollmentId,
  };
}

export async function createSession(ctx: RequestContext): Promise<ApiResponse> {
  const code = readString(ctx.body, 'access_code');
  if (code === undefined) throw apiError(401, 'invalid_code');

  const coach = await oneRow<{ id: string; name: string }>(
    'select id, name from coaches where access_code = $1',
    [code],
  );
  const token = randomBytes(24).toString('base64url');

  if (coach !== null) {
    await pool.query('insert into sessions (token, role, coach_id) values ($1, $2, $3)', [
      token,
      'coach',
      coach.id,
    ]);
    return {
      status: 200,
      json: { role: 'coach', name: coach.name, id: coach.id },
      setSession: token,
    };
  }

  const enrollment = await findEnrollmentByAccessCode(code);
  if (enrollment === null) throw apiError(401, 'invalid_code');
  if (enrollment.status !== 'active') {
    throw apiError(403, 'enrollment_not_active', { status: enrollment.status });
  }
  await pool.query('insert into sessions (token, role, enrollment_id) values ($1, $2, $3)', [
    token,
    'dreamer',
    enrollment.id,
  ]);
  return {
    status: 200,
    json: { role: 'dreamer', name: enrollment.name, id: enrollment.id },
    setSession: token,
  };
}

export async function readSession(ctx: RequestContext): Promise<ApiResponse> {
  if (ctx.session === null) throw unauthenticated();
  return { status: 200, json: sessionBody(ctx.session) };
}

export async function endSession(ctx: RequestContext): Promise<ApiResponse> {
  if (ctx.session === null) throw unauthenticated();
  await pool.query('delete from sessions where token = $1', [ctx.session.token]);
  return { status: 204, clearSession: true };
}

export async function readLanding(ctx: RequestContext): Promise<ApiResponse> {
  if (ctx.session === null) throw unauthenticated();
  return {
    status: 200,
    json: { landing: signInLanding(ctx.session.role, ctx.url.searchParams.get('next')) },
  };
}
