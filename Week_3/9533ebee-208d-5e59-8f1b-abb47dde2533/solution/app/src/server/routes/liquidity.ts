import { randomBytes } from "node:crypto";
import { one, type Tx } from "../db.js";
import { fail, FIELD, insufficientLiquidity } from "../errors.js";
import { requireRole, valid, type Ctx, type Reply, type Route } from "../http.js";
import { account, balance, post } from "../ledger.js";
import { parseAmount } from "../money.js";
import { availableLiquidity, poolBalances, sharePrice, sharesForSupply, sharesForWithdrawal, shareValue, type Asset } from "../pools.js";
import { newSettlementId, settle } from "../settlements.js";
import { displayAmount } from "../../shared/format.js";

// Supplying to and withdrawing from an asset's single-sided pool.

function pathAsset(ctx: Ctx): Asset {
  const asset = ctx.market.get(ctx.params[0] ?? "");
  if (!asset) throw fail("not_found");
  return asset;
}

export function walletMessage(held: bigint, asset: Asset): string {
  return `Your wallet holds ${displayAmount(held, asset.decimals)} ${asset.asset}.`;
}

async function holderShares(tx: Tx, actorId: string, asset: string): Promise<bigint> {
  const row = await one<{ shares: string }>(tx, "SELECT shares::text FROM share_holdings WHERE actor_id = $1 AND asset = $2", [actorId, asset]);
  return BigInt(row?.shares ?? "0");
}

async function changeShares(tx: Tx, actorId: string, asset: string, delta: bigint): Promise<void> {
  await tx.query(
    `INSERT INTO share_holdings (actor_id, asset, shares) VALUES ($1, $2, $3)
     ON CONFLICT (actor_id, asset) DO UPDATE SET shares = share_holdings.shares + EXCLUDED.shares`,
    [actorId, asset, delta.toString()],
  );
  await tx.query("UPDATE assets SET total_shares = total_shares + $2 WHERE asset = $1", [asset, delta.toString()]);
}

async function supply(ctx: Ctx): Promise<Reply> {
  const asset = pathAsset(ctx);
  requireRole(ctx.member, "liquidity_provider");
  const amount = parseAmount(ctx.body["amount"]);
  const held = await balance(ctx.tx, account.wallet(ctx.member.actor_id), asset.asset);
  const { supply: pooled } = await poolBalances(ctx.tx, asset.asset);
  const minted = amount === null ? 0n : sharesForSupply(amount, pooled, asset.totalShares);
  const { amount: supplied } = valid(ctx.bodyErrors, {
    amount: [amount !== null && amount <= held && minted > 0n ? amount : null, amount === null ? FIELD.amount : amount > held ? walletMessage(held, asset) : FIELD.tooSmallShares],
  });
  const price = sharePrice(pooled, asset.totalShares);
  const supplyId = `sup-${randomBytes(6).toString("hex")}`;
  const { postingId } = await post(ctx.tx, "supply", supplyId, ctx.now, [
    { account: account.wallet(ctx.member.actor_id), asset: asset.asset, amount: -supplied },
    { account: account.supply, asset: asset.asset, amount: supplied },
  ]);
  await changeShares(ctx.tx, ctx.member.actor_id, asset.asset, minted);
  return {
    status: 201,
    body: { supply_id: supplyId, posting_id: postingId, asset: asset.asset, amount: supplied.toString(), shares_minted: minted.toString(), share_price: price },
  };
}

async function withdraw(ctx: Ctx): Promise<Reply> {
  const asset = pathAsset(ctx);
  requireRole(ctx.member, "liquidity_provider");
  const amount = parseAmount(ctx.body["amount"]);
  const available = await availableLiquidity(ctx.tx, asset);
  if (amount !== null && amount > available) throw insufficientLiquidity(displayAmount(available, asset.decimals), asset.asset);
  const { supply: pooled } = await poolBalances(ctx.tx, asset.asset);
  const shares = await holderShares(ctx.tx, ctx.member.actor_id, asset.asset);
  const value = shareValue(shares, pooled, asset.totalShares);
  const { amount: withdrawn } = valid(ctx.bodyErrors, {
    amount: [amount !== null && amount <= value ? amount : null, amount === null ? FIELD.amount : `Your shares are worth ${displayAmount(value, asset.decimals)} ${asset.asset}.`],
  });
  const burned = sharesForWithdrawal(withdrawn, pooled, asset.totalShares);
  const settlementId = newSettlementId();
  const { legs } = await post(ctx.tx, "withdrawal", settlementId, ctx.now, [
    { account: account.supply, asset: asset.asset, amount: -withdrawn },
    { account: account.wallet(ctx.member.actor_id), asset: asset.asset, amount: withdrawn },
  ]);
  await changeShares(ctx.tx, ctx.member.actor_id, asset.asset, -burned);
  const settlement = await settle(
    ctx,
    { settlementId, kind: "withdrawal", positionId: null, asset: asset.asset, amount: withdrawn, legs },
    { shares_burned: burned.toString(), share_price_after: sharePrice(pooled - withdrawn, asset.totalShares - burned) },
  );
  return { status: 201, body: settlement };
}

export const liquidityRoutes: Route[] = [
  { method: "POST", pattern: /^\/api\/pools\/([^/]+)\/supplies$/, fields: ["amount"], handler: supply },
  { method: "POST", pattern: /^\/api\/pools\/([^/]+)\/withdrawals$/, fields: ["amount"], handler: withdraw, keyed: true },
];
