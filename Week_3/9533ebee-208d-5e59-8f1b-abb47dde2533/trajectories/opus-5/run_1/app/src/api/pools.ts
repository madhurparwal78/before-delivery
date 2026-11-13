/**
 * Pools, risk parameters, supplies and liquidity withdrawals.
 */

import { createHash, randomUUID } from 'node:crypto';
import { config } from '../config.ts';
import { query, readBig, transaction } from '../db/pool.ts';
import { apiAmount, apiDuration, apiSharePrice } from '../domain/apiformat.ts';
import { ASSET_CODES, type Asset } from '../domain/assets.ts';
import { API_FIELD_MESSAGE } from '../domain/copy.ts';
import { formatCanonicalUtc } from '../domain/desktime.ts';
import {
  poolFigures,
  sharePriceScaled,
  shareValue,
  sharesToBurn,
  sharesToMint,
} from '../domain/pool.ts';
import { SUPPLY, walletAccount } from '../ledger/accounts.ts';
import { insertPosting, lockPool, poolBalances } from '../ledger/postings.ts';
import { accrueAsset } from '../market/accrual.ts';
import { poolDto } from '../market/pools.ts';
import { countBelowHealthFactorOne, evaluateAllOpenPositions } from '../market/positions.ts';
import { refreshMarket } from '../market/refresh.ts';
import { createSettlement } from '../market/settlements.ts';
import { loadAsset, loadAssets } from '../market/state.ts';
import { runKeyed } from '../http/idempotency.ts';
import {
  insufficientLiquidity,
  preconditionFailed,
  preconditionRequired,
} from '../http/problem.ts';
import type { Member } from '../http/sessions.ts';
import type { Reply, Request, Route } from '../http/router.ts';
import { finishWith, Validator } from '../http/validate.ts';
import { refuseAboveShareValue, refuseSupplyTooSmall, requireWalletCovers } from './checks.ts';
import { settlementDto } from './dto.ts';

async function readPools(request: Request): Promise<Reply> {
  await refreshMarket(request.nowMs);
  const assets = await loadAssets({ query });
  const pools: Array<Record<string, unknown>> = [];
  for (const asset of ASSET_CODES) {
    pools.push(await poolDto({ query }, assets[asset], request.nowMs));
  }
  return {
    status: 200,
    body: {
      pools,
      staleness_limit: apiDuration(config.stalenessSeconds),
      grace_period: apiDuration(config.graceSeconds),
      quote_lifetime: apiDuration(config.quoteTtlSeconds),
      desk_time_zone: config.deskTimeZone,
      server_time: formatCanonicalUtc(request.nowMs),
    },
  };
}

async function readPool(request: Request, _member: Member, asset: Asset): Promise<Reply> {
  await refreshMarket(request.nowMs);
  const state = await loadAsset({ query }, asset);
  const dto = await poolDto({ query }, state, request.nowMs);
  return { status: 200, body: { ...dto, server_time: formatCanonicalUtc(request.nowMs) } };
}

// ---------------------------------------------------------------------------
// Risk parameters under conditional requests
// ---------------------------------------------------------------------------

interface RiskParams {
  readonly ltvBps: number;
  readonly liquidationThresholdBps: number;
  readonly liquidationBonusBps: number;
  readonly reserveFactorBps: number;
}

/** A strong validator that changes on every save. */
function riskEtag(asset: Asset, version: bigint): string {
  const digest = createHash('sha256').update(`${asset}:${version.toString()}`).digest('hex');
  return `"${digest.slice(0, 32)}"`;
}

function riskBody(asset: Asset, params: RiskParams): Record<string, unknown> {
  return {
    asset,
    ltv_bps: params.ltvBps,
    liquidation_threshold_bps: params.liquidationThresholdBps,
    liquidation_bonus_bps: params.liquidationBonusBps,
    reserve_factor_bps: params.reserveFactorBps,
  };
}

async function readRisk(_request: Request, _member: Member, asset: Asset): Promise<Reply> {
  const state = await loadAsset({ query }, asset);
  return {
    status: 200,
    body: riskBody(asset, {
      ltvBps: Number(state.settings.ltvBps),
      liquidationThresholdBps: Number(state.settings.liquidationThresholdBps),
      liquidationBonusBps: Number(state.settings.liquidationBonusBps),
      reserveFactorBps: Number(state.settings.reserveFactorBps),
    }),
    headers: { ETag: riskEtag(asset, state.settings.riskVersion) },
  };
}

/**
 * The published bounds. Loan-to-value at or above the liquidation threshold
 * is always reported on `ltv_bps`, and a threshold times one plus the bonus at
 * or above 100% is always reported on `liquidation_bonus_bps`.
 */
