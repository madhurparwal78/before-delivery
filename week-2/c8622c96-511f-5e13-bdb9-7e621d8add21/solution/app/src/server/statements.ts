// Monthly royalty statements and payouts. Every amount is integer cents.
import { isCalendarMonth, isoInstant, coopTime, monthBounds } from "../shared/coop-time.js";
import { requireRole } from "./auth.js";
import { serverNow } from "./clock.js";
import { one, query, transaction } from "./db.js";
import { ApiError, notFound, sendJson, validationFailed } from "./http.js";
import { BillingRefused, BillingUnreachable, recordPayout } from "./killbill.js";
import { licenceState, type LicenceRow } from "./licence-state.js";
import { on, type Ctx } from "./router.js";
import type { WorkOutcome } from "./workers.js";
import { emptyBody, strictBody } from "./strict-body.js";

const MONTH_MESSAGE = "Use YYYY-MM";
const OPEN_MESSAGE = "That month hasn't closed in co-op time";

/**
 * Splits `amount` cents at `rateBp`: commission floor(A·r/10000), then each share floor(P·s/10000) of the
 * pool P, with leftover cents one each to the largest fractional remainders, ties to the earlier position.
 */
function royaltySplit(amount: number, rateBp: number, splits: number[]): { commission: number; shares: number[] } {
  const commission = Math.floor((amount * rateBp) / 10000);
  const pool = amount - commission;
  const shares = splits.map((s) => Math.floor((pool * s) / 10000));
  const remainders = splits.map((s, i) => ({ i, rest: (pool * s) % 10000 }));
  remainders.sort((a, b) => b.rest - a.rest || a.i - b.i);
  let left = pool - shares.reduce((a, b) => a + b, 0);
  for (const { i } of remainders) {
    if (left === 0) break;
    shares[i] = (shares[i] ?? 0) + 1;
    left -= 1;
  }
  return { commission, shares };
}

interface StatementBody {
  month: string;
  lines: {
    licence_id: string; essay_title: string; newsroom: { slug: string; name: string }; confirmed_at: string;
    confirmed_display: string; amount_minor: number; rate_bp: number; commission_minor: number;
    shares: { handle: string; name: string; position: number; split_bp: number; amount_minor: number }[];
  }[];
  totals: { invoiced_minor: number; commission_minor: number; contributors: { handle: string; name: string; amount_minor: number }[] };
}

interface PayoutRow {
  handle: string;
  amount_minor: number;
  state: "queued" | "recorded";
}

async function withPayouts(body: StatementBody): Promise<Record<string, unknown>> {
  const payouts = await query<PayoutRow>(
    "SELECT handle, amount_minor, state FROM payouts WHERE month = $1 ORDER BY handle", [body.month]);
  return { ...body, payouts };
}

async function storedStatement(month: string): Promise<StatementBody | undefined> {
  return (await one<{ body: StatementBody }>("SELECT body FROM statements WHERE month = $1", [month]))?.body;
}

async function buildStatement(month: string, start: Date, end: Date): Promise<StatementBody> {
  const licences = await query<LicenceRow & { title: string; newsroom_name: string }>(
    `SELECT l.*, e.title, n.name AS newsroom_name FROM licences l JOIN essays e ON e.id = l.essay_id
     JOIN newsrooms n ON n.slug = l.newsroom
     WHERE l.confirmed_at >= $1 AND l.confirmed_at < $2 AND l.invoice_raised ORDER BY l.confirmed_at, l.id`, [start, end]);
  const credits = await query<{ essay_id: string; handle: string; name: string; position: number; split_bp: number }>(
    `SELECT c.essay_id, c.handle, p.name, c.position, c.split_bp FROM credits c JOIN people p ON p.handle = c.handle
     WHERE c.essay_id = ANY($1) ORDER BY c.position`, [licences.map((l) => l.essay_id)]);
  const totals = new Map<string, { handle: string; name: string; amount_minor: number }>();
  const lines = licences.map((l) => {
    const own = credits.filter((c) => c.essay_id === l.essay_id);
    const { commission, shares } = royaltySplit(l.amount_minor, l.rate_bp, own.map((c) => c.split_bp));
    own.forEach((c, i) => {
      const total = totals.get(c.handle) ?? { handle: c.handle, name: c.name, amount_minor: 0 };
      total.amount_minor += shares[i] ?? 0;
      totals.set(c.handle, total);
    });
    return {
      licence_id: l.id, essay_title: l.title, newsroom: { slug: l.newsroom, name: l.newsroom_name },
      confirmed_at: isoInstant(l.confirmed_at), confirmed_display: coopTime(l.confirmed_at),
      amount_minor: l.amount_minor, rate_bp: l.rate_bp, commission_minor: commission,
      shares: own.map((c, i) => ({ handle: c.handle, name: c.name, position: c.position, split_bp: c.split_bp,
        amount_minor: shares[i] ?? 0 })),
    };
  });
  return {
    month, lines,
    totals: {
      invoiced_minor: lines.reduce((a, l) => a + l.amount_minor, 0),
      commission_minor: lines.reduce((a, l) => a + l.commission_minor, 0),
      contributors: [...totals.values()].sort((a, b) => a.handle.localeCompare(b.handle)),
    },
  };
}

