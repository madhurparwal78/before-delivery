import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { db, withTransaction } from '../db.js';
import { conflict, unprocessable } from '../http.js';
import { emitEvent, flushEvents } from '../live.js';
import { feeForGas, parseFern, STAKING_GAS } from '../../shared/fees.js';
import { formatPercent } from '../../shared/format.js';
import { balancesFor, lockPerson } from '../domain/accounts.js';
import { now } from '../domain/engine.js';
import {
  insufficientBalance,
  pendingRewardsTotal,
  stakingRefusal,
  totalBonded,
  validatorById,
  validatorsOf,
} from '../domain/staking.js';
import { TransactionKind, ValidatorRow } from '../domain/types.js';
import {
  readString,
  replayIdempotent,
  RequestContext,
  requireWorkspace,
  requireWrite,
  storeIdempotent,
  StoredResponse,
} from './context.js';
import { transactionWriteView, ufern } from './serialize.js';

export const stakingFee = (): bigint => feeForGas(STAKING_GAS, config.minGasPrice);

export async function getStakingFee(ctx: RequestContext, id: string): Promise<StoredResponse> {
  await requireWorkspace(ctx, id);
  return { status: 200, body: { gas: STAKING_GAS, feeUfern: ufern(stakingFee()) } };
}

export async function listValidators(ctx: RequestContext, id: string): Promise<StoredResponse> {
  const { workspace } = await requireWorkspace(ctx, id);
  const validators = await validatorsOf(db, workspace.id);
  const bonded = await totalBonded(db, workspace.id);
  const { rows } = await db.query<{
    validator_id: string;
    person_id: string | null;
    total: string;
  }>(
    `SELECT validator_id, person_id, sum(amount_ufern)::text AS total FROM delegations
     WHERE workspace_id = $1 GROUP BY validator_id, person_id`,
    [workspace.id],
  );
  return {
    status: 200,
    body: validators.map((validator) => {
      const own = rows.filter((row) => row.validator_id === validator.id);
      const stake = own.reduce((sum, row) => sum + BigInt(row.total), 0n);
      const selfStake = own
        .filter((row) => row.person_id === null)
        .reduce((sum, row) => sum + BigInt(row.total), 0n);
      return {
        id: validator.id,
        name: validator.name,
        selfStakeUfern: ufern(selfStake),
        stakeUfern: ufern(stake),
        commission: commissionText(validator),
        shareOfBonded: formatPercent(stake, bonded, 2),
      };
    }),
  };
}

function commissionText(validator: ValidatorRow): string {
  const numerator = BigInt(validator.commission_numerator);
  const denominator = BigInt(validator.commission_denominator);
  const scaled = (numerator * 10000n) / denominator;
  return (Number(scaled) / 10000).toString();
}

export async function getStakingMe(ctx: RequestContext, id: string): Promise<StoredResponse> {
  const { workspace, person } = await requireWorkspace(ctx, id);
  const balances = await balancesFor(db, workspace.id, person.id);
  const { rows: delegations } = await db.query<{
    validator_id: string;
    name: string;
    amount_ufern: string;
    pending_rewards_ufern: string;
  }>(
    `SELECT d.validator_id, v.name, d.amount_ufern::text, d.pending_rewards_ufern::text
     FROM delegations d JOIN validators v ON v.id = d.validator_id
     WHERE d.workspace_id = $1 AND d.person_id = $2 ORDER BY v.position`,
    [workspace.id, person.id],
  );
  const { rows: unbondings } = await db.query<{
    validator_id: string;
    name: string;
    amount_ufern: string;
    completes_at: Date;
    released_at: Date | null;
  }>(
    `SELECT u.validator_id, v.name, u.amount_ufern::text, u.completes_at, u.released_at
     FROM unbondings u JOIN validators v ON v.id = u.validator_id
     WHERE u.workspace_id = $1 AND u.person_id = $2 ORDER BY u.completes_at, u.id`,
    [workspace.id, person.id],
  );
  const { rows: redelegations } = await db.query<{
    from_validator_id: string;
    from_name: string;
    to_validator_id: string;
    to_name: string;
    amount_ufern: string;
    arrived_at: Date;
    movable_at: Date;
  }>(
    `SELECT r.from_validator_id, f.name AS from_name, r.to_validator_id, t.name AS to_name,
            r.amount_ufern::text, r.arrived_at, r.movable_at
     FROM redelegations r
       JOIN validators f ON f.id = r.from_validator_id
       JOIN validators t ON t.id = r.to_validator_id
     WHERE r.workspace_id = $1 AND r.person_id = $2 ORDER BY r.arrived_at, r.id`,
    [workspace.id, person.id],
  );
  return {
    status: 200,
    body: {
      balanceUfern: ufern(balances.balanceUfern),
      availableUfern: ufern(balances.availableUfern),
      heldUfern: ufern(balances.heldUfern),
      delegations: delegations.map((row) => ({
        validator: row.validator_id,
        validatorName: row.name,
        amountUfern: Number(row.amount_ufern),
        pendingRewardsUfern: Number(row.pending_rewards_ufern),
      })),
      unbondings: unbondings.map((row) => ({
        validator: row.validator_id,
        validatorName: row.name,
        amountUfern: Number(row.amount_ufern),
        completesAt: row.completes_at.toISOString(),
        status: row.released_at ? 'released' : 'unbonding',
      })),
      redelegations: redelegations.map((row) => ({
        from: row.from_validator_id,
        fromName: row.from_name,
        to: row.to_validator_id,
        toName: row.to_name,
        amountUfern: Number(row.amount_ufern),
        arrivedAt: row.arrived_at.toISOString(),
        movableAt: row.movable_at.toISOString(),
      })),
    },
  };
}

