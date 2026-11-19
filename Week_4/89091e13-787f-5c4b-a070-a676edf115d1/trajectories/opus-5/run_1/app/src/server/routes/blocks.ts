import { db } from '../db.js';
import { notFound, storageUnavailable, unprocessable } from '../http.js';
import { getObject, putObject, squareObjectKey, StorageUnavailable } from '../storage.js';
import { toHex } from '../../shared/hex.js';
import { validateNamespaceFormat } from '../../shared/namespace.js';
import { proveNamespace, RowProof, rootFromRowProof } from '../../shared/proofs.js';
import { isWithheldPosition } from '../../shared/square.js';
import { blockAt, loadSquare, snapshotBytes } from '../domain/blocks.js';
import { fraudProofOf } from '../domain/fraud.js';
import { BlockRow } from '../domain/types.js';
import { RequestContext, requireWorkspace, StoredResponse } from './context.js';
import { blockListView } from './serialize.js';

const SNAPSHOT_COPY = "Storage is unavailable, so the snapshot can't be downloaded right now.";

async function requireBlock(
  ctx: RequestContext,
  workspaceId: string,
  height: string,
): Promise<{ workspaceId: string; block: BlockRow }> {
  const { workspace } = await requireWorkspace(ctx, workspaceId);
  const parsed = Number(height);
  if (!Number.isInteger(parsed)) throw notFound();
  const block = await blockAt(db, workspace.id, parsed);
  if (!block) throw notFound();
  return { workspaceId: workspace.id, block };
}

export async function listBlocks(ctx: RequestContext, id: string): Promise<StoredResponse> {
  const { workspace } = await requireWorkspace(ctx, id);
  const { rows } = await db.query<BlockRow>(
    'SELECT * FROM blocks WHERE workspace_id = $1 ORDER BY height DESC',
    [workspace.id],
  );
  return { status: 200, body: rows.map(blockListView) };
}

export async function getBlock(
  ctx: RequestContext,
  id: string,
  height: string,
): Promise<StoredResponse> {
  const { workspaceId, block } = await requireBlock(ctx, id, height);
  const { rows } = await db.query<{ blob_id: string; namespace_hex: string; row: number; col: number }>(
    `SELECT blob_id, namespace_hex, row, col FROM block_shares
     WHERE workspace_id = $1 AND height = $2 AND blob_id IS NOT NULL ORDER BY row, col`,
    [workspaceId, block.height],
  );
  const blobs = new Map<string, { id: string; namespace: string; positions: [number, number][] }>();
  for (const row of rows) {
    const entry = blobs.get(row.blob_id) ?? {
      id: row.blob_id,
      namespace: row.namespace_hex,
      positions: [],
    };
    entry.positions.push([row.row, row.col]);
    blobs.set(row.blob_id, entry);
  }
  return {
    status: 200,
    body: {
      height: block.height,
      producedAt: block.produced_at.toISOString(),
      status: block.status,
      squareWidth: block.square_width,
      dataRoot: block.data_root,
      rowRoots: block.row_roots,
      columnRoots: block.column_roots,
      blobs: [...blobs.values()],
      rejection: block.rejection,
    },
  };
}

export async function getShares(
  ctx: RequestContext,
  id: string,
  height: string,
): Promise<StoredResponse> {
  const { workspaceId, block } = await requireBlock(ctx, id, height);
  const square = await loadSquare(db, workspaceId, block.height);
  const withheld = block.behaviour === 'withhold';
  const rows = square.meta.map((metaRow, r) =>
    metaRow.map((meta, c) => {
      const hidden = withheld && isWithheldPosition(r, c, square.k);
      return {
        row: r,
        col: c,
        quadrant: meta.quadrant,
        namespace: meta.namespace,
        kind: hidden ? 'withheld' : meta.kind,
        share: hidden ? null : toHex(square.shares[r][c]),
      };
    }),
  );
  return { status: 200, body: { k: square.k, rows } };
}

export async function getProofs(
  ctx: RequestContext,
  id: string,
  height: string,
): Promise<StoredResponse> {
  const { workspaceId, block } = await requireBlock(ctx, id, height);
  const namespace = (ctx.query.get('namespace') ?? '').trim().toLowerCase();
  const refusal = validateNamespaceFormat(namespace);
  if (refusal) throw unprocessable('namespace', refusal);
  const square = await loadSquare(db, workspaceId, block.height);
  return {
    status: 200,
    body: {
      height: block.height,
      namespace,
      rows: proveNamespace(square.shares, square.k, namespace),
    },
  };
}

export async function verifyProof(
  ctx: RequestContext,
  id: string,
  height: string,
): Promise<StoredResponse> {
  const { block } = await requireBlock(ctx, id, height);
  const proof = ctx.body.proof as RowProof;
  const recomputed = rootFromRowProof(block.square_width, proof);
  const committed = block.row_roots[proof.row];
  return {
    status: 200,
    body: {
      verified: recomputed !== null && committed !== undefined && recomputed.hash === committed.hash,
      root: recomputed,
    },
  };
}

export async function getFraudProof(
  ctx: RequestContext,
  id: string,
  height: string,
): Promise<StoredResponse> {
  const { workspaceId, block } = await requireBlock(ctx, id, height);
  const proof = await fraudProofOf(db, workspaceId, block.height);
  if (!proof) throw notFound();
  return {
    status: 200,
    body: {
      height: proof.height,
      axis: proof.axis,
      index: proof.index,
      shares: proof.shares,
      committedRoot: proof.committed_root,
      recomputedRoot: proof.recomputed_root,
      publishedAt: proof.published_at.toISOString(),
    },
  };
}

export interface SnapshotDownload {
  filename: string;
  bytes: Uint8Array;
}

export async function getSnapshot(
  ctx: RequestContext,
  id: string,
  height: string,
): Promise<SnapshotDownload> {
  const { workspaceId, block } = await requireBlock(ctx, id, height);
  const key = squareObjectKey(workspaceId, block.height);
  try {
    const stored = await getObject(key);
    if (stored) return { filename: `block-${block.height}-square.bin`, bytes: stored };
    const square = await loadSquare(db, workspaceId, block.height);
    const bytes = snapshotBytes(square, block.behaviour === 'withhold');
    await putObject(key, bytes);
    await db.query(
      'UPDATE blocks SET snapshot_stored = true WHERE workspace_id = $1 AND height = $2',
      [workspaceId, block.height],
    );
    return { filename: `block-${block.height}-square.bin`, bytes };
  } catch (error) {
    if (error instanceof StorageUnavailable) throw storageUnavailable(SNAPSHOT_COPY);
    throw error;
  }
}
