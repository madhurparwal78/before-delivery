/**
 * Positions: opening one, drawing against it, repaying and changing
 * collateral. Each endpoint applies its state conflicts before its field
 * checks, as the error ladder requires.
 */

import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { query, transaction, writeInstant } from '../db/pool.ts';
import { apiAmount, apiHealthFactor } from '../domain/apiformat.ts';
import { assetScale, isAsset, type Asset } from '../domain/assets.ts';
import { API_FIELD_MESSAGE } from '../domain/copy.ts';
import { formatCanonicalUtc } from '../domain/desktime.ts';
import { healthFactorScaled, passesLoanToValue } from '../domain/position.ts';
import { poolFigures } from '../domain/pool.ts';
import { collateralAccount, loanAccount, walletAccount } from '../ledger/accounts.ts';
import { insertPosting, lockPool, poolBalances, type Leg } from '../ledger/postings.ts';
import { accrueAsset } from '../market/accrual.ts';
import { emitPositionStateChanged } from '../market/events.ts';
import {
  evaluateAndPersist,
  listPositions,
  lockPositionRow,
  nextPositionId,
  previewEvaluation,
  readLockedPosition,
  type PositionRow,
} from '../market/positions.ts';
import { refreshMarket } from '../market/refresh.ts';
import { createSettlement } from '../market/settlements.ts';
import { isStale, loadAssets, type AssetStates } from '../market/state.ts';
import { runKeyed } from '../http/idempotency.ts';
import { insufficientLiquidity, marketStale, positionClosed } from '../http/problem.ts';
import type { Member } from '../http/sessions.ts';
import type { Reply, Request, ResolvedPosition, Route } from '../http/router.ts';
import { finishWith, Validator } from '../http/validate.ts';
import {
  refuseAboveCollateral,
  refuseAboveDebt,
  refuseDrawPastLoanToValue,
  refuseWithdrawalPastLoanToValue,
  requireWalletCovers,
} from './checks.ts';
import { positionDto, positionDtos, settlementDto } from './dto.ts';

/** Locks both of a position's pools, always in the same order, then accrues. */
async function lockAndAccrue(
  client: PoolClient,
  row: { collateralAsset: Asset; debtAsset: Asset },
  nowMs: number,
): Promise<void> {
  for (const asset of [row.collateralAsset, row.debtAsset].sort()) {
    await lockPool(client, asset);
  }
  await accrueAsset(client, row.collateralAsset, nowMs);
  await accrueAsset(client, row.debtAsset, nowMs);
}

function requireOpenMarkets(assets: AssetStates, row: PositionRow, nowMs: number): void {
  if (
    isStale(assets[row.collateralAsset].price, nowMs) ||
    isStale(assets[row.debtAsset].price, nowMs)
  ) {
    throw marketStale();
  }
}

function valuationFor(row: PositionRow, assets: AssetStates, collateral: bigint, debt: bigint) {
  return {
    collateral,
    debt,
    collateralPrice: assets[row.collateralAsset].price.price,
    debtPrice: assets[row.debtAsset].price.price,
    collateralScale: assetScale(row.collateralAsset),
    debtScale: assetScale(row.debtAsset),
  };
}

/** Resets a position's accrual reference to the debt it now carries. */
async function resetAccrualReference(
  client: PoolClient,
  positionId: string,
  debt: bigint,
  debtAsset: Asset,
): Promise<void> {
  await client.query(
    `UPDATE positions SET principal = $1,
            reference_index = (SELECT borrow_index FROM assets WHERE asset = $2)
     WHERE position_id = $3`,
    [debt.toString(), debtAsset, positionId],
  );
}

// ---------------------------------------------------------------------------
// Opening a position
// ---------------------------------------------------------------------------

