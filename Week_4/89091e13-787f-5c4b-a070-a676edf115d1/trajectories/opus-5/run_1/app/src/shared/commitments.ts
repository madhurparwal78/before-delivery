import { binaryMerkleRoot, nmtLeaf, NmtNode, nmtRoot, serializeNode } from './nmt.js';
import { leafNamespace } from './square.js';

export interface SquareCommitment {
  rowRoots: NmtNode[];
  columnRoots: NmtNode[];
  dataRoot: string;
}

/** The NMT leaves of extended row r. */
export function rowLeaves(square: Uint8Array[][], k: number, row: number): NmtNode[] {
  return square[row].map((share, col) => nmtLeaf(leafNamespace(row, col, k, share), share));
}

/** The NMT leaves of extended column c. */
export function columnLeaves(square: Uint8Array[][], k: number, col: number): NmtNode[] {
  return square.map((row, rowIndex) => nmtLeaf(leafNamespace(rowIndex, col, k, row[col]), row[col]));
}

export function commitSquare(square: Uint8Array[][], k: number): SquareCommitment {
  const width = 2 * k;
  const rowRoots: NmtNode[] = [];
  const columnRoots: NmtNode[] = [];
  for (let r = 0; r < width; r++) rowRoots.push(nmtRoot(rowLeaves(square, k, r)));
  for (let c = 0; c < width; c++) columnRoots.push(nmtRoot(columnLeaves(square, k, c)));
  const dataRoot = binaryMerkleRoot([...rowRoots, ...columnRoots].map(serializeNode));
  return { rowRoots, columnRoots, dataRoot };
}
