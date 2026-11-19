import { config } from "./config.ts";
import { maybeOne, rows, run, type Db } from "./db.ts";
import { enqueueMail } from "./outbox.ts";
import { REWARDS, UNBONDING, bondedAccount, memberAccount, operatorAccount, post } from "./ledger.ts";
import { stakingFee } from "./fee.ts";
import { isUuid } from "./ids.ts";
import { latestHeight } from "./workspace.ts";
import type { Refusal } from "./errors.ts";
import { formatFern, formatFernUnit, formatTime, parseFern } from "../shared/units.ts";

interface ValidatorRow {
  id: string;
  name: string;
  selfStake: number;
  commissionBasisPoints: number;
  stake: number;
}

export async function validatorsOf(db: Db, workspaceId: string): Promise<ValidatorRow[]> {
  return rows<ValidatorRow>(
    db,
    `SELECT v.id, v.name, v.self_stake_ufern AS "selfStake", v.commission_basis_points AS "commissionBasisPoints",
            (v.self_stake_ufern + COALESCE((SELECT SUM(d.amount_ufern) FROM delegations d WHERE d.validator_id = v.id), 0))::bigint AS stake
     FROM validators v WHERE v.workspace_id = $1 ORDER BY v.name`,
    [workspaceId],
  );
}

export async function totalBonded(db: Db, workspaceId: string): Promise<number> {
  return (await validatorsOf(db, workspaceId)).reduce((sum, v) => sum + v.stake, 0);
}

/**
 * Rewards of a block use the stake as it stood before the block's transactions:
 * validator share = floor(R x stake / total bonded), commission = floor(share x rate) paid to the operator,
 * each delegation, the validator's self stake included (paid to the operator), gets floor((share - commission) x amount / validator stake);
 * remainders are discarded.
 */
export async function payRewards(db: Db, workspaceId: string, height: number, at: Date): Promise<void> {
  const validators = await validatorsOf(db, workspaceId);
  const total = validators.reduce((sum, v) => sum + v.stake, 0);
  for (const validator of validators) {
    if (validator.stake === 0) continue;
    const share = Number((BigInt(config.blockRewardUfern) * BigInt(validator.stake)) / BigInt(total));
    const commission = Number((BigInt(share) * BigInt(validator.commissionBasisPoints)) / 10_000n);
    const selfReward = Number((BigInt(share - commission) * BigInt(validator.selfStake)) / BigInt(validator.stake));
    const operatorReward = commission + selfReward;
    if (operatorReward > 0) {
      await post(db, {
        workspaceId, from: REWARDS, to: operatorAccount(validator.id), amount: operatorReward, kind: "rewards",
        label: `Rewards from ${validator.name}`, height, at,
      });
    }
    await run(
      db,
      `UPDATE delegations SET pending_rewards_ufern = pending_rewards_ufern + FLOOR($3::numeric * amount_ufern / $4::numeric)::bigint
       WHERE workspace_id = $1 AND validator_id = $2`,
      [workspaceId, validator.id, share - commission, validator.stake],
    );
  }
}

interface DelegationRow {
  validatorId: string;
  validatorName: string;
  amount: number;
  pending: number;
}

export async function delegationsOf(db: Db, workspaceId: string, userId: string): Promise<DelegationRow[]> {
  return rows<DelegationRow>(
    db,
    `SELECT d.validator_id AS "validatorId", v.name AS "validatorName", d.amount_ufern AS amount, d.pending_rewards_ufern AS pending
     FROM delegations d JOIN validators v ON v.id = d.validator_id
     WHERE d.workspace_id = $1 AND d.user_id = $2 AND d.amount_ufern > 0 ORDER BY v.name`,
    [workspaceId, userId],
  );
}

interface Moment {
  workspaceId: string;
  height: number;
  at: Date;
}

/** Moves a delegation's pending rewards into the person's balance. */
async function withdrawRewards(db: Db, moment: Moment, userId: string, validatorId: string): Promise<void> {
  const row = await maybeOne<{ pending: number; name: string }>(
    db,
    `SELECT d.pending_rewards_ufern AS pending, v.name FROM delegations d JOIN validators v ON v.id = d.validator_id
     WHERE d.workspace_id = $1 AND d.user_id = $2 AND d.validator_id = $3`,
    [moment.workspaceId, userId, validatorId],
  );
  if (!row || row.pending === 0) return;
  await post(db, { ...moment, from: REWARDS, to: memberAccount(userId), amount: row.pending, kind: "rewards", label: `Rewards from ${row.name}` });
  await run(db, "UPDATE delegations SET pending_rewards_ufern = 0 WHERE workspace_id = $1 AND user_id = $2 AND validator_id = $3", [moment.workspaceId, userId, validatorId]);
}

async function validatorName(db: Db, validatorId: string): Promise<string> {
  return (await maybeOne<{ name: string }>(db, "SELECT name FROM validators WHERE id = $1", [validatorId]))?.name ?? "";
}

