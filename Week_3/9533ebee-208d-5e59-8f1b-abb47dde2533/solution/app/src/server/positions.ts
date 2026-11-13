import { config } from "./config.js";
import { one, rows, type Tx } from "./db.js";
import { fail } from "./errors.js";
import { emit } from "./events.js";
import { account, postAll, type PostingDraft } from "./ledger.js";
import { BPS, ceilDiv, fixedText, reserveShare } from "./money.js";
import { queueMarginNotice, noticesByPosition, type NoticeJson } from "./notices.js";
import { toInstant } from "./time.js";
import { assetOf, borrowRate, loadMarket, poolBalances, poolFigures, type Market } from "./pools.js";
import { fillLimit, healthFactor, liquidationPrice, type Exposure } from "./risk.js";
import { plainPrice } from "../shared/format.js";

export type PositionState = "healthy" | "warned" | "liquidatable_grace" | "liquidatable" | "partially_liquidated" | "closed";

export interface Position {
  positionId: string;
  borrowerId: string;
  collateralAsset: string;
  debtAsset: string;
  state: PositionState;
  graceEndsAt: Date | null;
  afterFill: boolean;
  marginArmed: boolean;
  round: number;
  /** The debt and the borrow index it was last reset at (a draw, a repayment or a fill). */
  principal: bigint;
  referenceIndex: bigint;
  createdAt: Date;
  collateral: bigint;
  debt: bigint;
}

interface PositionRow {
  position_id: string;
  borrower_id: string;
  collateral_asset: string;
  debt_asset: string;
  state: PositionState;
  grace_ends_at: Date | null;
  after_fill: boolean;
  margin_armed: boolean;
  round: number;
  principal: string;
  reference_index: string;
  created_at: Date;
  collateral: string;
  debt: string;
}

const SELECT = `
  SELECT p.position_id, p.borrower_id, p.collateral_asset, p.debt_asset, p.state, p.grace_ends_at, p.after_fill,
         p.margin_armed, p.round, p.principal::text, p.reference_index::text, p.created_at,
         COALESCE(c.balance, 0)::text AS collateral, (-COALESCE(l.balance, 0))::text AS debt
  FROM positions p
  LEFT JOIN account_balances c ON c.account = 'collateral:' || p.position_id AND c.asset = p.collateral_asset
  LEFT JOIN account_balances l ON l.account = 'loan:' || p.position_id AND l.asset = p.debt_asset`;

function fromRow(row: PositionRow): Position {
  return {
    positionId: row.position_id,
    borrowerId: row.borrower_id,
    collateralAsset: row.collateral_asset,
    debtAsset: row.debt_asset,
    state: row.state,
    graceEndsAt: row.grace_ends_at,
    afterFill: row.after_fill,
    marginArmed: row.margin_armed,
    round: row.round,
    principal: BigInt(row.principal),
    referenceIndex: BigInt(row.reference_index),
    createdAt: row.created_at,
    collateral: BigInt(row.collateral),
    debt: BigInt(row.debt),
  };
}

export async function findPosition(tx: Tx, positionId: string): Promise<Position> {
  const row = await one<PositionRow>(tx, `${SELECT} WHERE p.position_id = $1`, [positionId]);
  if (!row) throw fail("not_found");
  return fromRow(row);
}

export async function listPositions(tx: Tx, filter: { collateralAsset?: string; includeClosed?: boolean; borrowerId?: string } = {}): Promise<Position[]> {
  const found = await rows<PositionRow>(
    tx,
    `${SELECT} WHERE ($1::text IS NULL OR p.collateral_asset = $1) AND ($2 OR p.state <> 'closed')
       AND ($3::text IS NULL OR p.borrower_id = $3) ORDER BY p.seq`,
    [filter.collateralAsset ?? null, filter.includeClosed ?? false, filter.borrowerId ?? null],
  );
  return found.map(fromRow);
}

export function exposureOf(position: Position, market: Market): Exposure {
  return {
    collateral: position.collateral,
    debt: position.debt,
    collateralAsset: assetOf(market, position.collateralAsset),
    debtAsset: assetOf(market, position.debtAsset),
  };
}

// ---- the position state machine: the server alone decides every move ----

interface Decision {
  state: PositionState;
  graceEndsAt: Date | null;
  afterFill: boolean;
  marginArmed: boolean;
  queueMargin: boolean;
}

