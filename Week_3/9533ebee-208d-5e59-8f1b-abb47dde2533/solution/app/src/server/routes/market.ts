import { config } from "../config.js";
import { rows } from "../db.js";
import { fail, FIELD, validation } from "../errors.js";
import { requireRole, valid, type Ctx, type Reply, type Route } from "../http.js";
import { parsePrice } from "../money.js";
import { oracleStatusOf } from "../oracle.js";
import { poolJson, type Asset } from "../pools.js";
import { isLargeMove, recordPrice } from "../prices.js";
import { positionsBelowOne, sync } from "../positions.js";
import { isoDuration, plainPrice } from "../../shared/format.js";
import { toInstant } from "../time.js";

// Pools, posted prices and risk parameters: the steward's levers and everyone's view of the market.

function pathAsset(ctx: Ctx): Asset {
  const asset = ctx.market.get(ctx.params[0] ?? "");
  if (!asset) throw fail("not_found");
  return asset;
}

const pool = (ctx: Ctx, asset: Asset) => poolJson(ctx.tx, asset, ctx.now, oracleStatusOf(asset.asset));

async function listPools(ctx: Ctx): Promise<Reply> {
  const pools = [];
  for (const asset of ctx.market.values()) pools.push(await pool(ctx, asset));
  return {
    status: 200,
    body: {
      pools,
      staleness_limit: isoDuration(config.stalenessSeconds),
      grace_period: isoDuration(config.graceSeconds),
      quote_lifetime: isoDuration(config.quoteTtlSeconds),
      desk_time_zone: config.deskTimeZone,
      server_time: toInstant(ctx.now),
    },
  };
}

async function showPool(ctx: Ctx): Promise<Reply> {
  return { status: 200, body: { ...(await pool(ctx, pathAsset(ctx))), server_time: toInstant(ctx.now) } };
}

// ---- risk parameters, under RFC 9110 conditional requests ----

const RISK_FIELDS = ["ltv_bps", "liquidation_threshold_bps", "liquidation_bonus_bps", "reserve_factor_bps"] as const;
type RiskField = (typeof RISK_FIELDS)[number];

function riskOf(asset: Asset) {
  return {
    asset: asset.asset,
    ltv_bps: asset.ltvBps,
    liquidation_threshold_bps: asset.liquidationThresholdBps,
    liquidation_bonus_bps: asset.liquidationBonusBps,
    reserve_factor_bps: asset.reserveFactorBps,
  };
}

/** A strong validator that changes on every save. */
const etagOf = (asset: Asset) => `"${asset.asset}-${asset.riskVersion}"`;

async function showRisk(ctx: Ctx): Promise<Reply> {
  const asset = pathAsset(ctx);
  return { status: 200, body: riskOf(asset), headers: { ETag: etagOf(asset) } };
}

/** `If-Match` is compared strongly: a weak tag never matches, `*` matches any current representation. */
function matchesEtag(header: string, current: string): boolean {
  return header.split(",").some((tag) => tag.trim() === "*" || tag.trim() === current);
}

async function saveRisk(ctx: Ctx): Promise<Reply> {
  const asset = pathAsset(ctx);
  requireRole(ctx.member, "risk_steward");
  const ifMatch = ctx.headers["if-match"];
  if (ifMatch === undefined) throw fail("precondition_required");
  if (!matchesEtag(ifMatch, etagOf(asset))) throw fail("precondition_failed");
  const stored = riskOf(asset);
  const sent: Partial<Record<RiskField, number | null>> = {};
  for (const field of RISK_FIELDS) {
    const value = ctx.body[field];
    if (value !== undefined) sent[field] = typeof value === "number" && Number.isSafeInteger(value) ? value : null;
  }
  // Every cross-field check uses the submitted value, falling back to the stored one.
  const next = (field: RiskField) => (sent[field] === undefined ? stored[field] : sent[field]);
  const ltv = next("ltv_bps");
  const threshold = next("liquidation_threshold_bps");
  const bonus = next("liquidation_bonus_bps");
  const reserve = next("reserve_factor_bps");
  const ltvOk = ltv !== null && threshold !== null && ltv > 0 && ltv < threshold;
  const thresholdOk = threshold !== null && threshold > 0 && threshold <= 9500;
  const bonusOk = bonus !== null && threshold !== null && bonus >= 0 && bonus <= 2000 && threshold * (10_000 + bonus) < 100_000_000;
  const reserveOk = reserve !== null && reserve >= 0 && reserve <= 5000;
  const checked = valid(ctx.bodyErrors, {
    ltv_bps: [ltvOk ? ltv : null, FIELD.ltv],
    liquidation_threshold_bps: [thresholdOk ? threshold : null, FIELD.threshold],
    liquidation_bonus_bps: [bonusOk ? bonus : null, FIELD.bonus],
    reserve_factor_bps: [reserveOk ? reserve : null, FIELD.reserve],
  });
  await ctx.tx.query(
    "UPDATE assets SET ltv_bps = $2, liquidation_threshold_bps = $3, liquidation_bonus_bps = $4, reserve_factor_bps = $5, risk_version = risk_version + 1 WHERE asset = $1",
    [asset.asset, checked.ltv_bps, checked.liquidation_threshold_bps, checked.liquidation_bonus_bps, checked.reserve_factor_bps],
  );
  // The save applies at once and re-evaluates every open position.
  const market = await sync(ctx.tx, ctx.now);
  const updated = market.get(asset.asset) ?? asset;
  return {
    status: 200,
    body: { ...riskOf(updated), positions_below_one: await positionsBelowOne(ctx.tx, market) },
    headers: { ETag: etagOf(updated) },
  };
}

