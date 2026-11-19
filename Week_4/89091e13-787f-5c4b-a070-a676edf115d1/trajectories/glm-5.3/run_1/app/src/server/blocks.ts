// Block production: takes pending blobs in submission order while they fit,
// lays out the square, extends it, commits the roots, pays rewards, includes
// staking and governance transactions and applies producer behaviour.

import { randomBytes } from "node:crypto";
import {
  TAIL_PADDING_NAMESPACE,
  bytesToHex,
  dataRootOf,
  encodeBlobShares,
  extendSquare,
  layoutSquare,
  rowRoot,
  columnRoot,
  tailPaddingShare,
  toRootRef,
  type LaidOutSquare,
  type RootRef,
} from "../shared/domain.js";
import type { AppConfig } from "./config.js";
import type { Db, DbClient } from "./db.js";
import type { LiveHub } from "./live.js";
import type { Storage } from "./storage.js";
import {
  bondedAccount,
  depositsAccount,
  ledgerPair,
  personAccount,
  postPair,
} from "./ledger.js";
import { queueMail } from "./mail.js";

export interface ProducedBlock {
  height: number;
  k: number;
  dataRoot: string;
  blobCount: number;
  status: "sampling" | "available" | "rejected";
}

interface PendingTx {
  id: string;
  kind: string;
  sender_id: string;
  fee_ufern: bigint;
  payload: Record<string, unknown>;
  sequence: number;
  hold_ufern: bigint;
}

interface PendingBlobTx extends PendingTx {
  blob_id: string;
  namespace: string;
  size: number;
  shares: number;
}

