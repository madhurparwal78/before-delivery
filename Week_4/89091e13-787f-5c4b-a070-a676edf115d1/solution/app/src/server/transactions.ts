import { randomUUID } from "node:crypto";
import { clockNow } from "./clock.ts";
import { run, type Db } from "./db.ts";
import { estimateBlob } from "./fee.ts";
import type { TransactionCreated } from "../shared/api.ts";

interface NewTransaction {
  kind: string;
  feeUfern: number;
  gas: number;
  heldUfern: number;
  params: object;
}

/** A pending transaction: its fee (and any amount) is held until a block takes it. */
export async function insertTransaction(db: Db, workspaceId: string, senderId: string, tx: NewTransaction): Promise<TransactionCreated> {
  const id = randomUUID();
  const submittedAt = clockNow();
  await run(
    db,
    `INSERT INTO transactions (id, workspace_id, kind, sender, fee_ufern, gas, held_ufern, params, submitted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, workspaceId, tx.kind, senderId, tx.feeUfern, tx.gas, tx.heldUfern, JSON.stringify(tx.params), submittedAt],
  );
  return { id, kind: tx.kind, status: "pending", feeUfern: tx.feeUfern, gas: tx.gas, submittedAt: submittedAt.toISOString() };
}

/** A pending blob transaction and its payload. `stored` says whether MinIO already confirmed the object. */
export async function insertBlob(
  db: Db,
  workspaceId: string,
  senderId: string,
  blob: { id: string; namespace: string; data: Uint8Array; feeUfern: number; stored: boolean },
): Promise<TransactionCreated & { blobId: string; size: number; shares: number }> {
  const estimate = estimateBlob(blob.data.length);
  const created = await insertTransaction(db, workspaceId, senderId, { kind: "blob", feeUfern: blob.feeUfern, gas: estimate.gas, heldUfern: 0, params: {} });
  await run(
    db,
    "INSERT INTO blobs (id, tx_id, workspace_id, namespace, size, shares, payload, object_stored) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    [blob.id, created.id, workspaceId, blob.namespace, blob.data.length, estimate.shares, Buffer.from(blob.data), blob.stored],
  );
  return { ...created, blobId: blob.id, size: blob.data.length, shares: estimate.shares };
}
