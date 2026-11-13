import { randomBytes } from "node:crypto";
import { config } from "../config.js";
import { one } from "../db.js";
import { fail, FIELD, insufficientLiquidity, validation } from "../errors.js";
import { requireRole, valid, type Ctx, type Reply, type Route } from "../http.js";
import { account, balance, legJson, post } from "../ledger.js";
import { BPS, ceilDiv, parseAmount, pow10, reserveShare } from "../money.js";
import { assetOf, availableLiquidity, requireFreshForSwaps, type Asset } from "../pools.js";
import { toInstant } from "../time.js";
import { walletMessage } from "./liquidity.js";
import { displayAmount, plainPrice } from "../../shared/format.js";

// Swap previews, firm quotes and swap execution at the posted prices less the pool fee.

interface Terms {
  from: Asset;
  to: Asset;
  amountIn: bigint;
  fee: bigint;
  feeToSupply: bigint;
  feeToReserve: bigint;
  amountOut: bigint;
}

/** The quote formula: fee rounded up and split by largest remainder, output rounded down, at the posted prices. */
function quote(from: Asset, to: Asset, amountIn: bigint): Terms {
  const fee = ceilDiv(amountIn * BigInt(from.swapFeeBps), BPS);
  const feeToReserve = reserveShare(fee, from.reserveFactorBps);
  const amountOut = ((amountIn - fee) * from.price * pow10(to.decimals)) / (to.price * pow10(from.decimals));
  return { from, to, amountIn, fee, feeToSupply: fee - feeToReserve, feeToReserve, amountOut };
}

/**
 * Validates a swap request in the published order (state conflicts before field checks) and prices it.
 * `wallet` adds the wallet check that quotes make and previews do not.
 */
async function price(ctx: Ctx, input: { from: unknown; to: unknown; amountIn: unknown }, wallet: boolean): Promise<Terms> {
  const from = typeof input.from === "string" ? ctx.market.get(input.from) : undefined;
  const to = typeof input.to === "string" ? ctx.market.get(input.to) : undefined;
  const amountIn = parseAmount(input.amountIn);
  const samePair = from !== undefined && to !== undefined && from.asset === to.asset;
  if (from && to && !samePair) requireFreshForSwaps(ctx.now, from, to);
  const terms = from && to && !samePair && amountIn !== null ? quote(from, to, amountIn) : null;
  if (terms) {
    const available = await availableLiquidity(ctx.tx, terms.to);
    if (terms.amountOut > available) throw insufficientLiquidity(displayAmount(available, terms.to.decimals), terms.to.asset);
  }
  const held = wallet && from ? await balance(ctx.tx, account.wallet(ctx.member.actor_id), from.asset) : null;
  const amountMessage =
    amountIn === null ? FIELD.amount : held !== null && from && amountIn > held ? walletMessage(held, from) : terms?.amountOut === 0n ? FIELD.tooSmallOut : null;
  const checked = valid(ctx.bodyErrors, {
    amount_in: [amountMessage === null ? terms : null, amountMessage ?? FIELD.amount],
    from_asset: [from, FIELD.asset],
    to_asset: [to && !samePair ? to : null, to ? FIELD.pair : FIELD.asset],
  });
  return checked.amount_in;
}

function termsJson(terms: Terms) {
  return {
    from_asset: terms.from.asset,
    to_asset: terms.to.asset,
    amount_in: terms.amountIn.toString(),
    fee: terms.fee.toString(),
    amount_out: terms.amountOut.toString(),
    price_from: plainPrice(terms.from.price),
    price_to: plainPrice(terms.to.price),
  };
}

async function preview(ctx: Ctx): Promise<Reply> {
  requireRole(ctx.member, "trader");
  const terms = await price(ctx, { from: ctx.query.get("from_asset"), to: ctx.query.get("to_asset"), amountIn: ctx.query.get("amount_in") }, false);
  return { status: 200, body: termsJson(terms) };
}