function checkRiskBounds(validator: Validator, next: RiskParams): void {
  if (next.liquidationThresholdBps <= 0 || next.liquidationThresholdBps > 9500) {
    validator.fail('liquidation_threshold_bps', API_FIELD_MESSAGE.liquidationThreshold);
  }
  if (next.ltvBps <= 0 || next.ltvBps >= next.liquidationThresholdBps) {
    validator.fail('ltv_bps', API_FIELD_MESSAGE.ltv);
  }
  const thresholdWithBonus =
    BigInt(next.liquidationThresholdBps) * (10000n + BigInt(next.liquidationBonusBps));
  if (
    next.liquidationBonusBps < 0 ||
    next.liquidationBonusBps > 2000 ||
    thresholdWithBonus >= 100000000n
  ) {
    validator.fail('liquidation_bonus_bps', API_FIELD_MESSAGE.liquidationBonus);
  }
  if (next.reserveFactorBps < 0 || next.reserveFactorBps > 5000) {
    validator.fail('reserve_factor_bps', API_FIELD_MESSAGE.reserveFactor);
  }
}

async function saveRisk(request: Request, _member: Member, asset: Asset): Promise<Reply> {
  const ifMatch = request.headers['if-match'];
  if (typeof ifMatch !== 'string' || ifMatch.trim() === '') throw preconditionRequired();

  const validator = new Validator(request.body, [
    'ltv_bps',
    'liquidation_threshold_bps',
    'liquidation_bonus_bps',
    'reserve_factor_bps',
  ]);
  const submitted = {
    ltvBps: validator.optionalBps('ltv_bps', API_FIELD_MESSAGE.ltv),
    liquidationThresholdBps: validator.optionalBps(
      'liquidation_threshold_bps',
      API_FIELD_MESSAGE.liquidationThreshold,
    ),
    liquidationBonusBps: validator.optionalBps(
      'liquidation_bonus_bps',
      API_FIELD_MESSAGE.liquidationBonus,
    ),
    reserveFactorBps: validator.optionalBps(
      'reserve_factor_bps',
      API_FIELD_MESSAGE.reserveFactor,
    ),
  };

  const saved = await transaction(async (client) => {
    const locked = await client.query<{ risk_version: string }>(
      'SELECT risk_version FROM assets WHERE asset = $1 FOR UPDATE',
      [asset],
    );
    const storedVersion = readBig(locked.rows[0]?.risk_version ?? '0');
    if (ifMatch.trim() !== riskEtag(asset, storedVersion)) throw preconditionFailed();

    const current = await loadAsset(client, asset);
    const next: RiskParams = {
      ltvBps: submitted.ltvBps ?? Number(current.settings.ltvBps),
      liquidationThresholdBps:
        submitted.liquidationThresholdBps ?? Number(current.settings.liquidationThresholdBps),
      liquidationBonusBps:
        submitted.liquidationBonusBps ?? Number(current.settings.liquidationBonusBps),
      reserveFactorBps: submitted.reserveFactorBps ?? Number(current.settings.reserveFactorBps),
    };
    checkRiskBounds(validator, next);
    validator.finish();

    const bumped = await client.query<{ risk_version: string }>(
      `UPDATE assets SET ltv_bps = $1, liquidation_threshold_bps = $2,
                         liquidation_bonus_bps = $3, reserve_factor_bps = $4,
                         risk_version = risk_version + 1
       WHERE asset = $5 RETURNING risk_version`,
      [
        next.ltvBps,
        next.liquidationThresholdBps,
        next.liquidationBonusBps,
        next.reserveFactorBps,
        asset,
      ],
    );

    // A save applies at once and re-evaluates every open position.
    const assets = await loadAssets(client);
    const evaluated = await evaluateAllOpenPositions(client, assets, request.nowMs);
    return {
      params: next,
      version: readBig(bumped.rows[0]?.risk_version ?? '0'),
      positionsBelowOne: countBelowHealthFactorOne(evaluated, assets),
    };
  });

  return {
    status: 200,
    body: { ...riskBody(asset, saved.params), positions_below_one: saved.positionsBelowOne },
    headers: { ETag: riskEtag(asset, saved.version) },
  };
}

// ---------------------------------------------------------------------------
// Supplies and withdrawals
// ---------------------------------------------------------------------------

