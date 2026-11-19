// Fernsquare domain rules. Each published rule is decided in exactly one place
// here, and the browser reuses the same functions rather than restating them.

import { sha256 } from "./sha256.js";
import { bytesToHex, hexToBytes } from "./bytes.js";

export { bytesToHex, hexToBytes } from "./bytes.js";

export const UFERN_PER_FERN = 1_000_000n;
export const BLOB_BASE_GAS = 65_000;
export const GAS_PER_SHARE = 64 * 8;
export const NON_BLOB_GAS = 80_000;
export const NAMESPACE_HEX_LENGTH = 18;
export const SHARE_BYTES = 64;
export const FIRST_SHARE_DATA_BYTES = 50;
export const CONTINUATION_DATA_BYTES = 54;
export const TAIL_PADDING_NAMESPACE = "fffffffffffffffffe";
export const PARITY_NAMESPACE = "ffffffffffffffffff";
export const CONFIDENCE_DECIMALS = 4;
export const AVAILABILITY_CONFIDENCE = 0.99;

export interface ClockConfig {
  appStartAtMs: number;
  blockTimeSeconds: number;
}

export interface NetworkConfig {
  blockTimeSeconds: number;
  maxSquareWidth: number;
  minGasPriceUfernPerGas: number;
  blockRewardUfern: bigint;
  sampleSeed: number;
  samplesPerBlock: number;
  sampleIntervalMs: number;
  fraudCheckDelayMs: number;
  unbondingSeconds: number;
  maxUnbondings: number;
  maxRedelegations: number;
  minDepositUfern: bigint;
  depositPeriodSeconds: number;
  votingPeriodSeconds: number;
  voteReminderSeconds: number;
}

// ---------- namespaces ----------

export function namespaceMessages(
  hexInput: string,
  name: string,
  taken: (hex: string) => boolean,
): { field: string; message: string } | { conflict: string } | null {
  const hex = hexInput.trim().toLowerCase();
  if (!/^[0-9a-f]*$/.test(hex)) return { field: "hex", message: "Namespace must use only the characters 0-9 and a-f." };
  if (hex.length !== NAMESPACE_HEX_LENGTH) {
    return {
      field: "hex",
      message: `Namespace must be 18 hex characters (1 version byte and 8 id bytes); this one has ${hex.length}.`,
    };
  }
  if (!hex.startsWith("00")) return { field: "hex", message: "Only namespace version 00 is open to users." };
  const reserved =
    hex <= "0000000000000000ff" || hex === TAIL_PADDING_NAMESPACE || hex === PARITY_NAMESPACE;
  if (reserved) return { field: "hex", message: `Namespace ${hex} is reserved.` };
  if (!name.trim()) return { field: "name", message: "Give the namespace a name." };
  if (taken(hex)) return { conflict: `Namespace ${hex} is already registered.` };
  return null;
}

// ---------- shares ----------

export function shareCount(blobBytes: number): number {
  if (blobBytes <= 0) return 0;
  if (blobBytes <= FIRST_SHARE_DATA_BYTES) return 1;
  return 1 + Math.ceil((blobBytes - FIRST_SHARE_DATA_BYTES) / CONTINUATION_DATA_BYTES);
}

export function infoByte(isFirst: boolean): number {
  return isFirst ? 0x01 : 0x00;
}

export function sequenceLengthOf(share: Uint8Array): number {
  return (
    ((share[10]! << 24) | (share[11]! << 16) | (share[12]! << 8) | share[13]!) >>> 0
  );
}

export function tailPaddingShare(): Uint8Array {
  const share = new Uint8Array(SHARE_BYTES);
  share.set(hexToBytes(TAIL_PADDING_NAMESPACE), 0);
  share[9] = infoByte(true);
  return share;
}

