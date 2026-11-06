import { query } from '../db.js';
import { errors } from './errors.js';
import { jsonOk, parseJsonBody, requireJsonContentType, type Ctx } from './http.js';
import { resolveWorkspace } from './auth.js';
import { formatInstant, isStr, invalid } from './helpers.js';
import type { CaseRecord } from './helpers.js';
type ReviewCase = CaseRecord;
type ClaimRow = { case_id: string; workspace_slug: string; member_id: string; member_name: string; claimed_at: Date; ends_at: Date };
import { config } from '../config.js';
import { serialiseCase } from '../domain/case-body.js';
import { caseExtras } from './case-extras.js';

export async function listReview(ctx: Ctx): Promise<Response> {
  const ws = await resolveWorkspace(ctx);
  const now = new Date();
  const rows = await query<{ id: string; reference: string; counterparty_id: string; counterparty_name: string; fiat_value_cents: string; currency: string; created_at: Date; member_id: string | null; member_name: string | null; claimed_at: Date | null; ends_at: Date | null }>(
    `SELECT c.id, c.reference, c.counterparty_id, cp.legal_name AS counterparty_name, c.fiat_value_cents, c.currency, c.created_at,
            rc.member_id, rc.member_name, rc.claimed_at, rc.ends_at
     FROM cases c JOIN counterparties cp ON cp.id = c.counterparty_id
     LEFT JOIN review_claims rc ON rc.case_id = c.id AND rc.ends_at > $2
     WHERE c.workspace_slug = $1 AND c.status = 'in_review' AND c.archived = false
     ORDER BY c.created_at`,
    [ws.slug, now],
  );
  return jsonOk({
    cases: rows.rows.map((r) => ({
      id: r.id,
      reference: r.reference,
      counterparty: { id: r.counterparty_id, name: r.counterparty_name },
      fiatValueCents: Number(r.fiat_value_cents),
      currency: r.currency,
      createdAt: formatInstant(r.created_at),
      claim: r.member_id === null || r.claimed_at === null || r.ends_at === null ? null : {
        memberId: r.member_id, memberName: r.member_name ?? '', claimedAt: formatInstant(r.claimed_at),
        endsAt: formatInstant(r.ends_at), remainingSeconds: Math.max(0, Math.floor((r.ends_at.getTime() - now.getTime()) / 1000)),
      },
    })),
    now: formatInstant(now),
  });
}

export async function claimCase(ctx: Ctx): Promise<Response> {
  const ws = await resolveWorkspace(ctx);
  requireJsonContentType(ctx, ['application/json']);
  await readEmptyBody(ctx).catch(() => {});
  const caseId = ctx.params.id;
  const row = await query<ReviewCase>(`SELECT c.*, cp.legal_name AS counterparty_current_name FROM cases c LEFT JOIN counterparties cp ON cp.id = c.counterparty_id WHERE c.id = $1 AND c.workspace_slug = $2`, [caseId, ws.slug]);
  if (row.rows.length === 0) throw errors.notFound();
  const c = row.rows[0];
  if (c.status !== 'in_review') throw errors.conflict('already_decided', `Already decided by ${c.decided_counterparty_name ?? 'a colleague'} at ${formatInstant(c.closed_at ?? c.created_at)}.`);
  const now = new Date();
  const existing = await query<ClaimRow>('SELECT * FROM review_claims WHERE case_id = $1', [caseId]);
  if (existing.rows.length > 0) {
    const claim = existing.rows[0];
    if (claim.ends_at.getTime() > now.getTime()) {
      if (claim.member_id === ctx.session!.memberId) {
        return jsonOk({ claim: { memberId: claim.member_id, memberName: claim.member_name, claimedAt: formatInstant(claim.claimed_at), endsAt: formatInstant(claim.ends_at), remainingSeconds: Math.max(0, Math.floor((claim.ends_at.getTime() - now.getTime()) / 1000)) } });
      }
      throw errors.conflict('already_claimed', `Claimed by ${claim.member_name} at ${formatInstant(claim.claimed_at)}.`);
    }
    await query('DELETE FROM review_claims WHERE case_id = $1 AND ends_at <= $2', [caseId, now]);
  }
  const endsAt = new Date(now.getTime() + config.reviewClaimSeconds * 1000);
  const inserted = await query<ClaimRow>('INSERT INTO review_claims (case_id, workspace_slug, member_id, member_name, claimed_at, ends_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (case_id) DO NOTHING RETURNING *',
    [caseId, ws.slug, ctx.session!.memberId, ctx.session!.name, now, endsAt]);
  if (inserted.rows.length === 0) {
    const claim = (await query<ClaimRow>('SELECT * FROM review_claims WHERE case_id = $1', [caseId])).rows[0];
    throw errors.conflict('already_claimed', `Claimed by ${claim.member_name} at ${formatInstant(claim.claimed_at)}.`);
  }
  const claim = inserted.rows[0];
  return jsonOk({ claim: { memberId: claim.member_id, memberName: claim.member_name, claimedAt: formatInstant(claim.claimed_at), endsAt: formatInstant(claim.ends_at), remainingSeconds: Math.max(0, Math.floor((claim.ends_at.getTime() - now.getTime()) / 1000)) } });
}

