import { concat, fromHex, toHex } from "../shared/bytes.ts";
import { PARITY_NAMESPACE, TAIL_PADDING_NAMESPACE } from "../shared/namespace.ts";
import { dataRoot, leafNode, lineRoot, nodeToJson, type NmtNode } from "../shared/nmt.ts";
import type { RootJson } from "../shared/api.ts";
import {
  CONTINUATION_SHARE_DATA, CONTINUATION_SHARE_DATA_OFFSET, FIRST_SHARE_DATA, FIRST_SHARE_DATA_OFFSET, INFO_BYTE_OFFSET, NAMESPACE_SIZE, SEQUENCE_LENGTH_OFFSET, SHARE_SIZE,
} from "../shared/share.ts";


/** A blob of N bytes takes 1 share if N <= 50, else 1 + ceil((N - 50) / 54). */
export function sharesForBytes(size: number): number {
  return size <= FIRST_SHARE_DATA ? 1 : 1 + Math.ceil((size - FIRST_SHARE_DATA) / CONTINUATION_SHARE_DATA);
}

/** The largest blob that fits n shares: 50 data bytes in the first share, 54 in each continuation. */
export function bytesForShares(shares: number): number {
  return FIRST_SHARE_DATA + CONTINUATION_SHARE_DATA * (shares - 1);
}

/** Splits a blob into 64-byte shares: namespace, info byte, then (first share only) the 4-byte big-endian length. */
function blobShares(namespace: string, data: Uint8Array): Uint8Array[] {
  const prefix = fromHex(namespace);
  const first = new Uint8Array(SHARE_SIZE);
  first.set(prefix, 0);
  first[INFO_BYTE_OFFSET] = 1;
  new DataView(first.buffer).setUint32(SEQUENCE_LENGTH_OFFSET, data.length);
  first.set(data.subarray(0, FIRST_SHARE_DATA), FIRST_SHARE_DATA_OFFSET);
  const shares = [first];
  for (let at = FIRST_SHARE_DATA; at < data.length; at += CONTINUATION_SHARE_DATA) {
    const share = new Uint8Array(SHARE_SIZE);
    share.set(prefix, 0);
    share.set(data.subarray(at, at + CONTINUATION_SHARE_DATA), CONTINUATION_SHARE_DATA_OFFSET);
    shares.push(share);
  }
  return shares;
}

function tailPaddingShare(): Uint8Array {
  const share = new Uint8Array(SHARE_SIZE);
  share.set(fromHex(TAIL_PADDING_NAMESPACE), 0);
  share[INFO_BYTE_OFFSET] = 1;
  return share;
}

export interface LayoutBlob {
  id: string;
  namespace: string;
  data: Uint8Array;
}

interface Layout {
  k: number;
  /** The k x k original square, row by row. */
  original: Uint8Array[];
  positions: Record<string, Array<[number, number]>>;
}

/** Shares ordered by namespace, then submission order, then tail padding, laid row by row in the smallest power-of-two square. */
export function layoutSquare(blobsInSubmissionOrder: LayoutBlob[]): Layout {
  const ordered = blobsInSubmissionOrder
    .map((blob, order) => ({ blob, order }))
    .sort((a, b) => (a.blob.namespace < b.blob.namespace ? -1 : a.blob.namespace > b.blob.namespace ? 1 : a.order - b.order));
  const original: Uint8Array[] = [];
  const owners: string[] = [];
  for (const { blob } of ordered) {
    for (const share of blobShares(blob.namespace, blob.data)) {
      original.push(share);
      owners.push(blob.id);
    }
  }
  let k = 1;
  while (k * k < original.length) k *= 2;
  const positions: Record<string, Array<[number, number]>> = {};
  owners.forEach((id, index) => (positions[id] ??= []).push([Math.floor(index / k), index % k]));
  while (original.length < k * k) original.push(tailPaddingShare());
  return { k, original, positions };
}

/** GF(2^8) with reduction polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11d) and generator 2. */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255] as number;
}

function multiply(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : (EXP[(LOG[a] as number) + (LOG[b] as number)] as number);
}

function invert(a: number): number {
  return EXP[255 - (LOG[a] as number)] as number;
}

const coefficientCache = new Map<number, number[][]>();

/** Lagrange coefficients: row x - k holds, for each input position i, the weight of share i in the parity share at x. */
function parityCoefficients(k: number): number[][] {
  const cached = coefficientCache.get(k);
  if (cached) return cached;
  const table: number[][] = [];
  for (let x = k; x < 2 * k; x++) {
    const weights: number[] = [];
    for (let i = 0; i < k; i++) {
      let numerator = 1;
      let denominator = 1;
      for (let j = 0; j < k; j++) {
        if (j === i) continue;
        numerator = multiply(numerator, x ^ j);
        denominator = multiply(denominator, i ^ j);
      }
      weights.push(multiply(numerator, invert(denominator)));
    }
    table.push(weights);
  }
  coefficientCache.set(k, table);
  return table;
}

