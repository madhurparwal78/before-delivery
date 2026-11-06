import {
  clearedCookieHeader,
  createSession,
  endSession,
  isRole,
  requireSession,
  SESSION_COOKIE,
  sessionCookieHeader,
  type Role,
} from '../auth.ts';
import { config } from '../config.ts';
import { queryOne, transact, type Transaction } from '../db/pool.ts';
import { queueMail } from '../db/outbox.ts';
import { FIELD_COPY } from '../../domain/copy.ts';
import { graphemeCount } from '../../domain/text.ts';
import type { Ctx } from '../http/context.ts';
import { gone, unauthenticated, ApiError } from '../http/errors.ts';
import { sendEmpty, sendJson } from '../http/respond.ts';
import { email as emailField, Problems, text } from '../http/validate.ts';
import { newId, newToken, sha256Hex, hashPassword, verifyPassword } from '../services/crypto.ts';
import { formatInstant } from '../../domain/time.ts';

interface MemberRow {
  id: string;
  workspace_id: string;
  name: string;
  email: string;
  role: Role;
  stockist_id: string | null;
  password_hash: string | null;
  created_at_ms: number;
  removed_at_ms: number | null;
}

export function memberShape(row: MemberRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    stockistId: row.role === 'stockist_buyer' ? row.stockist_id : null,
    createdAt: formatInstant(Number(row.created_at_ms)),
  };
}

function checkPassword(problems: Problems, value: unknown, path = 'password'): string {
  if (typeof value !== 'string' || value === '') {
    problems.add(path, FIELD_COPY.required);
    return '';
  }
  const length = graphemeCount(value);
  if (length < 12 || length > 128) problems.add(path, FIELD_COPY.password);
  return value;
}

export async function signIn(ctx: Ctx): Promise<void> {
  const body = ctx.json();
  const problems = new Problems();
  const address = emailField(problems, body, 'email');
  const password = typeof body['password'] === 'string' ? (body['password'] as string) : '';
  problems.throwIfAny();

  const member = await queryOne<MemberRow>(
    'select * from members where lower(email) = lower($1) and removed_at_ms is null',
    [address],
  );
  if (member === null || !verifyPassword(password, member.password_hash)) {
    throw new ApiError(401, 'invalid_credentials');
  }
  const token = await transact((tx) => createSession(tx, member.id, ctx.nowMs));
  sendJson(ctx.response, 200, { member: memberShape(member) }, {
    'set-cookie': sessionCookieHeader(token),
  });
}

export async function signOut(ctx: Ctx): Promise<void> {
  const token = ctx.cookie(SESSION_COOKIE);
  if (token !== null) await endSession(token);
  sendEmpty(ctx.response, 204, { 'set-cookie': clearedCookieHeader() });
}

export async function session(ctx: Ctx): Promise<void> {
  const current = await requireSession(ctx);
  const member = await queryOne<MemberRow>('select * from members where id = $1', [
    current.memberId,
  ]);
  if (member === null) throw unauthenticated('access_removed');
  sendJson(ctx.response, 200, {
    member: memberShape(member),
    workspace: { id: current.workspaceId, name: current.workspaceName },
  });
}

/**
 * Answers the same status and body for every well-formed address, and records and sends nothing
 * for an address that cannot use a reset.
 */
export async function requestPasswordReset(ctx: Ctx): Promise<void> {
  const body = ctx.json();
  const problems = new Problems();
  const address = emailField(problems, body, 'email');
  problems.throwIfAny();

  await transact(async (tx) => {
    const member = await tx.queryOne<MemberRow>(
      'select * from members where lower(email) = lower($1) and removed_at_ms is null',
      [address],
    );
    if (member === null) return;
    const token = newToken();
    const expiresAtMs = ctx.nowMs + config.ttl.resetLinkSeconds * 1000;
    await tx.query(
      `insert into auth_links (id, kind, token_hash, workspace_id, member_id, email, issued_at_ms, expires_at_ms)
       values ($1,'reset',$2,$3,$4,$5,$6,$7)`,
      [newId(), sha256Hex(token), member.workspace_id, member.id, member.email, ctx.nowMs, expiresAtMs],
    );
    await queueMail(tx, {
      kind: 'password_reset',
      email: member.email,
      name: member.name,
      token,
      expiresAtMs,
    });
  });
  sendJson(ctx.response, 202, { status: 'reset_requested' });
}

