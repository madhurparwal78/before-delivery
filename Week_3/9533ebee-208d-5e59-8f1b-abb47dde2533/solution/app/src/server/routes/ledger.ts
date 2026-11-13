import { FIELD } from "../errors.js";
import { requireRole, valid, type Ctx, type Reply, type Route } from "../http.js";
import { accountsOf, latestPostings, totals } from "../ledger.js";
import { parseInstant, toInstant } from "../time.js";

// The steward's ledger views: the trial balance, account balances and the filtered postings.

/** The `asset` query parameter: a listed asset, or null when absent and optional. */
function assetQuery(ctx: Ctx, optional: boolean): { asset: string | null; findings: Record<string, string> } {
  const asset = ctx.query.get("asset");
  if (asset === null && optional) return { asset: null, findings: {} };
  const listed = asset !== null && ctx.market.has(asset);
  return { asset: listed ? asset : null, findings: listed ? {} : { asset: FIELD.asset } };
}

async function ledgerTotals(ctx: Ctx): Promise<Reply> {
  requireRole(ctx.member, "risk_steward");
  return { status: 200, body: { assets: await totals(ctx.tx) } };
}

async function ledgerAccounts(ctx: Ctx): Promise<Reply> {
  requireRole(ctx.member, "risk_steward");
  const { asset, findings } = assetQuery(ctx, false);
  const checked = valid(findings, { asset: [asset, FIELD.asset] });
  return { status: 200, body: { accounts: await accountsOf(ctx.tx, checked.asset) } };
}

async function ledgerPostings(ctx: Ctx): Promise<Reply> {
  requireRole(ctx.member, "risk_steward");
  const { asset, findings } = assetQuery(ctx, true);
  const fromText = ctx.query.get("from");
  const toText = ctx.query.get("to");
  const from = fromText === null ? null : parseInstant(fromText);
  const to = toText === null ? null : parseInstant(toText);
  const timeFindings: Record<string, string> = {};
  if (fromText !== null && from === null) timeFindings["from"] = FIELD.instant;
  if (toText !== null && to === null) timeFindings["to"] = FIELD.instant;
  else if (from !== null && to !== null && to <= from) timeFindings["to"] = FIELD.endAfterStart;
  valid({ ...findings, ...timeFindings }, {});
  const requested = Number.parseInt(ctx.query.get("limit") ?? "50", 10);
  const limit = Number.isSafeInteger(requested) ? Math.min(200, Math.max(1, requested)) : 50;
  const postings = await latestPostings(ctx.tx, { asset, limit, from, to });
  return { status: 200, body: { postings, server_time: toInstant(ctx.now) } };
}

export const ledgerRoutes: Route[] = [
  { method: "GET", pattern: /^\/api\/ledger\/totals$/, handler: ledgerTotals },
  { method: "GET", pattern: /^\/api\/ledger\/accounts$/, handler: ledgerAccounts },
  { method: "GET", pattern: /^\/api\/ledger\/postings$/, handler: ledgerPostings },
];
