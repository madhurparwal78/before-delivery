import { config } from "./config.ts";
import { maybeOne, pool, rows, run, type AfterCommit, type Db } from "./db.ts";
import { enqueueMail, deliverDueMail } from "./outbox.ts";
import { BURN, balanceOf, memberAccount, post } from "./ledger.ts";
import { membersOf, workspaceName } from "./workspace.ts";
import { applyGovernance, refuseGovernance, type GovernanceRequest } from "./governance.ts";
import { applyStake, payRewards, refuseStake, type StakeRequest } from "./staking.ts";
import { putObject } from "./storage.ts";
import { broadcast } from "./live.ts";
import { commit, extendSquare, layoutSquare, snapshotBytes, splitSquare, tamperWithShare, type LayoutBlob } from "./square.ts";
import { concat } from "../shared/bytes.ts";
import { rejectionText } from "../shared/copy.ts";
import type { NextBlock, Rejection } from "../shared/api.ts";

interface PendingTransaction {
  id: string;
  kind: string;
  sender: string;
  feeUfern: number;
  params: StakeRequest | GovernanceRequest;
  blobId: string | null;
  namespace: string | null;
  shares: number | null;
  payload: Buffer | null;
}

const PENDING_COLUMNS = `t.id, t.kind, t.sender, t.fee_ufern AS "feeUfern", t.params, b.id AS "blobId", b.namespace, b.shares, b.payload`;

/** Runs the refusals for one non-blob transaction against the person's balance as the block reaches it. */
async function refusalAtInclusion(db: Db, workspaceId: string, tx: PendingTransaction, at: Date): Promise<string | null> {
  const funds = await balanceOf(db, workspaceId, memberAccount(tx.sender));
  const refusal =
    tx.kind === "proposal" || tx.kind === "deposit" || tx.kind === "vote"
      ? await refuseGovernance(db, workspaceId, tx.params as GovernanceRequest, at, funds)
      : await refuseStake(db, workspaceId, tx.sender, tx.params as StakeRequest, at, funds);
  return refusal?.message ?? null;
}

async function settle(db: Db, id: string, height: number, reason: string | null): Promise<void> {
  await run(db, "UPDATE transactions SET status = $2, height = $3, reason = $4 WHERE id = $1", [id, reason === null ? "included" : "rejected", height, reason]);
}

/** Produces block `height` of a workspace at `at`: rewards, the pending transactions in submission order, the square, its roots. */
export async function produceBlock(db: Db, after: AfterCommit, workspaceId: string, height: number, at: Date, rewards: boolean): Promise<void> {
  const workspace = await maybeOne<{ nextBlock: NextBlock }>(db, 'SELECT next_block AS "nextBlock" FROM workspaces WHERE id = $1 FOR UPDATE', [workspaceId]);
  const choice = workspace?.nextBlock ?? "honest";
  await run(db, "UPDATE workspaces SET next_block = 'honest' WHERE id = $1", [workspaceId]);
  if (rewards) await payRewards(db, workspaceId, height, at);

  const pending = await rows<PendingTransaction>(
    db,
    `SELECT ${PENDING_COLUMNS} FROM transactions t LEFT JOIN blobs b ON b.tx_id = t.id
     WHERE t.workspace_id = $1 AND t.status = 'pending' ORDER BY t.seq`,
    [workspaceId],
  );
  const moment = { workspaceId, height, at };
  const capacity = config.maxSquareWidth ** 2;
  const taken: LayoutBlob[] = [];
  let used = 0;
  let blobsClosed = false;
  for (const tx of pending) {
    if (tx.kind === "blob") {
      const shares = tx.shares as number;
      if (blobsClosed || used + shares > capacity) {
        blobsClosed = true;
        continue;
      }
      used += shares;
      taken.push({ id: tx.blobId as string, namespace: tx.namespace as string, data: tx.payload as Buffer });
    }
    const reason = tx.kind === "blob" ? null : await refusalAtInclusion(db, workspaceId, tx, at);
    await post(db, { ...moment, from: memberAccount(tx.sender), to: BURN, amount: tx.feeUfern, kind: "fee", label: "Fee" });
    if (reason === null && tx.kind !== "blob") {
      if (tx.kind === "proposal" || tx.kind === "deposit" || tx.kind === "vote") {
        await applyGovernance(db, workspaceId, tx.sender, tx.params as GovernanceRequest, height, at);
      } else {
        await applyStake(db, moment, tx.sender, tx.params as StakeRequest);
      }
    }
    await settle(db, tx.id, height, reason);
  }

  const layout = layoutSquare(taken);
  const honest = extendSquare(layout.original, layout.k);
  const square = choice === "bad-encoding" ? tamperWithShare(honest, layout.k) : honest;
  const commitment = commit(square, layout.k);
  const withheld = choice === "withhold";
  await run(
    db,
    `INSERT INTO blocks (workspace_id, height, produced_at, k, blob_count, withheld, data_root, row_roots, column_roots, positions, square, fraud_checked)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $6)`,
    [workspaceId, height, at, layout.k, taken.length, withheld, commitment.dataRoot, JSON.stringify(commitment.rowRoots), JSON.stringify(commitment.columnRoots), JSON.stringify(layout.positions), Buffer.from(concat(...square))],
  );
  await run(db, "INSERT INTO auto_sampling (node_id, height) SELECT id, $2 FROM light_nodes WHERE workspace_id = $1 AND auto_sample", [workspaceId, height]);
  after(() => {
    broadcast(workspaceId, { type: "block", height, blobs: taken.length, squareWidth: layout.k });
    broadcast(workspaceId, { type: "changed" });
  });
}

