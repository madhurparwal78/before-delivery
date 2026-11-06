import { query } from '../db.js';
import { errors } from './errors.js';
import { jsonOk, parseJsonBody, requireJsonContentType, type Ctx } from './http.js';
import { resolveWorkspace, type Workspace } from './auth.js';
import { serialiseCase } from '../domain/case-body.js';
import { formatInstant, isStr, invalid } from './helpers.js';
import type { CaseRecord } from './helpers.js';
import { config } from '../config.js';
import { sendMail } from '../services/smtp.js';
import { caseExtras } from './case-extras.js';
import { newToken } from '../domain/crypto.js';
import { formatDateTime, maskAddress } from '../../shared/util.js';

async function readEmptyBody(ctx: Ctx): Promise<void> {
  await ctx.rawBody();
}

async function loadCase(ctx: Ctx, wsSlug: string): Promise<CaseRecord> {
  const r = await query<CaseRecord>(`SELECT c.*, cp.legal_name AS counterparty_current_name FROM cases c LEFT JOIN counterparties cp ON cp.id = c.counterparty_id WHERE c.id = $1 AND c.workspace_slug = $2`, [ctx.params.id, wsSlug]);
  if (r.rows.length === 0) throw errors.notFound();
  return r.rows[0];
}

async function viewCaseFull(ctx: Ctx, row: CaseRecord): Promise<Record<string, unknown>> {
  const extras = await caseExtras(row);
  return serialiseCase(row, { role: ctx.session?.role ?? 'compliance_officer', digests: extras.digests, requestPage: extras.requestPage, review: extras.review });
}

const RELEASABLE = ['accepted', 'cleared'];

export async function releaseCase(ctx: Ctx): Promise<Response> {
  const ws = await resolveWorkspace(ctx);
  requireJsonContentType(ctx, ['application/json']);
  const body = await parseJsonBody(await ctx.rawBody());
  void body;
  const row = await loadCase(ctx, ws.slug);
  const status = row.status;
  if (row.outcome !== null) throw errors.conflict('case_closed', 'This case is already closed.');
  const allowed = RELEASABLE.includes(status) || (status === 'no_response' && row.release_reason !== null);
  if (!allowed) throw errors.conflict('release_not_allowed', "This withdrawal can't be released yet.");
  const now = new Date();
  await query('UPDATE cases SET status = $1, outcome = $2, closed_at = $3, erasure_status = $4, erasure_due_at = $5 WHERE id = $6',
    ['released', 'released', now, 'scheduled', new Date(now.getTime() + config.retentionSeconds * 1000), row.id]);
  const updated = await loadCase(ctx, ws.slug);
  return jsonOk({ case: await viewCaseFull(ctx, updated) });
}

export async function returnCase(ctx: Ctx): Promise<Response> {
  const ws = await resolveWorkspace(ctx);
  requireJsonContentType(ctx, ['application/json']);
  const body = parseJsonBody(await ctx.rawBody());
  const reason = isStr(body.reason) ? body.reason : '';
  if (cpLength(reason) < 1 || cpLength(reason) > 1000) invalid({ reason: 'Enter a reason of at most 1,000 characters.' });
  const row = await loadCase(ctx, ws.slug);
  if (row.outcome !== null) throw errors.conflict('case_closed', 'This case is already closed.');
  const now = new Date();
  await query('UPDATE cases SET status = $1, outcome = $2, closed_at = $3, erasure_status = $4, erasure_due_at = $5 WHERE id = $6',
    ['returned', 'returned', now, 'scheduled', new Date(now.getTime() + config.retentionSeconds * 1000), row.id]);
  const updated = await loadCase(ctx, ws.slug);
  return jsonOk({ case: await viewCaseFull(ctx, updated) });
}

export async function recordReleaseReason(ctx: Ctx): Promise<Response> {
  const ws = await resolveWorkspace(ctx);
  requireJsonContentType(ctx, ['application/json']);
  const body = parseJsonBody(await ctx.rawBody());
  const reason = isStr(body.reason) ? body.reason : '';
  if (cpLength(reason) < 1 || cpLength(reason) > 1000) invalid({ reason: 'Enter a reason of at most 1,000 characters.' });
  const row = await loadCase(ctx, ws.slug);
  if (row.status !== 'no_response') throw errors.conflict('reason_not_needed', 'A reason is needed only after No response.');
  const now = new Date();
  await query('UPDATE cases SET release_reason = $1, release_reason_by = $2, release_reason_at = $3 WHERE id = $4', [reason, ctx.session!.name, now, row.id]);
  const updated = await loadCase(ctx, ws.slug);
  return jsonOk({ case: await viewCaseFull(ctx, updated) });
}

