import { randomBytes } from "node:crypto";
import { one } from "../db.js";
import { fail, FIELD, insufficientLiquidity, validation } from "../errors.js";
import { requireRole, valid, type Ctx, type Reply, type Route } from "../http.js";
import { account, balance, post, type Leg } from "../ledger.js";
import { fixedText, parseAmount } from "../money.js";
import { queueLiquidationNotice } from "../notices.js";
import { assetOf, availableLiquidity, requireFreshForBorrowing, type Asset } from "../pools.js";
import {
  announceStateChange,
  assess,
  belowOne,
  commit,
  evaluate,
  exposureOf,
  findPosition,
  listPositions,
  positionJson,
  positionsJson,
  resetDebtBasis,
  type Position,
} from "../positions.js";
import { fill, fillLimit, withinLoanToValue } from "../risk.js";
import { newSettlementId, settle } from "../settlements.js";
import { walletMessage } from "./liquidity.js";
import { bpsPercent, displayAmount, plainPrice } from "../../shared/format.js";
import { toInstant } from "../time.js";

// Positions: opening, draws, repayments, collateral changes, the liquidation queue and liquidation fills.

const hfText = (hf: bigint | null) => (hf === null ? null : fixedText(hf, 4));

/** The position named in the path, acted on only by its own borrower. */
async function ownPosition(ctx: Ctx): Promise<Position> {
  const position = await findPosition(ctx.tx, ctx.params[0] ?? "");
  requireRole(ctx.member, "borrower");
  if (position.borrowerId !== ctx.member.actor_id) throw fail("forbidden");
  return position;
}

function requireOpen(position: Position): void {
  if (position.state === "closed") throw fail("position_closed");
}

async function walletOf(ctx: Ctx, asset: Asset): Promise<bigint> {
  return balance(ctx.tx, account.wallet(ctx.member.actor_id), asset.asset);
}

async function openPosition(ctx: Ctx): Promise<Reply> {
  requireRole(ctx.member, "borrower");
  const collateralCode = ctx.body["collateral_asset"];
  const debtCode = ctx.body["debt_asset"];
  const collateralAsset = typeof collateralCode === "string" ? ctx.market.get(collateralCode) : undefined;
  const debtAsset = typeof debtCode === "string" ? ctx.market.get(debtCode) : undefined;
  const amount = parseAmount(ctx.body["collateral_amount"]);
  const held = collateralAsset ? await walletOf(ctx, collateralAsset) : 0n;
  const samePair = collateralAsset !== undefined && collateralAsset === debtAsset;
  const checked = valid(ctx.bodyErrors, {
    collateral_amount: [amount !== null && amount <= held ? amount : null, amount === null || !collateralAsset ? FIELD.amount : walletMessage(held, collateralAsset)],
    collateral_asset: [collateralAsset, FIELD.asset],
    debt_asset: [debtAsset && !samePair ? debtAsset : null, debtAsset ? FIELD.pair : FIELD.asset],
  });
  const seq = (await one<{ seq: string }>(ctx.tx, "SELECT nextval('position_seq')::text AS seq"))?.seq ?? "";
  // Ids are unique across databases sharing one integrator application, so events never mix up two positions.
  const positionId = `pos-${randomBytes(4).toString("hex")}`;
  await ctx.tx.query(
    `INSERT INTO positions (position_id, seq, borrower_id, collateral_asset, debt_asset, state, grace_ends_at, after_fill, margin_armed, round,
                            principal, reference_index, event_seq, created_at)
     VALUES ($1, $2, $3, $4, $5, 'healthy', NULL, false, true, 0, 0, $6, 0, $7)`,
    [positionId, seq, ctx.member.actor_id, checked.collateral_asset.asset, checked.debt_asset.asset, checked.debt_asset.borrowIndex.toString(), ctx.now],
  );
  await post(ctx.tx, "lock", positionId, ctx.now, [
    { account: account.wallet(ctx.member.actor_id), asset: checked.collateral_asset.asset, amount: -checked.collateral_amount },
    { account: account.collateral(positionId), asset: checked.collateral_asset.asset, amount: checked.collateral_amount },
  ]);
  await announceStateChange(ctx.tx, positionId, { from: null, to: "healthy", hf: null, graceEndsAt: null, at: ctx.now });
  const position = await evaluate(ctx.tx, ctx.market, ctx.now, await findPosition(ctx.tx, positionId));
  return { status: 201, body: await positionJson(ctx.tx, position, ctx.market, ctx.now) };
}