/** Rejects a block once: its blob transactions turn Rejected with their fees refunded, every member gets one mail. */
export async function rejectBlock(db: Db, after: AfterCommit, workspaceId: string, height: number, rejection: Rejection, at: Date): Promise<void> {
  const changed = await run(db, "UPDATE blocks SET status = 'rejected', rejection = $3 WHERE workspace_id = $1 AND height = $2 AND status <> 'rejected'", [workspaceId, height, JSON.stringify(rejection)]);
  if (changed === 0) return;
  const blobTransactions = await rows<{ id: string; sender: string; feeUfern: number }>(
    db,
    `SELECT id, sender, fee_ufern AS "feeUfern" FROM transactions WHERE workspace_id = $1 AND height = $2 AND kind = 'blob' AND status = 'included' ORDER BY seq`,
    [workspaceId, height],
  );
  for (const tx of blobTransactions) {
    await settle(db, tx.id, height, `block ${height} was rejected`);
    await post(db, { workspaceId, from: BURN, to: memberAccount(tx.sender), amount: tx.feeUfern, kind: "fee-refund", label: "Fee refund", height, at });
  }
  const name = await workspaceName(db, workspaceId);
  for (const member of await membersOf(db, workspaceId)) {
    await enqueueMail(db, member.email, `Block ${height} was rejected`, `${rejectionText(height, rejection)} (${name})`);
  }
  after(() => {
    broadcast(workspaceId, { type: "rejected", height, rejection });
    broadcast(workspaceId, { type: "changed" });
    void deliverDueMail();
  });
}

async function writeUnstoredObjects(): Promise<void> {
  const blobs = await rows<{ id: string; payload: Buffer }>(
    pool,
    "SELECT id, payload FROM blobs WHERE NOT object_stored ORDER BY id LIMIT 50",
  );
  for (const blob of blobs) {
    if (!(await putObject(`blobs/${blob.id}`, blob.payload))) return;
    await run(pool, "UPDATE blobs SET object_stored = true WHERE id = $1", [blob.id]);
  }
  const blocks = await rows<{ workspaceId: string; height: number; k: number; withheld: boolean; square: Buffer }>(
    pool,
    `SELECT workspace_id AS "workspaceId", height, k, withheld, square FROM blocks WHERE NOT snapshot_stored ORDER BY produced_at LIMIT 50`,
  );
  for (const block of blocks) {
    const bytes = snapshotBytes(splitSquare(block.square), block.k, block.withheld);
    if (!(await putObject(`squares/${block.workspaceId}/${block.height}.bin`, bytes))) return;
    await run(pool, "UPDATE blocks SET snapshot_stored = true WHERE workspace_id = $1 AND height = $2", [block.workspaceId, block.height]);
  }
}

let flushTail: Promise<void> = Promise.resolve();

/**
 * Writes blob payloads and square snapshots that MinIO has not confirmed yet; storage that is down is retried by the caller's timer.
 * Flushes run one at a time, and each caller waits for a flush that starts after its call, so what it just committed is covered.
 */
export function flushObjects(): Promise<void> {
  flushTail = flushTail.then(writeUnstoredObjects, writeUnstoredObjects);
  return flushTail;
}
