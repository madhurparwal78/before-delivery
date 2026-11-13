/**
 * The liquidation queue and liquidation fills. Of two or more fills submitted
 * at once for one position and round, exactly one fills: the position's row
 * lock serialises them and the round they carry tells the losers apart.
 */

import { query } from '../db/pool.ts';
import { assetScale, type Asset } from '../domain/assets.ts';
import { API_FIELD_MESSAGE } from '../domain/copy.ts';
import { formatCanonicalUtc } from '../domain/desktime.ts';
import {
  bonusPortion,
  coverFromCollateral,
  healthFactorScaled,
  isLiquidatable,
  maxRepay as maxRepayOf,
  seizedForRepay,
  type PositionValuation,
} from '../domain/position.ts';
import { SUPPLY, collateralAccount, loanAccount, walletAccount } from '../ledger/accounts.ts';
import { insertPosting, lockPool, type Leg } from '../ledger/postings.ts';
import { accrueAsset } from '../market/accrual.ts';
import { queueLiquidationNotice } from '../market/notices.ts';
import {
  borrowerEmail,
  evaluateAndPersist,
  listOpenPositions,
  lockPositionRow,
  positionFigures,
  previewEvaluation,
  readLockedPosition,
} from '../market/positions.ts';
import { refreshMarket } from '../market/refresh.ts';
import { createSettlement } from '../market/settlements.ts';
import { isStale, loadAssets } from '../market/state.ts';
import { runKeyed } from '../http/idempotency.ts';
import {
  alreadyLiquidated,
  inGrace,
  marketStale,
  notLiquidatable,
  positionClosed,
} from '../http/problem.ts';
import type { Member } from '../http/sessions.ts';
import type { Reply, Request, ResolvedPosition, Route } from '../http/router.ts';
import { finishWith, Validator } from '../http/validate.ts';
import { refuseAboveMaxRepay, requireWalletCovers } from './checks.ts';
import { positionDtos, settlementDto } from './dto.ts';

/** Every position below health factor 1, lowest first. */
async function readQueue(request: Request): Promise<Reply> {
  await refreshMarket(request.nowMs);
  const assets = await loadAssets({ query });
  const rows = await listOpenPositions({ query });
  const ranked = rows
    .map((row) => ({ row, figures: positionFigures(row, assets) }))
    .filter(
      (entry) =>
        entry.figures.healthFactorScaled !== null && entry.figures.healthFactorScaled < 10000n,
    )
    .sort((left, right) => {
      const a = left.figures.healthFactorScaled ?? 0n;
      const b = right.figures.healthFactorScaled ?? 0n;
      if (a === b) return left.row.positionId < right.row.positionId ? -1 : 1;
      return a < b ? -1 : 1;
    });

  return {
    status: 200,
    body: {
      positions: await positionDtos(
        { query },
        ranked.map((entry) => entry.row),
        assets,
        request.nowMs,
      ),
      server_time: formatCanonicalUtc(request.nowMs),
    },
  };
}

interface FillOutcome {
  readonly seized: bigint;
  readonly writtenOff: bigint;
  readonly releasedToBorrower: bigint;
}

/**
 * What a fill seizes, writes off and releases.
 *
 * When the collateral cover is below the close-factor cap and the liquidator
 * repays exactly the max repay, the fill takes all remaining collateral,
 * writes the rest of the debt off against the liquidity providers and closes
 * the position. Otherwise a fill that clears the debt releases what is left
 * of the collateral to the borrower.
 */
function fillOutcome(
  repaid: bigint,
  valuation: PositionValuation,
  bonusBps: bigint,
  closeFactorCap: bigint,
  cover: bigint,
): FillOutcome {
  if (cover < closeFactorCap && repaid === cover) {
    return {
      seized: valuation.collateral,
      writtenOff: valuation.debt - repaid,
      releasedToBorrower: 0n,
    };
  }
  const seized = seizedForRepay(repaid, valuation, bonusBps);
  const debtAfter = valuation.debt - repaid;
  if (debtAfter === 0n) {
    return {
      seized,
      writtenOff: 0n,
      releasedToBorrower: valuation.collateral - seized,
    };
  }
  return { seized, writtenOff: 0n, releasedToBorrower: 0n };
}

