import { config } from "./config.ts";
import { maybeOne, rows, run, type AfterCommit, type Db } from "./db.ts";
import { rejectBlock } from "./blocks.ts";
import { isUuid } from "./ids.ts";
import { broadcast } from "./live.ts";
import { buildFraudProof, findBadEncoding } from "./proofs.ts";
import { isWithheld, splitSquare } from "./square.ts";
import { confidence, reachesThreshold, sampleSequence } from "../shared/sampling.ts";
import type { NodeSamples, RootJson, Sample } from "../shared/api.ts";

interface NodeRow {
  id: string;
  workspaceId: string;
  name: string;
  number: number;
  autoSample: boolean;
}

const NODE_COLUMNS = 'id, workspace_id AS "workspaceId", name, number, auto_sample AS "autoSample"';

export async function nodeOf(db: Db, workspaceId: string, nodeId: string): Promise<NodeRow | undefined> {
  if (!isUuid(nodeId)) return undefined;
  return maybeOne<NodeRow>(db, `SELECT ${NODE_COLUMNS} FROM light_nodes WHERE id = $1 AND workspace_id = $2`, [nodeId, workspaceId]);
}

export async function nodesOf(db: Db, workspaceId: string): Promise<NodeRow[]> {
  return rows<NodeRow>(db, `SELECT ${NODE_COLUMNS} FROM light_nodes WHERE workspace_id = $1 ORDER BY number`, [workspaceId]);
}

export async function samplesOf(db: Db, nodeId: string, height: number): Promise<Sample[]> {
  return rows<Sample>(db, "SELECT index, row, col, served, confidence FROM samples WHERE node_id = $1 AND height = $2 ORDER BY index", [nodeId, height]);
}

/** Unavailable once any sample was withheld; Available at the 99% threshold with every sample served. */
export function verdictOf(k: number, samples: Sample[]): NodeSamples["verdict"] {
  if (samples.some((sample) => !sample.served)) return "unavailable";
  return reachesThreshold(k, samples.length) ? "available" : "sampling";
}

interface BlockForSampling {
  k: number;
  withheld: boolean;
}

/** Draws the node's next sample of the block from its seeded sequence; the first withheld sample rejects the block. */
export async function takeSample(db: Db, after: AfterCommit, node: NodeRow, height: number, block: BlockForSampling, at: Date): Promise<Sample> {
  const existing = await samplesOf(db, node.id, height);
  const index = existing.length + 1;
  const { row, col } = sampleSequence(config.sampleSeed, height, node.number, block.k, index)[index - 1] as { row: number; col: number };
  const sample: Sample = { index, row, col, served: !(block.withheld && isWithheld(block.k, row, col)), confidence: confidence(block.k, index) };
  await run(
    db,
    "INSERT INTO samples (node_id, height, index, row, col, served, confidence, taken_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    [node.id, height, index, row, col, sample.served, sample.confidence, at],
  );
  const verdict = verdictOf(block.k, [...existing, sample]);
  after(() => {
    broadcast(node.workspaceId, { type: "sample", node: node.id, height, sample, verdict });
    broadcast(node.workspaceId, { type: "changed" });
  });
  if (!sample.served) {
    await rejectBlock(db, after, node.workspaceId, height, { reason: "withheld", node: node.id, nodeName: node.name, row, col }, at);
  } else if (verdict === "available") {
    await run(db, "UPDATE blocks SET status = 'available' WHERE workspace_id = $1 AND height = $2 AND status = 'sampling'", [node.workspaceId, height]);
  }
  return sample;
}

/** One scheduled tick of an auto-sampling node: one sample per interval, up to SAMPLES_PER_BLOCK in all. */
export async function autoSampleTick(db: Db, after: AfterCommit, nodeId: string, height: number, at: Date): Promise<void> {
  const node = (await maybeOne<NodeRow>(db, `SELECT ${NODE_COLUMNS} FROM light_nodes WHERE id = $1`, [nodeId])) as NodeRow;
  const block = (await maybeOne<BlockForSampling>(db, "SELECT k, withheld FROM blocks WHERE workspace_id = $1 AND height = $2", [node.workspaceId, height])) as BlockForSampling;
  const taken = (await samplesOf(db, nodeId, height)).length;
  const ticks = taken >= config.samplesPerBlock ? config.samplesPerBlock : undefined;
  await run(db, "UPDATE auto_sampling SET ticks = COALESCE($3, ticks + 1) WHERE node_id = $1 AND height = $2", [nodeId, height, ticks]);
  if (ticks === undefined) await takeSample(db, after, node, height, block, at);
}

/** The full node re-extends rows then columns and publishes one proof for the first line that does not match its root. */
export async function runFraudCheck(db: Db, after: AfterCommit, workspaceId: string, height: number, at: Date): Promise<void> {
  const block = (await maybeOne<{ k: number; square: Buffer; rowRoots: RootJson[]; columnRoots: RootJson[] }>(
    db,
    'SELECT k, square, row_roots AS "rowRoots", column_roots AS "columnRoots" FROM blocks WHERE workspace_id = $1 AND height = $2',
    [workspaceId, height],
  )) as { k: number; square: Buffer; rowRoots: RootJson[]; columnRoots: RootJson[] };
  await run(db, "UPDATE blocks SET fraud_checked = true WHERE workspace_id = $1 AND height = $2", [workspaceId, height]);
  const square = splitSquare(block.square);
  const failing = findBadEncoding(square, block.k, block.rowRoots, block.columnRoots);
  if (!failing) return;
  const proof = buildFraudProof(square, block.k, height, failing, block.rowRoots, block.columnRoots, at);
  await run(db, "INSERT INTO fraud_proofs (workspace_id, height, proof, published_at) VALUES ($1, $2, $3, $4)", [workspaceId, height, JSON.stringify(proof), at]);
  after(() => broadcast(workspaceId, { type: "fraud", height }));
  await rejectBlock(db, after, workspaceId, height, { reason: "bad-encoding", axis: failing.axis, index: failing.index }, at);
}
