import { concatBytes, fromHex, toHex } from './hex.js';
import { sha256 } from './sha256.js';

export interface NmtNode {
  min: string;
  max: string;
  hash: string;
}

const LEAF_PREFIX = new Uint8Array([0x00]);
const INNER_PREFIX = new Uint8Array([0x01]);

export function nmtLeaf(namespaceHex: string, share: Uint8Array): NmtNode {
  return {
    min: namespaceHex,
    max: namespaceHex,
    hash: toHex(sha256(LEAF_PREFIX, fromHex(namespaceHex), share)),
  };
}

export function nmtInner(left: NmtNode, right: NmtNode): NmtNode {
  return {
    min: left.min <= right.min ? left.min : right.min,
    max: left.max >= right.max ? left.max : right.max,
    hash: toHex(
      sha256(
        INNER_PREFIX,
        fromHex(left.min),
        fromHex(left.max),
        fromHex(left.hash),
        fromHex(right.min),
        fromHex(right.max),
        fromHex(right.hash),
      ),
    ),
  };
}

/** Serialized root: min || max || hash (50 bytes). */
export function serializeNode(node: NmtNode): Uint8Array {
  return concatBytes(fromHex(node.min), fromHex(node.max), fromHex(node.hash));
}

/** levels[0] holds the leaves; the last level holds the single root. */
export type NmtLevels = NmtNode[][];

export function buildNmt(leaves: NmtNode[]): NmtLevels {
  const levels: NmtLevels = [leaves];
  let current = leaves;
  while (current.length > 1) {
    const next: NmtNode[] = [];
    for (let i = 0; i < current.length; i += 2) next.push(nmtInner(current[i], current[i + 1]));
    levels.push(next);
    current = next;
  }
  return levels;
}

export function nmtRoot(leaves: NmtNode[]): NmtNode {
  const levels = buildNmt(leaves);
  return levels[levels.length - 1][0];
}

/** The fewest subtree nodes covering every leaf outside [start, end), left to right. */
export function rangeProofNodes(levels: NmtLevels, start: number, end: number): NmtNode[] {
  const out: NmtNode[] = [];
  const topLevel = levels.length - 1;
  const walk = (level: number, index: number): void => {
    const span = 1 << level;
    const lo = index * span;
    const hi = lo + span;
    if (hi <= start || lo >= end) {
      out.push(levels[level][index]);
      return;
    }
    if (lo >= start && hi <= end) return;
    walk(level - 1, index * 2);
    walk(level - 1, index * 2 + 1);
  };
  walk(topLevel, 0);
  return out;
}

/** Recomputes the root from the proof nodes and the leaves of [start, end). */
export function rootFromRangeProof(
  leafCount: number,
  start: number,
  end: number,
  leaves: NmtNode[],
  nodes: NmtNode[],
): NmtNode | null {
  let cursor = 0;
  let levels = 0;
  while (1 << levels < leafCount) levels += 1;
  let failed = false;
  const build = (level: number, index: number): NmtNode => {
    const span = 1 << level;
    const lo = index * span;
    const hi = lo + span;
    if (hi <= start || lo >= end) {
      const node = nodes[cursor];
      cursor += 1;
      if (!node) {
        failed = true;
        return { min: '', max: '', hash: '' };
      }
      return node;
    }
    if (level === 0) {
      const leaf = leaves[lo - start];
      if (!leaf) {
        failed = true;
        return { min: '', max: '', hash: '' };
      }
      return leaf;
    }
    return nmtInner(build(level - 1, index * 2), build(level - 1, index * 2 + 1));
  };
  const root = build(levels, 0);
  if (failed || cursor !== nodes.length) return null;
  return root;
}

/** Binary Merkle root over serialized NMT roots, as published for the data root. */
export function binaryMerkleRoot(items: Uint8Array[]): string {
  let level = items.map((item) => sha256(LEAF_PREFIX, item));
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(sha256(INNER_PREFIX, level[i], level[i + 1]));
    }
    level = next;
  }
  return toHex(level[0]);
}
