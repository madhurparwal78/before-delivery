import { gfMul, lagrangeWeights } from './gf256.js';
import { compareNamespace, PARITY_NAMESPACE } from './namespace.js';
import { paddingShare, SHARE_SIZE, shareNamespaceHex } from './shares.js';

export type Quadrant = 'Q0' | 'Q1' | 'Q2' | 'Q3';
export type ShareKind = 'blob' | 'padding' | 'parity' | 'withheld';

/** The smallest power of two k with k x k >= the data shares. */
export function squareWidth(dataShares: number): number {
  let k = 1;
  while (k * k < dataShares) k *= 2;
  return k;
}

export interface LaidOutBlob {
  blobId: string;
  namespace: string;
  shares: Uint8Array[];
}

export interface LayoutCell {
  blobId: string | null;
  shareIndex: number;
  namespace: string;
  share: Uint8Array;
}

export interface SquareLayout {
  k: number;
  cells: LayoutCell[];
}

/**
 * Lays blob shares row by row into the original square: ordered by namespace,
 * then submission order, then tail padding filling the rest.
 */
export function layOutSquare(blobs: LaidOutBlob[]): SquareLayout {
  const ordered = blobs
    .map((blob, submissionIndex) => ({ blob, submissionIndex }))
    .sort(
      (a, b) =>
        compareNamespace(a.blob.namespace, b.blob.namespace) || a.submissionIndex - b.submissionIndex,
    );
  const cells: LayoutCell[] = [];
  for (const { blob } of ordered) {
    blob.shares.forEach((share, shareIndex) => {
      cells.push({ blobId: blob.blobId, shareIndex, namespace: blob.namespace, share });
    });
  }
  const k = squareWidth(cells.length);
  while (cells.length < k * k) {
    const share = paddingShare();
    cells.push({ blobId: null, shareIndex: 0, namespace: shareNamespaceHex(share), share });
  }
  return { k, cells };
}

/** Evaluates the line's degree < k polynomial at x = k..2k-1. */
export function extendLine(line: Uint8Array[]): Uint8Array[] {
  const k = line.length;
  const parity: Uint8Array[] = [];
  for (let x = k; x < 2 * k; x++) {
    const weights = lagrangeWeights(k, x);
    const share = new Uint8Array(SHARE_SIZE);
    for (let i = 0; i < k; i++) {
      const weight = weights[i];
      if (weight === 0) continue;
      const source = line[i];
      for (let b = 0; b < SHARE_SIZE; b++) share[b] ^= gfMul(weight, source[b]);
    }
    parity.push(share);
  }
  return parity;
}

/** Builds the 2k x 2k extended square in the published quadrant order. */
export function extendSquare(original: Uint8Array[][]): Uint8Array[][] {
  const k = original.length;
  const width = 2 * k;
  const square: Uint8Array[][] = [];
  for (let r = 0; r < width; r++) square.push(new Array<Uint8Array>(width));

  for (let r = 0; r < k; r++) {
    for (let c = 0; c < k; c++) square[r][c] = original[r][c];
  }
  for (let r = 0; r < k; r++) {
    const parity = extendLine(square[r].slice(0, k));
    for (let i = 0; i < k; i++) square[r][k + i] = parity[i];
  }
  for (let c = 0; c < k; c++) {
    const column: Uint8Array[] = [];
    for (let r = 0; r < k; r++) column.push(square[r][c]);
    const parity = extendLine(column);
    for (let i = 0; i < k; i++) square[k + i][c] = parity[i];
  }
  for (let r = k; r < width; r++) {
    const parity = extendLine(square[r].slice(0, k));
    for (let i = 0; i < k; i++) square[r][k + i] = parity[i];
  }
  return square;
}

export function quadrantOf(row: number, col: number, k: number): Quadrant {
  if (row < k) return col < k ? 'Q0' : 'Q1';
  return col < k ? 'Q2' : 'Q3';
}

/** The namespace a share carries as an NMT leaf. */
export function leafNamespace(row: number, col: number, k: number, share: Uint8Array): string {
  return quadrantOf(row, col, k) === 'Q0' ? shareNamespaceHex(share) : PARITY_NAMESPACE;
}

/** The bottom-right (k+1) x (k+1) region a withholding producer does not serve. */
export function isWithheldPosition(row: number, col: number, k: number): boolean {
  return row >= k - 1 && col >= k - 1;
}
