import { config } from '../config.js';
import { MAX_RENDER_ATTEMPTS, renderCost, sha256Hex } from '../domain.js';
import type { Render } from '../types.js';
import { transaction, type Tx } from './db.js';
import { capture, release } from './credits.js';
import { queueMail } from './outbox.js';
import { renderReadyEmail } from './documents.js';
import { getPieceTx, type PieceRow, type RenderRow } from './store.js';
import { RenderProviderClient, type RenderJobSpec } from './lib/ai.js';
import type { RenderQueue } from './lib/queue.js';
import type { StorageLike } from './lib/storage.js';

export interface RenderWorkerDeps {
  provider: RenderProviderClient;
  storage: StorageLike;
  queue: RenderQueue;
}

function renderFrom(row: Record<string, unknown>): RenderRow {
  return {
    id: row.id as string,
    piece_slug: row.piece_slug as string,
    state: row.state as Render['state'],
    failure_reason: (row.failure_reason as Render['failure_reason']) ?? null,
    cost_credits: row.cost_credits as number,
    attempts: row.attempts as number,
    format: row.format as Render['format'],
    resolution: row.resolution as Render['resolution'],
    duration_s: row.duration_s as number,
    aspect: row.aspect as Render['aspect'],
    sha256: (row.sha256 as string | null) ?? null,
    history: JSON.parse(row.history_json as string) as Render['history'],
    created_at: new Date(row.created_at as string)
  };
}

async function loadRender(tx: Tx, id: string): Promise<RenderRow | null> {
  const row = await tx.one<Record<string, unknown>>(
    `SELECT id, piece_slug, state, failure_reason, cost_credits, attempts, format, resolution, duration_s, aspect, sha256, history::text AS history_json, created_at
     FROM renders WHERE id = $1 FOR UPDATE`,
    [id]
  );
  return row ? renderFrom(row) : null;
}

async function appendHistory(tx: Tx, id: string, state: string): Promise<void> {
  await tx.query(
    `UPDATE renders SET history = history || $2::jsonb WHERE id = $1`,
    [id, JSON.stringify([{ state, at: new Date().toISOString() }])]
  );
}

/**
 * Runs one delivered job. At-least-once delivery means a job delivered again
 * after reaching ready or credits_released must do nothing here.
 */
export async function processRenderJob(deps: RenderWorkerDeps, renderId: string, attempt: number, ack: () => void): Promise<void> {
  let creatorId = '';
  const keep = await transaction(async (tx) => {
    const render = await loadRender(tx, renderId);
    if (!render) return false;
    const piece = await getPieceTx(tx, render.piece_slug);
    creatorId = piece?.creator_id ?? '';
    if (render.state === 'ready' || render.state === 'credits_released') return false;
    if (render.state === 'queued' || render.state === 'accepted') {
      await tx.query(`UPDATE renders SET state = 'rendering', attempts = $2 WHERE id = $1`, [renderId, attempt]);
      await appendHistory(tx, renderId, 'rendering');
      return true;
    }
    if (render.state === 'rendering') {
      await tx.query(`UPDATE renders SET attempts = $2 WHERE id = $1`, [renderId, attempt]);
      return true;
    }
    return false;
  });
  if (!keep || !creatorId) {
    ack();
    return;
  }

  const piece = await transaction(async (tx) => getPieceTx(tx, (await loadRender(tx, renderId))?.piece_slug ?? ''));
  const render = await transaction(async (tx) => loadRender(tx, renderId));
  if (!render || !piece) { ack(); return; }

  const spec: RenderJobSpec = {
    job_id: render.id,
    fragment_source: piece.fragment_source,
    uniforms: Object.fromEntries(piece.uniforms.map((u) => [u.name, u.value])),
    timeline: piece.timeline,
    format: render.format,
    resolution: render.resolution,
    duration_s: render.duration_s,
    aspect: render.aspect
  };
  const outcome = await deps.provider.call(spec);

  if (outcome.ok) {
    const bytes = Buffer.from(outcome.content_base64, 'base64');
    if (sha256Hex(bytes) !== outcome.sha256) {
      await failRender(deps, render, piece, 'malformed', attempt, ack, false);
      return;
    }
    let stored = false;
    try {
      await deps.storage.put(`renders/${render.id}/export.${render.format}`, bytes, render.format === 'mp4' ? 'video/mp4' : 'video/webm');
      const readBack = await deps.storage.get(`renders/${render.id}/export.${render.format}`);
      stored = sha256Hex(readBack) === outcome.sha256;
    } catch {
      stored = false;
    }
    if (!stored) {
      await failRender(deps, render, piece, 'storage_error', attempt, ack, true);
      return;
    }
    await finishRender(render, piece, outcome.sha256, ack);
    return;
  }

  const failureReason = outcome.reason === 'timeout' ? 'timeout' : outcome.reason === 'malformed' ? 'malformed' : 'provider_error';
  await failRender(deps, render, piece, failureReason, attempt, ack, failureReason !== 'malformed');
}

