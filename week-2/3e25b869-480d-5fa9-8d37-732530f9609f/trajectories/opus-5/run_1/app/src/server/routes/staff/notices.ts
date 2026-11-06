import { FIELD_MESSAGES, STUDIO } from '../../../shared/copy.js';
import type { NoticeStatus } from '../../../shared/types.js';
import { parseBody } from '../../http/body.js';
import type { ApiResponse, RequestContext } from '../../http/context.js';
import { errors } from '../../http/errors.js';
import { findNotice, listNotices, resendNotice } from '../../services/outbox.js';
import { requireRole } from '../sessions.js';

const FINANCE = ['maker', 'finance'] as const;

const STATUSES: readonly NoticeStatus[] = ['queued', 'retrying', 'sent', 'failed'];

export async function getNotices(ctx: RequestContext): Promise<ApiResponse> {
  requireRole(ctx, FINANCE);
  const raw = ctx.query.get('status');
  if (raw !== null && raw !== '' && !STATUSES.includes(raw as NoticeStatus)) {
    throw errors.invalid({ status: FIELD_MESSAGES.status });
  }
  const status = raw === null || raw === '' ? null : (raw as NoticeStatus);
  return { status: 200, body: { notices: await listNotices(status) } };
}

export async function postResendNotice(ctx: RequestContext): Promise<ApiResponse> {
  const number = ctx.params['number'] ?? '';
  const existing = await findNotice(number);
  if (!existing) throw errors.notFound();
  requireRole(ctx, FINANCE);
  const parsed = parseBody(ctx.body, {});
  if (!parsed.ok) throw errors.invalid(parsed.fields);
  const notice = await resendNotice(number);
  if (!notice) throw errors.conflict('notice_not_failed', STUDIO.noticeNotFailed(number));
  return { status: 200, body: { notice } };
}