async function listAll(ctx: Ctx): Promise<Reply> {
  const code = ctx.query.get("collateral_asset");
  if (code !== null && !ctx.market.has(code)) throw validation({ collateral_asset: FIELD.asset });
  const positions = await listPositions(ctx.tx, { collateralAsset: code ?? undefined, includeClosed: ctx.query.get("include_closed") === "true" });
  return { status: 200, body: { positions: await positionsJson(ctx.tx, positions, ctx.market, ctx.now), server_time: toInstant(ctx.now) } };
}

async function showPosition(ctx: Ctx): Promise<Reply> {
  const position = await findPosition(ctx.tx, ctx.params[0] ?? "");
  return { status: 200, body: await positionJson(ctx.tx, position, ctx.market, ctx.now) };
}

async function draw(ctx: Ctx): Promise<Reply> {
  const position = await ownPosition(ctx);
  const exposure = exposureOf(position, ctx.market);
  requireFreshForBorrowing(ctx.now, exposure.collateralAsset, exposure.debtAsset);
  requireOpen(position);
  const amount = parseAmount(ctx.body["amount"]);
  const available = await availableLiquidity(ctx.tx, exposure.debtAsset);
  if (amount !== null && amount > available) throw insufficientLiquidity(displayAmount(available, exposure.debtAsset.decimals), exposure.debtAsset.asset);
  const within = amount !== null && withinLoanToValue({ ...exposure, debt: exposure.debt + amount });
  const { amount: drawn } = valid(ctx.bodyErrors, {
    amount: [within ? amount : null, amount === null ? FIELD.amount : `This draw would take the position past its ${bpsPercent(exposure.collateralAsset.ltvBps)}% loan-to-value limit.`],
  });
  const settlementId = newSettlementId();
  const { legs } = await post(ctx.tx, "draw", settlementId, ctx.now, [
    { account: account.loan(position.positionId), asset: exposure.debtAsset.asset, amount: -drawn },
    { account: account.wallet(ctx.member.actor_id), asset: exposure.debtAsset.asset, amount: drawn },
  ]);
  await resetDebtBasis(ctx.tx, ctx.market, position.positionId, exposure.debtAsset.asset, position.debt + drawn);
  const after = assess(await findPosition(ctx.tx, position.positionId), ctx.market, ctx.now);
  const settlement = await settle(
    ctx,
    { settlementId, kind: "draw", positionId: position.positionId, asset: exposure.debtAsset.asset, amount: drawn, legs },
    { debt_after: (position.debt + drawn).toString(), health_factor_after: hfText(after.hf), state_after: after.after.state },
  );
  await commit(ctx.tx, ctx.market, ctx.now, after);
  return { status: 201, body: settlement };
}

async function repay(ctx: Ctx): Promise<Reply> {
  const position = await ownPosition(ctx);
  requireOpen(position);
  const debtAsset = assetOf(ctx.market, position.debtAsset);
  // "all" repays the debt accrued to the second of the request.
  const requested = ctx.body["amount"];
  const amount = requested === "all" && position.debt > 0n ? position.debt : parseAmount(requested);
  const held = await walletOf(ctx, debtAsset);
  const { amount: repaid } = valid(ctx.bodyErrors, {
    amount: [
      amount !== null && amount <= held && amount <= position.debt ? amount : null,
      amount === null ? FIELD.amount : amount > held ? walletMessage(held, debtAsset) : `The current debt is ${displayAmount(position.debt, debtAsset.decimals)} ${debtAsset.asset}.`,
    ],
  });
  const repaymentId = `rpy-${randomBytes(6).toString("hex")}`;
  const { postingId } = await post(ctx.tx, "repay", repaymentId, ctx.now, [
    { account: account.wallet(ctx.member.actor_id), asset: debtAsset.asset, amount: -repaid },
    { account: account.loan(position.positionId), asset: debtAsset.asset, amount: repaid },
  ]);
  await resetDebtBasis(ctx.tx, ctx.market, position.positionId, debtAsset.asset, position.debt - repaid);
  const after = await evaluate(ctx.tx, ctx.market, ctx.now, await findPosition(ctx.tx, position.positionId));
  const hf = assess(after, ctx.market, ctx.now).hf;
  return {
    status: 201,
    body: {
      repayment_id: repaymentId,
      posting_id: postingId,
      amount: repaid.toString(),
      debt_after: after.debt.toString(),
      health_factor_after: hfText(hf),
      state_after: after.state,
    },
  };
}

