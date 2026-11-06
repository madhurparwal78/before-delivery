import {
  isRole,
  requireRole,
  requireSession,
  requireVisibleMember,
  type Role,
} from '../auth.ts';
import { config } from '../config.ts';
import { query, queryOne, transact } from '../db/pool.ts';
import { queueMail } from '../db/outbox.ts';
import { FIELD_COPY } from '../../domain/copy.ts';
import type { Ctx } from '../http/context.ts';
import { conflict, notFound } from '../http/errors.ts';
import { sendEmpty, sendJson } from '../http/respond.ts';
import { email as emailField, Problems, readString } from '../http/validate.ts';
import { newId, newToken, sha256Hex } from '../services/crypto.ts';
import { memberShape } from './auth.ts';

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

export async function listMembers(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const rows =
    session.role === 'stockist_buyer'
      ? await query<MemberRow>('select * from members where id = $1', [session.memberId])
      : await query<MemberRow>(
          `select * from members
            where workspace_id = $1 and removed_at_ms is null
            order by created_at_ms`,
          [session.workspaceId],
        );
  sendJson(ctx.response, 200, { items: rows.map(memberShape) });
}

async function loadMember(workspaceId: string, memberId: string): Promise<MemberRow> {
  const row = await queryOne<MemberRow>(
    'select * from members where id = $1 and workspace_id = $2 and removed_at_ms is null',
    [memberId, workspaceId],
  );
  if (row === null) throw notFound();
  return row;
}

export async function getMember(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const memberId = ctx.params['memberId'] as string;
  requireVisibleMember(session, memberId);
  const row = await loadMember(session.workspaceId, memberId);
  sendJson(ctx.response, 200, memberShape(row));
}

export async function inviteMember(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  requireRole(session, 'launch_producer');
  const body = ctx.json();
  const problems = new Problems();
  const address = emailField(problems, body, 'email');
  const role = readString(body, 'role');
  if (!isRole(role)) problems.add('role', FIELD_COPY.required);
  const stockistId = readString(body, 'stockistId');
  if (role === 'stockist_buyer') {
    if (stockistId === null || stockistId === '') problems.add('stockistId', FIELD_COPY.unknownStockist);
  } else if (stockistId !== null && stockistId !== '') {
    problems.add('stockistId', FIELD_COPY.unknownStockist);
  }
  problems.throwIfAny();
  const checkedRole = role as Role;

  if (checkedRole === 'stockist_buyer' && stockistId !== null) {
    const stockist = await queryOne(
      "select 1 from stockists where id = $1 and workspace_id = $2 and status = 'active'",
      [stockistId, session.workspaceId],
    );
    if (stockist === null) {
      problems.add('stockistId', FIELD_COPY.unknownStockist);
      problems.throwIfAny();
    }
  }

  await transact(async (tx) => {
    const existing = await tx.queryOne<MemberRow>(
      'select * from members where lower(email) = lower($1) and removed_at_ms is null',
      [address],
    );
    // An invitation for an address that cannot use it records nothing and sends nothing.
    if (existing !== null) return;
    const token = newToken();
    const expiresAtMs = ctx.nowMs + config.ttl.inviteLinkSeconds * 1000;
    await tx.query(
      `insert into auth_links (id, kind, token_hash, workspace_id, email, role, stockist_id, issued_at_ms, expires_at_ms)
       values ($1,'invite',$2,$3,$4,$5,$6,$7,$8)`,
      [
        newId(),
        sha256Hex(token),
        session.workspaceId,
        address,
        checkedRole,
        checkedRole === 'stockist_buyer' ? stockistId : null,
        ctx.nowMs,
        expiresAtMs,
      ],
    );
    await queueMail(tx, {
      kind: 'invitation',
      email: address,
      workspaceName: session.workspaceName,
      token,
      expiresAtMs,
    });
  });
  sendJson(ctx.response, 202, { status: 'invitation_sent' });
}

async function wouldLeaveNoProducer(
  workspaceId: string,
  memberId: string,
): Promise<boolean> {
  const row = await queryOne<{ count: number }>(
    `select count(*)::int as count from members
      where workspace_id = $1 and role = 'launch_producer' and removed_at_ms is null and id <> $2`,
    [workspaceId, memberId],
  );
  return (row?.count ?? 0) === 0;
}

export async function changeMemberRole(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const memberId = ctx.params['memberId'] as string;
  requireVisibleMember(session, memberId);
  const member = await loadMember(session.workspaceId, memberId);
  requireRole(session, 'launch_producer');

  const body = ctx.json();
  const problems = new Problems();
  const role = readString(body, 'role');
  if (!isRole(role)) problems.add('role', FIELD_COPY.required);
  const stockistId = readString(body, 'stockistId');
  problems.throwIfAny();
  const nextRole = role as Role;

  if (
    member.role === 'launch_producer' &&
    nextRole !== 'launch_producer' &&
    (await wouldLeaveNoProducer(session.workspaceId, memberId))
  ) {
    throw conflict('last_producer');
  }
  if (nextRole === 'stockist_buyer') {
    const chosen = stockistId ?? member.stockist_id;
    if (chosen === null) {
      problems.add('stockistId', FIELD_COPY.unknownStockist);
      problems.throwIfAny();
    }
    const stockist = await queryOne(
      "select 1 from stockists where id = $1 and workspace_id = $2 and status = 'active'",
      [chosen, session.workspaceId],
    );
    if (stockist === null) {
      problems.add('stockistId', FIELD_COPY.unknownStockist);
      problems.throwIfAny();
    }
    await query('update members set role = $2, stockist_id = $3 where id = $1', [
      memberId,
      nextRole,
      chosen,
    ]);
  } else {
    await query('update members set role = $2, stockist_id = null where id = $1', [memberId, nextRole]);
  }
  const updated = await loadMember(session.workspaceId, memberId);
  sendJson(ctx.response, 200, memberShape(updated));
}

export async function removeMember(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const memberId = ctx.params['memberId'] as string;
  requireVisibleMember(session, memberId);
  const member = await loadMember(session.workspaceId, memberId);
  requireRole(session, 'launch_producer');

  if (
    member.role === 'launch_producer' &&
    (await wouldLeaveNoProducer(session.workspaceId, memberId))
  ) {
    throw conflict('last_producer');
  }
  await transact(async (tx) => {
    await tx.query('update members set removed_at_ms = $2 where id = $1', [memberId, ctx.nowMs]);
    await tx.query('delete from sessions where member_id = $1', [memberId]);
  });
  sendEmpty(ctx.response, 204);
}