export async function recordOwnership(ctx: Ctx): Promise<Response> {
  const ws = await resolveWorkspace(ctx);
  requireJsonContentType(ctx, ['application/json']);
  const body = parseJsonBody(await ctx.rawBody());
  const confirmedOn = isStr(body.confirmedOn) ? body.confirmedOn : '';
  const row = await loadCase(ctx, ws.slug);
  if (row.status !== 'awaiting_ownership') throw errors.conflict('ownership_not_pending', 'Ownership is not pending on this case.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(confirmedOn)) invalid({ confirmedOn: 'Enter the business date of the confirmation.' });
  const { businessDateInZone } = await import('../domain/time.js');
  const today = businessDateInZone(new Date(), ws.time_zone);
  const caseDate = businessDateInZone(new Date(row.created_at as Date), ws.time_zone);
  if (confirmedOn > today || confirmedOn < caseDate) invalid({ confirmedOn: 'Choose a business date between the case date and today.' });
  const now = new Date();
  await query('UPDATE cases SET status = $1, ownership_confirmed_on = $2, ownership_recorded_at = $3, ownership_recorded_by = $4 WHERE id = $5',
    ['cleared', confirmedOn, now, ctx.session!.name, row.id]);
  const updated = await loadCase(ctx, ws.slug);
  return jsonOk({ case: await viewCaseFull(ctx, updated) });
}

export async function newRequestPage(ctx: Ctx): Promise<Response> {
  const ws = await resolveWorkspace(ctx);
  requireJsonContentType(ctx, ['application/json']);
  await readEmptyBody(ctx);
  const row = await loadCase(ctx, ws.slug);
  const openStates = ['awaiting_answer', 'no_response'];
  const sunriseStillCleared = row.path === 'sunrise' && row.status === 'cleared';
  if (row.outcome !== null || row.data_sent_channel !== 'request_page' || !(openStates.includes(row.status) || sunriseStillCleared) || row.answer_decision !== null) {
    throw errors.conflict('request_page_not_open', 'This case has no open data request.');
  }
  const counterparty = await query<{ legal_name: string; contact_email: string | null }>('SELECT legal_name, contact_email FROM counterparties WHERE id = $1', [row.counterparty_id]);
  if (counterparty.rows.length === 0 || counterparty.rows[0].contact_email === null) {
    throw errors.conflict('request_page_not_open', 'This case has no open data request.');
  }
  const sentAt = new Date();
  await issuePage(row, ws, counterparty.rows[0].contact_email, sentAt);
  const updated = await loadCase(ctx, ws.slug);
  return jsonOk({ case: await viewCaseFull(ctx, updated) }, 201);
}

export async function endRequestPage(ctx: Ctx): Promise<Response> {
  const ws = await resolveWorkspace(ctx);
  const row = await loadCase(ctx, ws.slug);
  const page = await query<{ id: string }>(`SELECT id FROM request_pages WHERE case_id = $1 AND workspace_slug = $2 AND status = 'live'`, [row.id, ws.slug]);
  if (page.rows.length === 0) throw errors.conflict('request_page_not_open', 'This case has no open data request.');
  await query('UPDATE request_pages SET status = $1, ends_at = $2 WHERE id = $3', ['ended', new Date(), page.rows[0].id]);
  const updated = await loadCase(ctx, ws.slug);
  return jsonOk({ case: await viewCaseFull(ctx, updated) });
}

async function issuePage(row: CaseRecord, ws: Workspace, contactEmail: string, sentAt: Date): Promise<void> {
  await query('UPDATE request_pages SET status = $1, ends_at = $2 WHERE case_id = $3 AND status = $4', ['ended', sentAt, row.id, 'live']);
  const token = newToken(24);
  const pageId = `rp-${newToken(8).toLowerCase()}`;
  const endsAt = new Date(sentAt.getTime() + config.dataRequestPageSeconds * 1000);
  await query(`INSERT INTO request_pages (id, case_id, workspace_slug, token, status, sent_at, ends_at, contact_email) VALUES ($1,$2,$3,$4,'live',$5,$6,$7)`,
    [pageId, row.id, ws.slug, token, sentAt, endsAt, contactEmail]);
  const { formatAmount } = await import('../../shared/util.js');
  const { amountString } = await import('../domain/case-body.js');
  await sendMail({
    to: contactEmail,
    subject: `Travel Rule data request ${row.reference} from ${ws.name}`,
    textBody: [
      `${config.publicUrl}/r/${token}`,
      '',
      `Case reference: ${row.reference}`,
      `Asset and amount: ${formatAmount(row.asset as string, amountString(row.amount_digits as string, row.amount_scale as number))}`,
      `From address: ${maskAddress(row.sending_address as string)}`,
      `To address: ${maskAddress(row.destination_address as string)}`,
      `Requesting exchange: ${ws.legal_name}`,
      `This page ends at ${formatDateTime(endsAt, ws.time_zone as string, ws.city as string)}.`,
    ].join('\n'),
  });
}

export async function archiveCase(ctx: Ctx): Promise<Response> {
  const ws = await resolveWorkspace(ctx);
  requireJsonContentType(ctx, ['application/json']);
  await readEmptyBody(ctx);
  const row = await loadCase(ctx, ws.slug);
  if (row.outcome === null) throw errors.conflict('case_not_closed', 'Only a closed case can be archived.');
  const now = new Date();
  await query('UPDATE cases SET archived = true, archived_at = $1 WHERE id = $2', [now, row.id]);
  return jsonOk({ case: { id: row.id, reference: row.reference, archived: true, archivedAt: formatInstant(now), closedAt: row.closed_at !== null ? formatInstant(row.closed_at) : null } });
}

export async function restoreCase(ctx: Ctx): Promise<Response> {
  const ws = await resolveWorkspace(ctx);
  requireJsonContentType(ctx, ['application/json']);
  await readEmptyBody(ctx);
  const row = await loadCase(ctx, ws.slug);
  if (row.archived !== true) throw errors.conflict('case_not_archived', 'Only an archived case can be brought back.');
  await query('UPDATE cases SET archived = false, archived_at = NULL WHERE id = $1', [row.id]);
  const updated = await loadCase(ctx, ws.slug);
  return jsonOk({ case: await viewCaseFull(ctx, updated) });
}

function cpLength(value: string): number {
  let n = 0;
  for (const _ of value) n++;
  return n;
}
