/**
 * Swap previews, firm quotes and swap execution. The fee lands in the pool of
 * the asset the trader pays with, so it raises that pool's share price only.
 */

import { randomUUID } from 'node:crypto';
import { config } from '../config.ts';
import { query, readBig, readInstant, writeInstant } from '../db/pool.ts';
import { apiAmount, apiPrice, parseApiAmount } from '../domain/apiformat.ts';
import { assetScale, isAsset, type Asset } from '../domain/assets.ts';
import { API_FIELD_MESSAGE } from '../domain/copy.ts';
import { formatCanonicalUtc } from '../domain/desktime.ts';
import { poolFigures } from '../domain/pool.ts';
import { quoteFigures } from '../domain/quote.ts';
import { RESERVE, SUPPLY, SWAP, walletAccount } from '../ledger/accounts.ts';
import { insertPosting, lockPool, poolBalances, type Leg } from '../ledger/postings.ts';
import { accrueAsset } from '../market/accrual.ts';
import { refreshMarket } from '../market/refresh.ts';
import { isStale, loadAssets, type AssetStates } from '../market/state.ts';
import { runKeyed } from '../http/idempotency.ts';
import {
  insufficientLiquidity,
  marketStaleSwap,
  notFound,
  quoteExpired,
  quoteUsed,
  validationFailed,
} from '../http/problem.ts';
import type { Member } from '../http/sessions.ts';
import type { Reply, Request, Route } from '../http/router.ts';
import { finishWith, Validator } from '../http/validate.ts';
import { refuseOutputTooSmall, requireWalletCovers } from './checks.ts';

interface SwapPair {
  readonly fromAsset: Asset;
  readonly toAsset: Asset;
  readonly amountIn: bigint;
}

/** Either swap asset being stale pauses previews, quotes and swaps. */
function requireOpenMarkets(assets: AssetStates, pair: SwapPair, nowMs: number): void {
  if (
    isStale(assets[pair.fromAsset].price, nowMs) ||
    isStale(assets[pair.toAsset].price, nowMs)
  ) {
    throw marketStaleSwap();
  }
}

function figuresFor(assets: AssetStates, pair: SwapPair) {
  const from = assets[pair.fromAsset];
  const to = assets[pair.toAsset];
  return quoteFigures({
    amountIn: pair.amountIn,
    swapFeeBps: from.settings.swapFeeBps,
    priceFrom: from.price.price,
    priceTo: to.price.price,
    scaleFrom: assetScale(pair.fromAsset),
    scaleTo: assetScale(pair.toAsset),
    // the fee lands in the pool of the asset paid with
    reserveFactorBps: from.settings.reserveFactorBps,
  });
}

/** The preview uses the query names in its field messages. */
async function previewSwap(request: Request): Promise<Reply> {
  const problems = new Map<string, string>();
  const fromRaw = request.search.get('from_asset');
  const toRaw = request.search.get('to_asset');
  const amountRaw = request.search.get('amount_in');

  const fromAsset = fromRaw !== null && isAsset(fromRaw) ? fromRaw : null;
  if (fromAsset === null) problems.set('from_asset', API_FIELD_MESSAGE.unlistedAsset);
  const toAsset = toRaw !== null && isAsset(toRaw) ? toRaw : null;
  if (toAsset === null) problems.set('to_asset', API_FIELD_MESSAGE.unlistedAsset);
  else if (fromAsset !== null && toAsset === fromAsset) {
    problems.set('to_asset', API_FIELD_MESSAGE.samePair);
  }
  const amountIn = amountRaw === null ? null : parseApiAmount(amountRaw);
  if (amountIn === null) problems.set('amount_in', API_FIELD_MESSAGE.amountUnits);

  if (problems.size > 0) throw validationFailed(Object.fromEntries(problems));
  if (fromAsset === null || toAsset === null || amountIn === null) {
    throw new Error('unreachable: the preview has already answered');
  }

  await refreshMarket(request.nowMs);
  const assets = await loadAssets({ query });
  const pair: SwapPair = { fromAsset, toAsset, amountIn };
  requireOpenMarkets(assets, pair, request.nowMs);

  const figures = figuresFor(assets, pair);
  if (figures.amountOut === 0n) refuseOutputTooSmall('amount_in');

  const outBalances = poolFigures(await poolBalances({ query }, toAsset));
  if (figures.amountOut > outBalances.availableLiquidity) {
    throw insufficientLiquidity(toAsset, outBalances.availableLiquidity);
  }

  return {
    status: 200,
    body: {
      from_asset: fromAsset,
      to_asset: toAsset,
      amount_in: apiAmount(amountIn),
      fee: apiAmount(figures.fee),
      amount_out: apiAmount(figures.amountOut),
      price_from: apiPrice(assets[fromAsset].price.price),
      price_to: apiPrice(assets[toAsset].price.price),
    },
  };
}