/** The published rules, applied in order. `position.afterFill` is the mark a fill leaves behind. */
function decide(position: Position, hf: bigint | null, warningBps: bigint, now: Date): Decision {
  if (position.collateral === 0n && position.debt === 0n) {
    return { state: "closed", graceEndsAt: null, afterFill: false, marginArmed: false, queueMargin: false };
  }
  if (hf === null || hf >= warningBps) {
    return { state: "healthy", graceEndsAt: null, afterFill: false, marginArmed: true, queueMargin: false };
  }
  const queueMargin = position.marginArmed;
  if (hf >= BPS) {
    return { state: "warned", graceEndsAt: null, afterFill: false, marginArmed: false, queueMargin };
  }
  const started = position.graceEndsAt === null && !position.afterFill;
  const graceEndsAt = started ? new Date(now.getTime() + config.graceSeconds * 1000) : position.graceEndsAt;
  const state: PositionState =
    graceEndsAt !== null && now < graceEndsAt ? "liquidatable_grace" : position.afterFill ? "partially_liquidated" : "liquidatable";
  return { state, graceEndsAt, afterFill: position.afterFill, marginArmed: false, queueMargin };
}

interface Assessment {
  before: Position;
  after: Position;
  hf: bigint | null;
  queueMargin: boolean;
}

/**
 * What one open position becomes against the current prices and parameters, without writing it. `fillJustMade`
 * marks an evaluation made by a liquidation fill, which leaves its mark when the health factor stays below 1.
 */
export function assess(position: Position, market: Market, now: Date, fillJustMade = false): Assessment {
  if (position.state === "closed") return { before: position, after: position, hf: null, queueMargin: false };
  const exposure = exposureOf(position, market);
  const hf = healthFactor(exposure);
  const marked = { ...position, afterFill: position.afterFill || (fillJustMade && hf !== null && hf < BPS) };
  const decision = decide(marked, hf, BigInt(exposure.collateralAsset.warningHealthFactorBps), now);
  const { queueMargin, ...settled } = decision;
  return { before: position, after: { ...position, ...settled }, hf, queueMargin };
}

/** Announces a position state change to integrators; `from` is null for a position that was just opened. */
export async function announceStateChange(
  tx: Tx,
  positionId: string,
  change: { from: PositionState | null; to: PositionState; hf: bigint | null; graceEndsAt: Date | null; at: Date },
): Promise<void> {
  await emit(tx, {
    type: "position.state_changed",
    positionId,
    occurredAt: change.at,
    data: {
      from: change.from,
      to: change.to,
      health_factor: change.hf === null ? null : fixedText(change.hf, 4),
      grace_ends_at: change.to === "liquidatable_grace" && change.graceEndsAt ? toInstant(change.graceEndsAt) : null,
    },
  });
}

/** Writes an assessed move, announces a state change and queues the margin notice when it is armed. */
export async function commit(tx: Tx, market: Market, now: Date, { before, after, hf, queueMargin }: Assessment): Promise<Position> {
  const changed =
    after.state !== before.state ||
    after.graceEndsAt?.getTime() !== before.graceEndsAt?.getTime() ||
    after.afterFill !== before.afterFill ||
    after.marginArmed !== before.marginArmed;
  if (changed) {
    await tx.query("UPDATE positions SET state = $2, grace_ends_at = $3, after_fill = $4, margin_armed = $5 WHERE position_id = $1", [
      after.positionId,
      after.state,
      after.graceEndsAt,
      after.afterFill,
      after.marginArmed,
    ]);
  }
  if (after.state !== before.state) {
    // A grace that ran out is announced at the instant it ended, not when the server noticed.
    const expired = before.state === "liquidatable_grace" && before.graceEndsAt !== null && before.graceEndsAt <= now;
    await announceStateChange(tx, after.positionId, { from: before.state, to: after.state, hf, graceEndsAt: after.graceEndsAt, at: expired ? (before.graceEndsAt ?? now) : now });
  }
  if (queueMargin && hf !== null) await queueMarginNotice(tx, after, exposureOf(after, market), hf, now);
  return after;
}

/** Re-evaluates one position and writes the result. */
export function evaluate(tx: Tx, market: Market, now: Date, position: Position, fillJustMade = false): Promise<Position> {
  return commit(tx, market, now, assess(position, market, now, fillJustMade));
}

/** Resets a position's debt basis to its current debt and the asset's current borrow index. */
export async function resetDebtBasis(tx: Tx, market: Market, positionId: string, debtAsset: string, debt: bigint): Promise<void> {
  await tx.query("UPDATE positions SET principal = $2, reference_index = $3 WHERE position_id = $1", [positionId, debt.toString(), assetOf(market, debtAsset).borrowIndex.toString()]);
}

// ---- interest: per-second accrual along each asset's curve ----

const SECONDS_PER_YEAR = 31_536_000n;