/** Encodes blob data into shares with the published info byte, sequence length and padding. */
export function encodeBlobShares(namespaceHex: string, data: Uint8Array): Uint8Array[] {
  const namespace = hexToBytes(namespaceHex);
  const total = shareCount(data.length);
  const shares: Uint8Array[] = [];
  for (let i = 0; i < total; i++) {
    const share = new Uint8Array(SHARE_BYTES);
    share.set(namespace, 0);
    share[9] = infoByte(i === 0);
    if (i === 0) {
      const len = data.length;
      share[10] = (len >>> 24) & 0xff;
      share[11] = (len >>> 16) & 0xff;
      share[12] = (len >>> 8) & 0xff;
      share[13] = len & 0xff;
      const count = Math.min(FIRST_SHARE_DATA_BYTES, data.length);
      share.set(data.subarray(0, count), 14);
    } else {
      const offset = FIRST_SHARE_DATA_BYTES + (i - 1) * CONTINUATION_DATA_BYTES;
      const count = Math.min(CONTINUATION_DATA_BYTES, data.length - offset);
      share.set(data.subarray(offset, offset + count), 10);
    }
    shares.push(share);
  }
  return shares;
}

export function decodeBlobData(shares: Uint8Array[]): Uint8Array {
  if (shares.length === 0) return new Uint8Array(0);
  const length = sequenceLengthOf(shares[0]!);
  const out = new Uint8Array(length);
  let offset = 0;
  for (let i = 0; i < shares.length && offset < length; i++) {
    const share = shares[i]!;
    const start = i === 0 ? 14 : 10;
    const capacity = i === 0 ? FIRST_SHARE_DATA_BYTES : CONTINUATION_DATA_BYTES;
    const take = Math.min(capacity, length - offset);
    out.set(share.subarray(start, start + take), offset);
    offset += take;
  }
  return out;
}

// ---------- gas and fees ----------

export function blobGas(shares: number): number {
  return BLOB_BASE_GAS + shares * GAS_PER_SHARE;
}

/** Fee in ufern computed exactly with integer arithmetic (no floating point).
 * The gas price arrives scaled by 10^6 ufern per FERN, so one gas unit costs
 * price/10^6 ufern and the ceil happens on the exact remainder. */
export function feeUfern(gas: number, minGasPriceUfernPerGas: number): bigint {
  const scaled = BigInt(Math.round(minGasPriceUfernPerGas * 1_000_000));
  const product = BigInt(gas) * scaled;
  const quotient = product / 1_000_000n;
  return product % 1_000_000n === 0n ? quotient : quotient + 1n;
}

export function blobFeeUfern(shares: number, cfg: NetworkConfig): bigint {
  return feeUfern(blobGas(shares), cfg.minGasPriceUfernPerGas);
}

export function nonBlobFeeUfern(cfg: NetworkConfig): bigint {
  return feeUfern(NON_BLOB_GAS, cfg.minGasPriceUfernPerGas);
}

export function maxBlobBytes(cfg: NetworkConfig): number {
  return FIRST_SHARE_DATA_BYTES + CONTINUATION_DATA_BYTES * (cfg.maxSquareWidth ** 2 - 1);
}

// ---------- money ----------

export function parseFernAmount(text: string): bigint | null {
  const trimmed = text.trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(trimmed)) return null;
  const [whole, decimal = ""] = trimmed.split(".");
  const ufern = BigInt(whole) * UFERN_PER_FERN + BigInt((decimal + "000000").slice(0, 6));
  return ufern;
}