on("POST", "/api/royalty-statements", "json", async (ctx: Ctx) => {
  requireRole(ctx.person, "treasurer");
  const { values, errors } = strictBody(ctx.body, { month: { kind: "string", message: MONTH_MESSAGE } });
  if (typeof values.month === "string" && !isCalendarMonth(values.month)) errors.add("month", MONTH_MESSAGE);
  errors.fail();
  const month = values.month as string;
  const existing = await storedStatement(month);
  if (existing) {
    sendJson(ctx.res, 200, await withPayouts(existing));
    return;
  }
  const { start, end } = monthBounds(month);
  const now = await serverNow();
  const pending = await query<LicenceRow>(
    "SELECT * FROM licences WHERE status = 'pending' AND confirmed_at >= $1 AND confirmed_at < $2", [start, end]);
  if (pending.some((l) => licenceState(l, now) === "pending_invoice")) {
    throw new ApiError(409, "invoices_pending", "Some licences confirmed that month are still waiting for their invoice.");
  }
  if (now < end) throw validationFailed({ month: OPEN_MESSAGE });
  const body = await buildStatement(month, start, end);
  const inserted = await query("INSERT INTO statements (month, body, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING month",
    [month, JSON.stringify(body), now]);
  const stored = inserted.length ? body : await storedStatement(month);
  sendJson(ctx.res, inserted.length ? 201 : 200, await withPayouts(stored as StatementBody));
});

on("GET", "/api/royalty-statements/:month", "none", async (ctx: Ctx) => {
  requireRole(ctx.person, "treasurer");
  const stored = await storedStatement(ctx.params[0] ?? "");
  if (!stored) throw notFound();
  sendJson(ctx.res, 200, await withPayouts(stored));
});

on("POST", "/api/royalty-statements/:month/payouts", "json", async (ctx: Ctx) => {
  requireRole(ctx.person, "treasurer");
  const month = ctx.params[0] ?? "";
  const stored = await storedStatement(month);
  if (!stored) throw notFound();
  emptyBody(ctx.body);
  const created = await transaction(async (client) => {
    await query("SELECT month FROM statements WHERE month = $1 FOR UPDATE", [month], client);
    if (await one("SELECT 1 FROM payouts WHERE month = $1", [month], client)) return false;
    for (const person of stored.totals.contributors.filter((c) => c.amount_minor > 0)) {
      await query("INSERT INTO payouts (month, handle, amount_minor, state) VALUES ($1, $2, $3, 'queued')",
        [month, person.handle, person.amount_minor], client);
    }
    return true;
  });
  if (created) await recordDuePayouts(month);
  sendJson(ctx.res, created ? 202 : 200, await withPayouts(stored));
});

/**
 * Records queued payouts in billing, one row lock at a time so each is recorded exactly once. Answers
 * "provider_down" at the first payout billing does not record, leaving it queued for the next attempt.
 */
export async function recordDuePayouts(month?: string): Promise<WorkOutcome> {
  for (;;) {
    const outcome = await transaction(async (client): Promise<WorkOutcome | "recorded"> => {
      const payout = await one<PayoutRow & { month: string; name: string }>(
        `SELECT p.month, p.handle, p.amount_minor, p.state, pe.name FROM payouts p JOIN people pe ON pe.handle = p.handle
         WHERE p.state = 'queued'${month ? " AND p.month = $1" : ""}
         ORDER BY p.month, p.handle LIMIT 1 FOR UPDATE OF p SKIP LOCKED`, month ? [month] : [], client);
      if (!payout) return "done";
      try {
        await recordPayout(payout.handle, payout.name, payout.month, payout.amount_minor);
      } catch (error) {
        if (error instanceof BillingUnreachable || error instanceof BillingRefused) return "provider_down";
        throw error;
      }
      await query("UPDATE payouts SET state = 'recorded' WHERE month = $1 AND handle = $2",
        [payout.month, payout.handle], client);
      return "recorded";
    });
    if (outcome !== "recorded") return outcome;
  }
}
