import { randomInt } from 'node:crypto';
import { pool, one, rows, tx, isUniqueViolation } from '../db.js';
import { now } from '../clock.js';
import { conflict, notFound, validation } from '../errors.js';
import { ok, created, route, type Ctx, type Reply } from '../http.js';
import { optionalUser, requireAdmin, requireUser } from '../guards.js';
import { reportView } from '../views.js';
import { revokeSessions, findUserByUsername } from '../accounts.js';
import { emitAccount } from '../events.js';
import { mails, sendMail } from '../mail.js';
import { config } from '../config.js';
import { COPY, asRecord, asString, failIfAny, isValidEmail, isWithin, normaliseEmail, parseId, type Fields } from '../validate.js';

const CATEGORIES = ['hate', 'terrorism', 'csam', 'ip', 'privacy', 'other'];
const REFERENCE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const newReference = (): string =>
  `MH-${Array.from({ length: 8 }, () => REFERENCE_CHARS[randomInt(REFERENCE_CHARS.length)]).join('')}`;

async function fileReport(ctx: Ctx): Promise<Reply> {
  const user = optionalUser(ctx);
  const input = asRecord(ctx.body);
  const targetType = input.targetType;
  if (targetType !== 'post' && targetType !== 'comment') throw validation({ targetType: 'Reports are about a post or a comment' });
  const targetId = parseId(String(input.targetId ?? ''));
  const target = targetId === null ? null : await one(pool,
    targetType === 'post' ? 'SELECT 1 FROM posts WHERE id = $1' : 'SELECT 1 FROM comments WHERE id = $1', [targetId]);
  if (!target) throw notFound('Nothing to report');
  const fields: Fields = {};
  const category = asString(input.category);
  const explanation = asString(input.explanation)?.trim() ?? '';
  const reporterEmail = user ? user.email : normaliseEmail(asString(input.reporterEmail) ?? '');
  if (!category || !CATEGORIES.includes(category)) fields.category = COPY.reportType;
  if (!isWithin(explanation, 1, 2000)) fields.explanation = COPY.reportExplanation;
  if (!isValidEmail(reporterEmail)) fields.reporterEmail = COPY.email;
  if (input.goodFaith !== true) fields.goodFaith = COPY.reportConfirm;
  failIfAny(fields);
  for (;;) {
    const reference = newReference();
    try {
      const filed = await one<{ created_at: Date }>(pool,
        `INSERT INTO reports (reference, target_type, target_id, category, explanation, reporter_email, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING created_at`,
        [reference, targetType, targetId, category, explanation, reporterEmail, now()]);
      await sendMail(mails.reportConfirmation(reporterEmail, reference));
      const deadline = new Date((filed as { created_at: Date }).created_at.getTime() + config.limits.reportDeadlineSeconds * 1000);
      return created({ reference, deadlineAt: deadline.toISOString() });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
}

const REPORT_SELECT = `
  SELECT r.reference, r.target_type, r.target_id, r.category, r.explanation, r.created_at, r.status,
    c.name AS community_name, p.id AS post_id
  FROM reports r
  LEFT JOIN comments cm ON r.target_type = 'comment' AND cm.id = r.target_id
  JOIN posts p ON p.id = CASE WHEN r.target_type = 'post' THEN r.target_id ELSE cm.post_id END
  JOIN communities c ON c.id = p.community_id`;

async function queue(ctx: Ctx): Promise<Reply> {
  requireAdmin(requireUser(ctx));
  const status = ctx.query.get('status') ?? 'open';
  if (status !== 'open' && status !== 'all') throw validation({ status: 'Choose open or all' });
  const found = await rows<Parameters<typeof reportView>[0]>(pool,
    `${REPORT_SELECT} WHERE ($1 = 'all' OR r.status = 'open') ORDER BY r.created_at, r.id`, [status]);
  return ok({ items: found.map(reportView), serverTime: now().toISOString() });
}

async function resolve(ctx: Ctx): Promise<Reply> {
  requireAdmin(requireUser(ctx));
  const reference = ctx.params.reference as string;
  const view = await tx(async (client) => {
    const current = await one<{ status: string }>(client, 'SELECT status FROM reports WHERE reference = $1 FOR UPDATE', [reference]);
    if (!current) throw notFound('No such report');
    if (current.status !== 'open') throw conflict('This report was already resolved');
    const outcome = asRecord(ctx.body).outcome;
    if (outcome !== 'actioned' && outcome !== 'dismissed') throw validation({ outcome: 'Choose actioned or dismissed' });
    await client.query('UPDATE reports SET status = $2 WHERE reference = $1', [reference, outcome]);
    return reportView(await one<Parameters<typeof reportView>[0]>(client, `${REPORT_SELECT} WHERE r.reference = $1`, [reference]) as Parameters<typeof reportView>[0]);
  });
  return ok(view);
}

async function suspend(ctx: Ctx): Promise<Reply> {
  requireAdmin(requireUser(ctx));
  const target = await findUserByUsername(pool, ctx.params.username as string);
  if (!target) throw notFound('No such member');
  await tx(async (client) => {
    const locked = await one<{ suspended_at: Date | null; role: string }>(client, 'SELECT suspended_at, role FROM users WHERE id = $1 FOR UPDATE', [target.id]);
    if (locked?.suspended_at || locked?.role === 'admin') throw conflict('This account cannot be suspended');
    const reason = asString(asRecord(ctx.body).reason)?.trim() ?? '';
    if (!isWithin(reason, 1, 1000)) throw validation({ reason: COPY.suspensionReason });
    await client.query('UPDATE users SET suspended_at = $2, suspension_reason = $3 WHERE id = $1', [target.id, now(), reason]);
    await revokeSessions(client, target.id);
  });
  await emitAccount(target.id, { kind: 'suspended', communityName: null });
  return ok({ username: target.username, suspended: true });
}

export function registerReportRoutes(): void {
  route('POST', '/api/reports', fileReport);
  route('GET', '/api/admin/reports', queue);
  route('POST', '/api/admin/reports/:reference/resolve', resolve);
  route('POST', '/api/admin/users/:username/suspension', suspend);
}