export function formatFern(ufern: bigint): string {
  const negative = ufern < 0n;
  const abs = negative ? -ufern : ufern;
  const whole = (abs / UFERN_PER_FERN).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (abs % UFERN_PER_FERN).toString().padStart(6, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

export function formatFernWithUnit(ufern: bigint): string {
  return `${formatFern(ufern)} FERN`;
}

// ---------- square layout ----------

export interface LaidOutShare {
  kind: "blob" | "padding";
  namespace: string;
  blobIndex: number;
  shareIndex: number;
}

export interface LaidOutBlob {
  blobIndex: number;
  namespace: string;
  shareCount: number;
  positions: [number, number][];
}

export interface LaidOutSquare {
  k: number;
  shares: LaidOutShare[];
  blobs: LaidOutBlob[];
  namespaceOrder: string[];
}

/** Sizes the square: the smallest power of two with k x k >= data shares, capped. */
export function squareWidthFor(dataShares: number, maxSquareWidth: number): number {
  let k = 1;
  while (k * k < dataShares) {
    if (k >= maxSquareWidth) break;
    k *= 2;
  }
  return Math.min(k, maxSquareWidth);
}

/** Lays blob shares out by namespace byte order, then submission order, then tail padding. */
export function layoutSquare(
  blobs: { namespace: string; shareCount: number }[],
  maxSquareWidth: number,
): LaidOutSquare {
  const ordered = blobs
    .map((blob, blobIndex) => ({ ...blob, blobIndex }))
    .sort((a, b) => compareNamespaceHex(a.namespace, b.namespace) || a.blobIndex - b.blobIndex);
  const dataShares: LaidOutShare[] = [];
  const laid: LaidOutBlob[] = [];
  for (const blob of ordered) {
    for (let s = 0; s < blob.shareCount; s++) {
      dataShares.push({ kind: "blob", namespace: blob.namespace, blobIndex: blob.blobIndex, shareIndex: s });
    }
    laid.push({
      blobIndex: blob.blobIndex,
      namespace: blob.namespace,
      shareCount: blob.shareCount,
      positions: [],
    });
  }
  const dataCount = dataShares.length;
  const k = squareWidthFor(dataCount, maxSquareWidth);
  while (dataShares.length < k * k) {
    dataShares.push({ kind: "padding", namespace: TAIL_PADDING_NAMESPACE, blobIndex: -1, shareIndex: -1 });
  }
  let cursor = 0;
  for (const blob of laid) {
    blob.positions = [];
    for (let s = 0; s < blob.shareCount; s++) {
      blob.positions.push([Math.floor(cursor / k), cursor % k]);
      cursor++;
    }
  }
  return { k, shares: dataShares.slice(0, k * k), blobs: laid, namespaceOrder: ordered.map((b) => b.namespace) };
}

export function compareNamespaceHex(a: string, b: string): number {
  const bytesA = hexToBytes(a);
  const bytesB = hexToBytes(b);
  const length = Math.min(bytesA.length, bytesB.length);
  for (let i = 0; i < length; i++) {
    const diff = bytesA[i]! - bytesB[i]!;
    if (diff !== 0) return diff;
  }
  return bytesA.length - bytesB.length;
}

// ---------- GF(2^8) and erasure extension ----------

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function initGfTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x = (x << 1) ^ (x & 0x80 ? 0x11d : 0);
    x &= 0xff;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]!;
})();

export function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a]! + GF_LOG[b]!]!;
}

function gfInv(a: number): number {
  return GF_EXP[255 - GF_LOG[a]!]!;
}

/** Extends a line of k shares to its k parity shares by evaluating the unique
 * polynomial of degree < k at points k..2k-1 (Lagrange interpolation in GF(2^8)). */
export function extendLine(line: Uint8Array[]): Uint8Array[] {
  const k = line.length;
  const parity: Uint8Array[] = [];
  for (let j = k; j < 2 * k; j++) {
    const out = new Uint8Array(SHARE_BYTES);
    for (let b = 0; b < SHARE_BYTES; b++) {
      let acc = 0;
      for (let i = 0; i < k; i++) {
        let num = 1;
        let den = 1;
        for (let m = 0; m < k; m++) {
          if (m !== i) {
            num = gfMul(num, j ^ m);
            den = gfMul(den, i ^ m);
          }
        }
        acc ^= gfMul(gfMul(line[i]![b]!, num), gfInv(den));
      }
      out[b] = acc;
    }
    parity.push(out);
  }
  return parity;
}