async function supply(request: Request, member: Member, asset: Asset): Promise<Reply> {
  const validator = new Validator(request.body, ['amount']);
  const fields = finishWith(validator, { amount: validator.amount('amount') });

  const body = await transaction(async (client) => {
    await lockPool(client, asset);
    await accrueAsset(client, asset, request.nowMs);
    await requireWalletCovers(client, member.actorId, asset, fields.amount, 'amount');

    const state = await loadAsset(client, asset);
    const balances = await poolBalances(client, asset);
    const minted = sharesToMint(fields.amount, balances.supply, state.settings.totalShares);
    if (minted === 0n) refuseSupplyTooSmall();

    const postingId = await insertPosting(client, {
      kind: 'supply',
      ref: member.actorId,
      createdAtMs: request.nowMs,
      legs: [
        { account: walletAccount(member.actorId), asset, amount: -fields.amount },
        { account: SUPPLY, asset, amount: fields.amount },
      ],
    });

    await client.query(
      `INSERT INTO lp_shares (actor_id, asset, shares) VALUES ($1, $2, $3)
       ON CONFLICT (actor_id, asset) DO UPDATE SET shares = lp_shares.shares + $3`,
      [member.actorId, asset, minted.toString()],
    );
    await client.query('UPDATE assets SET total_shares = total_shares + $1 WHERE asset = $2', [
      minted.toString(),
      asset,
    ]);

    const after = await poolBalances(client, asset);
    return {
      supply_id: randomUUID(),
      posting_id: postingId,
      asset,
      amount: apiAmount(fields.amount),
      shares_minted: apiAmount(minted),
      share_price: apiSharePrice(
        sharePriceScaled(after.supply, state.settings.totalShares + minted),
      ),
    };
  });

  return { status: 201, body };
}

async function withdraw(request: Request, member: Member, asset: Asset): Promise<Reply> {
  const validator = new Validator(request.body, ['amount']);
  const fields = finishWith(validator, { amount: validator.amount('amount') });

  const outcome = await runKeyed(
    member.actorId,
    '/api/pools/:asset/withdrawals',
    request.idempotencyKey,
    request.body,
    async (client) => {
      await lockPool(client, asset);
      await accrueAsset(client, asset, request.nowMs);

      const state = await loadAsset(client, asset);
      const balances = await poolBalances(client, asset);
      const totalShares = state.settings.totalShares;

      const held = await client.query<{ shares: string }>(
        'SELECT shares FROM lp_shares WHERE actor_id = $1 AND asset = $2',
        [member.actorId, asset],
      );
      const shares = readBig(held.rows[0]?.shares ?? '0');
      const value = shareValue(shares, balances.supply, totalShares);
      if (fields.amount > value) refuseAboveShareValue(asset, value);

      const figures = poolFigures(balances);
      if (fields.amount > figures.availableLiquidity) {
        throw insufficientLiquidity(asset, figures.availableLiquidity);
      }

      const burned = sharesToBurn(fields.amount, balances.supply, totalShares);
      const legs = [
        { account: SUPPLY, asset, amount: -fields.amount },
        { account: walletAccount(member.actorId), asset, amount: fields.amount },
      ];
      const postingId = await insertPosting(client, {
        kind: 'withdrawal',
        ref: member.actorId,
        createdAtMs: request.nowMs,
        legs,
      });

      await client.query(
        'UPDATE lp_shares SET shares = shares - $1 WHERE actor_id = $2 AND asset = $3',
        [burned.toString(), member.actorId, asset],
      );
      await client.query(
        'UPDATE assets SET total_shares = total_shares - $1 WHERE asset = $2',
        [burned.toString(), asset],
      );

      const after = await poolBalances(client, asset);
      const record = await createSettlement(client, {
        kind: 'withdrawal',
        actorId: member.actorId,
        memberName: member.name,
        positionId: null,
        asset,
        amount: fields.amount,
        postingId,
        legs,
        createdAtMs: request.nowMs,
        draw: null,
        withdrawal: {
          sharesBurned: burned,
          sharePriceAfterScaled: sharePriceScaled(after.supply, totalShares - burned),
        },
        liquidation: null,
      });

      return { status: 201, body: await settlementDto(client, record) };
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

export const poolRoutes: readonly Route[] = [
  { kind: 'member', method: 'GET', pattern: '/api/pools', handler: readPools },
  { kind: 'asset', method: 'GET', pattern: '/api/pools/:asset', handler: readPool },
  { kind: 'asset', method: 'GET', pattern: '/api/assets/:asset/risk', handler: readRisk },
  {
    kind: 'asset',
    method: 'PATCH',
    pattern: '/api/assets/:asset/risk',
    roles: ['risk_steward'],
    handler: saveRisk,
  },
  {
    kind: 'asset',
    method: 'POST',
    pattern: '/api/pools/:asset/supplies',
    roles: ['liquidity_provider'],
    handler: supply,
  },
  {
    kind: 'asset',
    method: 'POST',
    pattern: '/api/pools/:asset/withdrawals',
    roles: ['liquidity_provider'],
    keyed: true,
    handler: withdraw,
  },
];
