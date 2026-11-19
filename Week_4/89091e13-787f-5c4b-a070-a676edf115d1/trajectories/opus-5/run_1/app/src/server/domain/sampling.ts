import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { Queryable } from '../db.js';
import { emitEvent } from '../live.js';
import { confidencePercent, isConfident, sampleSequence } from '../../shared/sampling.js';
import { isWithheldPosition } from '../../shared/square.js';
import { markAvailable, rejectBlock } from './blocks.js';
import { BlockRow, LightNodeRow, WorkspaceRow } from './types.js';

export interface SampleRow {
  index: number;
  row: number;
  col: number;
  served: boolean;
  at: Date;
}

export type SampleVerdict = 'sampling' | 'available' | 'unavailable';

export async function lightNodesOf(
  tx: Queryable,
  workspaceId: string,
): Promise<LightNodeRow[]> {
  const { rows } = await tx.query<LightNodeRow>(
    'SELECT * FROM light_nodes WHERE workspace_id = $1 ORDER BY number',
    [workspaceId],
  );
  return rows;
}

export async function samplesOf(
  tx: Queryable,
  nodeId: string,
  height: number,
): Promise<SampleRow[]> {
  const { rows } = await tx.query<SampleRow>(
    `SELECT index, row, col, served, at FROM samples
     WHERE light_node_id = $1 AND height = $2 ORDER BY index`,
    [nodeId, height],
  );
  return rows;
}

/** Confidence rises only with served samples. */
export function confidenceAfter(k: number, samples: SampleRow[], upTo: number): string {
  const served = samples.filter((sample) => sample.index <= upTo && sample.served).length;
  return confidencePercent(k, served);
}

export function verdictOf(k: number, samples: SampleRow[]): SampleVerdict {
  if (samples.some((sample) => !sample.served)) return 'unavailable';
  if (samples.length > 0 && isConfident(k, samples.length)) return 'available';
  return 'sampling';
}

export interface TakenSample {
  index: number;
  row: number;
  col: number;
  served: boolean;
  confidence: string;
  verdict: SampleVerdict;
}

/** Draws the next sample of the node's sequence for this block. */
export async function takeSample(
  tx: Queryable,
  workspace: WorkspaceRow,
  node: LightNodeRow,
  block: BlockRow,
  at: Date,
): Promise<TakenSample> {
  const existing = await samplesOf(tx, node.id, block.height);
  const index = existing.length + 1;
  const k = block.square_width;
  const sequence = sampleSequence(config.sampleSeed, block.height, node.number, k, index);
  const draw = sequence[index - 1];
  const served = !(
    block.behaviour === 'withhold' && isWithheldPosition(draw.row, draw.col, k)
  );
  await tx.query(
    `INSERT INTO samples (id, workspace_id, light_node_id, height, index, row, col, served, at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [randomUUID(), workspace.id, node.id, block.height, index, draw.row, draw.col, served, at],
  );
  const samples = [...existing, { index, row: draw.row, col: draw.col, served, at }];
  const confidence = confidenceAfter(k, samples, index);
  const verdict = verdictOf(k, samples);

  if (!served) {
    await rejectBlock(tx, workspace, block.height, at, {
      reason: 'withheld',
      node: node.id,
      nodeName: node.name,
      row: draw.row,
      col: draw.col,
    });
  } else if (verdict === 'available' && block.status === 'sampling') {
    await markAvailable(tx, workspace.id, block.height);
  }

  emitEvent(workspace.id, {
    kind: 'sample',
    nodeId: node.id,
    nodeName: node.name,
    height: block.height,
    index,
    row: draw.row,
    col: draw.col,
    served,
    confidence,
    verdict,
  });
  return { index, row: draw.row, col: draw.col, served, confidence, verdict };
}