/** The k parity shares of a line of k shares, byte position by byte position. */
function extendLine(line: Uint8Array[]): Uint8Array[] {
  return parityCoefficients(line.length).map((weights) => {
    const parity = new Uint8Array(SHARE_SIZE);
    weights.forEach((weight, i) => {
      const share = line[i] as Uint8Array;
      for (let b = 0; b < SHARE_SIZE; b++) parity[b] = (parity[b] as number) ^ multiply(weight, share[b] as number);
    });
    return parity;
  });
}

/** Q0 original, Q1 row parity, Q2 column parity, Q3 parity of parity; (2k)^2 shares row by row. */
export function extendSquare(original: Uint8Array[], k: number): Uint8Array[] {
  const width = 2 * k;
  const square: Uint8Array[] = new Array<Uint8Array>(width * width);
  const at = (r: number, c: number) => r * width + c;
  for (let r = 0; r < k; r++) {
    const row = original.slice(r * k, (r + 1) * k);
    row.forEach((share, c) => (square[at(r, c)] = share));
    extendLine(row).forEach((share, i) => (square[at(r, k + i)] = share));
  }
  for (let c = 0; c < k; c++) {
    const column = Array.from({ length: k }, (_, r) => square[at(r, c)] as Uint8Array);
    extendLine(column).forEach((share, i) => (square[at(k + i, c)] = share));
  }
  for (let r = k; r < width; r++) {
    const row = Array.from({ length: k }, (_, c) => square[at(r, c)] as Uint8Array);
    extendLine(row).forEach((share, i) => (square[at(r, k + i)] = share));
  }
  return square;
}

export type Axis = "row" | "column";

/** The producer's tamper: the lowest bit of byte 14 of share (0, k). */
export function tamperWithShare(square: Uint8Array[], k: number): Uint8Array[] {
  const tampered = square.slice();
  const index = k;
  const share = (tampered[index] as Uint8Array).slice();
  share[14] = (share[14] as number) ^ 1;
  tampered[index] = share;
  return tampered;
}

export function shareAt(square: Uint8Array[], k: number, row: number, col: number): Uint8Array {
  return square[row * 2 * k + col] as Uint8Array;
}

/** A leaf's namespace: its own first 9 bytes in Q0, the parity namespace everywhere else. */
function leafNamespace(share: Uint8Array, k: number, row: number, col: number): Uint8Array {
  return row < k && col < k ? share.subarray(0, NAMESPACE_SIZE) : fromHex(PARITY_NAMESPACE);
}

/** The 2k leaves of a row or a column, in order. */
export function lineLeaves(square: Uint8Array[], k: number, axis: Axis, index: number): NmtNode[] {
  return Array.from({ length: 2 * k }, (_, i) => {
    const [row, col] = axis === "row" ? [index, i] : [i, index];
    const share = shareAt(square, k, row, col);
    return leafNode(leafNamespace(share, k, row, col), share);
  });
}

interface Commitment {
  rowRoots: RootJson[];
  columnRoots: RootJson[];
  dataRoot: string;
}

/** Row roots, column roots and the data root of an extended square. */
export function commit(square: Uint8Array[], k: number): Commitment {
  const rows = Array.from({ length: 2 * k }, (_, i) => lineRoot(lineLeaves(square, k, "row", i)));
  const columns = Array.from({ length: 2 * k }, (_, i) => lineRoot(lineLeaves(square, k, "column", i)));
  return { rowRoots: rows.map(nodeToJson), columnRoots: columns.map(nodeToJson), dataRoot: toHex(dataRoot(rows, columns)) };
}

/** Re-extends the first k shares of a line and returns the root the line should have had. */
export function recomputedLineRoot(square: Uint8Array[], k: number, axis: Axis, index: number): NmtNode {
  const line = Array.from({ length: k }, (_, i) => (axis === "row" ? shareAt(square, k, index, i) : shareAt(square, k, i, index)));
  const full = [...line, ...extendLine(line)];
  return lineRoot(
    full.map((share, i) => {
      const [row, col] = axis === "row" ? [index, i] : [i, index];
      return leafNode(leafNamespace(share, k, row, col), share);
    }),
  );
}

/** The (2k)^2 shares as one byte string, with withheld shares written as zero bytes. */
export function snapshotBytes(square: Uint8Array[], k: number, withheld: boolean): Uint8Array {
  return concat(...square.map((share, i) => (withheld && isWithheld(k, Math.floor(i / (2 * k)), i % (2 * k)) ? new Uint8Array(SHARE_SIZE) : share)));
}

/** A withheld block serves every share except rows k-1..2k-1 x columns k-1..2k-1. */
export function isWithheld(k: number, row: number, col: number): boolean {
  return row >= k - 1 && col >= k - 1;
}

export function splitSquare(bytes: Uint8Array): Uint8Array[] {
  return Array.from({ length: bytes.length / SHARE_SIZE }, (_, i) => bytes.slice(i * SHARE_SIZE, (i + 1) * SHARE_SIZE));
}