async function createQuote(ctx: Ctx): Promise<Reply> {
  requireRole(ctx.member, "trader");
  const terms = await price(ctx, { from: ctx.body["from_asset"], to: ctx.body["to_asset"], amountIn: ctx.body["amount_in"] }, true);
  const quoteId = `qte-${randomBytes(8).toString("hex")}`;
  const expiresAt = new Date(ctx.now.getTime() + config.quoteTtlSeconds * 1000);
  await ctx.tx.query(
    `INSERT INTO quotes (quote_id, trader_id, from_asset, to_asset, amount_in, fee, fee_to_supply, fee_to_reserve, amount_out, price_from, price_to, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [quoteId, ctx.member.actor_id, terms.from.asset, terms.to.asset, terms.amountIn.toString(), terms.fee.toString(), terms.feeToSupply.toString(),
      terms.feeToReserve.toString(), terms.amountOut.toString(), terms.from.price.toString(), terms.to.price.toString(), ctx.now, expiresAt],
  );
  return {
    status: 201,
    body: {
      quote_id: quoteId,
      ...termsJson(terms),
      fee_to_supply: terms.feeToSupply.toString(),
      fee_to_reserve: terms.feeToReserve.toString(),
      expires_at: toInstant(expiresAt),
      server_time: toInstant(ctx.now),
    },
  };
}

interface QuoteRow {
  quote_id: string;
  trader_id: string;
  from_asset: string;
  to_asset: string;
  amount_in: string;
  fee: string;
  fee_to_supply: string;
  fee_to_reserve: string;
  amount_out: string;
  price_from: string;
  price_to: string;
  expires_at: Date;
  swap_id: string | null;
}

async function executeSwap(ctx: Ctx): Promise<Reply> {
  const quoteId = ctx.body["quote_id"];
  const found =
    typeof quoteId === "string"
      ? await one<QuoteRow>(
          ctx.tx,
          `SELECT quote_id, trader_id, from_asset, to_asset, amount_in::text, fee::text, fee_to_supply::text, fee_to_reserve::text,
                  amount_out::text, price_from::text, price_to::text, expires_at, swap_id FROM quotes WHERE quote_id = $1`,
          [quoteId],
        )
      : undefined;
  if (typeof quoteId === "string" && !found) throw fail("not_found");
  if (!found) throw validation({ ...ctx.bodyErrors, quote_id: FIELD.quoteId });
  requireRole(ctx.member, "trader");
  if (found.trader_id !== ctx.member.actor_id) throw fail("forbidden");
  const from = assetOf(ctx.market, found.from_asset);
  const to = assetOf(ctx.market, found.to_asset);
  requireFreshForSwaps(ctx.now, from, to);
  if (found.swap_id !== null) throw fail("quote_used");
  if (ctx.now >= found.expires_at) throw fail("quote_expired");
  // Executing honours the quote's own prices and amounts.
  const amountIn = BigInt(found.amount_in);
  const fee = BigInt(found.fee);
  const amountOut = BigInt(found.amount_out);
  const available = await availableLiquidity(ctx.tx, to);
  if (amountOut > available) throw insufficientLiquidity(displayAmount(available, to.decimals), to.asset);
  const held = await balance(ctx.tx, account.wallet(ctx.member.actor_id), from.asset);
  valid(ctx.bodyErrors, { amount_in: [amountIn <= held ? amountIn : null, walletMessage(held, from)] });

  const swapId = `swp-${randomBytes(8).toString("hex")}`;
  const trader = account.wallet(ctx.member.actor_id);
  const { postingId, legs } = await post(ctx.tx, "swap", swapId, ctx.now, [
    { account: trader, asset: from.asset, amount: -amountIn },
    { account: account.supply, asset: from.asset, amount: BigInt(found.fee_to_supply) },
    { account: account.reserve, asset: from.asset, amount: BigInt(found.fee_to_reserve) },
    { account: account.swap, asset: from.asset, amount: amountIn - fee },
    { account: account.swap, asset: to.asset, amount: -amountOut },
    { account: trader, asset: to.asset, amount: amountOut },
  ]);
  await ctx.tx.query("UPDATE quotes SET swap_id = $2 WHERE quote_id = $1", [found.quote_id, swapId]);
  return {
    status: 201,
    body: {
      swap_id: swapId,
      quote_id: found.quote_id,
      posting_id: postingId,
      from_asset: from.asset,
      to_asset: to.asset,
      amount_in: found.amount_in,
      fee: found.fee,
      fee_to_supply: found.fee_to_supply,
      fee_to_reserve: found.fee_to_reserve,
      amount_out: found.amount_out,
      price_from: plainPrice(found.price_from),
      price_to: plainPrice(found.price_to),
      legs: legs.map(legJson),
      created_at: toInstant(ctx.now),
    },
  };
}

export const swapRoutes: Route[] = [
  { method: "GET", pattern: /^\/api\/swap\/preview$/, handler: preview },
  { method: "POST", pattern: /^\/api\/swap\/quotes$/, fields: ["from_asset", "to_asset", "amount_in"], handler: createQuote },
  { method: "POST", pattern: /^\/api\/swaps$/, fields: ["quote_id"], handler: executeSwap, keyed: true },
];