/** Produces block `height` of a workspace at its instant. */
export async function produceBlock(
  config: AppConfig,
  db: Db,
  hub: LiveHub,
  storage: Storage,
  workspaceId: string,
  height: number,
): Promise<void> {
  const at = new Date(config.appStartAtMs + height * config.blockTimeSeconds * 1000);
  await db.transaction(async (tx) => {
    const workspace = await tx.one<{ name: string; next_block: string }>(
      `SELECT name, next_block FROM workspaces WHERE id = $1`,
      [workspaceId],
    );
    if (!workspace) return;
    const behaviour: "honest" | "withhold" | "bad-encoding" =
      workspace.next_block === "withhold" || workspace.next_block === "bad-encoding" ? workspace.next_block : "honest";
    await tx.query(`UPDATE workspaces SET next_block = 'honest' WHERE id = $1`, [workspaceId]);

    const pending = await tx.many<PendingTx>(
      `SELECT id, kind, sender_id, fee_ufern::bigint AS fee_ufern, payload, sequence, hold_ufern::bigint AS hold_ufern
       FROM transactions WHERE workspace_id = $1 AND status = 'pending' ORDER BY sequence`,
      [workspaceId],
    );

    const blobs: PendingBlobTx[] = [];
    const others: PendingTx[] = [];
    for (const txRow of pending) {
      if (txRow.kind === "blob") {
        const blobRow = await tx.one<{ id: string; namespace: string; size_bytes: number; shares: number }>(
          `SELECT id, namespace, size_bytes, shares FROM blobs WHERE tx_id = $1`,
          [txRow.id],
        );
        if (blobRow) {
          blobs.push({
            ...txRow,
            blob_id: blobRow.id,
            namespace: blobRow.namespace,
            size: blobRow.size_bytes,
            shares: blobRow.shares,
            payload: txRow.payload as Record<string, unknown>,
          });
        }
      } else {
        others.push(txRow);
      }
    }

    // Choose the blobs that fit, stopping at the first that does not.
    const taken: PendingBlobTx[] = [];
    let shareBudget = config.maxSquareWidth * config.maxSquareWidth;
    for (const blob of blobs) {
      if (blob.shares <= shareBudget) {
        taken.push(blob);
        shareBudget -= blob.shares;
      } else {
        break;
      }
    }

    const layout = layoutSquare(
      taken.map((blob) => ({ namespace: blob.namespace, shareCount: blob.shares })),
      config.maxSquareWidth,
    );

    const payloadRows = await tx.many<{ blob_id: string; data_base64: string }>(
      `SELECT b.id AS blob_id, t.payload->>'dataBase64' AS data_base64
       FROM blobs b JOIN transactions t ON t.id = b.tx_id
       WHERE b.workspace_id = $1 AND b.tx_id = ANY($2)`,
      [workspaceId, taken.map((blob) => blob.id)],
    );
    const payloads = new Map(
      payloadRows.map((row) => [row.blob_id, Buffer.from(row.data_base64 ?? "", "base64")]),
    );

    const original: Uint8Array[] = [];
    const blobShareRanges: { blobId: string; positions: [number, number][] }[] = [];
    const shareOwners: { blobIndex: number; shareIndex: number; namespace: string }[] = [];
    for (let i = 0; i < layout.shares.length; i++) {
      const share = layout.shares[i]!;
      if (share.kind === "blob") {
        const blob = taken[share.blobIndex]!;
        const data = payloads.get(blob.blob_id) ?? new Uint8Array(0);
        const encoded = encodeBlobShares(blob.namespace, data);
        original.push(encoded[share.shareIndex]!);
        shareOwners.push({ blobIndex: share.blobIndex, shareIndex: share.shareIndex, namespace: blob.namespace });
      } else {
        original.push(tailPaddingShare());
        shareOwners.push({ blobIndex: -1, shareIndex: -1, namespace: TAIL_PADDING_NAMESPACE });
      }
    }
    for (let i = 0; i < layout.blobs.length; i++) {
      blobShareRanges.push({ blobId: taken[layout.blobs[i]!.blobIndex]!.blob_id, positions: layout.blobs[i]!.positions });
    }

    const extended = extendSquare(original, layout.k);
    let extendedShares = extended.shares;
    const withheld = behaviour === "withhold";

    if (behaviour === "bad-encoding") {
      const altered = extendedShares.slice();
      const target = layout.k;
      const share = new Uint8Array(altered[target]!);
      share[14] = share[14]! ^ 0x01;
      altered[target] = share;
      extendedShares = altered;
    }

    const rowRoots: RootRef[] = [];
    const columnRoots: RootRef[] = [];
    for (let r = 0; r < extended.width; r++) rowRoots.push(toRootRef(rowRoot(extendedShares, layout.k, r)));
    for (let c = 0; c < extended.width; c++) columnRoots.push(toRootRef(columnRoot(extendedShares, layout.k, c)));
    const dataRoot = bytesToHex(dataRootOf(extendedShares, layout.k));

    const withheldSet = new Set<string>();
    if (withheld) {
      for (let r = layout.k - 1; r < extended.width; r++) {
        for (let c = layout.k - 1; c < extended.width; c++) {
          withheldSet.add(`${r},${c}`);
        }
      }
    }

    await tx.query(
      `INSERT INTO blocks (workspace_id, height, produced_at, square_width, status, blob_count, data_root, layout, row_roots, column_roots, shares_hex, withheld, producer_behaviour, rejection)
       VALUES ($1, $2, $3, $4, 'sampling', $5, $6, $7, $8, $9, $10, $11, $12, NULL)`,
      [
        workspaceId,
        height,
        at,
        layout.k,
        taken.length,
        dataRoot,
        JSON.stringify({ blobs: blobShareRanges, k: layout.k }),
        JSON.stringify(rowRoots),
        JSON.stringify(columnRoots),
        JSON.stringify(extendedShares.map((share) => bytesToHex(share))),
        JSON.stringify([...withheldSet]),
        behaviour,
      ],
    );

    for (const blob of taken) {
      await tx.query(`INSERT INTO block_blobs (workspace_id, height, blob_id) VALUES ($1, $2, $3)`, [
        workspaceId,
        height,
        blob.blob_id,
      ]);
      await tx.query(
        `UPDATE blobs SET positions = $2 WHERE id = $1`,
        [blob.blob_id, JSON.stringify(blobShareRanges.find((r) => r.blobId === blob.blob_id)?.positions ?? [])],
      );
    }

    // Rewards use stake as it stood before this block's transactions.
    await payRewards(config, tx, workspaceId, height, at);

    // Include non-blob transactions in submission order, then the blobs.
    for (const txRow of others) {
      await includeTransaction(config, tx, workspaceId, txRow, height, at);
    }
    for (const blob of taken) {
      await includeBlobTransaction(tx, workspaceId, blob, height, at);
    }
    // Blob transactions that did not fit stay pending with their holds.

    await tx.query(
      `INSERT INTO events (workspace_id, at, kind, body) VALUES ($1, $2, 'block-produced', $3)`,
      [workspaceId, at, JSON.stringify({ height, blobs: taken.length, square: layout.k })],
    );
  });

  const snapshotKey = `squares/${workspaceId}/${height}.bin`;
  const snapshot = await buildSnapshotBuffer(db, workspaceId, height);
  await storage.putDeferred(snapshotKey, snapshot);

  hub.publish(workspaceId, {
    kind: "block",
    body: { height, blobs: taken0BlobCount(db, workspaceId, height), square: layout0K(db, workspaceId, height) },
  });
}

