import { sha256 } from "@noble/hashes/sha2.js";
import { concat, equalBytes, fromHex, toHex } from "./bytes.ts";
import type { RowProof, RootJson } from "./api.ts";

/** A namespaced Merkle tree node: the smallest and largest namespace below it, and its hash. */
export interface NmtNode {
  min: Uint8Array;
  max: Uint8Array;
  hash: Uint8Array;
}

const LEAF_PREFIX = Uint8Array.of(0);
const INNER_PREFIX = Uint8Array.of(1);

export function leafNode(namespace: Uint8Array, share: Uint8Array): NmtNode {
  return { min: namespace, max: namespace, hash: sha256(concat(LEAF_PREFIX, namespace, share)) };
}

function compare(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return (a[i] as number) - (b[i] as number);
  return 0;
}

function innerNode(left: NmtNode, right: NmtNode): NmtNode {
  return {
    min: compare(left.min, right.min) <= 0 ? left.min : right.min,
    max: compare(left.max, right.max) >= 0 ? left.max : right.max,
    hash: sha256(concat(INNER_PREFIX, left.min, left.max, left.hash, right.min, right.max, right.hash)),
  };
}

/** Root of the leaves in [lo, hi); the leaf count is a power of two. */
function subtreeRoot(leaves: NmtNode[], lo: number, hi: number): NmtNode {
  if (hi - lo === 1) return leaves[lo] as NmtNode;
  const mid = (lo + hi) / 2;
  return innerNode(subtreeRoot(leaves, lo, mid), subtreeRoot(leaves, mid, hi));
}

export function lineRoot(leaves: NmtNode[]): NmtNode {
  return subtreeRoot(leaves, 0, leaves.length);
}

/** The fewest subtree nodes covering every leaf outside [start, end), left to right. */
export function proofNodes(leaves: NmtNode[], start: number, end: number): NmtNode[] {
  const cover = (lo: number, hi: number): NmtNode[] => {
    if (hi <= start || lo >= end) return [subtreeRoot(leaves, lo, hi)];
    if (hi - lo === 1) return [];
    const mid = (lo + hi) / 2;
    return [...cover(lo, mid), ...cover(mid, hi)];
  };
  return cover(0, leaves.length);
}

/** Rebuilds a root from the proved leaves [start, end) and the covering nodes. Null when the proof is malformed. */
export function rootFromProof(width: number, start: number, end: number, leaves: NmtNode[], nodes: NmtNode[]): NmtNode | null {
  let nextLeaf = 0;
  let nextNode = 0;
  let broken = false;
  const build = (lo: number, hi: number): NmtNode => {
    if (hi <= start || lo >= end) {
      const node = nodes[nextNode++];
      if (!node) {
        broken = true;
        return leafNode(new Uint8Array(9), new Uint8Array(0));
      }
      return node;
    }
    if (hi - lo === 1) {
      const leaf = leaves[nextLeaf++];
      if (!leaf) {
        broken = true;
        return leafNode(new Uint8Array(9), new Uint8Array(0));
      }
      return leaf;
    }
    const mid = (lo + hi) / 2;
    return innerNode(build(lo, mid), build(mid, hi));
  };
  const root = build(0, width);
  return broken || nextNode !== nodes.length || nextLeaf !== leaves.length ? null : root;
}

/** Serialized root: min || max || hash (50 bytes). */
function serialize(root: NmtNode): Uint8Array {
  return concat(root.min, root.max, root.hash);
}

/** Binary Merkle root over the serialized row roots then column roots. */
export function dataRoot(rowRoots: NmtNode[], columnRoots: NmtNode[]): Uint8Array {
  let level: Uint8Array[] = [...rowRoots, ...columnRoots].map((root) => sha256(concat(LEAF_PREFIX, serialize(root))));
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(sha256(concat(INNER_PREFIX, level[i] as Uint8Array, level[i + 1] as Uint8Array)));
    level = next;
  }
  return level[0] as Uint8Array;
}

export function nodeToJson(node: NmtNode): RootJson {
  return { min: toHex(node.min), max: toHex(node.max), hash: toHex(node.hash) };
}

function nodeFromJson(json: RootJson): NmtNode {
  return { min: fromHex(json.min), max: fromHex(json.max), hash: fromHex(json.hash) };
}

/** The verdict of Verify: the recomputed row root, and whether it is the committed one (and the proof says what it claims). */
export function verifyRowProof(
  proof: RowProof,
  namespace: string,
  width: number,
  committed: RootJson,
): { verified: boolean; root: RootJson } {
  if (proof.kind === "outside") {
    return { verified: namespace < committed.min || namespace > committed.max, root: committed };
  }
  const nodes = proof.nodes.map(nodeFromJson);
  if (proof.kind === "inclusion") {
    const leaves = proof.shares.map((hex) => {
      const share = fromHex(hex);
      return leafNode(share.slice(0, 9), share);
    });
    const rebuilt = rootFromProof(width, proof.start, proof.end, leaves, nodes);
    const sameNamespace = leaves.every((leaf) => toHex(leaf.min) === namespace);
    return rebuilt
      ? { verified: sameNamespace && leaves.length === proof.end - proof.start && sameRoot(rebuilt, committed), root: nodeToJson(rebuilt) }
      : { verified: false, root: committed };
  }
  const next = proof.nextLeaf;
  const leaf: NmtNode = { min: fromHex(next.namespace), max: fromHex(next.namespace), hash: fromHex(next.hash) };
  const rebuilt = rootFromProof(width, next.col, next.col + 1, [leaf], nodes);
  return rebuilt
    ? { verified: namespace < next.namespace && sameRoot(rebuilt, committed), root: nodeToJson(rebuilt) }
    : { verified: false, root: committed };
}

function sameRoot(node: NmtNode, json: RootJson): boolean {
  const other = nodeFromJson(json);
  return equalBytes(node.min, other.min) && equalBytes(node.max, other.max) && equalBytes(node.hash, other.hash);
}
