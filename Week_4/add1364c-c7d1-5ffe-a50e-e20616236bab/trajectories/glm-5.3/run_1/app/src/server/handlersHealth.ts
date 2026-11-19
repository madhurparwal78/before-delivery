import type { Ctx } from './apiRoutes.js';
import { ApiError, invalid, unavailable } from './errors.js';
import { jsonOk, readJsonBody } from './http.js';
import { COPY } from './apiCore.js';
import { requireRole } from './handlersCore.js';
import { policyView, ruleInForceAt, type RuleRow } from './domain/rules.js';
import { officeDateString, parseOfficeDate } from './officeTime.js';

/**
 * The health report, grouped by office day. The report for a past day returns
 * the snapshot of the last good check that ran in that office day; today's
 * report uses the latest good check overall. The latest office day picked always
 * wins, whatever order answers arrive in (the client discards stale answers).
 */
export async function getHealthReport(ctx: Ctx): Promise<void> {
  requireRole(ctx, 'office_manager', 'managing_partner');
  const dayRaw = ctx.url.searchParams.get('day') ?? '';
  const now = ctx.store.clock.now();
  const today = officeDateString(now);
  const day = dayRaw === '' ? today : parseOfficeDate(dayRaw);
  if (day === null || day > today) {
    throw invalid({ day: 'Pick a real office date that is not after today.' });
  }
  const feedState = await ctx.store.pool.query(
    'SELECT feed_ok FROM breach_checks ORDER BY ran_at DESC LIMIT 1'
  );
  const feed: 'ok' | 'unreachable' = feedState.rows.length > 0 ? (Boolean(feedState.rows[0].feed_ok) ? 'ok' : 'unreachable') : 'unreachable';
  if (day === today) {
    const latest = await ctx.store.pool.query(
      'SELECT * FROM breach_checks WHERE feed_ok = true ORDER BY ran_at DESC LIMIT 1'
    );
    jsonOk(ctx.res, 200, reportView(ctx, day, feed, latest.rows.length > 0 ? latest.rows[0] : null));
    return;
  }
  const snapshot = await ctx.store.pool.query(
    'SELECT * FROM breach_checks WHERE feed_ok = true AND office_day = $1 ORDER BY ran_at DESC LIMIT 1',
    [day]
  );
  jsonOk(ctx.res, 200, reportView(ctx, day, feed, snapshot.rows.length > 0 ? snapshot.rows[0] : null));
}

function reportView(ctx: Ctx, day: string, feed: 'ok' | 'unreachable', check: Record<string, unknown> | null): Record<string, unknown> {
  if (!check) {
    return {
      office_date: day,
      feed,
      last_good_check_at: null,
      counts: { exposed: 0, vendor_breached: 0, out_of_policy: 0, turns_due: 0, turns_overdue: 0 },
      credentials: []
    };
  }
  const counts = check.counts as Record<string, number>;
  const health = check.credential_health as Record<string, string>;
  const credentialIds = Object.keys(health).filter((id) => health[id] !== 'sound');
  return {
    office_date: day,
    feed,
    last_good_check_at: new Date(check.ran_at as string).toISOString(),
    counts,
    credentials: credentialIds.map((id) => ({ id, health: health[id] }))
  };
}

/** Run a breach check now; scheduled and manual checks never overlap. */
export async function runBreachCheck(ctx: Ctx): Promise<void> {
  requireRole(ctx, 'office_manager');
  const raw = await readJsonBody(ctx.req, ctx.res, 16384);
  if (raw instanceof ApiError) throw raw;
  const result = await ctx.store.runBreachCheckNow();
  if (!result.ok) {
    throw unavailable('breach_feed_unreachable', COPY.feedOutageNoCheck);
  }
  jsonOk(ctx.res, 200, {
    feed: 'ok',
    checked_at: result.checkedAt.toISOString()
  });
}
