import type { AspectRatio, ExportFormat, Render, RenderHistoryEntry, Resolution } from '../../shared/api.js';
import { config } from '../config.js';
import { transaction, type Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { captureCredits, releaseCredits, reserveCredits } from '../domain/ledger.js';
import { renderCostCredits } from '../domain/renderCost.js';
import { requireRenderMove, type RenderState } from '../domain/states.js';
import {
  ProviderCallFailed,
  ProviderResultMalformed,
  requestRender,
} from '../providers/aiRenderProvider.js';
import { publishDeadRenderJob, publishRenderJob } from '../providers/queue.js';
import { objectKeys, putObject, storedObjectSha256 } from '../providers/storage.js';
import type { Principal } from '../auth/identity.js';
import { loadPieceBySlugFor, requireOwnedPiece } from './pieceRows.js';
import { queueMail, sendNow } from './outbox.js';

const MAX_ATTEMPTS = 3;
const ASPECTS: readonly AspectRatio[] = ['16:9', '9:16', '1:1', '4:5'];

export interface RenderRow {
  id: string;
  piece_id: string;
  piece_slug: string;
  piece_title: string;
  creator_id: string;
  creator_email: string;
  state: RenderState;
  failure_reason: Render['failure_reason'];
  cost_credits: number;
  attempts: number;
  format: ExportFormat;
  resolution: Resolution;
  duration_s: number;
  aspect: AspectRatio;
  sha256: string | null;
  object_key: string | null;
  history: RenderHistoryEntry[];
  credits_settled: boolean;
  created_at: Date;
}

const RENDER_SELECT = `
  SELECT r.id, r.piece_id, r.creator_id, r.state, r.failure_reason, r.cost_credits, r.attempts,
         r.format, r.resolution, r.duration_s, r.aspect, r.sha256, r.object_key, r.history,
         r.credits_settled, r.created_at,
         p.slug AS piece_slug, p.title AS piece_title, u.email AS creator_email
  FROM render_jobs r
  JOIN pieces p ON p.id = r.piece_id
  JOIN app_users u ON u.id = r.creator_id
`;

export function toRender(row: RenderRow): Render {
  return {
    id: row.id,
    piece_slug: row.piece_slug,
    state: row.state,
    failure_reason: row.failure_reason,
    cost_credits: row.cost_credits,
    attempts: row.attempts,
    format: row.format,
    resolution: row.resolution,
    duration_s: row.duration_s,
    aspect: row.aspect,
    sha256: row.sha256,
    history: row.history,
    created_at: row.created_at.toISOString(),
  };
}

async function loadRender(
  client: Queryable,
  renderId: string,
  forUpdate: boolean,
): Promise<RenderRow | null> {
  const result = await client.query<RenderRow>(
    `${RENDER_SELECT} WHERE r.id = $1${forUpdate ? ' FOR UPDATE OF r' : ''}`,
    [renderId],
  );
  return result.rows[0] ?? null;
}

/** Moves a render on and appends the state it reached to its history. */
async function advance(
  client: Queryable,
  row: RenderRow,
  to: RenderState,
  extra: { failureReason?: Render['failure_reason']; sha256?: string; objectKey?: string } = {},
): Promise<void> {
  requireRenderMove(row.state, to);
  await client.query(
    `UPDATE render_jobs
     SET state = $2,
         failure_reason = COALESCE($3, failure_reason),
         sha256 = COALESCE($4, sha256),
         object_key = COALESCE($5, object_key),
         history = history || jsonb_build_array(jsonb_build_object('state', $2::text, 'at', to_jsonb(now())))
     WHERE id = $1`,
    [row.id, to, extra.failureReason ?? null, extra.sha256 ?? null, extra.objectKey ?? null],
  );
}

interface RenderRequestBody {
  format: ExportFormat;
  resolution: Resolution;
  durationSeconds: number;
  aspect: AspectRatio;
}

function readRenderBody(body: unknown): RenderRequestBody {
  const fields: Record<string, string> = {};
  const input = (body ?? {}) as Record<string, unknown>;

  const format = input.format;
  if (format !== 'mp4' && format !== 'webm') {
    fields.format = 'Choose MP4 or WebM.';
  }
  const resolution = input.resolution;
  if (resolution !== '720p' && resolution !== '1080p') {
    fields.resolution = 'Choose 720p or 1080p.';
  }
  const aspect = input.aspect;
  if (typeof aspect !== 'string' || !ASPECTS.includes(aspect as AspectRatio)) {
    fields.aspect = 'Choose 16:9, 9:16, 1:1 or 4:5.';
  }
  const duration = input.duration_s;
  if (
    typeof duration !== 'number' ||
    !Number.isInteger(duration) ||
    duration < 5 ||
    duration > 60
  ) {
    fields.duration_s = 'Render between 5 and 60 seconds.';
  }

  if (Object.keys(fields).length > 0) throw ApiError.validation(fields);

  return {
    format: format as ExportFormat,
    resolution: resolution as Resolution,
    durationSeconds: duration as number,
    aspect: aspect as AspectRatio,
  };
}

/** Accepting a render reserves its credit cost, or refuses it with 402. */
export async function acceptRender(
  owner: Principal,
  slug: string,
  body: unknown,
): Promise<Render> {
  const render = await transaction(async (client) => {
    const piece = requireOwnedPiece(await loadPieceBySlugFor(client, slug, false), owner.id);
    if (piece.state !== 'draft') {
      throw ApiError.invalidTransition('Only a draft piece can be rendered.');
    }

    const request = readRenderBody(body);
    const cost = renderCostCredits(request.durationSeconds, request.resolution);

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO render_jobs (piece_id, creator_id, state, cost_credits, format, resolution,
                                duration_s, aspect, history)
       VALUES ($1, $2, 'accepted', $3, $4, $5, $6, $7,
               jsonb_build_array(jsonb_build_object('state', 'accepted', 'at', to_jsonb(now()))))
       RETURNING id`,
      [
        piece.id,
        owner.id,
        cost,
        request.format,
        request.resolution,
        request.durationSeconds,
        request.aspect,
      ],
    );
    const renderId = inserted.rows[0]?.id;
    if (!renderId) throw new Error('Render insert returned no id');

    await reserveCredits(client, owner.id, cost, renderId);

    const accepted = await loadRender(client, renderId, false);
    if (!accepted) throw new Error('New render vanished before it could be read');
    await advance(client, accepted, 'queued');

    const queued = await loadRender(client, renderId, false);
    if (!queued) throw new Error('Queued render vanished before it could be read');
    return queued;
  });

  await publishRenderJob({ render_id: render.id, piece_slug: render.piece_slug, attempt: 1 }).catch(
    () => undefined,
  );

  return toRender({ ...render, state: 'queued' });
}

export async function listPieceRenders(owner: Principal, slug: string): Promise<Render[]> {
  const piece = await transaction(async (client) =>
    requireOwnedPiece(await loadPieceBySlugFor(client, slug, false), owner.id),
  );
  const result = await transaction((client) =>
    client.query<RenderRow>(`${RENDER_SELECT} WHERE r.piece_id = $1 ORDER BY r.created_at DESC`, [
      piece.id,
    ]),
  );
  return result.rows.map(toRender);
}

export async function getRenderForOwner(owner: Principal, renderId: string): Promise<Render> {
  if (!/^[0-9a-f-]{36}$/.test(renderId)) throw ApiError.notFound();
  const row = await transaction((client) => loadRender(client, renderId, false));
  if (!row || row.creator_id !== owner.id) throw ApiError.notFound();
  return toRender(row);
}

/**
 * Settles a render's reservation exactly once. The first caller to flip the flag
 * writes the capture or release; later deliveries write nothing.
 */
async function settleCreditsOnce(
  client: Queryable,
  renderId: string,
  movement: 'capture' | 'release',
): Promise<boolean> {
  const claim = await client.query<{ creator_id: string; cost_credits: number }>(
    `UPDATE render_jobs SET credits_settled = true
     WHERE id = $1 AND credits_settled = false
     RETURNING creator_id, cost_credits`,
    [renderId],
  );
  const row = claim.rows[0];
  if (!row) return false;

  if (movement === 'capture') {
    await captureCredits(client, row.creator_id, row.cost_credits, renderId);
  } else {
    await releaseCredits(client, row.creator_id, row.cost_credits, renderId);
  }
  return true;
}

/** Cancelling a queued render releases its credits and ends it as cancelled. */
export async function cancelRender(owner: Principal, renderId: string): Promise<Render> {
  if (!/^[0-9a-f-]{36}$/.test(renderId)) throw ApiError.notFound();
  return transaction(async (client) => {
    const row = await loadRender(client, renderId, true);
    if (!row || row.creator_id !== owner.id) throw ApiError.notFound();
    if (row.state !== 'queued') {
      throw ApiError.invalidTransition('Only a queued render can be cancelled.');
    }

    await advance(client, row, 'credits_released', { failureReason: 'cancelled' });
    await settleCreditsOnce(client, row.id, 'release');

    const cancelled = await loadRender(client, renderId, false);
    if (!cancelled) throw new Error('Cancelled render vanished before it could be read');
    return toRender(cancelled);
  });
}

async function endInFailure(
  row: RenderRow,
  reason: NonNullable<Render['failure_reason']>,
  deadLetter: boolean,
): Promise<void> {
  const endState: RenderState = reason === 'timeout' ? 'timed_out' : 'failed';
  await transaction(async (client) => {
    const current = await loadRender(client, row.id, true);
    if (!current || current.state === 'ready' || current.state === 'credits_released') return;
    await advance(client, current, endState, { failureReason: reason });
    const ended = await loadRender(client, row.id, false);
    if (!ended) return;
    await advance(client, ended, 'credits_released');
    await settleCreditsOnce(client, row.id, 'release');
  });

  if (deadLetter) {
    await publishDeadRenderJob({
      render_id: row.id,
      piece_slug: row.piece_slug,
      attempt: MAX_ATTEMPTS,
      failure_reason: reason,
    }).catch(() => undefined);
  }
}

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

/**
 * Runs one render job. A job delivered again after it reached ready or
 * credits_released does nothing: no second capture, release or provider call.
 */
export async function runRenderJob(renderId: string): Promise<void> {
  const start = await transaction(async (client) => {
    const row = await loadRender(client, renderId, true);
    if (!row) return null;
    if (row.state === 'ready' || row.state === 'credits_released') return null;
    if (row.state === 'queued') {
      await advance(client, row, 'rendering');
    }
    return loadRender(client, renderId, false);
  });
  if (!start) return;

  const piece = await transaction((client) =>
    client.query<{ fragment_source: string; uniforms: { name: string; value: number }[]; timeline: unknown }>(
      'SELECT fragment_source, uniforms, timeline FROM pieces WHERE id = $1',
      [start.piece_id],
    ),
  );
  const pieceRow = piece.rows[0];
  if (!pieceRow) return;

  const uniformValues: Record<string, number> = {};
  for (const uniform of pieceRow.uniforms) {
    uniformValues[uniform.name] = uniform.value;
  }

  let lastFailure: 'provider_error' | 'timeout' | 'storage_error' = 'provider_error';

  for (let attempt = start.attempts + 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    await transaction((client) =>
      client.query('UPDATE render_jobs SET attempts = $2 WHERE id = $1', [renderId, attempt]),
    );

    try {
      const result = await requestRender({
        renderId,
        fragmentSource: pieceRow.fragment_source,
        uniforms: uniformValues,
        timeline: pieceRow.timeline,
        format: start.format,
        resolution: start.resolution,
        durationSeconds: start.duration_s,
        aspect: start.aspect,
      });

      const key = objectKeys.renderExport(renderId, start.format);
      try {
        await putObject(key, result.bytes, start.format === 'mp4' ? 'video/mp4' : 'video/webm');
      } catch {
        lastFailure = 'storage_error';
        if (attempt < MAX_ATTEMPTS) {
          await sleep(config.renderBackoffSeconds * attempt);
          continue;
        }
        await endInFailure(start, 'storage_error', true);
        return;
      }

      const storedSha = await storedObjectSha256(key).catch(() => null);
      if (storedSha === null) {
        lastFailure = 'storage_error';
        if (attempt < MAX_ATTEMPTS) {
          await sleep(config.renderBackoffSeconds * attempt);
          continue;
        }
        await endInFailure(start, 'storage_error', true);
        return;
      }
      if (storedSha !== result.sha256) {
        await endInFailure(start, 'malformed', false);
        return;
      }

      await finishReady(renderId, result.sha256, key);
      return;
    } catch (error) {
      if (error instanceof ProviderResultMalformed) {
        await endInFailure(start, 'malformed', false);
        return;
      }
      if (error instanceof ProviderCallFailed) {
        lastFailure = error.timedOut ? 'timeout' : 'provider_error';
        if (attempt < MAX_ATTEMPTS) {
          await sleep(config.renderBackoffSeconds * attempt);
          continue;
        }
        await endInFailure(start, lastFailure, true);
        return;
      }
      throw error;
    }
  }

  await endInFailure(start, lastFailure, true);
}

/**
 * A render becomes ready only after the bytes are stored and their checksum read
 * back from storage matches. Then it captures its credits once and queues the
 * render-ready email once.
 */
async function finishReady(renderId: string, sha256: string, objectKey: string): Promise<void> {
  const queuedMessageId = await transaction(async (client) => {
    const row = await loadRender(client, renderId, true);
    if (!row || row.state === 'ready' || row.state === 'credits_released') return null;

    await advance(client, row, 'stored', { sha256, objectKey });
    const stored = await loadRender(client, renderId, false);
    if (!stored) return null;
    await advance(client, stored, 'ready');

    if (!(await settleCreditsOnce(client, renderId, 'capture'))) return null;

    return queueMail(client, {
      recipient: row.creator_email,
      subject: `Export ready: ${row.piece_title}`,
      bodyText: [
        `Your ${row.aspect} ${row.resolution} export of ${row.piece_title} is ready.`,
        '',
        `It used ${row.cost_credits} credits. Open the editor to publish an edition run.`,
        '',
        'Phosphene Yard',
      ].join('\n'),
      attachmentKey: null,
      attachmentName: null,
    });
  });

  if (queuedMessageId) await sendNow(queuedMessageId);
}
