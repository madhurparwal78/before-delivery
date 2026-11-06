import { query } from '../db.js';
import { errors } from './errors.js';
import { jsonOk, type Ctx } from './http.js';
import { type Workspace } from './auth.js';
import { config } from '../config.js';
import { newToken } from '../domain/crypto.js';
import { sendMail } from '../services/smtp.js';
import { formatDateTime, maskAddress, formatAmount } from '../../shared/util.js';
import { amountString } from '../domain/case-body.js';
import type { CaseRecord } from './helpers.js';

export async function getPage(ctx: Ctx): Promise<Response> {
  const r = await query<{ status: string; ends_at: Date; reference: string; asset: string; amount_digits: string; amount_scale: number; destination_address: string; legal_name: string; sending_address: string; city: string; time_zone: string; sent_at: Date }>('SELECT p.status, p.ends_at, p.sent_at, c.reference, c.asset, c.amount_digits, c.amount_scale, c.destination_address, w.legal_name, w.sending_address, w.city, w.time_zone FROM request_pages p JOIN cases c ON c.id = p.case_id JOIN workspaces w ON w.slug = p.workspace_slug WHERE p.token = $1', [ctx.params.token]);
  if (r.rows.length === 0) throw errors.notFound();
  const p = r.rows[0];
  const now = new Date();
  const live = p.status === 'live' && p.ends_at.getTime() > now.getTime();
  if (!live) throw errors.requestPageEnded();
  return jsonOk({
    page: {
      caseReference: p.reference,
      asset: p.asset,
      amount: amountString(p.amount_digits, p.amount_scale),
      fromAddressMasked: maskAddress(p.sending_address),
      toAddressMasked: maskAddress(p.destination_address),
      requestingExchange: p.legal_name,
      status: p.status === 'answered' ? 'answered' : 'live',
      endsAt: instant(p.ends_at),
      remainingSeconds: Math.max(0, Math.floor((p.ends_at.getTime() - now.getTime()) / 1000)),
      now: instant(now),
    },
  });
}

function instant(d: Date): string {
  return `${d.toISOString().slice(0, 19)}Z`;
}

export async function sendRequestPage(ws: Workspace, caseId: string, caseRow: CaseRecord, contactEmail: string, sentAt: Date): Promise<void> {
  await query('UPDATE request_pages SET status = $1, ends_at = $2 WHERE case_id = $3 AND status = $4', ['ended', sentAt, caseId, 'live']);
  const token = newToken(24);
  const pageId = `rp-${newToken(8).toLowerCase()}`;
  const endsAt = new Date(sentAt.getTime() + config.dataRequestPageSeconds * 1000);
  await query(`INSERT INTO request_pages (id, case_id, workspace_slug, token, status, sent_at, ends_at, contact_email) VALUES ($1,$2,$3,$4,'live',$5,$6,$7)`,
    [pageId, caseId, ws.slug, token, sentAt, endsAt, contactEmail]);
  const reference = caseRow.reference as string;
  const asset = caseRow.asset as string;
  const amount = amountString(caseRow.amount_digits as string, caseRow.amount_scale as number);
  await sendMail({
    to: contactEmail,
    subject: `Travel Rule data request ${reference} from ${ws.name}`,
    textBody: [
      `${config.publicUrl}/r/${token}`,
      '',
      `Case reference: ${reference}`,
      `Asset and amount: ${formatAmount(asset, amount)}`,
      `From address: ${maskAddress(ws.sending_address as string)}`,
      `To address: ${maskAddress(caseRow.destination_address as string)}`,
      `Requesting exchange: ${ws.legal_name}`,
      `This page ends at ${formatDateTime(endsAt, ws.time_zone as string, ws.city as string)}.`,
    ].join('\n'),
  });
}