/** Brings every asset's borrow index and every position's debt forward to the current whole second. */
async function bringForward(tx: Tx, market: Market, now: Date): Promise<void> {
  const second = BigInt(Math.floor(now.getTime() / 1000));
  for (const asset of market.values()) {
    if (asset.indexSecond >= second) continue;
    const rate = BigInt(borrowRate(asset, poolFigures(asset, await poolBalances(tx, asset.asset)).utilizationBps));
    const elapsed = second - asset.indexSecond;
    const index = asset.borrowIndex + (asset.borrowIndex * rate * elapsed) / (BPS * SECONDS_PER_YEAR);
    await tx.query("UPDATE assets SET borrow_index = $2, index_second = $3 WHERE asset = $1", [asset.asset, index.toString(), second.toString()]);
    if (index !== asset.borrowIndex) {
      const owing = await rows<{ position_id: string; debt: string; principal: string; reference_index: string }>(
        tx,
        `SELECT p.position_id, (-b.balance)::text AS debt, p.principal::text, p.reference_index::text FROM positions p
         JOIN account_balances b ON b.account = 'loan:' || p.position_id AND b.asset = p.debt_asset
         WHERE p.debt_asset = $1 AND p.state <> 'closed' AND b.balance < 0 ORDER BY p.seq`,
        [asset.asset],
      );
      const accruals: PostingDraft[] = [];
      for (const row of owing) {
        const interest = ceilDiv(BigInt(row.principal) * index, BigInt(row.reference_index)) - BigInt(row.debt);
        if (interest <= 0n) continue;
        const reserve = reserveShare(interest, asset.reserveFactorBps);
        accruals.push({
          ref: row.position_id,
          legs: [
            { account: account.loan(row.position_id), asset: asset.asset, amount: -interest },
            { account: account.supply, asset: asset.asset, amount: interest - reserve },
            { account: account.reserve, asset: asset.asset, amount: reserve },
          ],
        });
      }
      await postAll(tx, "accrual", now, accruals);
    }
    asset.borrowIndex = index;
    asset.indexSecond = second;
  }
}

/**
 * Brings interest forward and re-evaluates every open position. Runs at the start of every API request and in
 * the background, so every debt, health factor and state shown is the server's value at that second.
 * `recovered` names an asset whose market a post has just reopened: every open position involving it that is still
 * below health factor 1 first gets its recovery grace.
 */
export async function sync(tx: Tx, now: Date, recovered?: string): Promise<Market> {
  const market = await loadMarket(tx);
  await bringForward(tx, market, now);
  for (const position of await listPositions(tx)) {
    let current = position;
    if (recovered !== undefined && (position.collateralAsset === recovered || position.debtAsset === recovered) && belowOne(position, market) !== null) {
      const later = new Date(now.getTime() + config.graceSeconds * 1000);
      current = { ...position, graceEndsAt: position.graceEndsAt !== null && position.graceEndsAt > later ? position.graceEndsAt : later };
      await tx.query("UPDATE positions SET grace_ends_at = $2 WHERE position_id = $1", [position.positionId, current.graceEndsAt]);
    }
    await evaluate(tx, market, now, current);
  }
  return market;
}

/** The position's health factor when it is below 1, else null: the one test for "below health factor 1". */
export function belowOne(position: Position, market: Market): bigint | null {
  const hf = healthFactor(exposureOf(position, market));
  return hf !== null && hf < BPS ? hf : null;
}

export async function positionsBelowOne(tx: Tx, market: Market): Promise<number> {
  return (await listPositions(tx)).filter((p) => belowOne(p, market) !== null).length;
}

type PositionJson = ReturnType<typeof positionFigures> & {
  position_id: string;
  borrower_id: string;
  collateral_asset: string;
  debt_asset: string;
  state: PositionState;
  grace_ends_at: string | null;
  round: number;
  notices: NoticeJson[];
  created_at: string;
  server_time: string;
};

/** The figures the server computes for a position, as API strings. */
export function positionFigures(position: Position, market: Market) {
  const exposure = exposureOf(position, market);
  const hf = healthFactor(exposure);
  const price = liquidationPrice(exposure);
  const fillable = position.state === "liquidatable" || position.state === "partially_liquidated";
  return {
    collateral_amount: position.collateral.toString(),
    debt: position.debt.toString(),
    health_factor: hf === null ? null : fixedText(hf, 4),
    liquidation_price: price === null ? null : plainPrice(price),
    max_repay: (fillable ? fillLimit(exposure).maxRepay : 0n).toString(),
  };
}

/** The API's position objects for the given positions, with their notices read in one query. */
export async function positionsJson(tx: Tx, positions: Position[], market: Market, now: Date): Promise<PositionJson[]> {
  const notices = await noticesByPosition(tx, positions.map((p) => p.positionId));
  return positions.map((position) => ({
    position_id: position.positionId,
    borrower_id: position.borrowerId,
    collateral_asset: position.collateralAsset,
    debt_asset: position.debtAsset,
    ...positionFigures(position, market),
    state: position.state,
    grace_ends_at: position.state === "liquidatable_grace" && position.graceEndsAt ? toInstant(position.graceEndsAt) : null,
    round: position.round,
    notices: notices.get(position.positionId) ?? [],
    created_at: toInstant(position.createdAt),
    server_time: toInstant(now),
  }));
}

export async function positionJson(tx: Tx, position: Position, market: Market, now: Date): Promise<PositionJson> {
  const [json] = await positionsJson(tx, [position], market, now);
  if (!json) throw new Error("position vanished");
  return json;
}
