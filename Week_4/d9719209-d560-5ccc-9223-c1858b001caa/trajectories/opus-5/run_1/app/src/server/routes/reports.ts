import { db, one } from '../../core/db.js';
import { errors } from '../../core/errors.js';
import { suspendAccount } from '../../domain/auth.js';
import { fileReport, parseReportInput, reportQueue, resolveReport } from '../../domain/reports.js';
import { sendReportConfirmationMail } from '../../services/mail.js';
import { requireAdmin } from '../guards.js';
import { route, sendJson, type Route } from '../http.js';

export const reportRoutes: Route[] = [
  route('POST', '/api/reports', async (ctx) => {
    const input = parseReportInput(ctx.body, ctx.member ? ctx.member.email : null);
    const target = await one(
      db,
      input.targetType === 'post'
        ? 'select 1 from posts where id = $1'
        : 'select 1 from comments where id = $1',
      [input.targetId],
    );
    if (!target) throw errors.notFound('That content does not exist');
    const filed = await fileReport(input, ctx.member ? ctx.member.id : null);
    await sendReportConfirmationMail(input.reporterEmail, filed.reference);
    sendJson(ctx, 201, filed);
  }),

  route(
    'GET',
    '/api/admin/reports',
    async (ctx) => {
      requireAdmin(ctx);
      const status = ctx.url.searchParams.get('status') === 'all' ? 'all' : 'open';
      sendJson(ctx, 200, await reportQueue(status));
    },
    'none',
  ),

  route('POST', '/api/admin/reports/:reference/resolve', async (ctx) => {
    requireAdmin(ctx);
    const outcome = ctx.body.outcome === 'dismissed' ? 'dismissed' : ctx.body.outcome === 'actioned' ? 'actioned' : null;
    if (outcome === null) throw errors.validation('Choose an outcome', { outcome: 'Choose an outcome' });
    sendJson(ctx, 200, await resolveReport(ctx.params.reference, outcome));
  }),

  route('POST', '/api/admin/users/:username/suspension', async (ctx) => {
    const admin = requireAdmin(ctx);
    const reason = typeof ctx.body.reason === 'string' ? ctx.body.reason.trim() : '';
    if (reason.length < 1 || reason.length > 1000) {
      throw errors.validation('Give a reason', { reason: 'Give a reason' });
    }
    await suspendAccount(ctx.params.username, reason, admin.role === 'admin');
    sendJson(ctx, 200, { username: ctx.params.username, suspended: true });
  }),
];
