import { rowLeaves } from './commitments.js';
import { fromHex, toHex } from './hex.js';
import { buildNmt, nmtLeaf, NmtNode, rangeProofNodes, rootFromRangeProof } from './nmt.js';
import { leafNamespace } from './square.js';

export interface InclusionRowProof {
  row: number;
  kind: 'inclusion';
  start: number;
  end: number;
  shares: string[];
  nodes: NmtNode[];
  root: NmtNode;
}

export interface AbsenceRowProof {
  row: number;
  kind: 'absence';
  nextLeaf: { col: number; namespace: string; hash: string };
  nodes: NmtNode[];
  root: NmtNode;
}

export interface OutsideRowProof {
  row: number;
  kind: 'outside';
}

export type RowProof = InclusionRowProof | AbsenceRowProof | OutsideRowProof;

/** Proves a namespace against rows 0..k-1 of the extended square. */
export function proveNamespace(square: Uint8Array[][], k: number, namespace: string): RowProof[] {
  const proofs: RowProof[] = [];
  for (let row = 0; row < k; row++) {
    const leaves = rowLeaves(square, k, row);
    const levels = buildNmt(leaves);
    const root = levels[levels.length - 1][0];
    if (namespace < root.min || namespace > root.max) {
      proofs.push({ row, kind: 'outside' });
      continue;
    }
    const first = leaves.findIndex((leaf) => leaf.min === namespace);
    if (first === -1) {
      const nextCol = leaves.findIndex((leaf) => leaf.min > namespace);
      const nextLeaf = leaves[nextCol];
      proofs.push({
        row,
        kind: 'absence',
        nextLeaf: { col: nextCol, namespace: nextLeaf.min, hash: nextLeaf.hash },
        nodes: rangeProofNodes(levels, nextCol, nextCol + 1),
        root,
      });
      continue;
    }
    let end = first;
    while (end < leaves.length && leaves[end].min === namespace) end += 1;
    const shares: string[] = [];
    for (let col = first; col < end; col++) shares.push(toHex(square[row][col]));
    proofs.push({
      row,
      kind: 'inclusion',
      start: first,
      end,
      shares,
      nodes: rangeProofNodes(levels, first, end),
      root,
    });
  }
  return proofs;
}

/** Recomputes the row root from a proof; the browser and the server share this. */
export function rootFromRowProof(k: number, proof: RowProof): NmtNode | null {
  const leafCount = 2 * k;
  if (proof.kind === 'inclusion') {
    const leaves = proof.shares.map((hex, index) => {
      const col = proof.start + index;
      const share = fromHex(hex);
      return nmtLeaf(leafNamespace(proof.row, col, k, share), share);
    });
    return rootFromRangeProof(leafCount, proof.start, proof.end, leaves, proof.nodes);
  }
  if (proof.kind === 'absence') {
    const leaf: NmtNode = {
      min: proof.nextLeaf.namespace,
      max: proof.nextLeaf.namespace,
      hash: proof.nextLeaf.hash,
    };
    return rootFromRangeProof(
      leafCount,
      proof.nextLeaf.col,
      proof.nextLeaf.col + 1,
      [leaf],
      proof.nodes,
    );
  }
  return null;
}

export function proofLine(proof: RowProof, proofNodeCount: number): string {
  if (proof.kind === 'inclusion') {
    return `Row ${proof.row}: inclusion, columns ${proof.start} to ${proof.end - 1}, ${proofNodeCount} proof nodes`;
  }
  if (proof.kind === 'absence') {
    return `Row ${proof.row}: absence, next leaf at column ${proof.nextLeaf.col}`;
  }
  return `Row ${proof.row}: outside this row's namespace range`;
}
