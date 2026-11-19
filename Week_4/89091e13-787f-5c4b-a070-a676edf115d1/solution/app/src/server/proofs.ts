import { toHex } from "../shared/bytes.ts";
import { nodeToJson, proofNodes, rootFromProof } from "../shared/nmt.ts";
import type { FraudProof, RootJson, RowProof } from "../shared/api.ts";
import { lineLeaves, recomputedLineRoot, shareAt, type Axis } from "./square.ts";

/** Namespace proofs for the original-half rows 0..k-1: inclusion, absence or outside, per row. */
export function namespaceProofs(square: Uint8Array[], k: number, rowRoots: RootJson[], namespace: string): RowProof[] {
  return Array.from({ length: k }, (_, row): RowProof => {
    const root = rowRoots[row] as RootJson;
    if (namespace < root.min || namespace > root.max) return { row, kind: "outside" };
    const leaves = lineLeaves(square, k, "row", row);
    const hexes = leaves.map((leaf) => toHex(leaf.min));
    const start = hexes.indexOf(namespace);
    if (start !== -1) {
      const end = hexes.lastIndexOf(namespace) + 1;
      return {
        row,
        kind: "inclusion",
        start,
        end,
        shares: Array.from({ length: end - start }, (_, i) => toHex(shareAt(square, k, row, start + i))),
        nodes: proofNodes(leaves, start, end).map(nodeToJson),
        root,
      };
    }
    const col = hexes.findIndex((hex) => hex > namespace);
    const next = leaves[col] as (typeof leaves)[number];
    return {
      row,
      kind: "absence",
      nextLeaf: { col, namespace: toHex(next.min), hash: toHex(next.hash) },
      nodes: proofNodes(leaves, col, col + 1).map(nodeToJson),
      root,
    };
  });
}

/** The first line (rows 0..2k-1, then columns 0..2k-1) whose re-extended root differs from the committed one. */
export function findBadEncoding(square: Uint8Array[], k: number, rowRoots: RootJson[], columnRoots: RootJson[]):
  | { axis: Axis; index: number; committed: RootJson; recomputed: RootJson }
  | null {
  for (const axis of ["row", "column"] as const) {
    const committedRoots = axis === "row" ? rowRoots : columnRoots;
    for (let index = 0; index < 2 * k; index++) {
      const recomputed = nodeToJson(recomputedLineRoot(square, k, axis, index));
      const committed = committedRoots[index] as RootJson;
      if (recomputed.hash !== committed.hash) return { axis, index, committed, recomputed };
    }
  }
  return null;
}

/** A fraud proof for a bad line: its k original shares, each with its proof against the crossing root, verified. */
export function buildFraudProof(
  square: Uint8Array[],
  k: number,
  height: number,
  failing: { axis: Axis; index: number; committed: RootJson; recomputed: RootJson },
  rowRoots: RootJson[],
  columnRoots: RootJson[],
  publishedAt: Date,
): FraudProof {
  const crossing: Axis = failing.axis === "row" ? "column" : "row";
  const crossingRoots = failing.axis === "row" ? columnRoots : rowRoots;
  const shares = Array.from({ length: k }, (_, position) => {
    const leaves = lineLeaves(square, k, crossing, position);
    const nodes = proofNodes(leaves, failing.index, failing.index + 1);
    const leaf = leaves[failing.index] as (typeof leaves)[number];
    const rebuilt = rootFromProof(2 * k, failing.index, failing.index + 1, [leaf], nodes);
    const root = crossingRoots[position] as RootJson;
    return {
      position,
      share: toHex(failing.axis === "row" ? shareAt(square, k, failing.index, position) : shareAt(square, k, position, failing.index)),
      nodes: nodes.map(nodeToJson),
      verified: rebuilt !== null && toHex(rebuilt.hash) === root.hash,
    };
  });
  return { height, axis: failing.axis, index: failing.index, shares, committedRoot: failing.committed, recomputedRoot: failing.recomputed, publishedAt: publishedAt.toISOString() };
}

/** Accepts only a well-formed row proof from a client body. */
export function parseRowProof(value: unknown): RowProof | null {
  if (typeof value !== "object" || value === null) return null;
  const proof = value as Record<string, unknown>;
  const hex = (v: unknown, bytes?: number): v is string => typeof v === "string" && /^[0-9a-f]*$/.test(v) && v.length % 2 === 0 && (bytes === undefined || v.length === bytes * 2);
  const root = (v: unknown): v is RootJson => typeof v === "object" && v !== null && hex((v as RootJson).min, 9) && hex((v as RootJson).max, 9) && hex((v as RootJson).hash, 32);
  const nodes = (v: unknown): v is RootJson[] => Array.isArray(v) && v.length <= 8 && v.every(root);
  const index = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) < 256;
  if (!index(proof.row)) return null;
  if (proof.kind === "outside") return { row: proof.row, kind: "outside" };
  if (proof.kind === "inclusion") {
    const { start, end, shares } = proof;
    if (!index(start) || !index(end) || !Array.isArray(shares) || !shares.every((s) => hex(s, 64)) || !nodes(proof.nodes) || !root(proof.root)) return null;
    return { row: proof.row, kind: "inclusion", start, end, shares, nodes: proof.nodes, root: proof.root };
  }
  if (proof.kind === "absence") {
    const next = proof.nextLeaf as Record<string, unknown> | null;
    if (typeof next !== "object" || next === null || !index(next.col) || !hex(next.namespace, 9) || !hex(next.hash, 32) || !nodes(proof.nodes) || !root(proof.root)) return null;
    return { row: proof.row, kind: "absence", nextLeaf: { col: next.col, namespace: next.namespace, hash: next.hash }, nodes: proof.nodes, root: proof.root };
  }
  return null;
}
