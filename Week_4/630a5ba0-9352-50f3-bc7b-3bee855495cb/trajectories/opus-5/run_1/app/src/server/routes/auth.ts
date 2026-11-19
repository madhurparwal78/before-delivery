import type { PoolClient } from 'pg';
import { pool, withTransaction } from '../db/pool.js';
import type { MemberRow, SessionRow, TaskRow, WorkspaceRow } from '../db/records.js';
import type { MemberDto } from '../../shared/types.js';
import { config } from '../config.js';
import { Response, created, noContent } from '../http/server.js';
import { SESSION_COOKIE, jsonBody, requireMember, type RequestContext } from '../http/context.js';
import { conflict, invalidCredentials } from '../http/errors.js';
import {
  FieldErrors,
  checkEmail,
  checkName,
  checkPassword,
  checkThreshold,
  checkTimeZone,
} from '../http/validate.js';
import { createAuthSession, endAuthSession, hashPassword, newId, randomToken, verifyPassword } from '../services/auth.js';
import { enqueue, runItemNow } from '../services/outbox.js';
import { billingEventsFor, statusFrom, workspaceDto } from '../services/workspaces.js';
import { localDateOf, localTimeOf, todayInZone } from '../../shared/time.js';
import type { Router } from '../http/router.js';

export function memberDto(member: MemberRow): MemberDto {
  return {
    id: member.id,
    name: member.name,
    email: member.email,
    role: member.role,
    timeZone: member.time_zone,
    thresholdMinutes: member.threshold_minutes,
  };
}

export function sessionCookie(token: string): Record<string, string> {
  return {
    'Set-Cookie': `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.sessionTtlSeconds}`,
  };
}

export async function emailTaken(client: Pick<PoolClient, 'query'>, email: string): Promise<boolean> {
  const result = await client.query(
    `select 1 from members where email_lower = $1 and status <> 'removed'`,
    [email.toLowerCase()],
  );
  return (result.rowCount ?? 0) > 0;
}

async function createWorkspace(context: RequestContext): Promise<Response> {
  const body = jsonBody(context);
  const errors = new FieldErrors();
  const workspaceName = checkName(errors, 'workspaceName', body.workspaceName);
  const ownerName = checkName(errors, 'ownerName', body.ownerName);
  const email = checkEmail(errors, 'email', body.email);
  const password = checkPassword(errors, 'password', body.password);
  const timeZone = checkTimeZone(errors, 'timeZone', body.timeZone);
  errors.throwIfAny();

  if (await emailTaken(pool, email)) {
    throw conflict('email_taken', 'That email already has a Daybook.');
  }

  const passwordHash = await hashPassword(password);
  const result = await withTransaction(async (tx) => {
    const workspaceId = newId();
    const memberId = newId();
    const workspace = await tx.query<WorkspaceRow>(
      `insert into workspaces (id, name, created_at, trial_ends_at)
       values ($1, $2, now(), now() + ($3 || ' seconds')::interval)
       returning *`,
      [workspaceId, workspaceName, String(config.trialLengthSeconds)],
    );
    const member = await tx.query<MemberRow>(
      `insert into members (id, workspace_id, name, email, email_lower, password_hash, role,
                            time_zone, threshold_minutes, status, feed_token, created_at, updated_at)
       values ($1, $2, $3, $4, lower($4), $5, 'owner', $6, 360, 'active', $7, now(), now())
       returning *`,
      [memberId, workspaceId, ownerName, email, passwordHash, timeZone, randomToken()],
    );
    const token = await createAuthSession(tx, memberId);
    const queueId = await enqueue(tx, 'killbill_register_workspace', { workspaceId, memberId });
    return { workspace: workspace.rows[0]!, member: member.rows[0]!, token, queueId };
  });

  const registered = await runItemNow(result.queueId);
  const status = statusFrom(result.workspace, []);
  return created(
    {
      workspace: workspaceDto(result.workspace, status.state),
      member: memberDto(result.member),
      billing: registered ? 'registered' : 'queued',
    },
    sessionCookie(result.token),
  );
}