async function taken0BlobCount(db: Db, workspaceId: string, height: number): Promise<number> {
  const row = await db.one<{ blob_count: number }>(
    `SELECT blob_count FROM blocks WHERE workspace_id = $1 AND height = $2`,
    [workspaceId, height],
  );
  return row?.blob_count ?? 0;
}

async function layout0K(db: Db, workspaceId: string, height: number): Promise<number> {
  const row = await db.one<{ square_width: number }>(
    `SELECT square_width FROM blocks WHERE workspace_id = $1 AND height = $2`,
    [workspaceId, height],
  );
  return row?.square_width ?? 1;
}

/** Snapshot bytes: 2k x 2k shares row by row, withheld shares as 64 zero bytes. */
export async function buildSnapshotBuffer(db: Db, workspaceId: string, height: number): Promise<Buffer> {
  const block = await db.one<{ shares_hex: string[]; withheld: string[]; square_width: number }>(
    `SELECT shares_hex, withheld, square_width FROM blocks WHERE workspace_id = $1 AND height = $2`,
    [workspaceId, height],
  );
  if (!block) return Buffer.alloc(0);
  const withheldSet = new Set(block.withheld);
  const out: Buffer[] = [];
  const width = block.square_width * 2;
  for (let r = 0; r < width; r++) {
    for (let c = 0; c < width; c++) {
      const index = r * width + c;
      if (withheldSet.has(`${r},${c}`)) {
        out.push(Buffer.alloc(64));
      } else {
        out.push(Buffer.from(block.shares_hex[index] ?? "", "hex"));
      }
    }
  }
  return Buffer.concat(out);
}

/** Per-block rewards by the stake, commission and floor-division rule. */
async function payRewards(
  config: AppConfig,
  tx: DbClient,
  workspaceId: string,
  height: number,
  at: Date,
): Promise<void> {
  const validators = await tx.many<{
    id: string;
    name: string;
    self_stake_ufern: bigint;
    commission: string;
    stake_ufern: bigint;
  }>(
    `SELECT v.id, v.name, v.self_stake_ufern::bigint AS self_stake_ufern, v.commission::text AS commission,
            (v.self_stake_ufern + COALESCE((SELECT SUM(amount_ufern) FROM delegations d WHERE d.validator_id = v.id), 0))::bigint AS stake_ufern
     FROM validators v WHERE v.workspace_id = $1`,
    [workspaceId],
  );
  const totalBonded = validators.reduce((acc, v) => acc + v.stake_ufern, 0n);
  if (totalBonded === 0n) return;
  const reward = config.blockRewardUfern;
  for (const validator of validators) {
    if (validator.stake_ufern === 0n) continue;
    const share = (reward * validator.stake_ufern) / totalBonded;
    const rateNumerator = BigInt(Math.round(Number(validator.commission) * 1_000_000));
    const commission = (share * rateNumerator) / 1_000_000n;
    const delegations = await tx.many<{ id: string; person_id: string; amount_ufern: bigint }>(
      `SELECT id, person_id, amount_ufern::bigint AS amount_ufern FROM delegations WHERE validator_id = $1`,
      [validator.id],
    );
    for (const delegation of delegations) {
      const cut = ((share - commission) * delegation.amount_ufern) / validator.stake_ufern;
      if (cut > 0n) {
        await tx.query(`UPDATE delegations SET pending_rewards_ufern = pending_rewards_ufern + $1 WHERE id = $2`, [
          cut.toString(),
          delegation.id,
        ]);
      }
    }
    if (commission > 0n) {
      const operatorPair = ledgerPair({
        workspaceId,
        credit: { account: `operator:${validator.id}`, amount: commission },
        debit: { account: "rewards", amount: commission },
        kind: "rewards",
        label: `Rewards from ${validator.name}`,
        at,
        height,
      });
      await postPair(tx, operatorPair);
    }
  }
}