async function addToDelegation(db: Db, workspaceId: string, userId: string, validatorId: string, amount: number): Promise<void> {
  await run(
    db,
    `INSERT INTO delegations (workspace_id, user_id, validator_id, amount_ufern) VALUES ($1, $2, $3, $4)
     ON CONFLICT (workspace_id, user_id, validator_id) DO UPDATE SET amount_ufern = delegations.amount_ufern + $4`,
    [workspaceId, userId, validatorId, amount],
  );
}

export type StakeKind = "delegate" | "undelegate" | "redelegate" | "claim";

export interface StakeRequest {
  kind: StakeKind;
  validator?: string;
  from?: string;
  to?: string;
  amount: number;
}

/** Stake still locked by an earlier redelegation into this validator, with the latest lock's details. */
async function lockOf(db: Db, workspaceId: string, userId: string, validatorId: string, now: Date) {
  const locks = await rows<{ amount: number; arrivedAt: Date; movableAt: Date; fromName: string }>(
    db,
    `SELECT r.amount_ufern AS amount, r.arrived_at AS "arrivedAt", r.movable_at AS "movableAt", v.name AS "fromName"
     FROM redelegations r JOIN validators v ON v.id = r.from_validator
     WHERE r.workspace_id = $1 AND r.user_id = $2 AND r.to_validator = $3 AND r.movable_at > $4 ORDER BY r.movable_at DESC`,
    [workspaceId, userId, validatorId, now],
  );
  return { locked: locks.reduce((sum, l) => sum + l.amount, 0), latest: locks[0] };
}

async function unbondingsInProgress(db: Db, workspaceId: string, userId: string, validatorId: string): Promise<number> {
  const row = await maybeOne<{ n: number }>(
    db,
    "SELECT count(*)::int AS n FROM unbondings WHERE workspace_id = $1 AND user_id = $2 AND validator_id = $3 AND released_at IS NULL",
    [workspaceId, userId, validatorId],
  );
  return row?.n ?? 0;
}

async function redelegationsInProgress(db: Db, workspaceId: string, userId: string, now: Date): Promise<number> {
  const row = await maybeOne<{ n: number }>(
    db,
    "SELECT count(*)::int AS n FROM redelegations WHERE workspace_id = $1 AND user_id = $2 AND movable_at > $3",
    [workspaceId, userId, now],
  );
  return row?.n ?? 0;
}

async function unclaimedRewards(db: Db, workspaceId: string, userId: string): Promise<number> {
  return (await delegationsOf(db, workspaceId, userId)).reduce((sum, d) => sum + d.pending, 0);
}

/**
 * The published refusals 5-9 in order, against the person's funds (available balance when submitting,
 * balance when the block takes the transaction). Null when the request may go ahead.
 */
export async function refuseStake(db: Db, workspaceId: string, userId: string, request: StakeRequest, now: Date, funds: number): Promise<Refusal | null> {
  const fee = stakingFee();
  if (request.kind === "delegate") {
    const most = Math.max(0, funds - fee);
    if (request.amount > most) return { field: "amount", message: `You can delegate at most ${formatFern(most)} FERN.` };
  }
  if (request.kind === "undelegate" || request.kind === "redelegate") {
    const source = (request.kind === "undelegate" ? request.validator : request.from) as string;
    const held = (await delegationsOf(db, workspaceId, userId)).find((d) => d.validatorId === source)?.amount ?? 0;
    if (request.amount > held) return { field: "amount", message: `You can ${request.kind} at most ${formatFern(held)} FERN.` };
    if (request.kind === "redelegate") {
      const { locked, latest } = await lockOf(db, workspaceId, userId, source, now);
      if (latest && request.amount > held - locked) {
        return {
          field: "amount",
          message: `This stake arrived from ${latest.fromName} at ${formatTime(latest.arrivedAt, config.timeZone)} and can move again at ${formatTime(latest.movableAt, config.timeZone)}.`,
        };
      }
    }
    if (request.kind === "undelegate" && (await unbondingsInProgress(db, workspaceId, userId, source)) >= config.maxUnbondings) {
      return { field: "amount", message: `You already have ${config.maxUnbondings} unbondings in progress from ${await validatorName(db, source)}.` };
    }
    if (request.kind === "redelegate" && (await redelegationsInProgress(db, workspaceId, userId, now)) >= config.maxRedelegations) {
      return { field: "amount", message: `You already have ${config.maxRedelegations} redelegations in progress.` };
    }
  }
  if (funds < fee) {
    return {
      field: request.kind === "claim" ? "fee" : "amount",
      message: `Insufficient balance: available ${formatFern(funds)} FERN, this transaction needs ${formatFern(fee)} FERN.`,
    };
  }
  if (request.kind === "claim" && (await unclaimedRewards(db, workspaceId, userId)) === 0) {
    return { field: null, message: "There are no rewards to claim." };
  }
  return null;
}

