import { config } from '../config.js';
import { Queryable } from '../db.js';
import { emitEvent } from '../live.js';
import { queueMail } from '../mail.js';
import {
  putObject,
  squareObjectKey,
  StorageUnavailable,
} from '../storage.js';
import { commitSquare } from '../../shared/commitments.js';
import { blobToShares, SHARE_SIZE } from '../../shared/shares.js';
import {
  extendSquare,
  isWithheldPosition,
  LaidOutBlob,
  layOutSquare,
  leafNamespace,
  Quadrant,
  quadrantOf,
  ShareKind,
} from '../../shared/square.js';
import { BURN_ACCOUNT, memberAccount, postPair } from './ledger.js';
import { includeTransaction } from './inclusion.js';
import { payBlockRewards } from './staking.js';
import { membersOf } from './workspaces.js';
import { BlockRow, RejectionJson, TransactionRow, WorkspaceRow } from './types.js';

export interface CellMeta {
  row: number;
  col: number;
  quadrant: Quadrant;
  namespace: string;
  kind: ShareKind;
  blobId: string | null;
}

export interface StoredSquare {
  k: number;
  shares: Uint8Array[][];
  meta: CellMeta[][];
}

export function blockTimeOf(height: number): Date {
  return new Date(Date.parse(config.appStartAt) + height * config.blockTimeSeconds * 1000);
}

export async function latestHeight(tx: Queryable, workspaceId: string): Promise<number> {
  const { rows } = await tx.query<{ height: number | null }>(
    'SELECT max(height) AS height FROM blocks WHERE workspace_id = $1',
    [workspaceId],
  );
  return rows[0]?.height ?? 0;
}

export async function blockAt(
  tx: Queryable,
  workspaceId: string,
  height: number,
): Promise<BlockRow | null> {
  const { rows } = await tx.query<BlockRow>(
    'SELECT * FROM blocks WHERE workspace_id = $1 AND height = $2',
    [workspaceId, height],
  );
  return rows[0] ?? null;
}

export async function loadSquare(
  tx: Queryable,
  workspaceId: string,
  height: number,
): Promise<StoredSquare> {
  const { rows } = await tx.query<{
    row: number;
    col: number;
    quadrant: Quadrant;
    namespace_hex: string;
    kind: ShareKind;
    blob_id: string | null;
    share: Buffer;
  }>(
    `SELECT row, col, quadrant, namespace_hex, kind, blob_id, share
     FROM block_shares WHERE workspace_id = $1 AND height = $2 ORDER BY row, col`,
    [workspaceId, height],
  );
  const width = Math.round(Math.sqrt(rows.length));
  const k = width / 2;
  const shares: Uint8Array[][] = [];
  const meta: CellMeta[][] = [];
  for (let r = 0; r < width; r++) {
    shares.push(new Array<Uint8Array>(width));
    meta.push(new Array<CellMeta>(width));
  }
  for (const row of rows) {
    shares[row.row][row.col] = new Uint8Array(row.share);
    meta[row.row][row.col] = {
      row: row.row,
      col: row.col,
      quadrant: row.quadrant,
      namespace: row.namespace_hex,
      kind: row.kind,
      blobId: row.blob_id,
    };
  }
  return { k, shares, meta };
}

/** The (2k)^2 x 64 snapshot, with withheld shares as 64 zero bytes. */
export function snapshotBytes(square: StoredSquare, withheld: boolean): Uint8Array {
  const width = 2 * square.k;
  const out = new Uint8Array(width * width * SHARE_SIZE);
  for (let r = 0; r < width; r++) {
    for (let c = 0; c < width; c++) {
      if (withheld && isWithheldPosition(r, c, square.k)) continue;
      out.set(square.shares[r][c], (r * width + c) * SHARE_SIZE);
    }
  }
  return out;
}

async function writeSnapshot(
  tx: Queryable,
  workspaceId: string,
  height: number,
  bytes: Uint8Array,
): Promise<boolean> {
  const key = squareObjectKey(workspaceId, height);
  try {
    await putObject(key, bytes);
    return true;
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
    await tx.query(
      `INSERT INTO pending_objects (key, workspace_id, body, created_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (key) DO UPDATE SET body = excluded.body`,
      [key, workspaceId, Buffer.from(bytes)],
    );
    return false;
  }
}