export async function decideCase(ctx: Ctx): Promise<Response> {
  const ws = await resolveWorkspace(ctx);
  requireJsonContentType(ctx, ['application/json']);
  const body = parseJsonBody(await ctx.rawBody());
  const fields: Record<string, string> = {};
  const decision = isStr(body.decision) ? body.decision : '';
  const reason = isStr(body.reason) ? body.reason : '';
  if (!['accept', 'reject'].includes(decision)) fields.decision = 'Choose Accept or Reject.';
  if (cp(reason) < 1 || cp(reason) > 1000) fields.reason = 'Enter a reason.';
  if (Object.keys(fields).length > 0) invalid(fields);

  const caseId = ctx.params.id;
  const row = await query<ReviewCase>(`SELECT c.*, cp.legal_name AS counterparty_current_name FROM cases c LEFT JOIN counterparties cp ON cp.id = c.counterparty_id WHERE c.id = $1 AND c.workspace_slug = $2`, [caseId, ws.slug]);
  if (row.rows.length === 0) throw errors.notFound();
  const c = row.rows[0];
  if (c.status !== 'in_review') throw errors.conflict('already_decided', `Already decided by ${c.decided_counterparty_name ?? 'a colleague'} at ${formatInstant(c.closed_at ?? c.created_at)}.`);
  const claim = (await query<ClaimRow>('SELECT * FROM review_claims WHERE case_id = $1', [caseId])).rows[0];
  if (claim === undefined || claim.member_id !== ctx.session!.memberId || claim.ends_at.getTime() <= Date.now()) {
    throw errors.conflict('claim_not_held', 'Claim this case before deciding.');
  }
  const now = new Date();
  await query('DELETE FROM review_claims WHERE case_id = $1', [caseId]);

  if (decision === 'reject') {
    await query('UPDATE cases SET status = $1, outcome = $2, closed_at = $3, erasure_status = $4, erasure_due_at = $5, review_decision = $6, review_reason = $7, review_decided_by = $8, review_decided_at = $9 WHERE id = $10',
      ['returned', 'returned', now, 'scheduled', new Date(now.getTime() + config.retentionSeconds * 1000), 'reject', reason, ctx.session!.name, now, caseId]);
  } else {
    // Accept continues along the counterparty path with the rules recorded at creation.
    let status = 'cleared';
    let dataSentChannel: string | null = null;
    const thresholdCents = c.decided_threshold_cents === null ? null : Number(c.decided_threshold_cents);
    if (c.decided_counterparty_rule === 'in_force' && thresholdCents !== null && Number(c.fiat_value_cents) >= thresholdCents) {
      status = 'awaiting_answer';
      dataSentChannel = c.counterparty_network === 'on_network' ? 'network' : 'request_page';
    } else if (c.decided_counterparty_rule === 'no_rule') {
      status = 'cleared';
      dataSentChannel = c.counterparty_network === 'on_network' ? 'network' : 'request_page';
    }
    const dataSentAt = dataSentChannel !== null ? now : null;
    const answerDueAt = status === 'awaiting_answer' ? new Date(now.getTime() + config.answerWindowSeconds * 1000) : null;
    await query(`UPDATE cases SET status = $1, data_sent_channel = $2, data_sent_at = $3, answer_due_at = $4, decided_review_accepted_at = $5, review_decision = $6, review_reason = $7, review_decided_by = $8, review_decided_at = $9 WHERE id = $10`,
      [status, dataSentChannel, dataSentAt, answerDueAt, now, 'accept', reason, ctx.session!.name, now, caseId]);
    if (dataSentChannel === 'network') {
      await query('INSERT INTO metered_messages (id, workspace_slug, at, direction) VALUES ($1,$2,$3,$4)', [`m-${caseId}-${now.getTime()}`, ws.slug, now, 'sent']);
    }
    if (dataSentChannel === 'request_page') {
      const cp = await query<{ contact_email: string }>('SELECT contact_email FROM counterparties WHERE id = $1', [c.counterparty_id]);
      const { sendRequestPage } = await import('./request-pages.js');
      await sendRequestPage(ws, caseId, c, cp.rows[0].contact_email, now);
    }
  }
  const updated = await query<ReviewCase>(`SELECT c.*, cp.legal_name AS counterparty_current_name FROM cases c LEFT JOIN counterparties cp ON cp.id = c.counterparty_id WHERE c.id = $1`, [caseId]);
  const decideExtras = await caseExtras(updated.rows[0]);
  return jsonOk({ case: serialiseCase(updated.rows[0], { role: ctx.session!.role, digests: decideExtras.digests, requestPage: decideExtras.requestPage, review: decideExtras.review }) });
}

async function readEmptyBody(ctx: Ctx): Promise<void> {
  await ctx.rawBody();
}

function cp(value: string): number {
  let n = 0;
  for (const _ of value) n++;
  return n;
}
