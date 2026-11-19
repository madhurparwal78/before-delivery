// Light-node sampling, withheld rejection and bad-encoding fraud proofs.

import { randomBytes } from "node:crypto";
import {
  bytesToHex,
  verifyRowProof,
  confidenceDecimal,
  extendSquare,
  hexToBytes,
  isBlockAvailable,
  leavesOfLine,
  mulberry32,
  nmtInner,
  nmtRootOf,
  rowRoot,
  toRootRef,
  type NmtNode,
  type ProofNodeRef,
  type RootRef,
} from "../shared/domain.js";
import type { AppConfig } from "./config.js";
import type { Db } from "./db.js";
import type { LiveHub } from "./live.js";
import { ledgerPair, personAccount, postPair } from "./ledger.js";
import { queueMail } from "./mail.js";

export interface SampleRow {
  index: number;
  row: number;
  col: number;
  served: boolean;
}

/** The node's fixed sample sequence for a height. */
export function sampleCoordinates(
  config: AppConfig,
  nodeNumber: number,
  height: number,
  k: number,
): [number, number][] {
  const rng = mulberry32((config.sampleSeed + 7919 * height + 104729 * nodeNumber) >>> 0);
  const width = 2 * k;
  const out: [number, number][] = [];
  for (let i = 0; i < config.samplesPerBlock; i++) {
    out.push([Math.floor(rng() * width), Math.floor(rng() * width)]);
  }
  return out;
}

export async function listSamples(db: Db, nodeId: string, height: number): Promise<SampleRow[]> {
  const rows = await db.many<{ index: number; row: number; col: number; served: boolean }>(
    `SELECT index, row, col, served FROM samples WHERE node_id = $1 AND height = $2 ORDER BY index`,
    [nodeId, height],
  );
  return rows.map((row) => ({ index: row.index, row: row.row, col: row.col, served: row.served }));
}

/** Takes one sample for a node at a height, drawing the node's fixed sequence. */
export async function takeSample(
  config: AppConfig,
  db: Db,
  hub: LiveHub,
  workspaceId: string,
  nodeId: string,
  height: number,
  takenAt: Date,
): Promise<SampleRow | null> {
  const node = await db.one<{ id: string; name: string; number: number }>(
    `SELECT id, name, number FROM light_nodes WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, nodeId],
  );
  const block = await db.one<{ square_width: number; withheld: string[]; status: string }>(
    `SELECT square_width, withheld, status FROM blocks WHERE workspace_id = $1 AND height = $2`,
    [workspaceId, height],
  );
  if (!node || !block) return null;
  const existing = await listSamples(db, nodeId, height);
  if (existing.length >= config.samplesPerBlock) return null;
  const nextIndex = existing.length;
  const sequence = sampleCoordinates(config, node.number, height, block.square_width);
  const [row, col] = sequence[nextIndex]!;
  const withheldSet = new Set(block.withheld);
  const served = !withheldSet.has(`${row},${col}`);
  await db.query(
    `INSERT INTO samples (id, workspace_id, node_id, height, index, row, col, served, taken_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [randomBytes(12).toString("hex"), workspaceId, nodeId, height, nextIndex, row, col, served, takenAt],
  );
  if (!served && block.status !== "rejected") {
    await rejectBlock(db, hub, workspaceId, height, {
      reason: "withheld",
      nodeId: node.id,
      nodeName: node.name,
      row,
      col,
    });
  }
  const samples = await listSamples(db, nodeId, height);
  if (
    block.status !== "rejected" &&
    isBlockAvailable(samples.length, block.square_width, samples.every((s) => s.served))
  ) {
    await db.query(`UPDATE blocks SET status = 'available' WHERE workspace_id = $1 AND height = $2`, [
      workspaceId,
      height,
    ]);
    hub.publish(workspaceId, { kind: "block-status", body: { height, status: "available" } });
  }
  return { index: nextIndex, row, col, served };
}

export interface RejectionInfo {
  reason: "withheld" | "bad-encoding";
  nodeId?: string;
  nodeName?: string;
  row?: number;
  col?: number;
  axis?: "row" | "column";
  index?: number;
}

/** Rejects a block: refunds blob fees, marks its blob transactions rejected and mails members. */
export async function rejectBlock(
  db: Db,
  hub: LiveHub,
  workspaceId: string,
  height: number,
  info: RejectionInfo,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query(`UPDATE blocks SET status = 'rejected', rejection = $3 WHERE workspace_id = $1 AND height = $2`, [
      workspaceId,
      height,
      JSON.stringify(info),
    ]);
    const blobTxs = await tx.many<{ id: string; sender_id: string; fee_ufern: bigint }>(
      `SELECT t.id, t.sender_id, t.fee_ufern::bigint AS fee_ufern
       FROM transactions t JOIN blobs b ON b.tx_id = t.id
       WHERE t.workspace_id = $1 AND t.height = $2 AND t.status = 'included'`,
      [workspaceId, height],
    );
    for (const txRow of blobTxs) {
      await tx.query(
        `UPDATE transactions SET status = 'rejected', status_text = $3, refusal = $4 WHERE id = $1`,
        [txRow.id, `Rejected — block ${height} was rejected`, `Block ${height} was rejected`],
      );
      const refund = ledgerPair({
        workspaceId,
        credit: { account: personAccount(txRow.sender_id), amount: txRow.fee_ufern },
        debit: { account: "burn", amount: txRow.fee_ufern },
        kind: "fee-refund",
        label: "Fee refund",
        at: new Date(),
        height,
      });
      await postPair(tx, refund);
    }
    const members = await tx.many<{ email: string }>(
      `SELECT p.email FROM memberships m JOIN people p ON p.id = m.person_id WHERE m.workspace_id = $1`,
      [workspaceId],
    );
    const subject = `Block ${height} was rejected`;
    const reason =
      info.reason === "withheld"
        ? `shares were withheld. Light node ${info.nodeName} could not fetch share (${info.row}, ${info.col})`
        : `${info.axis} ${info.index} is not encoded correctly`;
    for (const member of members) {
      await queueMail(
        tx,
        workspaceId,
        member.email,
        subject,
        `${subject}\n\nBlock ${height} of your Fernsquare workspace was rejected because ${reason}. Blob fees have been refunded.`,
      );
    }
  });
  hub.publish(workspaceId, { kind: "block-rejected", body: { height, ...info } });
}