interface PendingBlobRow {
  id: string;
  tx_id: string;
  namespace_hex: string;
  shares: number;
  payload: Buffer;
}

/**
 * Produces block h: rewards first, then the block's transactions in submission
 * order, then the square that carries the blobs it took.
 */
export async function produceBlock(
  tx: Queryable,
  workspace: WorkspaceRow,
  height: number,
  at: Date,
  payRewards: boolean,
): Promise<BlockRow> {
  const behaviour = workspace.next_block;
  if (behaviour !== 'honest') {
    await tx.query("UPDATE workspaces SET next_block = 'honest' WHERE id = $1", [workspace.id]);
  }
  if (payRewards) await payBlockRewards(tx, workspace.id, height, at);

  const { rows: pending } = await tx.query<TransactionRow>(
    `SELECT id, workspace_id, kind, sender_id, status, height, fee_ufern::text, gas,
            held_ufern::text, payload, rejection_reason, submitted_at
     FROM transactions WHERE workspace_id = $1 AND status = 'pending'
     ORDER BY sequence`,
    [workspace.id],
  );
  const { rows: blobRows } = await tx.query<PendingBlobRow>(
    `SELECT b.id, b.tx_id, b.namespace_hex, b.shares, b.payload
     FROM blobs b JOIN transactions t ON t.id = b.tx_id
     WHERE b.workspace_id = $1 AND t.status = 'pending'`,
    [workspace.id],
  );
  const blobByTx = new Map(blobRows.map((row) => [row.tx_id, row]));

  const maxShares = config.maxSquareWidth * config.maxSquareWidth;
  const taken: TransactionRow[] = [];
  const takenBlobs: PendingBlobRow[] = [];
  let usedShares = 0;
  let squareFull = false;
  for (const row of pending) {
    if (row.kind !== 'blob') {
      taken.push(row);
      continue;
    }
    if (squareFull) continue;
    const blob = blobByTx.get(row.id) as PendingBlobRow;
    if (usedShares + blob.shares > maxShares) {
      squareFull = true;
      continue;
    }
    usedShares += blob.shares;
    taken.push(row);
    takenBlobs.push(blob);
  }

  for (const row of taken) {
    await includeTransaction(tx, workspace, row, height, at);
  }

  const laidOut: LaidOutBlob[] = takenBlobs.map((blob) => ({
    blobId: blob.id,
    namespace: blob.namespace_hex,
    shares: blobToShares(blob.namespace_hex, new Uint8Array(blob.payload)),
  }));
  const layout = layOutSquare(laidOut);
  const k = layout.k;
  const original: Uint8Array[][] = [];
  for (let r = 0; r < k; r++) {
    original.push(layout.cells.slice(r * k, r * k + k).map((cell) => cell.share));
  }
  const square = extendSquare(original);
  if (behaviour === 'bad-encoding') square[0][k][14] ^= 1;
  const commitment = commitSquare(square, k);

  const blobCount = takenBlobs.length;
  await tx.query(
    `INSERT INTO blocks
       (workspace_id, height, produced_at, status, square_width, data_root, row_roots,
        column_roots, behaviour, blob_count, snapshot_stored)
     VALUES ($1, $2, $3, 'sampling', $4, $5, $6, $7, $8, $9, false)`,
    [
      workspace.id,
      height,
      at,
      k,
      commitment.dataRoot,
      JSON.stringify(commitment.rowRoots),
      JSON.stringify(commitment.columnRoots),
      behaviour,
      blobCount,
    ],
  );

  const values: string[] = [];
  const params: (string | number | Buffer | null)[] = [workspace.id, height];
  const width = 2 * k;
  for (let r = 0; r < width; r++) {
    for (let c = 0; c < width; c++) {
      const quadrant = quadrantOf(r, c, k);
      const cell = quadrant === 'Q0' ? layout.cells[r * k + c] : null;
      const kind: ShareKind =
        quadrant !== 'Q0' ? 'parity' : cell && cell.blobId ? 'blob' : 'padding';
      const base = params.length;
      values.push(
        `($1, $2, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`,
      );
      params.push(
        r,
        c,
        quadrant,
        leafNamespace(r, c, k, square[r][c]),
        kind,
        cell?.blobId ?? null,
        Buffer.from(square[r][c]),
      );
    }
  }
  await tx.query(
    `INSERT INTO block_shares
       (workspace_id, height, row, col, quadrant, namespace_hex, kind, blob_id, share)
     VALUES ${values.join(', ')}`,
    params,
  );

  const stored = await loadSquare(tx, workspace.id, height);
  const snapshotStored = await writeSnapshot(
    tx,
    workspace.id,
    height,
    snapshotBytes(stored, behaviour === 'withhold'),
  );
  if (snapshotStored) {
    await tx.query(
      'UPDATE blocks SET snapshot_stored = true WHERE workspace_id = $1 AND height = $2',
      [workspace.id, height],
    );
  }

  emitEvent(workspace.id, { kind: 'block', height, blobs: blobCount, squareWidth: k });
  emitEvent(workspace.id, { kind: 'transactions' });
  const block = (await blockAt(tx, workspace.id, height)) as BlockRow;
  return block;
}