async function includeBlobTransaction(
  tx: DbClient,
  workspaceId: string,
  blob: PendingBlobTx,
  height: number,
  at: Date,
): Promise<void> {
  await tx.query(
    `UPDATE transactions SET status = 'included', status_text = $2, height = $3, included_at = $4, hold_ufern = 0
     WHERE id = $1`,
    [blob.id, `Included in block ${height}`, height, at],
  );
  const feePair = ledgerPair({
    workspaceId,
    credit: { account: "burn", amount: blob.fee_ufern },
    debit: { account: personAccount(blob.sender_id), amount: blob.fee_ufern },
    kind: "fee",
    label: "Fee",
    at,
    height,
  });
  await postPair(tx, feePair);
}

async function includeTransaction(
  config: AppConfig,
  tx: DbClient,
  workspaceId: string,
  txRow: PendingTx,
  height: number,
  at: Date,
): Promise<void> {
  const payload = txRow.payload;
  const kind = txRow.kind;
  const burnFee = async () => {
    const feePair = ledgerPair({
      workspaceId,
      credit: { account: "burn", amount: txRow.fee_ufern },
      debit: { account: personAccount(txRow.sender_id), amount: txRow.fee_ufern },
      kind: "fee",
      label: "Fee",
      at,
      height,
    });
    await postPair(tx, feePair);
  };
  const reject = async (refusal: string) => {
    await tx.query(
      `UPDATE transactions SET status = 'rejected', status_text = $2, height = $3, included_at = $4, hold_ufern = 0, refusal = $5
       WHERE id = $1`,
      [txRow.id, `Rejected — ${refusal}`, height, at, refusal],
    );
    await burnFee();
  };
  const accept = async (statusText: string, work?: () => Promise<void>) => {
    await tx.query(
      `UPDATE transactions SET status = 'included', status_text = $2, height = $3, included_at = $4, hold_ufern = 0
       WHERE id = $1`,
      [txRow.id, statusText, height, at],
    );
    if (work) await work();
    await burnFee();
  };

  switch (kind) {
    case "delegate": {
      const validatorId = String(payload.validatorId ?? "");
      const amount = BigInt(String(payload.amountUfern ?? "0"));
      const validator = await tx.one<{ id: string; name: string }>(
        `SELECT id, name FROM validators WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, validatorId],
      );
      if (!validator) {
        await reject("Choose a validator.");
        return;
      }
      await accept(`Included in block ${height}`, async () => {
        const existing = await tx.one<{ id: string }>(
          `SELECT id FROM delegations WHERE workspace_id = $1 AND person_id = $2 AND validator_id = $3`,
          [workspaceId, txRow.sender_id, validatorId],
        );
        if (existing) {
          await tx.query(`UPDATE delegations SET amount_ufern = amount_ufern + $1 WHERE id = $2`, [
            amount.toString(),
            existing.id,
          ]);
        } else {
          await tx.query(
            `INSERT INTO delegations (id, workspace_id, person_id, validator_id, amount_ufern, created_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [randomBytes(12).toString("hex"), workspaceId, txRow.sender_id, validatorId, amount.toString(), at],
          );
        }
        const pair = ledgerPair({
          workspaceId,
          credit: { account: bondedAccount(validatorId), amount: amount },
          debit: { account: personAccount(txRow.sender_id), amount: amount },
          kind: "delegation",
          label: `Delegation to ${validator.name}`,
          at,
          height,
        });
        await postPair(tx, pair);
        await withdrawPendingRewards(tx, workspaceId, txRow.sender_id, validatorId, at, height, validator.name);
      });
      return;
    }
    case "undelegate": {
      const validatorId = String(payload.validatorId ?? "");
      const amount = BigInt(String(payload.amountUfern ?? "0"));
      const validator = await tx.one<{ id: string; name: string }>(
        `SELECT id, name FROM validators WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, validatorId],
      );
      if (!validator) {
        await reject("Choose a validator.");
        return;
      }
      const delegation = await tx.one<{ id: string; amount_ufern: bigint }>(
        `SELECT id, amount_ufern::bigint AS amount_ufern FROM delegations WHERE workspace_id = $1 AND person_id = $2 AND validator_id = $3`,
        [workspaceId, txRow.sender_id, validatorId],
      );
      if (!delegation || delegation.amount_ufern < amount) {
        await reject("You can undelegate at most 0 FERN.");
        return;
      }
      await accept(`Included in block ${height}`, async () => {
        await withdrawPendingRewards(tx, workspaceId, txRow.sender_id, validatorId, at, height, validator.name);
        if (delegation.amount_ufern === amount) {
          await tx.query(`DELETE FROM delegations WHERE id = $1`, [delegation.id]);
        } else {
          await tx.query(`UPDATE delegations SET amount_ufern = amount_ufern - $1 WHERE id = $2`, [
            amount.toString(),
            delegation.id,
          ]);
        }
        const pair = ledgerPair({
          workspaceId,
          credit: { account: "unbonding", amount },
          debit: { account: bondedAccount(validatorId), amount },
          kind: "unbonding-started",
          label: `Unbonding started from ${validator.name}`,
          at,
          height,
        });
        await postPair(tx, pair);
        const completesAt = new Date(at.getTime() + config.unbondingSeconds * 1000);
        await tx.query(
          `INSERT INTO unbondings (id, workspace_id, person_id, validator_id, amount_ufern, included_at, completes_at, tx_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            randomBytes(12).toString("hex"),
            workspaceId,
            txRow.sender_id,
            validatorId,
            amount.toString(),
            at,
            completesAt,
            txRow.id,
          ],
        );
      });
      return;
    }
    case "redelegate": {
      const fromId = String(payload.fromValidatorId ?? "");
      const toId = String(payload.toValidatorId ?? "");
      const amount = BigInt(String(payload.amountUfern ?? "0"));
      const from = await tx.one<{ id: string; name: string }>(
        `SELECT id, name FROM validators WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, fromId],
      );
      const to = await tx.one<{ id: string; name: string }>(
        `SELECT id, name FROM validators WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, toId],
      );
      if (!from || !to || fromId === toId) {
        await reject("Choose a validator.");
        return;
      }
      const delegation = await tx.one<{ id: string; amount_ufern: bigint }>(
        `SELECT id, amount_ufern::bigint AS amount_ufern FROM delegations WHERE workspace_id = $1 AND person_id = $2 AND validator_id = $3`,
        [workspaceId, txRow.sender_id, fromId],
      );
      if (!delegation || delegation.amount_ufern < amount) {
        await reject("You can redelegate at most 0 FERN.");
        return;
      }
      await accept(`Included in block ${height}`, async () => {
        await withdrawPendingRewards(tx, workspaceId, txRow.sender_id, fromId, at, height, from.name);
        if (delegation.amount_ufern === amount) {
          await tx.query(`DELETE FROM delegations WHERE id = $1`, [delegation.id]);
        } else {
          await tx.query(`UPDATE delegations SET amount_ufern = amount_ufern - $1 WHERE id = $2`, [
            amount.toString(),
            delegation.id,
          ]);
        }
        const existing = await tx.one<{ id: string }>(
          `SELECT id FROM delegations WHERE workspace_id = $1 AND person_id = $2 AND validator_id = $3`,
          [workspaceId, txRow.sender_id, toId],
        );
        if (existing) {
          await tx.query(`UPDATE delegations SET amount_ufern = amount_ufern + $1 WHERE id = $2`, [
            amount.toString(),
            existing.id,
          ]);
        } else {
          await tx.query(
            `INSERT INTO delegations (id, workspace_id, person_id, validator_id, amount_ufern, created_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [randomBytes(12).toString("hex"), workspaceId, txRow.sender_id, toId, amount.toString(), at],
          );
        }
        const pair = ledgerPair({
          workspaceId,
          credit: { account: bondedAccount(toId), amount },
          debit: { account: bondedAccount(fromId), amount },
          kind: "redelegation",
          label: `Redelegation from ${from.name} to ${to.name}`,
          at,
          height,
        });
        await postPair(tx, pair);
        const movableAt = new Date(at.getTime() + config.unbondingSeconds * 1000);
        await tx.query(
          `INSERT INTO redelegations (id, workspace_id, person_id, from_validator_id, to_validator_id, amount_ufern, arrived_at, movable_at, tx_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            randomBytes(12).toString("hex"),
            workspaceId,
            txRow.sender_id,
            fromId,
            toId,
            amount.toString(),
            at,
            movableAt,
            txRow.id,
          ],
        );
      });
      return;
    }
    case "claim": {
      const total = await pendingRewardsTotal(tx, workspaceId, txRow.sender_id);
      if (total === 0n) {
        await reject("There are no rewards to claim.");
        return;
      }
      await accept(`Included in block ${height}`, async () => {
        await withdrawAllPendingRewards(tx, workspaceId, txRow.sender_id, at, height);
      });
      return;
    }
    case "proposal": {
      const title = String(payload.title ?? "");
      const deposit = BigInt(String(payload.amountUfern ?? "0"));
      await accept(`Included in block ${height}`, async () => {
        const nextNumber = await nextProposalNumber(tx, workspaceId);
        const depositEndsAt = new Date(at.getTime() + config.depositPeriodSeconds * 1000);
        await tx.query(
          `INSERT INTO proposals (workspace_id, number, title, description, status, status_text, deposit_ufern, min_deposit_ufern, tx_id, created_at, deposit_ends_at, voting_ends_at)
           VALUES ($1, $2, $3, $4, 'deposit', 'Deposit period', $5, $6, $7, $8, $9, NULL)`,
          [
            workspaceId,
            nextNumber,
            title,
            String(payload.description ?? ""),
            deposit.toString(),
            config.minDepositUfern.toString(),
            txRow.id,
            at,
            depositEndsAt,
          ],
        );
        if (deposit > 0n) {
          const pair = ledgerPair({
            workspaceId,
            credit: { account: depositsAccount(nextNumber), amount: deposit },
            debit: { account: personAccount(txRow.sender_id), amount: deposit },
            kind: "deposit",
            label: `Deposit on proposal ${nextNumber}`,
            at,
            height,
          });
          await postPair(tx, pair);
          await tx.query(
            `INSERT INTO deposits (id, workspace_id, number, person_id, amount_ufern, tx_id, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [randomBytes(12).toString("hex"), workspaceId, nextNumber, txRow.sender_id, deposit.toString(), txRow.id, at],
          );
        }
        if (deposit >= config.minDepositUfern) {
          await openVotingPeriod(tx, config, workspaceId, nextNumber, at);
        }
      });
      return;
    }
    case "deposit": {
      const number = Number(payload.number ?? 0);
      const amount = BigInt(String(payload.amountUfern ?? "0"));
      const proposal = await tx.one<{ status: string; deposit_ends_at: Date | null }>(
        `SELECT status, deposit_ends_at FROM proposals WHERE workspace_id = $1 AND number = $2`,
        [workspaceId, number],
      );
      if (!proposal || proposal.status !== "deposit" || !proposal.deposit_ends_at || proposal.deposit_ends_at.getTime() <= at.getTime()) {
        await reject(`The deposit period for proposal ${number} has ended.`);
        return;
      }
      await accept(`Included in block ${height}`, async () => {
        await tx.query(
          `UPDATE proposals SET deposit_ufern = deposit_ufern + $1 WHERE workspace_id = $2 AND number = $3`,
          [amount.toString(), workspaceId, number],
        );
        const pair = ledgerPair({
          workspaceId,
          credit: { account: depositsAccount(number), amount },
          debit: { account: personAccount(txRow.sender_id), amount },
          kind: "deposit",
          label: `Deposit on proposal ${number}`,
          at,
          height,
        });
        await postPair(tx, pair);
        await tx.query(
          `INSERT INTO deposits (id, workspace_id, number, person_id, amount_ufern, tx_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [randomBytes(12).toString("hex"), workspaceId, number, txRow.sender_id, amount.toString(), txRow.id, at],
        );
        const updated = await tx.one<{ deposit_ufern: bigint; min_deposit_ufern: bigint; status: string }>(
          `SELECT deposit_ufern::bigint AS deposit_ufern, min_deposit_ufern::bigint AS min_deposit_ufern, status FROM proposals WHERE workspace_id = $1 AND number = $2`,
          [workspaceId, number],
        );
        if (updated && updated.status === "deposit" && updated.deposit_ufern >= updated.min_deposit_ufern) {
          await openVotingPeriod(tx, config, workspaceId, number, at);
        }
      });
      return;
    }
    case "vote": {
      const number = Number(payload.number ?? 0);
      const option = String(payload.option ?? "");
      const proposal = await tx.one<{ status: string; voting_ends_at: Date | null }>(
        `SELECT status, voting_ends_at FROM proposals WHERE workspace_id = $1 AND number = $2`,
        [workspaceId, number],
      );
      if (!proposal || proposal.status !== "voting" || !proposal.voting_ends_at || proposal.voting_ends_at.getTime() <= at.getTime()) {
        await reject(`The voting period for proposal ${number} has ended.`);
        return;
      }
      await accept(`Included in block ${height}`, async () => {
        await tx.query(
          `INSERT INTO votes (workspace_id, number, person_id, option, tx_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (workspace_id, number, person_id) DO UPDATE SET option = EXCLUDED.option, tx_id = EXCLUDED.tx_id, created_at = EXCLUDED.created_at`,
          [workspaceId, number, txRow.sender_id, option, txRow.id, at],
        );
      });
      return;
    }
    default:
      await reject("Unknown transaction kind.");
      return;
  }
}