async function openPosition(request: Request, member: Member): Promise<Reply> {
  const validator = new Validator(request.body, [
    'collateral_asset',
    'debt_asset',
    'collateral_amount',
  ]);
  const collateralAsset = validator.asset('collateral_asset');
  const debtAsset = validator.asset('debt_asset');
  const collateralAmount = validator.amount('collateral_amount');
  if (collateralAsset !== null && debtAsset !== null && collateralAsset === debtAsset) {
    validator.fail('debt_asset', API_FIELD_MESSAGE.samePair);
  }
  const fields = finishWith(validator, { collateralAsset, debtAsset, collateralAmount });

  const body = await transaction(async (client) => {
    await lockAndAccrue(client, fields, request.nowMs);
    await requireWalletCovers(
      client,
      member.actorId,
      fields.collateralAsset,
      fields.collateralAmount,
      'collateral_amount',
    );

    const positionId = await nextPositionId(client);
    await client.query(
      `INSERT INTO positions (position_id, borrower_id, collateral_asset, debt_asset,
                              principal, reference_index, state, grace_ends_at,
                              after_fill_mark, margin_notice_armed, round, event_sequence, created_at)
       VALUES ($1, $2, $3, $4, 0,
               (SELECT borrow_index FROM assets WHERE asset = $4),
               'healthy', NULL, false, true, 0, 0, $5)`,
      [
        positionId,
        member.actorId,
        fields.collateralAsset,
        fields.debtAsset,
        writeInstant(request.nowMs),
      ],
    );

    await insertPosting(client, {
      kind: 'lock',
      ref: positionId,
      createdAtMs: request.nowMs,
      legs: [
        {
          account: walletAccount(member.actorId),
          asset: fields.collateralAsset,
          amount: -fields.collateralAmount,
        },
        {
          account: collateralAccount(positionId),
          asset: fields.collateralAsset,
          amount: fields.collateralAmount,
        },
      ],
    });

    // Opening a position is itself a state change, from no state at all.
    await emitPositionStateChanged(client, {
      positionId,
      from: null,
      to: 'healthy',
      healthFactorScaled: null,
      graceEndsAtMs: null,
      occurredAtMs: request.nowMs,
    });

    const assets = await loadAssets(client);
    const row = await readLockedPosition(client, positionId);
    return positionDto(client, row, assets, request.nowMs);
  });

  return { status: 201, body };
}

// ---------------------------------------------------------------------------
// Reading positions
// ---------------------------------------------------------------------------

async function readPositions(request: Request): Promise<Reply> {
  await refreshMarket(request.nowMs);
  const named = request.search.get('collateral_asset');
  const includeClosed = request.search.get('include_closed') === 'true';
  const assets = await loadAssets({ query });
  const rows = await listPositions(
    { query },
    {
      ...(named !== null && isAsset(named) ? { collateralAsset: named } : {}),
      includeClosed,
    },
  );
  return {
    status: 200,
    body: {
      positions: await positionDtos({ query }, rows, assets, request.nowMs),
      server_time: formatCanonicalUtc(request.nowMs),
    },
  };
}

