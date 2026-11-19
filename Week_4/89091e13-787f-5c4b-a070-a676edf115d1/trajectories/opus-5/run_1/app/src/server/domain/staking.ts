import { randomUUID } from 'node:crypto';
import { Queryable } from '../db.js';
import { config } from '../config.js';
import { formatFern, formatTime } from '../../shared/format.js';
import { splitBlockReward } from '../../shared/rewards.js';
import { balancesFor } from './accounts.js';
import {
  bondedAccount,
  memberAccount,
  operatorAccount,
  postPair,
  REWARDS_ACCOUNT,
  UNBONDING_ACCOUNT,
} from './ledger.js';
import { ValidatorRow } from './types.js';
import { queueMail } from '../mail.js';

export interface Refusal {
  field: string;
  message: string;
}

export interface DelegationRow {
  id: string;
  validator_id: string;
  person_id: string | null;
  amount_ufern: string;
  pending_rewards_ufern: string;
}

export async function validatorsOf(tx: Queryable, workspaceId: string): Promise<ValidatorRow[]> {
  const { rows } = await tx.query<ValidatorRow>(
    'SELECT * FROM validators WHERE workspace_id = $1 ORDER BY position',
    [workspaceId],
  );
  return rows;
}

export async function validatorById(
  tx: Queryable,
  workspaceId: string,
  validatorId: string,
): Promise<ValidatorRow | null> {
  const { rows } = await tx.query<ValidatorRow>(
    'SELECT * FROM validators WHERE workspace_id = $1 AND id = $2',
    [workspaceId, validatorId],
  );
  return rows[0] ?? null;
}

export async function delegationsOf(
  tx: Queryable,
  workspaceId: string,
): Promise<DelegationRow[]> {
  const { rows } = await tx.query<DelegationRow>(
    `SELECT id, validator_id, person_id, amount_ufern::text, pending_rewards_ufern::text
     FROM delegations WHERE workspace_id = $1 ORDER BY created_at, id`,
    [workspaceId],
  );
  return rows;
}

export async function totalBonded(tx: Queryable, workspaceId: string): Promise<bigint> {
  const { rows } = await tx.query<{ total: string | null }>(
    'SELECT sum(amount_ufern)::text AS total FROM delegations WHERE workspace_id = $1',
    [workspaceId],
  );
  return BigInt(rows[0]?.total ?? '0');
}

async function delegationFor(
  tx: Queryable,
  workspaceId: string,
  personId: string,
  validatorId: string,
): Promise<DelegationRow | null> {
  const { rows } = await tx.query<DelegationRow>(
    `SELECT id, validator_id, person_id, amount_ufern::text, pending_rewards_ufern::text
     FROM delegations WHERE workspace_id = $1 AND person_id = $2 AND validator_id = $3`,
    [workspaceId, personId, validatorId],
  );
  return rows[0] ?? null;
}

interface LockedStake {
  amountUfern: bigint;
  fromName: string;
  arrivedAt: Date;
  movableAt: Date;
}

/** Redelegated stake that cannot move again yet. */
async function lockedStake(
  tx: Queryable,
  workspaceId: string,
  personId: string,
  validatorId: string,
  now: Date,
): Promise<LockedStake[]> {
  const { rows } = await tx.query<{
    amount_ufern: string;
    name: string;
    arrived_at: Date;
    movable_at: Date;
  }>(
    `SELECT r.amount_ufern::text, v.name, r.arrived_at, r.movable_at
     FROM redelegations r JOIN validators v ON v.id = r.from_validator_id
     WHERE r.workspace_id = $1 AND r.person_id = $2 AND r.to_validator_id = $3
       AND r.movable_at > $4
     ORDER BY r.arrived_at, r.id`,
    [workspaceId, personId, validatorId, now],
  );
  return rows.map((row) => ({
    amountUfern: BigInt(row.amount_ufern),
    fromName: row.name,
    arrivedAt: row.arrived_at,
    movableAt: row.movable_at,
  }));
}

async function unbondingCount(
  tx: Queryable,
  workspaceId: string,
  personId: string,
  validatorId: string,
): Promise<number> {
  const { rows } = await tx.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM unbondings
     WHERE workspace_id = $1 AND person_id = $2 AND validator_id = $3 AND released_at IS NULL`,
    [workspaceId, personId, validatorId],
  );
  return Number(rows[0].count);
}

async function redelegationCount(
  tx: Queryable,
  workspaceId: string,
  personId: string,
  now: Date,
): Promise<number> {
  const { rows } = await tx.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM redelegations
     WHERE workspace_id = $1 AND person_id = $2 AND movable_at > $3`,
    [workspaceId, personId, now],
  );
  return Number(rows[0].count);
}