export async function withdrawPendingRewards(
  tx: DbClient,
  workspaceId: string,
  personId: string,
  validatorId: string,
  at: Date,
  height: number,
  validatorName: string,
): Promise<void> {
  const delegation = await tx.one<{ id: string; pending_rewards_ufern: bigint }>(
    `SELECT id, pending_rewards_ufern::bigint AS pending_rewards_ufern FROM delegations
     WHERE workspace_id = $1 AND person_id = $2 AND validator_id = $3`,
    [workspaceId, personId, validatorId],
  );
  if (!delegation || delegation.pending_rewards_ufern === 0n) return;
  await tx.query(`UPDATE delegations SET pending_rewards_ufern = 0 WHERE id = $1`, [delegation.id]);
  const pair = ledgerPair({
    workspaceId,
    credit: { account: personAccount(personId), amount: delegation.pending_rewards_ufern },
    debit: { account: "rewards", amount: delegation.pending_rewards_ufern },
    kind: "rewards",
    label: `Rewards from ${validatorName}`,
    at,
    height,
  });
  await postPair(tx, pair);
}

async function withdrawAllPendingRewards(
  tx: DbClient,
  workspaceId: string,
  personId: string,
  at: Date,
  height: number,
): Promise<void> {
  const rows = await tx.many<{ validator_id: string; name: string; pending: bigint }>(
    `SELECT d.validator_id, v.name, d.pending_rewards_ufern::bigint AS pending FROM delegations d
     JOIN validators v ON v.id = d.validator_id
     WHERE d.workspace_id = $1 AND d.person_id = $2 AND d.pending_rewards_ufern > 0`,
    [workspaceId, personId],
  );
  for (const row of rows) {
    await withdrawPendingRewards(tx, workspaceId, personId, row.validator_id, at, height, row.name);
  }
}