async function finishRender(render: RenderRow, piece: PieceRow, sha: string, ack: () => void): Promise<void> {
  const email = renderReadyEmail(piece.title);
  await transaction(async (tx) => {
    const current = await loadRender(tx, render.id);
    if (!current || current.state === 'ready' || current.state === 'credits_released') return;
    await tx.query(`UPDATE renders SET state = 'stored', sha256 = $2 WHERE id = $1`, [render.id, sha]);
    await appendHistory(tx, render.id, 'stored');
    await tx.query(`UPDATE renders SET state = 'ready' WHERE id = $1 AND state = 'stored'`, [render.id]);
    await appendHistory(tx, render.id, 'ready');
    await capture(tx, piece.creator_id, current.cost_credits, render.id);
    const creator = await tx.one<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [piece.creator_id]);
    if (creator) {
      email.to = creator.email;
      await queueMail(tx, 'render_ready', email);
    }
  });
  ack();
}

async function failRender(
  deps: RenderWorkerDeps,
  render: RenderRow,
  piece: PieceRow,
  reason: 'provider_error' | 'timeout' | 'malformed' | 'storage_error',
  attempt: number,
  ack: () => void,
  allowRetry: boolean
): Promise<void> {
  const canRetry = allowRetry && attempt < MAX_RENDER_ATTEMPTS;
  if (canRetry) {
    const waitSeconds = attempt === 1 ? config.renderBackoffSeconds : config.renderBackoffSeconds * 2;
    setTimeout(() => {
      void deps.queue.publish({ render_id: render.id, piece_slug: render.piece_slug, attempt: attempt + 1 }).catch(() => null);
    }, waitSeconds * 1000);
    ack();
    return;
  }
  const finalReason = reason === 'timeout' ? 'timed_out' : 'failed';
  await transaction(async (tx) => {
    const current = await loadRender(tx, render.id);
    if (!current || current.state === 'credits_released' || current.state === 'ready') return;
    await tx.query(`UPDATE renders SET state = $2, failure_reason = $3 WHERE id = $1`, [render.id, finalReason, reason === 'timeout' ? 'timeout' : reason]);
    await appendHistory(tx, render.id, finalReason);
    await releaseRenderCredits(tx, render.id, piece.creator_id, current.cost_credits);
  });
  await deps.queue.publishDead({
    render_id: render.id,
    piece_slug: render.piece_slug,
    attempt,
    failure_reason: reason
  }).catch(() => null);
  ack();
}

async function releaseRenderCredits(tx: Tx, renderId: string, creatorId: string, cost: number): Promise<void> {
  const already = await tx.one<{ id: string }>(
    `SELECT e.id FROM credit_entries e WHERE e.kind = 'release' AND e.render_id = $1 LIMIT 1`,
    [renderId]
  );
  if (already) return;
  await release(tx, creatorId, cost, renderId);
  await tx.query(`UPDATE renders SET state = 'credits_released' WHERE id = $1`, [renderId]);
  await appendHistory(tx, renderId, 'credits_released');
}

export async function cancelRender(renderId: string): Promise<RenderRow | null> {
  return transaction(async (tx) => {
    const render = await loadRender(tx, renderId);
    if (!render || render.state !== 'queued') return null;
    const piece = await getPieceTx(tx, render.piece_slug);
    if (!piece) return null;
    await releaseRenderCredits(tx, renderId, piece.creator_id, render.cost_credits);
    await tx.query(`UPDATE renders SET failure_reason = 'cancelled' WHERE id = $1`, [renderId]);
    return loadRender(tx, renderId);
  });
}

export function costOf(resolution: '720p' | '1080p', durationS: number): number {
  return renderCost(resolution, durationS);
}