interface LinkRow {
  id: string;
  kind: string;
  workspace_id: string | null;
  member_id: string | null;
  email: string | null;
  role: Role | null;
  stockist_id: string | null;
  expires_at_ms: number;
  used_at_ms: number | null;
}

async function takeLink(
  tx: Transaction,
  kind: string,
  token: string,
  nowMs: number,
): Promise<LinkRow> {
  const link = await tx.queryOne<LinkRow>(
    'select * from auth_links where token_hash = $1 and kind = $2 for update',
    [sha256Hex(token), kind],
  );
  if (link === null) throw gone('link_expired');
  if (link.used_at_ms !== null) throw gone('link_used');
  if (nowMs >= Number(link.expires_at_ms)) throw gone('link_expired');
  await tx.query('update auth_links set used_at_ms = $2 where id = $1', [link.id, nowMs]);
  return link;
}

export async function completePasswordReset(ctx: Ctx): Promise<void> {
  const body = ctx.json();
  const problems = new Problems();
  const token = text(problems, body, 'token');
  const password = checkPassword(problems, body['password']);
  problems.throwIfAny();

  const result = await transact(async (tx) => {
    const link = await takeLink(tx, 'reset', token, ctx.nowMs);
    if (link.member_id === null) throw gone('link_expired');
    const member = await tx.queryOne<MemberRow>(
      'select * from members where id = $1 and removed_at_ms is null',
      [link.member_id],
    );
    if (member === null) throw gone('link_expired');
    await tx.query('update members set password_hash = $2 where id = $1', [
      member.id,
      hashPassword(password),
    ]);
    await tx.query('delete from sessions where member_id = $1', [member.id]);
    const sessionToken = await createSession(tx, member.id, ctx.nowMs);
    return { member, sessionToken };
  });
  sendJson(ctx.response, 200, { member: memberShape(result.member) }, {
    'set-cookie': sessionCookieHeader(result.sessionToken),
  });
}

export async function acceptInvitation(ctx: Ctx): Promise<void> {
  const body = ctx.json();
  const problems = new Problems();
  const token = text(problems, body, 'token');
  const name = text(problems, body, 'name', { max: 80 });
  const password = checkPassword(problems, body['password']);
  problems.throwIfAny();

  const result = await transact(async (tx) => {
    const link = await takeLink(tx, 'invite', token, ctx.nowMs);
    if (link.email === null || link.workspace_id === null || !isRole(link.role)) {
      throw gone('link_expired');
    }
    const existing = await tx.queryOne<MemberRow>(
      'select * from members where lower(email) = lower($1) and removed_at_ms is null',
      [link.email],
    );
    const memberId = existing?.id ?? newId();
    if (existing === null) {
      await tx.query(
        `insert into members (id, workspace_id, name, email, role, stockist_id, password_hash, created_at_ms)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          memberId,
          link.workspace_id,
          name,
          link.email,
          link.role,
          link.stockist_id,
          hashPassword(password),
          ctx.nowMs,
        ],
      );
    } else {
      await tx.query('update members set name = $2, password_hash = $3 where id = $1', [
        memberId,
        name,
        hashPassword(password),
      ]);
    }
    const member = await tx.queryOne<MemberRow>('select * from members where id = $1', [memberId]);
    if (member === null) throw gone('link_expired');
    const sessionToken = await createSession(tx, memberId, ctx.nowMs);
    return { member, sessionToken };
  });
  sendJson(ctx.response, 201, { member: memberShape(result.member) }, {
    'set-cookie': sessionCookieHeader(result.sessionToken),
  });
}