async function pendingRewardsTotal(tx: DbClient, workspaceId: string, personId: string): Promise<bigint> {
  const row = await tx.one<{ total: bigint | null }>(
    `SELECT COALESCE(SUM(pending_rewards_ufern), 0) AS total FROM delegations WHERE workspace_id = $1 AND person_id = $2`,
    [workspaceId, personId],
  );
  return row?.total ?? 0n;
}

async function nextProposalNumber(tx: DbClient, workspaceId: string): Promise<number> {
  const row = await tx.one<{ next: number }>(
    `SELECT COALESCE(MAX(number) + 1, 1) AS next FROM proposals WHERE workspace_id = $1`,
    [workspaceId],
  );
  return row?.next ?? 1;
}

/** Opens the voting period; the voting clock starts at this block's instant. */
export async function openVotingPeriod(
  tx: DbClient,
  config: AppConfig,
  workspaceId: string,
  number: number,
  at: Date,
): Promise<void> {
  const votingEndsAt = new Date(at.getTime() + config.votingPeriodSeconds * 1000);
  await tx.query(
    `UPDATE proposals SET status = 'voting', status_text = 'Voting period', voting_opened_at = $1, voting_ends_at = $2
     WHERE workspace_id = $3 AND number = $4`,
    [at, votingEndsAt, workspaceId, number],
  );
  const members = await tx.many<{ email: string; name: string }>(
    `SELECT p.email, p.name FROM memberships m JOIN people p ON p.id = m.person_id WHERE m.workspace_id = $1`,
    [workspaceId],
  );
  const proposal = await tx.one<{ title: string }>(
    `SELECT title FROM proposals WHERE workspace_id = $1 AND number = $2`,
    [workspaceId, number],
  );
  for (const member of members) {
    await queueMail(
      tx,
      workspaceId,
      member.email,
      `Voting is open on proposal ${number}: ${proposal?.title ?? ""}`,
      `Voting is open on proposal ${number}: ${proposal?.title ?? ""}\n\nThe voting period of this proposal in your Fernsquare workspace ends at ${votingEndsAt.toISOString()}.`,
    );
  }
}

export type { LaidOutSquare };