async function liquidate(
  request: Request,
  member: Member,
  resolved: ResolvedPosition,
): Promise<Reply> {
  const validator = new Validator(request.body, ['repay_amount', 'round']);
  const repayAmount = validator.amount('repay_amount');
  const round = validator.wholeNumber('round', API_FIELD_MESSAGE.roundRequired);

  const outcome = await runKeyed(
    member.actorId,
    '/api/positions/:id/liquidations',
    request.idempotencyKey,
    request.body,
    async (client) => {
      await lockPositionRow(client, resolved.positionId);
      const locked = await readLockedPosition(client, resolved.positionId);
      for (const asset of [locked.collateralAsset, locked.debtAsset].sort()) {
        await lockPool(client, asset);
      }
      await accrueAsset(client, locked.collateralAsset, request.nowMs);
      await accrueAsset(client, locked.debtAsset, request.nowMs);

      const position = await readLockedPosition(client, resolved.positionId);
      const assets = await loadAssets(client);

      if (
        isStale(assets[position.collateralAsset].price, request.nowMs) ||
        isStale(assets[position.debtAsset].price, request.nowMs)
      ) {
        throw marketStale();
      }
      // The round decides the contest, ahead of every other state conflict, so
      // a submission whose winner closed the position still reads as already
      // liquidated.
      if (round !== null && round !== position.round) throw alreadyLiquidated();
      if (position.state === 'closed') throw positionClosed();
      if (position.state === 'liquidatable_grace') throw inGrace();
      if (!isLiquidatable(position.state)) throw notLiquidatable();

      const collateralSettings = assets[position.collateralAsset].settings;
      const priceCollateral = assets[position.collateralAsset].price.price;
      const priceDebt = assets[position.debtAsset].price.price;
      const valuation: PositionValuation = {
        collateral: position.collateral,
        debt: position.debt,
        collateralPrice: priceCollateral,
        debtPrice: priceDebt,
        collateralScale: assetScale(position.collateralAsset),
        debtScale: assetScale(position.debtAsset),
      };
      const bonusBps = collateralSettings.liquidationBonusBps;
      const thresholdBps = collateralSettings.liquidationThresholdBps;
      const maxRepay = maxRepayOf(valuation, bonusBps);

      if (repayAmount !== null && repayAmount > maxRepay) {
        refuseAboveMaxRepay(position.debtAsset, maxRepay);
      }
      const fields = finishWith(validator, { repayAmount, round });
      await requireWalletCovers(
        client,
        member.actorId,
        position.debtAsset,
        fields.repayAmount,
        'repay_amount',
      );

      const healthBefore = healthFactorScaled(valuation, thresholdBps);
      const closeFactorCap = (valuation.debt * collateralSettings.closeFactorBps) / 10000n;
      const cover = coverFromCollateral(valuation, bonusBps);
      const fill = fillOutcome(fields.repayAmount, valuation, bonusBps, closeFactorCap, cover);
      const bonusAmount = bonusPortion(fields.repayAmount, fill.seized, valuation);

      const debtAsset: Asset = position.debtAsset;
      const collateralAsset: Asset = position.collateralAsset;
      const legs: Leg[] = [
        {
          account: walletAccount(member.actorId),
          asset: debtAsset,
          amount: -fields.repayAmount,
        },
        {
          account: loanAccount(position.positionId),
          asset: debtAsset,
          amount: fields.repayAmount,
        },
        {
          account: collateralAccount(position.positionId),
          asset: collateralAsset,
          amount: -fill.seized,
        },
        { account: walletAccount(member.actorId), asset: collateralAsset, amount: fill.seized },
      ];
      if (fill.writtenOff > 0n) {
        legs.push(
          {
            account: loanAccount(position.positionId),
            asset: debtAsset,
            amount: fill.writtenOff,
          },
          { account: SUPPLY, asset: debtAsset, amount: -fill.writtenOff },
        );
      }
      if (fill.releasedToBorrower > 0n) {
        legs.push(
          {
            account: collateralAccount(position.positionId),
            asset: collateralAsset,
            amount: -fill.releasedToBorrower,
          },
          {
            account: walletAccount(position.borrowerId),
            asset: collateralAsset,
            amount: fill.releasedToBorrower,
          },
        );
      }

      const postingId = await insertPosting(client, {
        kind: 'liquidation',
        ref: position.positionId,
        createdAtMs: request.nowMs,
        legs,
      });

      const debtAfter = position.debt - fields.repayAmount - fill.writtenOff;
      const nextRound = position.round + 1;
      await client.query(
        `UPDATE positions SET round = $1, principal = $2,
                reference_index = (SELECT borrow_index FROM assets WHERE asset = $3)
         WHERE position_id = $4`,
        [nextRound, debtAfter.toString(), debtAsset, position.positionId],
      );

      const afterLedger = await readLockedPosition(client, position.positionId);
      const healthAfter = healthFactorScaled(
        {
          ...valuation,
          collateral: afterLedger.collateral,
          debt: afterLedger.debt,
        },
        thresholdBps,
      );
      // A fill that leaves the health factor below 1 sets the after-fill mark.
      const marked = healthAfter !== null && healthAfter < 10000n;
      if (marked) {
        await client.query(
          'UPDATE positions SET after_fill_mark = true WHERE position_id = $1',
          [position.positionId],
        );
      }

      const markedRow = await readLockedPosition(client, position.positionId);
      const preview = previewEvaluation(markedRow, assets, request.nowMs);

      const record = await createSettlement(client, {
        kind: 'liquidation',
        actorId: member.actorId,
        memberName: member.name,
        positionId: position.positionId,
        asset: debtAsset,
        amount: fields.repayAmount,
        postingId,
        legs,
        createdAtMs: request.nowMs,
        draw: null,
        withdrawal: null,
        liquidation: {
          round: nextRound,
          borrowerId: position.borrowerId,
          repaid: fields.repayAmount,
          debtAsset,
          seized: fill.seized,
          collateralAsset,
          bonusAmount,
          writtenOff: fill.writtenOff,
          healthFactorBeforeScaled: healthBefore,
          healthFactorAfterScaled: healthAfter,
          stateAfter: preview.state,
          priceCollateral,
          priceDebt,
        },
      });

      await queueLiquidationNotice(client, {
        positionId: position.positionId,
        recipient: await borrowerEmail(client, position.borrowerId),
        round: nextRound,
        repaid: fields.repayAmount,
        debtAsset,
        seized: fill.seized,
        bonusAmount,
        collateralAsset,
        healthFactorAfterScaled: healthAfter,
        settlementId: record.settlementId,
        createdAtMs: request.nowMs,
      });

      await evaluateAndPersist(client, markedRow, assets, request.nowMs);

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

export const liquidationRoutes: readonly Route[] = [
  {
    kind: 'member',
    method: 'GET',
    pattern: '/api/liquidations/queue',
    roles: ['liquidator', 'risk_steward'],
    handler: (request) => readQueue(request),
  },
  {
    kind: 'position',
    method: 'POST',
    pattern: '/api/positions/:id/liquidations',
    roles: ['liquidator'],
    keyed: true,
    handler: liquidate,
  },
];
