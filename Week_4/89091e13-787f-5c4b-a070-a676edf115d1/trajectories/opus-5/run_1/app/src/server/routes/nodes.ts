import { db, withTransaction } from '../db.js';
import { conflict, notFound } from '../http.js';
import { emitEvent, flushEvents } from '../live.js';
import { config } from '../config.js';
import { blockAt } from '../domain/blocks.js';
import { now } from '../domain/engine.js';
import {
  confidenceAfter,
  lightNodesOf,
  samplesOf,
  takeSample,
  verdictOf,
} from '../domain/sampling.js';
import { BlockRow, LightNodeRow } from '../domain/types.js';
import {
  readBoolean,
  RequestContext,
  requireWorkspace,
  requireWrite,
  StoredResponse,
  WorkspaceContext,
} from './context.js';

function nodeView(node: LightNodeRow): Record<string, unknown> {
  return { id: node.id, name: node.name, number: node.number, autoSample: node.auto_sample };
}

async function requireNode(
  context: WorkspaceContext,
  nodeId: string,
): Promise<LightNodeRow> {
  const nodes = await lightNodesOf(db, context.workspace.id);
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw notFound();
  return node;
}

export async function listLightNodes(ctx: RequestContext, id: string): Promise<StoredResponse> {
  const context = await requireWorkspace(ctx, id);
  const nodes = await lightNodesOf(db, context.workspace.id);
  return { status: 200, body: nodes.map(nodeView) };
}

export async function patchLightNode(
  ctx: RequestContext,
  id: string,
  nodeId: string,
): Promise<StoredResponse> {
  const context = await requireWorkspace(ctx, id);
  const node = await requireNode(context, nodeId);
  requireWrite(context.role, 'transaction');
  const autoSample = readBoolean(ctx, 'autoSample');
  if (autoSample === null) return { status: 200, body: nodeView(node) };
  await db.query('UPDATE light_nodes SET auto_sample = $2, auto_sample_since = $3 WHERE id = $1', [
    node.id,
    autoSample,
    autoSample ? now() : null,
  ]);
  emitEvent(context.workspace.id, { kind: 'light-node', nodeId: node.id });
  flushEvents();
  return { status: 200, body: { ...nodeView(node), autoSample } };
}

async function requireHeight(
  workspaceId: string,
  height: string | null,
): Promise<BlockRow> {
  const parsed = Number(height);
  if (!Number.isInteger(parsed)) throw notFound();
  const block = await blockAt(db, workspaceId, parsed);
  if (!block) throw notFound();
  return block;
}

export async function listSamples(
  ctx: RequestContext,
  id: string,
  nodeId: string,
): Promise<StoredResponse> {
  const context = await requireWorkspace(ctx, id);
  const node = await requireNode(context, nodeId);
  const block = await requireHeight(context.workspace.id, ctx.query.get('height'));
  const samples = await samplesOf(db, node.id, block.height);
  return {
    status: 200,
    body: {
      height: block.height,
      k: block.square_width,
      samples: samples.map((sample) => ({
        index: sample.index,
        row: sample.row,
        col: sample.col,
        served: sample.served,
        confidence: confidenceAfter(block.square_width, samples, sample.index),
      })),
      confidence: confidenceAfter(block.square_width, samples, samples.length),
      verdict: verdictOf(block.square_width, samples),
    },
  };
}

export async function createSample(
  ctx: RequestContext,
  id: string,
  nodeId: string,
): Promise<StoredResponse> {
  const context = await requireWorkspace(ctx, id);
  const node = await requireNode(context, nodeId);
  const height = ctx.body.height;
  const block = await requireHeight(
    context.workspace.id,
    typeof height === 'number' ? String(height) : String(height ?? ''),
  );
  requireWrite(context.role, 'transaction');
  const taken = await samplesOf(db, node.id, block.height);
  if (taken.length >= config.samplesPerBlock) {
    throw conflict(
      `Light node ${node.name} has already taken ${taken.length} samples of block ${block.height}.`,
    );
  }
  const sample = await withTransaction((tx) =>
    takeSample(tx, context.workspace, node, block, now()),
  );
  flushEvents();
  return {
    status: 201,
    body: {
      index: sample.index,
      row: sample.row,
      col: sample.col,
      served: sample.served,
      confidence: sample.confidence,
      verdict: sample.verdict,
    },
  };
}
