import { now } from '../clock.js';
import { db, withTransaction } from '../db.js';
import { errors } from '../errors.js';
import { isoZoned } from '../domain/time.js';
import { BOOKING_STATES } from '../domain/booking-rules.js';
import { flushRows, mailCopy, queueEmail } from '../outbox.js';
import { loadMember, serialiseMember } from '../model.js';
import { publishToMembers } from '../live.js';
import type { Ctx, Reply, Router } from '../http.js';

function requireFounder(ctx: Ctx): void {
  const member = ctx.requireMember();
  if (!member.roles.includes('founder')) throw errors.forbidden();
}

async function queue(ctx: Ctx): Promise<Reply> {
  requireFounder(ctx);
  const { rows } = await db.query<{
    id: string;
    member_id: string;
    file_id: string;
    uploaded_at: Date;
  }>(
    `select id, member_id, file_id, uploaded_at from id_documents
      where state = 'pending' order by uploaded_at, id`,
  );
  const documents = [];
  for (const row of rows) {
    const member = await loadMember(db, row.member_id);
    if (!member) continue;
    documents.push({
      id: row.id,
      member: await serialiseMember(db, member),
      file_id: row.file_id,
      uploaded_at: isoZoned(row.uploaded_at),
    });
  }
  return { status: 200, body: { documents } };
}

async function decide(ctx: Ctx, approve: boolean): Promise<Reply> {
  requireFounder(ctx);
  const reason = approve ? null : readReason(ctx);
  const at = now();
  const result = await withTransaction(async (tx) => {
    const { rows } = await tx.query<{ id: string; member_id: string; state: string }>(
      'select id, member_id, state from id_documents where id = $1 for update',
      [/^[0-9a-f-]{36}$/i.test(ctx.param('id')) ? ctx.param('id') : null],
    );
    const document = rows[0];
    if (!document) throw errors.notFound();
    if (document.state !== 'pending') throw errors.alreadyDecided();
    const idState = approve ? 'verified' : 'rejected';
    await tx.query(
      `update id_documents set state = $2, reason = $3, decided_at = $4 where id = $1`,
      [document.id, approve ? 'approved' : 'rejected', reason, at],
    );
    await tx.query('update members set id_state = $2 where id = $1', [
      document.member_id,
      idState,
    ]);
    const member = await loadMember(tx, document.member_id);
    const copy = mailCopy.idReview(approve, reason);
    const emailId = await queueEmail(tx, {
      kind: 'id_review',
      to: member?.email ?? '',
      subject: copy.subject,
      body: copy.body,
      memberId: document.member_id,
    });
    return { memberId: document.member_id, idState, emailId };
  });

  await flushRows([result.emailId]);
  publishToMembers([result.memberId], 'id_review', { id_state: result.idState, reason });
  return { status: 200, body: { id_state: result.idState } };
}

function readReason(ctx: Ctx): string {
  const body = ctx.json();
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 1 || reason.length > 200) {
    throw errors.validationFailed({ reason: 'Write why a new upload is needed.' });
  }
  return reason;
}

async function outbox(ctx: Ctx): Promise<Reply> {
  requireFounder(ctx);
  const { rows } = await db.query<{
    id: string;
    kind: string;
    to_email: string;
    subject: string;
    status: string;
    attempts: number;
    last_attempt_at: Date | null;
  }>(
    `select id, kind, to_email, subject, status, attempts, last_attempt_at
       from outbox order by seq desc`,
  );
  return {
    status: 200,
    body: {
      items: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        to: row.to_email,
        subject: row.subject,
        status: row.status,
        attempts: row.attempts,
        last_attempt_at: row.last_attempt_at ? isoZoned(row.last_attempt_at) : null,
      })),
    },
  };
}

async function bookingsByState(ctx: Ctx): Promise<Reply> {
  requireFounder(ctx);
  const { rows } = await db.query<{ state: string; count: number }>(
    'select state, count(*)::int as count from bookings group by state',
  );
  const counts: Record<string, number> = {};
  for (const state of BOOKING_STATES) counts[state] = 0;
  for (const row of rows) counts[row.state] = Number(row.count);
  return { status: 200, body: { counts } };
}

export function registerFounderRoutes(router: Router): void {
  router.add({
    method: 'GET',
    pattern: '/api/founder/id-reviews',
    kind: 'plain',
    auth: 'member',
    handler: queue,
  });
  router.add({
    method: 'POST',
    pattern: '/api/founder/id-reviews/:id/approve',
    kind: 'plain',
    auth: 'member',
    handler: (ctx) => decide(ctx, true),
  });
  router.add({
    method: 'POST',
    pattern: '/api/founder/id-reviews/:id/reject',
    kind: 'json',
    auth: 'member',
    handler: (ctx) => decide(ctx, false),
  });
  router.add({
    method: 'GET',
    pattern: '/api/founder/outbox',
    kind: 'plain',
    auth: 'member',
    handler: outbox,
  });
  router.add({
    method: 'GET',
    pattern: '/api/founder/bookings-by-state',
    kind: 'plain',
    auth: 'member',
    handler: bookingsByState,
  });
}
