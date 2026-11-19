import { randomUUID } from 'node:crypto';
import { Queryable } from '../db.js';
import { emitEvent } from '../live.js';
import { columnLeaves, rowLeaves } from '../../shared/commitments.js';
import { toHex } from '../../shared/hex.js';
import { buildNmt, nmtLeaf, NmtNode, nmtRoot, rangeProofNodes } from '../../shared/nmt.js';
import { extendLine, leafNamespace } from '../../shared/square.js';
import { loadSquare, rejectBlock, StoredSquare } from './blocks.js';
import { BlockRow, WorkspaceRow } from './types.js';

export interface FraudProofShare {
  position: [number, number];
  share: string;
  nodes: NmtNode[];
  verified: boolean;
}

export interface FraudProofRow {
  height: number;
  axis: 'row' | 'column';
  index: number;
  shares: FraudProofShare[];
  committed_root: NmtNode;
  recomputed_root: NmtNode;
  published_at: Date;
}

function recomputedRowRoot(square: StoredSquare, row: number): NmtNode {
  const k = square.k;
  const original = square.shares[row].slice(0, k);
  const line = [...original, ...extendLine(original)];
  return nmtRoot(line.map((share, col) => nmtLeaf(leafNamespace(row, col, k, share), share)));
}

function recomputedColumnRoot(square: StoredSquare, col: number): NmtNode {
  const k = square.k;
  const original = square.shares.slice(0, k).map((row) => row[col]);
  const line = [...original, ...extendLine(original)];
  return nmtRoot(line.map((share, row) => nmtLeaf(leafNamespace(row, col, k, share), share)));
}

export async function fraudProofOf(
  tx: Queryable,
  workspaceId: string,
  height: number,
): Promise<FraudProofRow | null> {
  const { rows } = await tx.query<FraudProofRow>(
    `SELECT height, axis, index, shares, committed_root, recomputed_root, published_at
     FROM fraud_proofs WHERE workspace_id = $1 AND height = $2`,
    [workspaceId, height],
  );
  return rows[0] ?? null;
}

/**
 * The full node re-extends every row then every column and publishes one proof
 * for the first line whose recomputed root differs from the committed one.
 */
export async function runFraudCheck(
  tx: Queryable,
  workspace: WorkspaceRow,
  block: BlockRow,
  at: Date,
): Promise<void> {
  const square = await loadSquare(tx, workspace.id, block.height);
  const k = square.k;
  const width = 2 * k;
  let axis: 'row' | 'column' | null = null;
  let index = -1;
  let committed: NmtNode | null = null;
  let recomputed: NmtNode | null = null;

  for (let row = 0; row < width && axis === null; row++) {
    const candidate = recomputedRowRoot(square, row);
    if (candidate.hash !== block.row_roots[row].hash) {
      axis = 'row';
      index = row;
      committed = block.row_roots[row];
      recomputed = candidate;
    }
  }
  for (let col = 0; col < width && axis === null; col++) {
    const candidate = recomputedColumnRoot(square, col);
    if (candidate.hash !== block.column_roots[col].hash) {
      axis = 'column';
      index = col;
      committed = block.column_roots[col];
      recomputed = candidate;
    }
  }
  if (axis === null) return;

  const shares: FraudProofShare[] = [];
  for (let i = 0; i < k; i++) {
    const row = axis === 'row' ? index : i;
    const col = axis === 'row' ? i : index;
    const crossLeaves =
      axis === 'row' ? columnLeaves(square.shares, k, col) : rowLeaves(square.shares, k, row);
    const levels = buildNmt(crossLeaves);
    const leafIndex = axis === 'row' ? row : col;
    const nodes = rangeProofNodes(levels, leafIndex, leafIndex + 1);
    const crossRoot = axis === 'row' ? block.column_roots[col] : block.row_roots[row];
    shares.push({
      position: [row, col],
      share: toHex(square.shares[row][col]),
      nodes,
      verified: levels[levels.length - 1][0].hash === crossRoot.hash,
    });
  }

  await tx.query(
    `INSERT INTO fraud_proofs
       (id, workspace_id, height, axis, index, shares, committed_root, recomputed_root, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      randomUUID(),
      workspace.id,
      block.height,
      axis,
      index,
      JSON.stringify(shares),
      JSON.stringify(committed),
      JSON.stringify(recomputed),
      at,
    ],
  );
  emitEvent(workspace.id, { kind: 'fraud-proof', height: block.height, axis, index });

  if (block.status !== 'rejected') {
    await rejectBlock(tx, workspace, block.height, at, { reason: 'bad-encoding', axis, index });
  }
}