async function addCollateral(ctx: Ctx): Promise<Reply> {
  const position = await ownPosition(ctx);
  requireOpen(position);
  const collateralAsset = assetOf(ctx.market, position.collateralAsset);
  const amount = parseAmount(ctx.body["amount"]);
  const held = await walletOf(ctx, collateralAsset);
  const { amount: added } = valid(ctx.bodyErrors, { amount: [amount !== null && amount <= held ? amount : null, amount === null ? FIELD.amount : walletMessage(held, collateralAsset)] });
  await post(ctx.tx, "lock", position.positionId, ctx.now, [
    { account: account.wallet(ctx.member.actor_id), asset: collateralAsset.asset, amount: -added },
    { account: account.collateral(position.positionId), asset: collateralAsset.asset, amount: added },
  ]);
  const after = await evaluate(ctx.tx, ctx.market, ctx.now, await findPosition(ctx.tx, position.positionId));
  return { status: 201, body: await positionJson(ctx.tx, after, ctx.market, ctx.now) };
}

async function withdrawCollateral(ctx: Ctx): Promise<Reply> {
  const position = await ownPosition(ctx);
  const exposure = exposureOf(position, ctx.market);
  requireFreshForBorrowing(ctx.now, exposure.collateralAsset, exposure.debtAsset);
  requireOpen(position);
  const amount = parseAmount(ctx.body["amount"]);
  const asset = exposure.collateralAsset;
  const message =
    amount === null
      ? FIELD.amount
      : position.debt > 0n && !withinLoanToValue({ ...exposure, collateral: position.collateral - amount })
        ? `This withdrawal would take the position past its ${bpsPercent(asset.ltvBps)}% loan-to-value limit.`
        : `The position holds ${displayAmount(position.collateral, asset.decimals)} ${asset.asset}.`;
  const allowed = amount !== null && amount <= position.collateral && (position.debt === 0n || withinLoanToValue({ ...exposure, collateral: position.collateral - amount }));
  const { amount: released } = valid(ctx.bodyErrors, { amount: [allowed ? amount : null, message] });
  await post(ctx.tx, "release", position.positionId, ctx.now, [
    { account: account.collateral(position.positionId), asset: asset.asset, amount: -released },
    { account: account.wallet(ctx.member.actor_id), asset: asset.asset, amount: released },
  ]);
  const after = await evaluate(ctx.tx, ctx.market, ctx.now, await findPosition(ctx.tx, position.positionId));
  return { status: 201, body: await positionJson(ctx.tx, after, ctx.market, ctx.now) };
}

async function queue(ctx: Ctx): Promise<Reply> {
  requireRole(ctx.member, "liquidator", "risk_steward");
  const below = (await listPositions(ctx.tx))
    .map((position) => ({ position, hf: belowOne(position, ctx.market) }))
    .filter((entry): entry is { position: Position; hf: bigint } => entry.hf !== null)
    .sort((a, b) => (a.hf < b.hf ? -1 : a.hf > b.hf ? 1 : 0));
  return {
    status: 200,
    body: { positions: await positionsJson(ctx.tx, below.map((entry) => entry.position), ctx.market, ctx.now), server_time: toInstant(ctx.now) },
  };
}