interface StakingWrite {
  kind: TransactionKind;
  payload: Record<string, unknown>;
  holdUfern: bigint;
}

async function createTransaction(
  ctx: RequestContext,
  workspaceId: string,
  personId: string,
  write: StakingWrite,
): Promise<StoredResponse> {
  const feeUfern = stakingFee();
  const txId = randomUUID();
  const at = now();
  const result = await withTransaction(async (tx) => {
    await lockPerson(tx, personId);
    await tx.query(
      `INSERT INTO transactions
         (id, workspace_id, kind, sender_id, status, fee_ufern, gas, held_ufern, payload, submitted_at)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8, $9)`,
      [
        txId,
        workspaceId,
        write.kind,
        personId,
        feeUfern,
        STAKING_GAS,
        write.holdUfern,
        JSON.stringify(write.payload),
        at,
      ],
    );
    const stored: StoredResponse = {
      status: 201,
      body: transactionWriteView({
        id: txId,
        kind: write.kind,
        feeUfern,
        gas: STAKING_GAS,
        submittedAt: at,
      }),
    };
    await storeIdempotent(tx, ctx, workspaceId, personId, stored);
    return stored;
  });
  emitEvent(workspaceId, { kind: 'transactions' });
  flushEvents();
  return result;
}

const AMOUNT_FORMAT = 'Amount must be an amount in FERN with at most 6 decimals.';

export async function postDelegation(
  ctx: RequestContext,
  id: string,
  kind: 'delegate' | 'undelegate' | 'redelegate',
): Promise<StoredResponse> {
  const { workspace, role, person } = await requireWorkspace(ctx, id);
  const replay = await replayIdempotent(ctx, workspace.id, person.id);
  if (replay) return replay;
  requireWrite(role, 'transaction');

  const fromField = kind === 'redelegate' ? 'from' : 'validator';
  const validator = await validatorById(db, workspace.id, readString(ctx, fromField));
  if (!validator) throw unprocessable(fromField, 'Choose a validator.');
  let target: ValidatorRow | null = null;
  if (kind === 'redelegate') {
    target = await validatorById(db, workspace.id, readString(ctx, 'to'));
    if (!target) throw unprocessable('to', 'Choose a validator.');
    if (target.id === validator.id) throw unprocessable('to', 'Choose a different validator.');
  }
  const amountUfern = parseFern(readString(ctx, 'amount'));
  if (amountUfern === null) throw unprocessable('amount', AMOUNT_FORMAT);
  const feeUfern = stakingFee();
  const refusal = await stakingRefusal(db, {
    kind,
    workspaceId: workspace.id,
    personId: person.id,
    validator,
    toValidator: target,
    amountUfern,
    feeUfern,
    now: now(),
  });
  if (refusal) throw unprocessable(refusal.field, refusal.message);

  const payload =
    kind === 'redelegate'
      ? {
          fromValidatorId: validator.id,
          toValidatorId: (target as ValidatorRow).id,
          amountUfern: amountUfern.toString(),
        }
      : { validatorId: validator.id, amountUfern: amountUfern.toString() };
  const holdUfern = kind === 'delegate' ? feeUfern + amountUfern : feeUfern;
  return createTransaction(ctx, workspace.id, person.id, { kind, payload, holdUfern });
}

export async function postClaim(ctx: RequestContext, id: string): Promise<StoredResponse> {
  const { workspace, role, person } = await requireWorkspace(ctx, id);
  const replay = await replayIdempotent(ctx, workspace.id, person.id);
  if (replay) return replay;
  requireWrite(role, 'transaction');
  const feeUfern = stakingFee();
  const balances = await balancesFor(db, workspace.id, person.id);
  if (balances.availableUfern < feeUfern) {
    throw unprocessable('amount', insufficientBalance(balances.availableUfern, feeUfern));
  }
  const pending = await pendingRewardsTotal(db, workspace.id, person.id);
  if (pending === 0n) throw conflict('There are no rewards to claim.');
  return createTransaction(ctx, workspace.id, person.id, {
    kind: 'claim',
    payload: {},
    holdUfern: feeUfern,
  });
}
