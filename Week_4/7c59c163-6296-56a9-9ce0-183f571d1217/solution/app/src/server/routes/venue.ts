import { feeBpsValid, RANGES, type Role } from "../../shared/rules.js";
import { requireRole, signedIn } from "../auth.js";
import { effectivePlan } from "../billing.js";
import { Check, EMAIL } from "../body.js";
import { one, pool, rows, UUID } from "../db.js";
import { invalid, notFound, ProviderDown } from "../errors.js";
import { json, type Ctx, type Route } from "../http.js";
import { invite } from "../identity.js";
import { reachable as minioReachable, objectExists, presign } from "../s3.js";
import { monthBounds, startRun, statementKey, statementView, venueMonth, type StatementRow } from "../statements.js";
import { iso, marketsOfVenue, venueById } from "../views.js";

const INVITABLE: readonly Role[] = ["trader", "builder", "market_admin"];
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

async function totals(ctx: Ctx) {
  const venueId = requireRole(signedIn(ctx), "org_owner");
  const venue = await venueById(pool, venueId);
  const row = await one<{ members: number; open_orders: number; deposits: number; refunds: number; fees: number; volume: number }>(
    pool,
    `SELECT (SELECT count(*)::int FROM members WHERE venue_id = $1) AS members,
            (SELECT count(*)::int FROM orders WHERE venue_id = $1 AND status IN ('resting', 'partially_filled')) AS open_orders,
            (SELECT coalesce(sum(amount_cents), 0) FROM deposits WHERE venue_id = $1 AND status = 'succeeded') AS deposits,
            (SELECT coalesce(sum(amount_cents), 0) FROM refunds WHERE venue_id = $1) AS refunds,
            (SELECT coalesce(sum(fee_cents), 0) FROM fills WHERE venue_id = $1) AS fees,
            (SELECT coalesce(sum(price::bigint * quantity), 0) FROM trades
              WHERE venue_id = $1 AND at >= (date_trunc('day', now() AT TIME ZONE $2) AT TIME ZONE $2)) AS volume`,
    [venueId, venue.time_zone],
  );
  const markets = await marketsOfVenue(pool, venueId);
  return json(200, {
    members: row?.members ?? 0,
    open_orders: row?.open_orders ?? 0,
    deposits_cents: row?.deposits ?? 0,
    refunds_cents: row?.refunds ?? 0,
    fees_cents: row?.fees ?? 0,
    volume_cents_today: row?.volume ?? 0,
    open_interest_contracts: markets.reduce((total, m) => total + m.open_interest, 0),
  });
}

async function members(ctx: Ctx) {
  const venueId = requireRole(signedIn(ctx), "org_owner", "market_admin");
  const q = ctx.query.get("q") ?? "";
  if (q.length < 1 || q.length > 60) throw invalid({ q: "invalid" });
  const found = await rows<{ id: string; display_name: string; email: string; roles: Role[] }>(
    pool,
    `SELECT id, display_name, email, roles FROM members
      WHERE venue_id = $1 AND (display_name ILIKE '%' || $2 || '%' OR email ILIKE '%' || $2 || '%')
      ORDER BY display_name LIMIT 10`,
    [venueId, q.replace(/[\\%_]/g, (c) => `\\${c}`)],
  );
  return json(200, { members: found });
}

async function sendInvite(ctx: Ctx) {
  const venueId = requireRole(signedIn(ctx), "org_owner");
  const check = new Check(ctx.body, ["email", "display_name", "roles"]);
  const email = check.text("email", 3, 254);
  if (!EMAIL.test(email)) check.fail("email", "invalid");
  const displayName = check.text("display_name", 1, 60);
  const roles = check.body.roles;
  const valid = Array.isArray(roles) && roles.length > 0 && roles.every((role) => INVITABLE.includes(role as Role)) && new Set(roles).size === roles.length;
  if (!valid) check.fail("roles", "invalid");
  check.done();
  const venue = await venueById(pool, venueId);
  const chosen = INVITABLE.filter((role) => (roles as Role[]).includes(role));
  const { memberId } = await invite(venue, { email, displayName, roles: chosen });
  return json(201, { member_id: memberId, email, roles: chosen });
}

async function putFees(ctx: Ctx) {
  const venueId = requireRole(signedIn(ctx), "org_owner");
  const check = new Check(ctx.body, ["taker_fee_bps", "maker_fee_bps"]);
  const taker = check.int("taker_fee_bps", RANGES.feeBps.min, RANGES.feeBps.max);
  const maker = check.int("maker_fee_bps", RANGES.feeBps.min, RANGES.feeBps.max);
  if (check.ok && feeBpsValid(taker, maker) === "exceeds_taker") check.fail("maker_fee_bps", "exceeds_taker");
  check.done();
  await pool.query("UPDATE venues SET taker_fee_bps = $2, maker_fee_bps = $3 WHERE id = $1", [venueId, taker, maker]);
  return json(200, { taker_fee_bps: taker, maker_fee_bps: maker });
}