/** Refusals 1-4 on the raw request fields: the validators exist, differ, and the amount is a positive FERN amount. */
export async function parseStakeBody(db: Db, workspaceId: string, kind: StakeKind, body: Record<string, unknown>): Promise<StakeRequest | Refusal> {
  const known = async (value: unknown) =>
    isUuid(value) && (await maybeOne(db, "SELECT 1 FROM validators WHERE id = $1 AND workspace_id = $2", [value, workspaceId])) ? value : null;
  if (kind === "claim") return { kind, amount: 0 };
  const choose = { field: "", message: "Choose a validator." };
  let validator: string | undefined;
  let from: string | undefined;
  let to: string | undefined;
  if (kind === "redelegate") {
    from = (await known(body.from)) ?? undefined;
    if (!from) return { ...choose, field: "from" };
    to = (await known(body.to)) ?? undefined;
    if (!to) return { ...choose, field: "to" };
    if (from === to) return { field: "to", message: "Choose a different validator." };
  } else {
    validator = (await known(body.validator)) ?? undefined;
    if (!validator) return { ...choose, field: "validator" };
  }
  const amount = parseFern(body.amount);
  if (amount === null) return { field: "amount", message: "Amount must be an amount in FERN with at most 6 decimals." };
  if (amount === 0) return { field: "amount", message: "Amount must be more than 0." };
  return { kind, validator, from, to, amount };
}

/** Applies a staking transaction the block has taken. The caller has already checked the refusals. */
export async function applyStake(db: Db, moment: Moment, userId: string, request: StakeRequest): Promise<void> {
  const { workspaceId, height, at } = moment;
  const posting = { workspaceId, height, at };
  if (request.kind === "claim") {
    for (const delegation of await delegationsOf(db, workspaceId, userId)) await withdrawRewards(db, moment, userId, delegation.validatorId);
    return;
  }
  if (request.kind === "delegate") {
    const target = request.validator as string;
    await withdrawRewards(db, moment, userId, target);
    await addToDelegation(db, workspaceId, userId, target, request.amount);
    await post(db, { ...posting, from: memberAccount(userId), to: bondedAccount(target), amount: request.amount, kind: "delegation", label: `Delegation to ${await validatorName(db, target)}` });
    return;
  }
  const source = (request.kind === "undelegate" ? request.validator : request.from) as string;
  await withdrawRewards(db, moment, userId, source);
  await addToDelegation(db, workspaceId, userId, source, -request.amount);
  if (request.kind === "undelegate") {
    await post(db, { ...posting, from: bondedAccount(source), to: UNBONDING, amount: request.amount, kind: "unbonding", label: `Unbonding started from ${await validatorName(db, source)}` });
    await run(
      db,
      "INSERT INTO unbondings (workspace_id, user_id, validator_id, amount_ufern, completes_at) VALUES ($1, $2, $3, $4, $5)",
      [workspaceId, userId, source, request.amount, new Date(at.getTime() + config.unbondingMs)],
    );
    return;
  }
  const target = request.to as string;
  await addToDelegation(db, workspaceId, userId, target, request.amount);
  await post(db, {
    ...posting, from: bondedAccount(source), to: bondedAccount(target), amount: request.amount, kind: "redelegation",
    label: `Redelegation from ${await validatorName(db, source)} to ${await validatorName(db, target)}`,
  });
  await run(
    db,
    `INSERT INTO redelegations (workspace_id, user_id, from_validator, to_validator, amount_ufern, arrived_at, movable_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [workspaceId, userId, source, target, request.amount, at, new Date(at.getTime() + config.unbondingMs)],
  );
}

/** At its end instant (inclusive) an unbonding returns its tokens, posts the release and queues the notice in one step. */
export async function releaseUnbonding(db: Db, unbondingId: number): Promise<{ workspaceId: string }> {
  const row = await maybeOne<{ workspaceId: string; userId: string; validatorId: string; amount: number; completesAt: Date; workspaceName: string; email: string }>(
    db,
    `SELECT u.workspace_id AS "workspaceId", u.user_id AS "userId", u.validator_id AS "validatorId", u.amount_ufern AS amount,
            u.completes_at AS "completesAt", w.name AS "workspaceName", us.email
     FROM unbondings u JOIN workspaces w ON w.id = u.workspace_id JOIN users us ON us.id = u.user_id WHERE u.id = $1`,
    [unbondingId],
  );
  if (!row) throw new Error("unbonding vanished");
  const height = await latestHeight(db, row.workspaceId);
  const name = await validatorName(db, row.validatorId);
  await post(db, {
    workspaceId: row.workspaceId, from: UNBONDING, to: memberAccount(row.userId), amount: row.amount, kind: "release",
    label: `Unbonding released from ${name}`, height, at: row.completesAt,
  });
  await run(db, "UPDATE unbondings SET released_at = $2 WHERE id = $1", [unbondingId, row.completesAt]);
  await enqueueMail(
    db,
    row.email,
    `Unbonding complete: ${formatFernUnit(row.amount)} from ${name}`,
    `Your unbonding from ${name} in ${row.workspaceName} has completed. ${formatFernUnit(row.amount)} is back in your balance.`,
  );
  return { workspaceId: row.workspaceId };
}
