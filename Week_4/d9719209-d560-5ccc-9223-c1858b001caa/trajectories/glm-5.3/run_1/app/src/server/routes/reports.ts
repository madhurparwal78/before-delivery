/* Illegal-content reports and the admin queue. */
import { ApiError, validation } from '../errors.js';
import { route, type Route, type RouteHandler, type Services } from '../routes.js';
import type { Ctx } from '../context.js';
import { isEmail, reference, iso } from '../util.js';
import { requiresTwoFactor } from '../communities.js';

const CATEGORIES = new Set(['hate', 'terrorism', 'csam', 'ip', 'privacy', 'other']);

export function registerReportRoutes(services: Services, add: (r: Route) => void): void {
  add(route('POST', '/api/reports', createReport(services)));
  add(route('GET', '/api/admin/reports', listReports(services), 'none'));
  add(route('POST', '/api/admin/reports/:reference/resolve', resolveReport(services)));
  add(route('POST', '/api/admin/users/:username/suspension', suspendUser(services)));
}

function body(ctx: Ctx): Record<string, unknown> {
  return (ctx.body ?? {}) as Record<string, unknown>;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function createReport(services: Services): RouteHandler {
  return async (ctx) => {
    const b = body(ctx);
    const targetType = str(b.targetType);
    const targetId = Number(b.targetId);
    const category = str(b.category);
    const explanation = str(b.explanation).trim();
    const reporterEmail = str(b.reporterEmail).trim();
    const goodFaith = b.goodFaith === true;
    const fields: Record<string, string> = {};
    if (targetType !== 'post' && targetType !== 'comment') fields.targetType = 'Choose a type';
    if (!CATEGORIES.has(category)) fields.category = 'Choose a type';
    if (explanation.length < 1 || explanation.length > 2000) fields.explanation = 'Explain why this is illegal';
    if (ctx.account === null && !isEmail(reporterEmail)) fields.reporterEmail = 'Enter a valid email address';
    if (!goodFaith) fields.goodFaith = 'Confirm the statement to send';
    if (Object.keys(fields).length > 0) throw validation(fields);

    // The target must exist.
    if (targetType === 'post') {
      const rows = await services.db.query(`SELECT 1 FROM posts WHERE id = $1`, [targetId]);
      if (rows.rows.length === 0) throw new ApiError('NOT_FOUND', 'Not found');
    } else {
      const rows = await services.db.query(`SELECT 1 FROM comments WHERE id = $1`, [targetId]);
      if (rows.rows.length === 0) throw new ApiError('NOT_FOUND', 'Not found');
    }

    const ref = reference();
    const email = ctx.account !== null ? ctx.account.email : reporterEmail;
    const deadlineSeconds = services.cfg.limits.reportDeadline;
    await services.db.query(
      `INSERT INTO reports (reference, target_type, target_id, category, explanation, reporter_email, good_faith, deadline_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now() + make_interval(secs => $8))`,
      [ref, targetType, targetId, category, explanation, email, goodFaith, deadlineSeconds]
    );
    services.mailer.report(email, ref);
    const rows = await services.db.query(`SELECT created_at, deadline_at FROM reports WHERE reference = $1`, [ref]);
    const row = rows.rows[0] as { created_at: Date; deadline_at: Date };
    return {
      status: 201,
      body: { reference: ref, deadlineAt: iso(new Date(row.deadline_at)), createdAt: iso(new Date(row.created_at)) },
    };
  };
}

async function requireAdmin(services: Services, ctx: Ctx): Promise<void> {
  if (ctx.account === null) throw new ApiError('UNAUTHENTICATED', 'Sign in to continue');
  if (ctx.account.role !== 'admin') throw new ApiError('FORBIDDEN', 'Admins only');
  const need2fa = await requiresTwoFactor(services, ctx.account);
  if (need2fa) throw new ApiError('TOTP_REQUIRED', 'Enter the 6-digit code from your authenticator app');
}

function reportView(row: { reference: string; target_type: string; target_id: string; category: string; explanation: string; created_at: Date; deadline_at: Date; status: string }): Record<string, unknown> {
  const now = Date.now();
  const deadline = new Date(row.deadline_at);
  const secondsRemaining = Math.floor((deadline.getTime() - now) / 1000);
  const targetUrl = row.target_type === 'post'
    ? `/c/-/post/${Number(row.target_id)}`
    : `/c/-/post/-/comment/${Number(row.target_id)}`;
  return {
    reference: row.reference,
    target: { type: row.target_type, id: String(row.target_id), url: targetUrl },
    category: row.category,
    explanation: row.explanation,
    createdAt: iso(new Date(row.created_at)),
    deadlineAt: iso(deadline),
    secondsRemaining,
    overdue: secondsRemaining <= 0,
    status: row.status,
  };
}

function listReports(services: Services): RouteHandler {
  return async (ctx) => {
    await requireAdmin(services, ctx);
    const status = ctx.url.searchParams.get('status') ?? 'open';
    const rows = status === 'all'
      ? await services.db.query(`SELECT * FROM reports ORDER BY deadline_at ASC LIMIT 100`)
      : await services.db.query(`SELECT * FROM reports WHERE status = 'open' ORDER BY deadline_at ASC LIMIT 100`);
    return {
      status: 200,
      body: {
        items: (rows.rows as unknown as Parameters<typeof reportView>[0][]).map(reportView),
        serverTime: iso(new Date()),
      },
    };
  };
}

function resolveReport(services: Services): RouteHandler {
  return async (ctx) => {
    await requireAdmin(services, ctx);
    const outcome = str(body(ctx).outcome);
    if (outcome !== 'actioned' && outcome !== 'dismissed') throw validation({ outcome: 'Outcome must be actioned or dismissed' });
    const ref = ctx.params.reference as string;
    const rows = await services.db.query(`SELECT * FROM reports WHERE reference = $1`, [ref]);
    if (rows.rows.length === 0) throw new ApiError('NOT_FOUND', 'Not found');
    const row = rows.rows[0] as { status: string };
    if (row.status !== 'open') throw new ApiError('CONFLICT', 'Already resolved');
    await services.db.query(`UPDATE reports SET status = $2 WHERE reference = $1`, [ref, outcome]);
    const fresh = await services.db.query(`SELECT * FROM reports WHERE reference = $1`, [ref]);
    return { status: 200, body: reportView(fresh.rows[0] as unknown as Parameters<typeof reportView>[0]) };
  };
}

function suspendUser(services: Services): RouteHandler {
  return async (ctx) => {
    await requireAdmin(services, ctx);
    const username = ctx.params.username as string;
    const reason = str(body(ctx).reason);
    if (reason.trim().length < 1) throw validation({ reason: 'A reason is required' });
    const rows = await services.db.query(`SELECT id, username, role, suspended FROM accounts WHERE username_lc = $1`, [username.toLowerCase()]);
    if (rows.rows.length === 0) throw new ApiError('NOT_FOUND', 'Not found');
    const target = rows.rows[0] as { id: string; username: string; role: string; suspended: boolean };
    if (target.suspended) throw new ApiError('CONFLICT', 'Already suspended');
    if (target.role === 'admin') throw new ApiError('CONFLICT', 'Admins cannot be suspended');
    await services.db.query(`BEGIN`);
    try {
      await services.db.query(`UPDATE accounts SET suspended = true WHERE id = $1`, [Number(target.id)]);
      // Every session of the account ends; the tokens are remembered so later
      // requests still answer 403 SUSPENDED.
      await services.db.query(`INSERT INTO revoked_sessions (token, account_id) SELECT token, account_id FROM sessions WHERE account_id = $1`, [Number(target.id)]);
      await services.db.query(`DELETE FROM sessions WHERE account_id = $1`, [Number(target.id)]);
      await services.db.query(`COMMIT`);
    } catch (err) {
      await services.db.query(`ROLLBACK`);
      throw err;
    }
    await services.valkey.publish({
      topics: [`account:${Number(target.id)}`],
      event: 'account',
      data: { kind: 'suspended', communityName: null, accountId: Number(target.id) },
    });
    return { status: 200, body: { username: target.username, suspended: true } };
  };
}