// ---- manual price posts ----

async function postPrice(ctx: Ctx): Promise<Reply> {
  requireRole(ctx.member, "risk_steward");
  const code = ctx.body["asset"];
  const asset = typeof code === "string" ? ctx.market.get(code) : undefined;
  const price = parsePrice(ctx.body["price"]);
  const confirm = ctx.body["confirm_large_move"];
  const confirmOk = confirm === undefined || typeof confirm === "boolean";
  const largeMove = asset !== undefined && price !== null && confirm !== true && isLargeMove(asset.price, price);
  const priceMessage = price === null ? FIELD.price : largeMove ? FIELD.largeMove : null;
  const checked = valid(ctx.bodyErrors, {
    asset: [asset, FIELD.asset],
    price: [priceMessage === null ? price : null, priceMessage ?? FIELD.price],
    confirm_large_move: [confirmOk ? true : null, FIELD.confirm],
  });
  const recorded = await recordPrice(ctx.tx, ctx.now, ctx.stored, checked.asset, checked.price, {
    source: "manual",
    postedBy: ctx.member.actor_id,
    postedAt: ctx.now,
    oracleRound: null,
    evidence: { submitted: ctx.body },
  });
  return {
    status: 201,
    body: {
      price_post_id: recorded.pricePostId,
      asset: checked.asset.asset,
      price: plainPrice(checked.price),
      previous_price: plainPrice(recorded.previousPrice),
      posted_at: toInstant(ctx.now),
      source: "manual",
      positions_below_one: recorded.positionsBelowOne,
      evidence_key: recorded.evidenceKey,
    },
  };
}

async function listPrices(ctx: Ctx): Promise<Reply> {
  const code = ctx.query.get("asset");
  if (code !== null && !ctx.market.has(code)) throw validation({ asset: FIELD.asset });
  const found = await rows<{
    price_post_id: string;
    asset: string;
    price: string;
    posted_at: Date;
    posted_by: string;
    source: string;
    oracle_round: string | null;
    evidence_key: string | null;
  }>(
    ctx.tx,
    "SELECT price_post_id, asset, price::text, posted_at, posted_by, source, oracle_round::text, evidence_key FROM price_posts WHERE $1::text IS NULL OR asset = $1 ORDER BY seq DESC",
    [code],
  );
  return {
    status: 200,
    body: {
      prices: found.map((p) => ({ ...p, price: plainPrice(p.price), posted_at: toInstant(p.posted_at), oracle_round: p.oracle_round === null ? null : Number(p.oracle_round) })),
    },
  };
}

export const marketRoutes: Route[] = [
  { method: "GET", pattern: /^\/api\/pools$/, handler: listPools },
  { method: "GET", pattern: /^\/api\/pools\/([^/]+)$/, handler: showPool },
  { method: "GET", pattern: /^\/api\/assets\/([^/]+)\/risk$/, handler: showRisk },
  { method: "PATCH", pattern: /^\/api\/assets\/([^/]+)\/risk$/, fields: RISK_FIELDS, handler: saveRisk },
  { method: "POST", pattern: /^\/api\/prices$/, fields: ["asset", "price", "confirm_large_move"], handler: postPrice },
  { method: "GET", pattern: /^\/api\/prices$/, handler: listPrices },
];