async function signIn(context: RequestContext): Promise<Response> {
  const body = jsonBody(context);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const found = await pool.query<MemberRow>(
    `select * from members where email_lower = $1 and status <> 'removed'`,
    [email],
  );
  const member = found.rows[0];
  if (!member || !(await verifyPassword(password, member.password_hash))) {
    throw invalidCredentials();
  }
  const token = await withTransaction((tx) => createAuthSession(tx, member.id));
  const workspace = member.workspace_id
    ? (await pool.query<WorkspaceRow>('select * from workspaces where id = $1', [member.workspace_id])).rows[0]
    : undefined;
  const state = workspace ? statusFrom(workspace, await billingEventsFor(workspace.id)).state : null;
  return new Response(
    200,
    {
      member: memberDto(member),
      workspace: workspace && state ? workspaceDto(workspace, state) : null,
    },
    sessionCookie(token),
  );
}

async function signOut(context: RequestContext): Promise<Response> {
  const cookie = context.request.headers.cookie ?? '';
  const match = new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(cookie);
  if (match) await endAuthSession(decodeURIComponent(match[1]!));
  return noContent({
    'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  });
}

function meBody(context: RequestContext, member: MemberRow): Record<string, unknown> {
  return {
    member: memberDto(member),
    workspace:
      context.workspace && context.workspaceState
        ? workspaceDto(context.workspace, context.workspaceState)
        : null,
    today: todayInZone(member.time_zone),
  };
}

async function me(context: RequestContext): Promise<Record<string, unknown>> {
  const member = requireMember(context);
  return meBody(context, member);
}

/**
 * A zone change moves today and every day boundary at once. Sessions keep their instant;
 * their local date and times are recomputed, and a session that lands on another local
 * date takes its task's dayDate with it.
 */
async function retimeSessions(tx: PoolClient, memberId: string, timeZone: string): Promise<void> {
  const sessions = await tx.query<SessionRow>(
    'select * from task_sessions where member_id = $1 for update',
    [memberId],
  );
  for (const session of sessions.rows) {
    const localDate = localDateOf(session.start_instant, timeZone);
    const startTime = localTimeOf(session.start_instant, timeZone);
    const endTime = localTimeOf(session.end_instant, timeZone);
    if (
      localDate === session.local_date &&
      startTime === session.start_time &&
      endTime === session.end_time
    ) {
      continue;
    }
    await tx.query(
      `update task_sessions
          set local_date = $2, start_time = $3, end_time = $4, version = version + 1, updated_at = now()
        where id = $1`,
      [session.id, localDate, startTime, endTime],
    );
    const task = await tx.query<TaskRow>('select * from tasks where id = $1 for update', [session.task_id]);
    const row = task.rows[0];
    if (row && row.day_date !== localDate) {
      await tx.query(
        'update tasks set day_date = $2, version = version + 1, updated_at = now() where id = $1',
        [row.id, localDate],
      );
    }
  }
}

async function updateMe(context: RequestContext): Promise<Record<string, unknown>> {
  const member = requireMember(context);
  const body = jsonBody(context);
  const errors = new FieldErrors();
  const timeZone = 'timeZone' in body ? checkTimeZone(errors, 'timeZone', body.timeZone) : member.time_zone;
  const thresholdMinutes =
    'thresholdMinutes' in body
      ? checkThreshold(errors, 'thresholdMinutes', body.thresholdMinutes)
      : member.threshold_minutes;
  errors.throwIfAny();

  const updated = await withTransaction(async (tx) => {
    const row = await tx.query<MemberRow>(
      `update members set time_zone = $2, threshold_minutes = $3, updated_at = now()
        where id = $1 returning *`,
      [member.id, timeZone, thresholdMinutes],
    );
    if (timeZone !== member.time_zone) await retimeSessions(tx, member.id, timeZone);
    return row.rows[0]!;
  });

  return { member: memberDto(updated), today: todayInZone(updated.time_zone) };
}

export function registerAuthRoutes(router: Router): void {
  router.post('/api/workspaces', createWorkspace);
  router.post('/api/auth/sign-in', signIn);
  router.post('/api/auth/sign-out', signOut);
  router.get('/api/me', me);
  router.patch('/api/me', updateMe);
}