export type Quadrant = "Q0" | "Q1" | "Q2" | "Q3";

export function quadrantOf(row: number, col: number, k: number): Quadrant {
  const bottom = row >= k;
  const right = col >= k;
  if (!bottom && !right) return "Q0";
  if (!bottom && right) return "Q1";
  if (bottom && !right) return "Q2";
  return "Q3";
}

export interface ExtendedSquare {
  k: number;
  width: number;
  shares: Uint8Array[];
}

/** Extends the k x k original quadrant to the 2k x 2k square in quadrant order Q1, Q2, Q3. */
export function extendSquare(original: Uint8Array[], k: number): ExtendedSquare {
  const width = 2 * k;
  const shares: Uint8Array[] = new Array(width * width);
  const originalAt = (r: number, c: number) => original[r * k + c]!;
  for (let r = 0; r < k; r++) for (let c = 0; c < k; c++) shares[r * width + c] = originalAt(r, c);
  for (let r = 0; r < k; r++) {
    const parity = extendLine(firstK(original, k, r));
    for (let j = 0; j < k; j++) shares[r * width + k + j] = parity[j]!;
  }
  for (let c = 0; c < k; c++) {
    const parity = extendLine(firstColumnK(original, k, c));
    for (let j = 0; j < k; j++) shares[(k + j) * width + c] = parity[j]!;
  }
  for (let r = k; r < width; r++) {
    const line: Uint8Array[] = [];
    for (let c = 0; c < k; c++) line.push(shares[r * width + c]!);
    const parity = extendLine(line);
    for (let j = 0; j < k; j++) shares[r * width + k + j] = parity[j]!;
  }
  return { k, width, shares };
}

function firstK(original: Uint8Array[], k: number, r: number): Uint8Array[] {
  const line: Uint8Array[] = [];
  for (let c = 0; c < k; c++) line.push(original[r * k + c]!);
  return line;
}

function firstColumnK(original: Uint8Array[], k: number, c: number): Uint8Array[] {
  const line: Uint8Array[] = [];
  for (let r = 0; r < k; r++) line.push(original[r * k + c]!);
  return line;
}

export function lineOfRow(square: Uint8Array[], k: number, r: number): Uint8Array[] {
  const width = 2 * k;
  const line: Uint8Array[] = [];
  for (let c = 0; c < width; c++) line.push(square[r * width + c]!);
  return line;
}

export function lineOfColumn(square: Uint8Array[], k: number, c: number): Uint8Array[] {
  const width = 2 * k;
  const line: Uint8Array[] = [];
  for (let r = 0; r < width; r++) line.push(square[r * width + c]!);
  return line;
}

// ---------- namespaced Merkle trees ----------

export interface NmtNode {
  min: Uint8Array;
  max: Uint8Array;
  hash: Uint8Array;
}

export function nmtLeaf(share: Uint8Array, namespace: Uint8Array): NmtNode {
  const preimage = new Uint8Array(1 + 9 + SHARE_BYTES);
  preimage[0] = 0x00;
  preimage.set(namespace, 1);
  preimage.set(share, 10);
  return { min: namespace, max: namespace, hash: sha256(preimage) };
}

export function nmtInner(left: NmtNode, right: NmtNode): NmtNode {
  const preimage = new Uint8Array(1 + 9 + 9 + 32 + 9 + 9 + 32);
  let o = 0;
  preimage[o++] = 0x01;
  preimage.set(left.min, o);
  o += 9;
  preimage.set(left.max, o);
  o += 9;
  preimage.set(left.hash, o);
  o += 32;
  preimage.set(right.min, o);
  o += 9;
  preimage.set(right.max, o);
  o += 9;
  preimage.set(right.hash, o);
  return {
    min: compareBytes(left.min, right.min) <= 0 ? left.min : right.min,
    max: compareBytes(left.max, right.max) >= 0 ? left.max : right.max,
    hash: sha256(preimage),
  };
}