async function liquidate(ctx: Ctx): Promise<Reply> {
  const position = await findPosition(ctx.tx, ctx.params[0] ?? "");
  requireRole(ctx.member, "liquidator");
  const exposure = exposureOf(position, ctx.market);
  const { collateralAsset, debtAsset } = exposure;
  requireFreshForBorrowing(ctx.now, collateralAsset, debtAsset);
  const round = ctx.body["round"];
  const wholeRound = typeof round === "number" && Number.isSafeInteger(round) && round >= 0;
  if (wholeRound && round !== position.round) throw fail("already_liquidated");
  requireOpen(position);
  if (position.state === "liquidatable_grace") throw fail("in_grace");
  if (position.state !== "liquidatable" && position.state !== "partially_liquidated") throw fail("not_liquidatable");

  const requested = parseAmount(ctx.body["repay_amount"]);
  const held = await walletOf(ctx, debtAsset);
  const { maxRepay } = fillLimit(exposure);
  const repaid = requested !== null && requested <= held && requested <= maxRepay ? requested : null;
  const checked = valid(ctx.bodyErrors, {
    repay_amount: [
      repaid,
      requested === null ? FIELD.amount : requested > held ? walletMessage(held, debtAsset) : `Repay at most ${displayAmount(maxRepay, debtAsset.decimals)} ${debtAsset.asset} on this fill.`,
    ],
    round: [wholeRound ? round : null, FIELD.round],
  });

  const filled = fill(exposure, checked.repay_amount);
  const borrowerWallet = account.wallet(position.borrowerId);
  const liquidatorWallet = account.wallet(ctx.member.actor_id);
  const debtLeft = position.debt - checked.repay_amount - filled.writtenOff;
  const collateralLeft = position.collateral - filled.seized;
  const legs: Leg[] = [
    { account: liquidatorWallet, asset: debtAsset.asset, amount: -checked.repay_amount },
    { account: account.loan(position.positionId), asset: debtAsset.asset, amount: checked.repay_amount },
    { account: account.collateral(position.positionId), asset: collateralAsset.asset, amount: -filled.seized },
    { account: liquidatorWallet, asset: collateralAsset.asset, amount: filled.seized },
    { account: account.loan(position.positionId), asset: debtAsset.asset, amount: filled.writtenOff },
    { account: account.supply, asset: debtAsset.asset, amount: -filled.writtenOff },
  ];
  if (debtLeft === 0n) {
    // A fill that clears the debt closes the position and returns any collateral left to the borrower.
    legs.push(
      { account: account.collateral(position.positionId), asset: collateralAsset.asset, amount: -collateralLeft },
      { account: borrowerWallet, asset: collateralAsset.asset, amount: collateralLeft },
    );
  }
  const settlementId = newSettlementId();
  const posted = await post(ctx.tx, "liquidation", settlementId, ctx.now, legs);
  await ctx.tx.query("UPDATE positions SET round = round + 1 WHERE position_id = $1", [position.positionId]);
  await resetDebtBasis(ctx.tx, ctx.market, position.positionId, debtAsset.asset, debtLeft);
  const after = assess(await findPosition(ctx.tx, position.positionId), ctx.market, ctx.now, true);
  const hfBefore = hfText(assess(position, ctx.market, ctx.now).hf);
  const hfAfter = hfText(after.hf);
  await queueLiquidationNotice(
    ctx.tx,
    { position, exposure, settlementId, round: position.round, repaid: checked.repay_amount, seized: filled.seized, bonusAmount: filled.bonusAmount, healthFactorAfter: hfAfter },
    ctx.now,
  );
  const settlement = await settle(
    ctx,
    { settlementId, kind: "liquidation", positionId: position.positionId, asset: debtAsset.asset, amount: checked.repay_amount, legs: posted.legs },
    {
      round: position.round + 1,
      borrower_id: position.borrowerId,
      repaid: checked.repay_amount.toString(),
      seized: filled.seized.toString(),
      bonus_amount: filled.bonusAmount.toString(),
      written_off: filled.writtenOff.toString(),
      health_factor_before: hfBefore,
      health_factor_after: hfAfter,
      state_after: after.after.state,
      price_collateral: plainPrice(collateralAsset.price),
      price_debt: plainPrice(debtAsset.price),
    },
    {
      collateralAsset: collateralAsset.asset,
      repaid: checked.repay_amount,
      seized: filled.seized,
      bonusAmount: filled.bonusAmount,
      writtenOff: filled.writtenOff,
      healthFactorBefore: hfBefore,
      healthFactorAfter: hfAfter,
    },
  );
  await commit(ctx.tx, ctx.market, ctx.now, after);
  return { status: 201, body: { ...settlement, notice_status: "queued" } };
}

export const positionRoutes: Route[] = [
  { method: "POST", pattern: /^\/api\/positions$/, fields: ["collateral_asset", "debt_asset", "collateral_amount"], handler: openPosition },
  { method: "GET", pattern: /^\/api\/positions$/, handler: listAll },
  { method: "GET", pattern: /^\/api\/positions\/([^/]+)$/, handler: showPosition },
  { method: "POST", pattern: /^\/api\/positions\/([^/]+)\/draws$/, fields: ["amount"], handler: draw, keyed: true },
  { method: "POST", pattern: /^\/api\/positions\/([^/]+)\/repayments$/, fields: ["amount"], handler: repay },
  { method: "POST", pattern: /^\/api\/positions\/([^/]+)\/collateral$/, fields: ["amount"], handler: addCollateral },
  { method: "POST", pattern: /^\/api\/positions\/([^/]+)\/collateral-withdrawals$/, fields: ["amount"], handler: withdrawCollateral },
  { method: "GET", pattern: /^\/api\/liquidations\/queue$/, handler: queue },
  { method: "POST", pattern: /^\/api\/positions\/([^/]+)\/liquidations$/, fields: ["repay_amount", "round"], handler: liquidate, keyed: true },
];
