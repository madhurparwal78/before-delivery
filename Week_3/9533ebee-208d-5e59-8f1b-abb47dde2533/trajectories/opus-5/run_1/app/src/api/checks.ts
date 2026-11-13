/**
 * The field checks several endpoints share, each with its published message
 * written in desk format, decided here once.
 */

import { readBig, type Queryable } from '../db/pool.ts';
import { assetDecimals, type Asset } from '../domain/assets.ts';
import { API_FIELD_MESSAGE } from '../domain/copy.ts';
import { formatAmount, formatPercentPlain } from '../domain/deskformat.ts';
import { walletAccount } from '../ledger/accounts.ts';
import { validationFailed } from '../http/problem.ts';

export async function walletBalanceOf(
  client: Queryable,
  actorId: string,
  asset: Asset,
): Promise<bigint> {
  const result = await client.query<{ balance: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS balance FROM ledger_legs
     WHERE account = $1 AND asset = $2`,
    [walletAccount(actorId), asset],
  );
  return readBig(result.rows[0]?.balance ?? '0');
}

/**
 * Refuses an amount above the member's wallet balance. The message is keyed
 * by the request's own amount field.
 */
export async function requireWalletCovers(
  client: Queryable,
  actorId: string,
  asset: Asset,
  amount: bigint,
  field: string,
): Promise<void> {
  const balance = await walletBalanceOf(client, actorId, asset);
  if (amount <= balance) return;
  throw validationFailed({
    [field]: `Your wallet holds ${formatAmount(balance, assetDecimals(asset))} ${asset}.`,
  });
}

export function refuseAboveShareValue(asset: Asset, value: bigint): never {
  throw validationFailed({
    amount: `Your shares are worth ${formatAmount(value, assetDecimals(asset))} ${asset}.`,
  });
}

export function refuseAboveDebt(asset: Asset, debt: bigint): never {
  throw validationFailed({
    amount: `The current debt is ${formatAmount(debt, assetDecimals(asset))} ${asset}.`,
  });
}

export function refuseAboveCollateral(asset: Asset, collateral: bigint): never {
  throw validationFailed({
    amount: `The position holds ${formatAmount(collateral, assetDecimals(asset))} ${asset}.`,
  });
}

export function refuseDrawPastLoanToValue(ltvBps: bigint): never {
  throw validationFailed({
    amount: `This draw would take the position past its ${formatPercentPlain(ltvBps)}% loan-to-value limit.`,
  });
}

export function refuseWithdrawalPastLoanToValue(ltvBps: bigint): never {
  throw validationFailed({
    amount: `This withdrawal would take the position past its ${formatPercentPlain(ltvBps)}% loan-to-value limit.`,
  });
}

export function refuseAboveMaxRepay(asset: Asset, maxRepay: bigint): never {
  throw validationFailed({
    repay_amount: `Repay at most ${formatAmount(maxRepay, assetDecimals(asset))} ${asset} on this fill.`,
  });
}

export function refuseSupplyTooSmall(): never {
  throw validationFailed({ amount: API_FIELD_MESSAGE.supplyTooSmall });
}

export function refuseOutputTooSmall(field: string): never {
  throw validationFailed({ [field]: API_FIELD_MESSAGE.outputTooSmall });
}