export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i]! < b[i]!) return -1;
    if (a[i]! > b[i]!) return 1;
  }
  return a.length - b.length;
}

export function nmtRootOf(leaves: NmtNode[]): NmtNode {
  let level = leaves;
  while (level.length > 1) {
    const next: NmtNode[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(nmtInner(level[i]!, level[i + 1]!));
    level = next;
  }
  return level[0]!;
}

/** Leaf namespace: the share's own first 9 bytes in Q0, the parity namespace elsewhere. */
export function leafNamespace(share: Uint8Array, row: number, col: number, k: number): Uint8Array {
  if (row < k && col < k) return share.subarray(0, 9);
  return hexToBytes(PARITY_NAMESPACE);
}

export function leavesOfLine(square: Uint8Array[], k: number, axis: "row" | "column", index: number): NmtNode[] {
  const line = axis === "row" ? lineOfRow(square, k, index) : lineOfColumn(square, k, index);
  return line.map((share, i) => {
    const row = axis === "row" ? index : i;
    const col = axis === "row" ? i : index;
    return nmtLeaf(share, leafNamespace(share, row, col, k));
  });
}

export interface RootRef {
  min: string;
  max: string;
  hash: string;
}

export function toRootRef(root: NmtNode): RootRef {
  return { min: bytesToHex(root.min), max: bytesToHex(root.max), hash: bytesToHex(root.hash) };
}

export function rowRoot(square: Uint8Array[], k: number, r: number): NmtNode {
  return nmtRootOf(leavesOfLine(square, k, "row", r));
}

export function columnRoot(square: Uint8Array[], k: number, c: number): NmtNode {
  return nmtRootOf(leavesOfLine(square, k, "column", c));
}

export function serializeRoot(root: NmtNode): Uint8Array {
  const out = new Uint8Array(50);
  out.set(root.min, 0);
  out.set(root.max, 9);
  out.set(root.hash, 18);
  return out;
}

export function serializeRootRef(ref: RootRef): Uint8Array {
  const out = new Uint8Array(50);
  out.set(hexToBytes(ref.min), 0);
  out.set(hexToBytes(ref.max), 9);
  out.set(hexToBytes(ref.hash), 18);
  return out;
}

/** Binary Merkle root over the 4k serialized roots (rows then columns). */
export function dataRootOf(square: Uint8Array[], k: number): Uint8Array {
  const width = 2 * k;
  const serialized: Uint8Array[] = [];
  for (let r = 0; r < width; r++) serialized.push(serializeRoot(rowRoot(square, k, r)));
  for (let c = 0; c < width; c++) serialized.push(serializeRoot(columnRoot(square, k, c)));
  let level = serialized.map((root) => {
    const preimage = new Uint8Array(51);
    preimage[0] = 0x00;
    preimage.set(root, 1);
    return sha256(preimage);
  });
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const preimage = new Uint8Array(65);
      preimage[0] = 0x01;
      preimage.set(level[i]!, 1);
      preimage.set(level[i + 1]!, 33);
      next.push(sha256(preimage));
    }
    level = next;
  }
  return level[0]!;
}

// ---------- namespace proofs ----------

/** A covering subtree node with the width of leaves it covers. */
export interface ProofNodeRef extends RootRef {
  span: number;
}

export interface InclusionProof {
  row: number;
  kind: "inclusion";
  start: number;
  end: number;
  shares: string[];
  nodes: ProofNodeRef[];
  root: RootRef;
}

export interface AbsenceProof {
  row: number;
  kind: "absence";
  nextLeaf: { col: number; namespace: string; hash: string };
  nodes: ProofNodeRef[];
  root: RootRef;
}

export interface OutsideProof {
  row: number;
  kind: "outside";
}

export type RowProof = InclusionProof | AbsenceProof | OutsideProof;

export interface ProofPlanNode extends RootRef {
  span: number;
}