export interface StakingRequest {
  kind: 'delegate' | 'undelegate' | 'redelegate';
  workspaceId: string;
  personId: string;
  validator: ValidatorRow;
  toValidator: ValidatorRow | null;
  amountUfern: bigint;
  feeUfern: bigint;
  now: Date;
}

/** The published staking refusals, in order, first failure only. */
export async function stakingRefusal(
  tx: Queryable,
  request: StakingRequest,
): Promise<Refusal | null> {
  const { kind, workspaceId, personId, validator, amountUfern, feeUfern, now } = request;
  const amountField = 'amount';
  if (amountUfern <= 0n) return { field: amountField, message: 'Amount must be more than 0.' };

  const balances = await balancesFor(tx, workspaceId, personId);

  if (kind === 'delegate') {
    const spendable = balances.availableUfern - feeUfern;
    const max = spendable > 0n ? spendable : 0n;
    if (amountUfern > max) {
      return { field: amountField, message: `You can delegate at most ${formatFern(max)} FERN.` };
    }
    return null;
  }

  const delegation = await delegationFor(tx, workspaceId, personId, validator.id);
  const delegated = delegation ? BigInt(delegation.amount_ufern) : 0n;
  const locked = await lockedStake(tx, workspaceId, personId, validator.id, now);
  const lockedTotal = locked.reduce((sum, item) => sum + item.amountUfern, 0n);
  const movable = delegated - lockedTotal;
  const verb = kind === 'undelegate' ? 'undelegate' : 'redelegate';
  if (amountUfern > delegated) {
    return {
      field: amountField,
      message: `You can ${verb} at most ${formatFern(movable > 0n ? movable : 0n)} FERN.`,
    };
  }
  if (amountUfern > movable) {
    const blocking = locked[0];
    return {
      field: amountField,
      message: `This stake arrived from ${blocking.fromName} at ${formatTime(
        blocking.arrivedAt.toISOString(),
        config.timeZone,
      )} and can move again at ${formatTime(blocking.movableAt.toISOString(), config.timeZone)}.`,
    };
  }
  if (kind === 'undelegate') {
    const count = await unbondingCount(tx, workspaceId, personId, validator.id);
    if (count >= config.maxUnbondings) {
      return {
        field: amountField,
        message: `You already have ${config.maxUnbondings} unbondings in progress from ${validator.name}.`,
      };
    }
  } else {
    const count = await redelegationCount(tx, workspaceId, personId, now);
    if (count >= config.maxRedelegations) {
      return {
        field: amountField,
        message: `You already have ${config.maxRedelegations} redelegations in progress.`,
      };
    }
  }
  if (balances.availableUfern < feeUfern) {
    return {
      field: amountField,
      message: `Insufficient balance: available ${formatFern(
        balances.availableUfern,
      )} FERN, this transaction needs ${formatFern(feeUfern)} FERN.`,
    };
  }
  return null;
}

export function insufficientBalance(available: bigint, needed: bigint): string {
  return `Insufficient balance: available ${formatFern(available)} FERN, this transaction needs ${formatFern(
    needed,
  )} FERN.`;
}

/** Moves a delegation's pending rewards into the delegator's balance. */
async function withdrawRewards(
  tx: Queryable,
  workspaceId: string,
  delegation: DelegationRow,
  validatorName: string,
  height: number,
  at: Date,
): Promise<bigint> {
  const pending = BigInt(delegation.pending_rewards_ufern);
  if (pending === 0n) return 0n;
  await tx.query('UPDATE delegations SET pending_rewards_ufern = 0 WHERE id = $1', [delegation.id]);
  await postPair(tx, {
    workspaceId,
    debit: REWARDS_ACCOUNT,
    credit: memberAccount(delegation.person_id as string),
    amountUfern: pending,
    kind: 'rewards',
    label: `Rewards from ${validatorName}`,
    height,
    at,
  });
  return pending;
}