async function readPosition(
  request: Request,
  _member: Member,
  resolved: ResolvedPosition,
): Promise<Reply> {
  await refreshMarket(request.nowMs);
  const body = await transaction(async (client) => {
    await lockPositionRow(client, resolved.positionId);
    const row = await readLockedPosition(client, resolved.positionId);
    const assets = await loadAssets(client);
    const evaluated = await evaluateAndPersist(client, row, assets, request.nowMs);
    return positionDto(client, evaluated, assets, request.nowMs);
  });
  return { status: 200, body };
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

async function draw(
  request: Request,
  member: Member,
  resolved: ResolvedPosition,
): Promise<Reply> {
  const validator = new Validator(request.body, ['amount']);
  const amount = validator.amount('amount');

  const outcome = await runKeyed(
    member.actorId,
    '/api/positions/:id/draws',
    request.idempotencyKey,
    request.body,
    async (client) => {
      await lockPositionRow(client, resolved.positionId);
      const locked = await readLockedPosition(client, resolved.positionId);
      await lockAndAccrue(client, locked, request.nowMs);
      const fresh = await readLockedPosition(client, resolved.positionId);

      const assets = await loadAssets(client);
      requireOpenMarkets(assets, fresh, request.nowMs);
      if (fresh.state === 'closed') throw positionClosed();

      const figures = poolFigures(await poolBalances(client, fresh.debtAsset));
      if (amount !== null && amount > figures.availableLiquidity) {
        throw insufficientLiquidity(fresh.debtAsset, figures.availableLiquidity);
      }
      const fields = finishWith(validator, { amount });

      const debtAfter = fresh.debt + fields.amount;
      const ltv = assets[fresh.collateralAsset].settings.ltvBps;
      if (!passesLoanToValue(valuationFor(fresh, assets, fresh.collateral, debtAfter), ltv)) {
        refuseDrawPastLoanToValue(ltv);
      }

      const legs: Leg[] = [
        {
          account: loanAccount(fresh.positionId),
          asset: fresh.debtAsset,
          amount: -fields.amount,
        },
        {
          account: walletAccount(member.actorId),
          asset: fresh.debtAsset,
          amount: fields.amount,
        },
      ];
      const postingId = await insertPosting(client, {
        kind: 'draw',
        ref: fresh.positionId,
        createdAtMs: request.nowMs,
        legs,
      });
      await resetAccrualReference(client, fresh.positionId, debtAfter, fresh.debtAsset);

      // The settlement is written before the state change, because
      // settlement.committed is sequenced before position.state_changed.
      const afterLedger = await readLockedPosition(client, fresh.positionId);
      const preview = previewEvaluation(afterLedger, assets, request.nowMs);

      const record = await createSettlement(client, {
        kind: 'draw',
        actorId: member.actorId,
        memberName: member.name,
        positionId: fresh.positionId,
        asset: fresh.debtAsset,
        amount: fields.amount,
        postingId,
        legs,
        createdAtMs: request.nowMs,
        draw: {
          debtAfter: afterLedger.debt,
          healthFactorAfterScaled: preview.healthFactorScaled,
          stateAfter: preview.state,
        },
        withdrawal: null,
        liquidation: null,
      });
      await evaluateAndPersist(client, afterLedger, assets, request.nowMs);

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

// ---------------------------------------------------------------------------
// Repaying
// ---------------------------------------------------------------------------

async function repay(
  request: Request,
  member: Member,
  resolved: ResolvedPosition,
): Promise<Reply> {
  const validator = new Validator(request.body, ['amount']);
  const requested = validator.amountOrAll('amount');

  const body = await transaction(async (client) => {
    await lockPositionRow(client, resolved.positionId);
    const locked = await readLockedPosition(client, resolved.positionId);
    await lockAndAccrue(client, locked, request.nowMs);
    const fresh = await readLockedPosition(client, resolved.positionId);

    if (fresh.state === 'closed') throw positionClosed();
    const fields = finishWith(validator, { requested });

    // "all" repays the debt accrued to the second of the request.
    const amount = fields.requested === 'all' ? fresh.debt : fields.requested;
    if (amount > fresh.debt) refuseAboveDebt(fresh.debtAsset, fresh.debt);
    if (amount === 0n) refuseAboveDebt(fresh.debtAsset, fresh.debt);
    await requireWalletCovers(client, member.actorId, fresh.debtAsset, amount, 'amount');

    const postingId = await insertPosting(client, {
      kind: 'repay',
      ref: fresh.positionId,
      createdAtMs: request.nowMs,
      legs: [
        { account: walletAccount(member.actorId), asset: fresh.debtAsset, amount: -amount },
        { account: loanAccount(fresh.positionId), asset: fresh.debtAsset, amount },
      ],
    });
    await resetAccrualReference(client, fresh.positionId, fresh.debt - amount, fresh.debtAsset);

    const assets = await loadAssets(client);
    const afterLedger = await readLockedPosition(client, fresh.positionId);
    const evaluated = await evaluateAndPersist(client, afterLedger, assets, request.nowMs);
    const health = healthFactorScaled(
      valuationFor(evaluated, assets, evaluated.collateral, evaluated.debt),
      assets[evaluated.collateralAsset].settings.liquidationThresholdBps,
    );

    return {
      repayment_id: randomUUID(),
      posting_id: postingId,
      amount: apiAmount(amount),
      debt_after: apiAmount(evaluated.debt),
      health_factor_after: apiHealthFactor(health),
      state_after: evaluated.state,
    };
  });

  return { status: 201, body };
}

// ---------------------------------------------------------------------------
// Collateral
// ---------------------------------------------------------------------------

async function addCollateral(
  request: Request,
  member: Member,
  resolved: ResolvedPosition,
): Promise<Reply> {
  const validator = new Validator(request.body, ['amount']);
  const amount = validator.amount('amount');

  const body = await transaction(async (client) => {
    await lockPositionRow(client, resolved.positionId);
    const locked = await readLockedPosition(client, resolved.positionId);
    await lockAndAccrue(client, locked, request.nowMs);
    const fresh = await readLockedPosition(client, resolved.positionId);

    if (fresh.state === 'closed') throw positionClosed();
    const fields = finishWith(validator, { amount });
    await requireWalletCovers(
      client,
      member.actorId,
      fresh.collateralAsset,
      fields.amount,
      'amount',
    );

    await insertPosting(client, {
      kind: 'lock',
      ref: fresh.positionId,
      createdAtMs: request.nowMs,
      legs: [
        {
          account: walletAccount(member.actorId),
          asset: fresh.collateralAsset,
          amount: -fields.amount,
        },
        {
          account: collateralAccount(fresh.positionId),
          asset: fresh.collateralAsset,
          amount: fields.amount,
        },
      ],
    });

    const assets = await loadAssets(client);
    const afterLedger = await readLockedPosition(client, fresh.positionId);
    const evaluated = await evaluateAndPersist(client, afterLedger, assets, request.nowMs);
    return positionDto(client, evaluated, assets, request.nowMs);
  });

  return { status: 201, body };
}

async function withdrawCollateral(
  request: Request,
  member: Member,
  resolved: ResolvedPosition,
): Promise<Reply> {
  const validator = new Validator(request.body, ['amount']);
  const amount = validator.amount('amount');

  const body = await transaction(async (client) => {
    await lockPositionRow(client, resolved.positionId);
    const locked = await readLockedPosition(client, resolved.positionId);
    await lockAndAccrue(client, locked, request.nowMs);
    const fresh = await readLockedPosition(client, resolved.positionId);

    const assets = await loadAssets(client);
    requireOpenMarkets(assets, fresh, request.nowMs);
    if (fresh.state === 'closed') throw positionClosed();
    const fields = finishWith(validator, { amount });

    if (fields.amount > fresh.collateral) {
      refuseAboveCollateral(fresh.collateralAsset, fresh.collateral);
    }
    const collateralAfter = fresh.collateral - fields.amount;
    const ltv = assets[fresh.collateralAsset].settings.ltvBps;
    if (
      fresh.debt > 0n &&
      !passesLoanToValue(valuationFor(fresh, assets, collateralAfter, fresh.debt), ltv)
    ) {
      refuseWithdrawalPastLoanToValue(ltv);
    }

    await insertPosting(client, {
      kind: 'release',
      ref: fresh.positionId,
      createdAtMs: request.nowMs,
      legs: [
        {
          account: collateralAccount(fresh.positionId),
          asset: fresh.collateralAsset,
          amount: -fields.amount,
        },
        {
          account: walletAccount(member.actorId),
          asset: fresh.collateralAsset,
          amount: fields.amount,
        },
      ],
    });

    const afterLedger = await readLockedPosition(client, fresh.positionId);
    const evaluated = await evaluateAndPersist(client, afterLedger, assets, request.nowMs);
    return positionDto(client, evaluated, assets, request.nowMs);
  });

  return { status: 201, body };
}

export const positionRoutes: readonly Route[] = [
  {
    kind: 'member',
    method: 'POST',
    pattern: '/api/positions',
    roles: ['borrower'],
    handler: openPosition,
  },
  {
    kind: 'member',
    method: 'GET',
    pattern: '/api/positions',
    handler: (request) => readPositions(request),
  },
  { kind: 'position', method: 'GET', pattern: '/api/positions/:id', handler: readPosition },
  {
    kind: 'position',
    method: 'POST',
    pattern: '/api/positions/:id/draws',
    roles: ['borrower'],
    ownedPosition: true,
    keyed: true,
    handler: draw,
  },
  {
    kind: 'position',
    method: 'POST',
    pattern: '/api/positions/:id/repayments',
    roles: ['borrower'],
    ownedPosition: true,
    handler: repay,
  },
  {
    kind: 'position',
    method: 'POST',
    pattern: '/api/positions/:id/collateral',
    roles: ['borrower'],
    ownedPosition: true,
    handler: addCollateral,
  },
  {
    kind: 'position',
    method: 'POST',
    pattern: '/api/positions/:id/collateral-withdrawals',
    roles: ['borrower'],
    ownedPosition: true,
    handler: withdrawCollateral,
  },
];