export interface InclusionProofPlan {
  row: number;
  kind: "inclusion";
  start: number;
  end: number;
  shares: string[];
  nodes: ProofPlanNode[];
  root: RootRef;
}

export interface AbsenceProofPlan {
  row: number;
  kind: "absence";
  nextLeaf: { col: number; namespace: string; hash: string };
  nodes: ProofPlanNode[];
  root: RootRef;
}

/** Fewest subtree nodes covering every leaf outside [start, end), left to right,
 * with each node's leaf span attached so verification needs no trust in layout. */
function coveringPlan(leaves: NmtNode[], start: number, end: number): ProofPlanNode[] {
  const plan: ProofPlanNode[] = [];
  const descend = (left: number, right: number) => {
    if (left >= end || right <= start) {
      plan.push({ ...toRootRef(rootOfRange(leaves, left, right)), span: right - left });
      return;
    }
    if (right - left === 1 || (left >= start && right <= end)) return;
    const mid = (left + right) / 2;
    descend(left, mid);
    descend(mid, right);
  };
  descend(0, leaves.length);
  return plan;
}

function rootOfRange(level: NmtNode[], left: number, right: number): NmtNode {
  let current = level.slice(left, right);
  while (current.length > 1) {
    const next: NmtNode[] = [];
    for (let i = 0; i < current.length; i += 2) next.push(nmtInner(current[i]!, current[i + 1]!));
    current = next;
  }
  return current[0]!;
}

/** Namespace proofs for rows 0..k-1 (the original half) of a square. */
export function proveNamespaceRows(
  square: Uint8Array[],
  k: number,
  namespaceHex: string,
): { rows: RowProof[]; rowRoots: RootRef[] } {
  const ns = hexToBytes(namespaceHex);
  const rows: RowProof[] = [];
  const rowRoots: RootRef[] = [];
  for (let r = 0; r < k; r++) {
    const leaves = leavesOfLine(square, k, "row", r).slice(0, 2 * k);
    const root = nmtRootOf(leaves);
    rowRoots.push(toRootRef(root));
    if (!(compareBytes(root.min, ns) <= 0 && compareBytes(ns, root.max) <= 0)) {
      rows.push({ row: r, kind: "outside" });
      continue;
    }
    const columns = leaves.map((leaf, c) => ({ leaf, c })).filter(({ leaf }) => compareBytes(leaf.min, ns) === 0);
    if (columns.length > 0) {
      const start = columns[0]!.c;
      const end = columns[columns.length - 1]!.c + 1;
      const nodes = coveringPlan(leaves, start, end);
      rows.push({
        row: r,
        kind: "inclusion",
        start,
        end,
        shares: columns.map(({ c }) => bytesToHex(square[r * 2 * k + c]!)),
        nodes,
        root: toRootRef(root),
      });
    } else {
      let nextCol = -1;
      for (let c = 0; c < leaves.length; c++) {
        if (compareBytes(leaves[c]!.min, ns) > 0) {
          nextCol = c;
          break;
        }
      }
      if (nextCol < 0) nextCol = leaves.length - 1;
      const nodes = coveringPlan(leaves, nextCol, nextCol + 1);
      rows.push({
        row: r,
        kind: "absence",
        nextLeaf: {
          col: nextCol,
          namespace: bytesToHex(leaves[nextCol]!.min),
          hash: bytesToHex(leaves[nextCol]!.hash),
        },
        nodes,
        root: toRootRef(root),
      });
    }
  }
  return { rows, rowRoots };
}

/** A row proof with its covering nodes' span widths attached, so a verifier can
 * rebuild the leaf row without trusting the prover's layout. */
export interface VerifiableProof {
  proof: InclusionProof | AbsenceProof;
  spans: number[];
  width: number;
}

/** Attaches the covering nodes' span widths so verification can rebuild the row. */
export function toVerifiable(
  proof: InclusionProof | AbsenceProof,
  spans: number[],
  width: number,
): VerifiableProof {
  return { proof, spans, width };
}