function csvField(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

async function fillsCsv(ctx: Ctx) {
  const venueId = requireRole(signedIn(ctx), "org_owner");
  const venue = await venueById(pool, venueId);
  const month = ctx.query.get("month") ?? (await venueMonth(venue.time_zone));
  if (!MONTH.test(month)) throw invalid({ month: "invalid" });
  const bounds = await monthBounds(month, venue.time_zone);
  const fills = await rows<Record<string, unknown>>(
    pool,
    `SELECT f.id AS fill_id, f.filled_at, m.symbol AS market_symbol, mem.email AS member_email, f.mode, f.side, f.outcome, f.price, f.quantity, f.fee_cents, f.liquidity
       FROM fills f JOIN markets m ON m.id = f.market_id JOIN members mem ON mem.id = f.member_id
      WHERE f.venue_id = $1
        AND f.filled_at >= $2 AND f.filled_at < $3
      ORDER BY f.filled_at, f.seq`,
    [venueId, bounds.start, bounds.end],
  );
  const header = ["fill_id", "filled_at", "market_symbol", "member_email", "mode", "side", "outcome", "price", "quantity", "fee_cents", "liquidity"];
  const lines = [header.join(","), ...fills.map((f) => header.map((h) => csvField(h === "filled_at" ? iso(f[h] as Date) : f[h])).join(","))];
  return {
    status: 200,
    text: lines.join("\r\n") + "\r\n",
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="fills-${venue.slug}-${month}.csv"` },
  };
}

async function builderBilling(ctx: Ctx) {
  const venueId = requireRole(signedIn(ctx), "org_owner");
  const builders = await rows<{ member_id: string; display_name: string; plan: "sandbox" | "builder" | "desk" | null; state: "active" | "payment_failed" | "downgraded" | null }>(
    pool,
    `SELECT m.id AS member_id, m.display_name, b.plan, b.state FROM members m LEFT JOIN builder_billing b ON b.member_id = m.id
      WHERE m.venue_id = $1 AND 'builder' = ANY(m.roles) ORDER BY m.display_name`,
    [venueId],
  );
  return json(200, {
    builders: builders.map((b) => {
      const plan = b.plan ?? "sandbox";
      const state = b.state ?? "active";
      return { member_id: b.member_id, display_name: b.display_name, plan, effective_plan: effectivePlan(plan, state), state };
    }),
  });
}

async function generateStatements(ctx: Ctx) {
  const venueId = requireRole(signedIn(ctx), "org_owner");
  const venue = await venueById(pool, venueId);
  const check = new Check(ctx.body, ["month"]);
  const month = check.text("month", 7, 7, false);
  if (!MONTH.test(month)) check.fail("month", "invalid");
  else if (month >= (await venueMonth(venue.time_zone))) check.fail("month", "not_closed");
  check.done();
  if (!(await minioReachable())) throw new ProviderDown("minio", "unreachable before a statement run");
  const run = await startRun(venueId, month);
  return json(run.started ? 202 : 200, { month, members: run.members });
}

async function listStatements(ctx: Ctx) {
  const auth = signedIn(ctx);
  requireRole(auth);
  const statements = await rows<StatementRow>(pool, "SELECT id, month, created_at FROM statements WHERE member_id = $1 ORDER BY month DESC", [auth.memberId]);
  return json(200, { statements: statements.map(statementView) });
}

async function statementLink(ctx: Ctx) {
  const auth = signedIn(ctx);
  const id = ctx.params.id ?? "";
  const statement = UUID.test(id)
    ? await one<{ venue_id: string; member_id: string; month: string }>(pool, "SELECT venue_id, member_id, month FROM statements WHERE id = $1 AND member_id = $2", [id, auth.memberId])
    : undefined;
  if (!statement) throw notFound();
  requireRole(auth);
  const key = statementKey(statement.venue_id, statement.member_id, statement.month);
  if (!(await objectExists(key))) throw notFound();
  const link = presign(key, 60);
  return json(200, { url: link.url, expires_at: link.expiresAt.toISOString() });
}

export const venueRoutes: Route[] = [
  { method: "GET", pattern: "/api/venue/totals", auth: "session", handler: totals },
  { method: "GET", pattern: "/api/venue/members", auth: "session", handler: members },
  { method: "POST", pattern: "/api/venue/invites", auth: "session", handler: sendInvite, outage: "identity_unavailable" },
  { method: "PUT", pattern: "/api/venue/fees", auth: "session", handler: putFees },
  { method: "GET", pattern: "/api/venue/fills.csv", auth: "session", handler: fillsCsv },
  { method: "GET", pattern: "/api/venue/billing", auth: "session", handler: builderBilling },
  { method: "POST", pattern: "/api/venue/statements", auth: "session", handler: generateStatements, outage: "statements_unavailable" },
  { method: "GET", pattern: "/api/statements", auth: "session", handler: listStatements },
  { method: "GET", pattern: "/api/statements/{id}/link", auth: "session", handler: statementLink, outage: "statements_unavailable" },
];