export async function applyDelegate(
  tx: Queryable,
  workspaceId: string,
  personId: string,
  validator: ValidatorRow,
  amountUfern: bigint,
  height: number,
  at: Date,
): Promise<void> {
  const existing = await delegationFor(tx, workspaceId, personId, validator.id);
  if (existing) {
    await withdrawRewards(tx, workspaceId, existing, validator.name, height, at);
    await tx.query('UPDATE delegations SET amount_ufern = amount_ufern + $2 WHERE id = $1', [
      existing.id,
      amountUfern,
    ]);
  } else {
    await tx.query(
      `INSERT INTO delegations (id, workspace_id, validator_id, person_id, amount_ufern, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), workspaceId, validator.id, personId, amountUfern, at],
    );
  }
  await postPair(tx, {
    workspaceId,
    debit: memberAccount(personId),
    credit: bondedAccount(validator.id),
    amountUfern,
    kind: 'delegate',
    label: `Delegation to ${validator.name}`,
    height,
    at,
  });
}

export async function applyUndelegate(
  tx: Queryable,
  workspaceId: string,
  personId: string,
  validator: ValidatorRow,
  amountUfern: bigint,
  height: number,
  at: Date,
): Promise<void> {
  const delegation = (await delegationFor(tx, workspaceId, personId, validator.id)) as DelegationRow;
  await withdrawRewards(tx, workspaceId, delegation, validator.name, height, at);
  const remaining = BigInt(delegation.amount_ufern) - amountUfern;
  if (remaining === 0n) {
    await tx.query('DELETE FROM delegations WHERE id = $1', [delegation.id]);
  } else {
    await tx.query('UPDATE delegations SET amount_ufern = $2 WHERE id = $1', [
      delegation.id,
      remaining,
    ]);
  }
  const completesAt = new Date(at.getTime() + config.unbondingSeconds * 1000);
  await tx.query(
    `INSERT INTO unbondings
       (id, workspace_id, validator_id, person_id, amount_ufern, started_at, completes_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [randomUUID(), workspaceId, validator.id, personId, amountUfern, at, completesAt],
  );
  await postPair(tx, {
    workspaceId,
    debit: bondedAccount(validator.id),
    credit: UNBONDING_ACCOUNT,
    amountUfern,
    kind: 'undelegate',
    label: `Unbonding started from ${validator.name}`,
    height,
    at,
  });
}

export async function applyRedelegate(
  tx: Queryable,
  workspaceId: string,
  personId: string,
  from: ValidatorRow,
  to: ValidatorRow,
  amountUfern: bigint,
  height: number,
  at: Date,
): Promise<void> {
  const delegation = (await delegationFor(tx, workspaceId, personId, from.id)) as DelegationRow;
  await withdrawRewards(tx, workspaceId, delegation, from.name, height, at);
  const remaining = BigInt(delegation.amount_ufern) - amountUfern;
  if (remaining === 0n) {
    await tx.query('DELETE FROM delegations WHERE id = $1', [delegation.id]);
  } else {
    await tx.query('UPDATE delegations SET amount_ufern = $2 WHERE id = $1', [
      delegation.id,
      remaining,
    ]);
  }
  const target = await delegationFor(tx, workspaceId, personId, to.id);
  if (target) {
    await tx.query('UPDATE delegations SET amount_ufern = amount_ufern + $2 WHERE id = $1', [
      target.id,
      amountUfern,
    ]);
  } else {
    await tx.query(
      `INSERT INTO delegations (id, workspace_id, validator_id, person_id, amount_ufern, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), workspaceId, to.id, personId, amountUfern, at],
    );
  }
  await tx.query(
    `INSERT INTO redelegations
       (id, workspace_id, person_id, from_validator_id, to_validator_id, amount_ufern, arrived_at, movable_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      randomUUID(),
      workspaceId,
      personId,
      from.id,
      to.id,
      amountUfern,
      at,
      new Date(at.getTime() + config.unbondingSeconds * 1000),
    ],
  );
  await postPair(tx, {
    workspaceId,
    debit: bondedAccount(from.id),
    credit: bondedAccount(to.id),
    amountUfern,
    kind: 'redelegate',
    label: `Redelegation from ${from.name} to ${to.name}`,
    height,
    at,
  });
}

export async function pendingRewardsTotal(
  tx: Queryable,
  workspaceId: string,
  personId: string,
): Promise<bigint> {
  const { rows } = await tx.query<{ total: string | null }>(
    `SELECT sum(pending_rewards_ufern)::text AS total FROM delegations
     WHERE workspace_id = $1 AND person_id = $2`,
    [workspaceId, personId],
  );
  return BigInt(rows[0]?.total ?? '0');
}

export async function applyClaim(
  tx: Queryable,
  workspaceId: string,
  personId: string,
  height: number,
  at: Date,
): Promise<bigint> {
  const { rows } = await tx.query<DelegationRow & { name: string }>(
    `SELECT d.id, d.validator_id, d.person_id, d.amount_ufern::text,
            d.pending_rewards_ufern::text, v.name
     FROM delegations d JOIN validators v ON v.id = d.validator_id
     WHERE d.workspace_id = $1 AND d.person_id = $2 AND d.pending_rewards_ufern > 0
     ORDER BY v.position`,
    [workspaceId, personId],
  );
  let total = 0n;
  for (const row of rows) {
    total += await withdrawRewards(tx, workspaceId, row, row.name, height, at);
  }
  return total;
}

/** Posts the per-block reward split; delegator cuts accrue as pending. */
export async function payBlockRewards(
  tx: Queryable,
  workspaceId: string,
  height: number,
  at: Date,
): Promise<void> {
  const validators = await validatorsOf(tx, workspaceId);
  const delegations = await delegationsOf(tx, workspaceId);
  const bonded = delegations.reduce((sum, row) => sum + BigInt(row.amount_ufern), 0n);
  if (bonded === 0n) return;
  const payouts = splitBlockReward(
    validators.map((validator) => {
      const own = delegations.filter((row) => row.validator_id === validator.id);
      return {
        id: validator.id,
        stakeUfern: own.reduce((sum, row) => sum + BigInt(row.amount_ufern), 0n),
        commissionNumerator: BigInt(validator.commission_numerator),
        commissionDenominator: BigInt(validator.commission_denominator),
        delegations: own.map((row) => ({ id: row.id, amountUfern: BigInt(row.amount_ufern) })),
      };
    }),
    bonded,
    config.blockRewardUfern,
  );
  const byId = new Map(delegations.map((row) => [row.id, row]));
  for (const payout of payouts) {
    const validator = validators.find((row) => row.id === payout.validatorId) as ValidatorRow;
    let operatorAmount = payout.commissionUfern;
    for (const cut of payout.delegations) {
      const delegation = byId.get(cut.id) as DelegationRow;
      if (delegation.person_id === null) {
        operatorAmount += cut.amountUfern;
        continue;
      }
      if (cut.amountUfern === 0n) continue;
      await tx.query(
        'UPDATE delegations SET pending_rewards_ufern = pending_rewards_ufern + $2 WHERE id = $1',
        [cut.id, cut.amountUfern],
      );
    }
    if (operatorAmount === 0n) continue;
    await postPair(tx, {
      workspaceId,
      debit: REWARDS_ACCOUNT,
      credit: operatorAccount(validator.id),
      amountUfern: operatorAmount,
      kind: 'rewards',
      label: `Rewards from ${validator.name}`,
      height,
      at,
    });
  }
}

/** Releases every unbonding whose end instant has come, inclusive. */
export async function releaseUnbondingsAt(tx: Queryable, at: Date): Promise<void> {
  const { rows } = await tx.query<{
    id: string;
    workspace_id: string;
    person_id: string;
    amount_ufern: string;
    name: string;
    email: string;
    workspace_name: string;
  }>(
    `SELECT u.id, u.workspace_id, u.person_id, u.amount_ufern::text, v.name,
            p.email, w.name AS workspace_name
     FROM unbondings u
       JOIN validators v ON v.id = u.validator_id
       JOIN people p ON p.id = u.person_id
       JOIN workspaces w ON w.id = u.workspace_id
     WHERE u.released_at IS NULL AND u.completes_at <= $1
     ORDER BY u.completes_at, u.id`,
    [at],
  );
  for (const row of rows) {
    const amount = BigInt(row.amount_ufern);
    await tx.query('UPDATE unbondings SET released_at = $2 WHERE id = $1', [row.id, at]);
    await postPair(tx, {
      workspaceId: row.workspace_id,
      debit: UNBONDING_ACCOUNT,
      credit: memberAccount(row.person_id),
      amountUfern: amount,
      kind: 'unbonding-release',
      label: `Unbonding released from ${row.name}`,
      height: null,
      at,
    });
    await queueMail(
      tx,
      row.workspace_id,
      {
        recipient: row.email,
        subject: `Unbonding complete: ${formatFern(amount)} FERN from ${row.name}`,
        body: `Your unbonding of ${formatFern(amount)} FERN from ${row.name} in ${
          row.workspace_name
        } on Fernsquare is complete. The tokens are back in your balance.`,
      },
      at,
    );
  }
}