/** Recomputes a row root from a proof: leaves at their columns, covering nodes at
 * their spans. A covering node of span s is folded level by level so the tree
 * shape stays the one the row committed to. Returns null when it does not add up. */
export function verifyRowProof(v: VerifiableProof): RootRef | null {
  const proof = v.proof;
  const slots: (NmtNode | null)[] = new Array(v.width).fill(null);
  const slotSpans: number[] = new Array(v.width).fill(1);
  let cursor = 0;
  const take = (): { node: NmtNode; span: number } => {
    const ref = proof.nodes[cursor]!;
    cursor++;
    return {
      node: { min: hexToBytes(ref.min), max: hexToBytes(ref.max), hash: hexToBytes(ref.hash) },
      span: ref.span,
    };
  };
  if (proof.kind === "inclusion") {
    if (proof.start + proof.shares.length > v.width) return null;
    proof.shares.forEach((hex, i) => {
      const share = hexToBytes(hex);
      slots[proof.start + i] = nmtLeaf(share, share.subarray(0, 9));
    });
    if (spansSum(v.spans, 0, beforeCount(v)) !== proof.start) return null;
    if (spansSum(v.spans, beforeCount(v), v.spans.length) !== v.width - proof.end) return null;
    fillSpans(slots, slotSpans, 0, 0, beforeCount(v), take);
    fillSpans(slots, slotSpans, proof.end, beforeCount(v), v.spans.length, take);
  } else {
    if (proof.nextLeaf.col >= v.width) return null;
    const ns = hexToBytes(proof.nextLeaf.namespace);
    slots[proof.nextLeaf.col] = { min: ns, max: ns, hash: hexToBytes(proof.nextLeaf.hash) };
    if (spansSum(v.spans, 0, beforeCount(v)) !== proof.nextLeaf.col) return null;
    if (spansSum(v.spans, beforeCount(v), v.spans.length) !== v.width - proof.nextLeaf.col - 1) return null;
    fillSpans(slots, slotSpans, 0, 0, beforeCount(v), take);
    fillSpans(slots, slotSpans, proof.nextLeaf.col + 1, beforeCount(v), v.spans.length, take);
  }
  return foldWithSpans(slots, slotSpans);
}

/** Folds a row where each slot is either a single leaf or a covering node whose
 * slotSpan is the number of leaves it stands for. The fold walks the leaf space:
 * a slot with span s advances s leaf positions, and sibling pairs at equal width
 * hash up until one root is left. */
function foldWithSpans(slots: (NmtNode | null)[], slotSpans: number[]): RootRef | null {
  const totalLeaves = slots.length;
  if (!isPowerOfTwo(totalLeaves)) return null;
  type Entry = { node: NmtNode; span: number };
  let level: Entry[] = [];
  for (let i = 0; i < slots.length; ) {
    const slot = slots[i]!;
    if (slot === null) return null;
    level.push({ node: slot, span: slotSpans[i] ?? 1 });
    i += slotSpans[i] ?? 1;
  }
  let leafWidth = 1;
  while (leafWidth < totalLeaves) {
    const next: Entry[] = [];
    let i = 0;
    while (i < level.length) {
      const left = level[i]!;
      if (left.span < leafWidth) return null;
      if (left.span > leafWidth) {
        // Covering node spans several sibling groups of this level: it moves up
        // one level at a time; at this width it still covers more than one pair,
        // so carry it and let the next level split it further.
        next.push(left);
        i += 1;
        continue;
      }
      const right = level[i + 1]!;
      if (right.span !== leafWidth) return null;
      next.push({ node: nmtInner(left.node, right.node), span: leafWidth * 2 });
      i += 2;
    }
    level = next;
    leafWidth *= 2;
    const covered = level.reduce((acc, entry) => acc + entry.span, 0);
    if (covered !== totalLeaves) return null;
  }
  if (level.length !== 1 || level[0]!.span !== totalLeaves) return null;
  return toRootRef(level[0]!.node);
}

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