async function createQuote(request: Request, member: Member): Promise<Reply> {
  const validator = new Validator(request.body, ['from_asset', 'to_asset', 'amount_in']);
  const fromAsset = validator.asset('from_asset');
  const toAsset = validator.asset('to_asset');
  const amountIn = validator.amount('amount_in');
  if (fromAsset !== null && toAsset !== null && fromAsset === toAsset) {
    validator.fail('to_asset', API_FIELD_MESSAGE.samePair);
  }
  const fields = finishWith(validator, { fromAsset, toAsset, amountIn });

  await refreshMarket(request.nowMs);
  const assets = await loadAssets({ query });
  const pair: SwapPair = {
    fromAsset: fields.fromAsset,
    toAsset: fields.toAsset,
    amountIn: fields.amountIn,
  };
  requireOpenMarkets(assets, pair, request.nowMs);

  await requireWalletCovers(
    { query },
    member.actorId,
    pair.fromAsset,
    pair.amountIn,
    'amount_in',
  );

  const figures = figuresFor(assets, pair);
  if (figures.amountOut === 0n) refuseOutputTooSmall('amount_in');

  const outBalances = poolFigures(await poolBalances({ query }, pair.toAsset));
  if (figures.amountOut > outBalances.availableLiquidity) {
    throw insufficientLiquidity(pair.toAsset, outBalances.availableLiquidity);
  }

  const quoteId = randomUUID();
  const createdAtMs = request.nowMs;
  const expiresAtMs = createdAtMs + config.quoteTtlSeconds * 1000;
  const priceFrom = assets[pair.fromAsset].price.price;
  const priceTo = assets[pair.toAsset].price.price;

  await query(
    `INSERT INTO quotes (quote_id, actor_id, from_asset, to_asset, amount_in, fee,
                         fee_to_supply, fee_to_reserve, amount_out, price_from, price_to,
                         expires_at, used_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL,$13)`,
    [
      quoteId,
      member.actorId,
      pair.fromAsset,
      pair.toAsset,
      pair.amountIn.toString(),
      figures.fee.toString(),
      figures.split.toSupply.toString(),
      figures.split.toReserve.toString(),
      figures.amountOut.toString(),
      priceFrom.toString(),
      priceTo.toString(),
      writeInstant(expiresAtMs),
      writeInstant(createdAtMs),
    ],
  );

  return {
    status: 201,
    body: {
      quote_id: quoteId,
      from_asset: pair.fromAsset,
      to_asset: pair.toAsset,
      amount_in: apiAmount(pair.amountIn),
      fee: apiAmount(figures.fee),
      fee_to_supply: apiAmount(figures.split.toSupply),
      fee_to_reserve: apiAmount(figures.split.toReserve),
      amount_out: apiAmount(figures.amountOut),
      price_from: apiPrice(priceFrom),
      price_to: apiPrice(priceTo),
      expires_at: formatCanonicalUtc(expiresAtMs),
      server_time: formatCanonicalUtc(createdAtMs),
    },
  };
}

interface QuoteRow {
  quote_id: string;
  actor_id: string;
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
  used_at: Date | null;
}