export async function markAvailable(
  tx: Queryable,
  workspaceId: string,
  height: number,
): Promise<void> {
  await tx.query(
    "UPDATE blocks SET status = 'available' WHERE workspace_id = $1 AND height = $2 AND status = 'sampling'",
    [workspaceId, height],
  );
}

/** Rejects a block, refunds its blob fees and mails every member. */
export async function rejectBlock(
  tx: Queryable,
  workspace: WorkspaceRow,
  height: number,
  at: Date,
  rejection: RejectionJson,
): Promise<void> {
  await tx.query(
    "UPDATE blocks SET status = 'rejected', rejection = $3 WHERE workspace_id = $1 AND height = $2",
    [workspace.id, height, JSON.stringify(rejection)],
  );
  const { rows } = await tx.query<{ id: string; sender_id: string; fee_ufern: string }>(
    `SELECT id, sender_id, fee_ufern::text FROM transactions
     WHERE workspace_id = $1 AND height = $2 AND kind = 'blob' AND status = 'included'
     ORDER BY sequence`,
    [workspace.id, height],
  );
  const reason = `block ${height} was rejected`;
  for (const row of rows) {
    await tx.query(
      "UPDATE transactions SET status = 'rejected', rejection_reason = $2 WHERE id = $1",
      [row.id, reason],
    );
    const fee = BigInt(row.fee_ufern);
    if (fee > 0n) {
      await postPair(tx, {
        workspaceId: workspace.id,
        debit: BURN_ACCOUNT,
        credit: memberAccount(row.sender_id),
        amountUfern: fee,
        kind: 'fee-refund',
        label: 'Fee refund',
        height,
        at,
      });
    }
  }
  const members = await membersOf(tx, workspace.id);
  const detail =
    rejection.reason === 'withheld'
      ? `Light node ${rejection.nodeName} could not fetch share (${rejection.row}, ${rejection.col}).`
      : `${rejection.axis === 'row' ? 'Row' : 'Column'} ${rejection.index} is not encoded correctly.`;
  for (const member of members) {
    await queueMail(
      tx,
      workspace.id,
      {
        recipient: member.email,
        subject: `Block ${height} was rejected`,
        body: `Block ${height} in ${workspace.name} on Fernsquare was rejected. ${detail} Blob fees in that block have been refunded.`,
      },
      at,
    );
  }
  emitEvent(workspace.id, {
    kind: 'rejected',
    height,
    reason: rejection.reason,
    ...(rejection.reason === 'withheld'
      ? { nodeName: rejection.nodeName, row: rejection.row, col: rejection.col }
      : { axis: rejection.axis, index: rejection.index }),
  });
  emitEvent(workspace.id, { kind: 'transactions' });
}