function beforeCount(v: VerifiableProof): number {
  const proof = v.proof;
  const boundary = proof.kind === "inclusion" ? proof.start : proof.nextLeaf.col;
  return countBefore(v.spans, boundary);
}

function countBefore(spans: number[], boundary: number): number {
  let sum = 0;
  let count = 0;
  for (const span of spans) {
    if (sum + span > boundary) break;
    sum += span;
    count++;
  }
  return count;
}

function spansSum(spans: number[], from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += spans[i]!;
  return sum;
}

function fillSpans(
  slots: (NmtNode | null)[],
  slotSpans: number[],
  left: number,
  spanFrom: number,
  spanTo: number,
  take: () => { node: NmtNode; span: number },
): void {
  let position = left;
  for (let i = spanFrom; i < spanTo; i++) {
    const { node, span } = take();
    slots[position] = node;
    slotSpans[position] = span;
    position += span;
  }
}

// ---------- sampling ----------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Per node and block: rng = mulberry32((seed + 7919*h + 104729*n) mod 2^32), drawing row then column. */
export function sampleSequence(
  cfg: Pick<NetworkConfig, "sampleSeed" | "samplesPerBlock">,
  nodeNumber: number,
  height: number,
  k: number,
): [number, number][] {
  const rng = mulberry32((cfg.sampleSeed + 7919 * height + 104729 * nodeNumber) >>> 0);
  const width = 2 * k;
  const out: [number, number][] = [];
  for (let i = 0; i < cfg.samplesPerBlock; i++) {
    out.push([Math.floor(rng() * width), Math.floor(rng() * width)]);
  }
  return out;
}

/** Withhold probability for one uniform sample: (k+1)^2 / (2k)^2. */
export function withheldChance(k: number): number {
  return ((k + 1) * (k + 1)) / ((2 * k) * (2 * k));
}

/** Confidence after s samples: 1 - (1 - p)^s, as an exact decimal string with 4 decimals. */
export function confidenceDecimal(samples: number, k: number): string {
  if (samples <= 0) return "0.0000";
  const p = withheldChance(k);
  const value = 1 - Math.pow(1 - p, samples);
  return (value * 100).toFixed(4);
}

export function confidenceRatio(samples: number, k: number): number {
  const p = withheldChance(k);
  return 1 - Math.pow(1 - p, samples);
}

/** A block is Available once confidence >= 99% and every sample was served. */
export function isBlockAvailable(samples: number, k: number, allServed: boolean): boolean {
  return allServed && confidenceRatio(samples, k) >= AVAILABILITY_CONFIDENCE;
}

export function samplesToAvailable(k: number): number {
  let s = 1;
  while (!isBlockAvailable(s, k, true)) s++;
  return s;
}

// ---------- percentage display ----------

/** Two-decimal percentage from exact fractions, rounding half away from zero. */
export function percentFromFraction(numerator: bigint, denominator: bigint): string {
  if (denominator === 0n) return "0.00";
  const negative = numerator < 0n;
  const absNum = negative ? -numerator : numerator;
  const timesTenThousand = (absNum * 10_000n) / denominator;
  const remainder = (absNum * 10_000n) % denominator;
  let scaled = timesTenThousand;
  if (remainder * 2n >= denominator) scaled += 1n;
  const text = scaled.toString().padStart(3, "0");
  const whole = text.slice(0, -2);
  const frac = text.slice(-2);
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

/** Two-decimal percentage from a ratio in [0, 1], rounding half away from zero. */
export function percentFromRatio(value: number): string {
  const scaled = Math.round(value * 10_000 * 100) / 100;
  return formatScaledPercent(scaled / 100);
}

function formatScaledPercent(wholePercent: number): string {
  const fixed = wholePercent.toFixed(2);
  return fixed;
}

export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