async function executeSwap(request: Request, member: Member): Promise<Reply> {
  const validator = new Validator(request.body, ['quote_id']);
  const fields = finishWith(validator, {
    quoteId: validator.text('quote_id', API_FIELD_MESSAGE.quoteIdRequired),
  });

  const outcome = await runKeyed(
    member.actorId,
    '/api/swaps',
    request.idempotencyKey,
    request.body,
    async (client) => {
      const found = await client.query<QuoteRow>(
        'SELECT * FROM quotes WHERE quote_id = $1 FOR UPDATE',
        [fields.quoteId],
      );
      const quote = found.rows[0];
      // An unknown quote, or one belonging to another trader, is not here.
      if (quote === undefined || quote.actor_id !== member.actorId) throw notFound();

      const fromAsset = quote.from_asset as Asset;
      const toAsset = quote.to_asset as Asset;
      const amountIn = readBig(quote.amount_in);
      const fee = readBig(quote.fee);
      const feeToSupply = readBig(quote.fee_to_supply);
      const feeToReserve = readBig(quote.fee_to_reserve);
      const amountOut = readBig(quote.amount_out);

      // Both pools are locked, always in the same order, before liquidity is read.
      for (const asset of [fromAsset, toAsset].sort()) {
        await lockPool(client, asset);
      }
      await accrueAsset(client, fromAsset, request.nowMs);
      await accrueAsset(client, toAsset, request.nowMs);

      const assets = await loadAssets(client);
      if (
        isStale(assets[fromAsset].price, request.nowMs) ||
        isStale(assets[toAsset].price, request.nowMs)
      ) {
        throw marketStaleSwap();
      }
      if (request.nowMs >= readInstant(quote.expires_at)) throw quoteExpired();
      if (quote.used_at !== null) throw quoteUsed();

      const outBalances = poolFigures(await poolBalances(client, toAsset));
      if (amountOut > outBalances.availableLiquidity) {
        throw insufficientLiquidity(toAsset, outBalances.availableLiquidity);
      }
      await requireWalletCovers(client, member.actorId, fromAsset, amountIn, 'amount_in');

      const legs: Leg[] = [
        { account: walletAccount(member.actorId), asset: fromAsset, amount: -amountIn },
        ...(feeToSupply > 0n
          ? [{ account: SUPPLY, asset: fromAsset, amount: feeToSupply }]
          : []),
        ...(feeToReserve > 0n
          ? [{ account: RESERVE, asset: fromAsset, amount: feeToReserve }]
          : []),
        { account: SWAP, asset: fromAsset, amount: amountIn - fee },
        { account: SWAP, asset: toAsset, amount: -amountOut },
        { account: walletAccount(member.actorId), asset: toAsset, amount: amountOut },
      ];
      const postingId = await insertPosting(client, {
        kind: 'swap',
        ref: quote.quote_id,
        createdAtMs: request.nowMs,
        legs,
      });

      await client.query('UPDATE quotes SET used_at = $1 WHERE quote_id = $2', [
        writeInstant(request.nowMs),
        quote.quote_id,
      ]);

      return {
        status: 201,
        body: {
          swap_id: randomUUID(),
          quote_id: quote.quote_id,
          posting_id: postingId,
          from_asset: fromAsset,
          to_asset: toAsset,
          amount_in: apiAmount(amountIn),
          fee: apiAmount(fee),
          fee_to_supply: apiAmount(feeToSupply),
          fee_to_reserve: apiAmount(feeToReserve),
          amount_out: apiAmount(amountOut),
          price_from: apiPrice(readBig(quote.price_from)),
          price_to: apiPrice(readBig(quote.price_to)),
          legs: legs.map((leg) => ({
            account: leg.account,
            asset: leg.asset,
            amount: apiAmount(leg.amount),
          })),
          created_at: formatCanonicalUtc(request.nowMs),
        },
      };
    },
  );

  return outcome.replayed
    ? {
        status: outcome.status,
        bodyText: outcome.bodyText,
        headers: { 'Idempotency-Replayed': 'true' },
      }
    : { status: outcome.status, bodyText: outcome.bodyText };
}

export const swapRoutes: readonly Route[] = [
  {
    kind: 'member',
    method: 'GET',
    pattern: '/api/swap/preview',
    roles: ['trader'],
    handler: (request) => previewSwap(request),
  },
  {
    kind: 'member',
    method: 'POST',
    pattern: '/api/swap/quotes',
    roles: ['trader'],
    handler: createQuote,
  },
  {
    kind: 'member',
    method: 'POST',
    pattern: '/api/swaps',
    roles: ['trader'],
    keyed: true,
    handler: executeSwap,
  },
];