export interface FraudProofShare {
  position: [number, number];
  share: string;
  nodes: ProofNodeRef[];
  verified: boolean;
}

export interface FraudProofBody {
  axis: "row" | "column";
  index: number;
  shares: FraudProofShare[];
  committedRoot: RootRef;
  recomputedRoot: RootRef;
}

/** The k original shares of a line, each with its NMT proof against the cross roots. */
function lineShareProofs(
  committedSquare: Uint8Array[],
  k: number,
  axis: "row" | "column",
  index: number,
  crossRoots: RootRef[],
): FraudProofShare[] {
  const width = 2 * k;
  const out: FraudProofShare[] = [];
  for (let i = 0; i < k; i++) {
    const row = axis === "row" ? index : i;
    const col = axis === "row" ? i : index;
    const share = committedSquare[row * width + col]!;
    const crossLine = axis === "row" ? i : row;
    const crossRoot = crossRoots[crossLine]!;
    // The share's proof against its column root (for a row) or row root (for a column).
    const leaves: NmtNode[] = leavesOfLine(committedSquare, k, axis === "row" ? "column" : "row", crossLine);
    const nodes = covering(leaves, col, col + 1);
    const verified = verifyRowProof({
      proof: {
        kind: "inclusion",
        row: crossLine,
        start: col,
        end: col + 1,
        shares: [bytesToHex(share)],
        nodes,
        root: crossRoot,
      },
      spans: nodes.map((n) => n.span),
      width,
    });
    out.push({ position: [row, col], share: bytesToHex(share), nodes, verified: verified?.hash === crossRoot.hash });
  }
  return out;
}

function covering(leaves: NmtNode[], start: number, end: number): ProofNodeRef[] {
  const plan: ProofNodeRef[] = [];
  const descend = (left: number, right: number) => {
    if (left >= end || right <= start) {
      const node = subtreeRoot(leaves, left, right);
      plan.push({ min: bytesToHex(node.min), max: bytesToHex(node.max), hash: bytesToHex(node.hash), span: right - left });
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

function subtreeRoot(leaves: NmtNode[], left: number, right: number): NmtNode {
  let level = leaves.slice(left, right);
  while (level.length > 1) {
    const next: NmtNode[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(nmtInner(level[i]!, level[i + 1]!));
    level = next;
  }
  return level[0]!;
}

/** Publishes the fraud proof for the first badly encoded line of a block. */
export async function runFraudCheck(
  db: Db,
  hub: LiveHub,
  workspaceId: string,
  height: number,
  atMs: number,
): Promise<void> {
  const block = await db.one<{
    square_width: number;
    shares_hex: string[];
    row_roots: unknown;
    column_roots: unknown;
    producer_behaviour: string;
    status: string;
  }>(
    `SELECT square_width, shares_hex, row_roots, column_roots, producer_behaviour, status FROM blocks WHERE workspace_id = $1 AND height = $2`,
    [workspaceId, height],
  );
  if (!block || block.producer_behaviour !== "bad-encoding") return;
  const existing = await db.one<{ height: number }>(
    `SELECT height FROM fraud_proofs WHERE workspace_id = $1 AND height = $2`,
    [workspaceId, height],
  );
  if (existing) return;
  const committedRowRoots = block.row_roots as RootRef[];
  const committedColumnRoots = block.column_roots as RootRef[];
  const k = block.square_width;
  const width = 2 * k;
  const committedSquare = block.shares_hex.map((hex) => hexToBytes(hex));
  const original: Uint8Array[] = [];
  for (let r = 0; r < k; r++) {
    for (let c = 0; c < k; c++) {
      original.push(committedSquare[r * width + c]!);
    }
  }
  const recomputed = extendSquare(original, k);

  const axes: { axis: "row" | "column"; roots: RootRef[] }[] = [
    { axis: "row", roots: committedRowRoots },
    { axis: "column", roots: committedColumnRoots },
  ];
  for (const { axis, roots } of axes) {
    for (let index = 0; index < width; index++) {
      const recomputedRoot =
        axis === "row" ? toRootRef(rowRoot(recomputed.shares, k, index)) : toRootRef(nmtRootOf(leavesOfLine(recomputed.shares, k, "column", index)));
      if (recomputedRoot.hash !== roots[index]!.hash) {
        const crossRoots = axis === "row" ? committedColumnRoots : committedRowRoots;
        const shares = lineShareProofs(committedSquare, k, axis, index, crossRoots);
        const body: FraudProofBody = {
          axis,
          index,
          shares,
          committedRoot: roots[index]!,
          recomputedRoot,
        };
        await db.query(
          `INSERT INTO fraud_proofs (workspace_id, height, axis, index, body, published_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [workspaceId, height, axis, index, JSON.stringify(body), new Date(atMs)],
        );
        if (block.status !== "rejected") {
          await rejectBlock(db, hub, workspaceId, height, { reason: "bad-encoding", axis, index });
        }
        hub.publish(workspaceId, { kind: "fraud-proof", body: { height, axis, index } });
        return;
      }
    }
  }
}

export function confidenceFor(samples: number, k: number): string {
  return confidenceDecimal(samples, k);
}


