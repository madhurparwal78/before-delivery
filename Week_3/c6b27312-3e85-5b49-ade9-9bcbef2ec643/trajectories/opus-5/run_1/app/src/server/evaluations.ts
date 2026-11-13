import { randomUUID } from 'node:crypto';
import { ENGINE_VERSION, config } from './config';
import { query } from './db';
import {
  forgetInFlightEvaluation,
  onEvaluationCancel,
  publishEvaluationCancel,
  readEvaluatorDelay,
  readInFlightEvaluation,
  rememberInFlightEvaluation,
} from './bus';
import { evaluateProgram } from '../tine/evaluate';
import { geometryDigest } from '../tine/digest';
import { Diagnostic, timeout } from '../tine/diagnostics';
import { Values } from '../tine/manifest';
import { TineProgram } from '../tine/ast';
import { roundTo } from '../shared/numbers';

export type EvaluationRow = {
  id: string;
  part_slug: string;
  viewer_id: string | null;
  seq: number;
  status: string;
  engine_version: string;
  geometry_digest: string | null;
  volume: number;
  bbox: [number, number, number];
  faces: number;
  solid: unknown;
  diagnostics: Diagnostic[];
  started_at: Date;
  finished_at: Date | null;
};

export function evaluationJson(row: EvaluationRow): Record<string, unknown> {
  return {
    id: row.id,
    partSlug: row.part_slug,
    viewerId: row.viewer_id,
    seq: row.seq,
    status: row.status,
    engineVersion: row.engine_version,
    geometryDigest: row.geometry_digest,
    volume: row.volume,
    bbox: row.bbox,
    faces: row.faces,
    solid: row.solid ?? null,
    diagnostics: row.diagnostics,
    startedAt: row.started_at.toISOString(),
    finishedAt: row.finished_at === null ? null : row.finished_at.toISOString(),
  };
}

const running = new Map<string, AbortController>();
const runningByViewer = new Map<string, string>();

onEvaluationCancel((evaluationId) => {
  running.get(evaluationId)?.abort();
});

class Cancelled extends Error {}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(new Cancelled());
    }
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** The server cancels any earlier in-flight evaluation from the same viewer. */
async function supersede(viewerId: string, evaluationId: string, seq: number): Promise<void> {
  const current = await readInFlightEvaluation(viewerId);
  const earlier = current?.evaluationId ?? runningByViewer.get(viewerId);
  if (earlier && earlier !== evaluationId) await publishEvaluationCancel(earlier);
  runningByViewer.set(viewerId, evaluationId);
  await rememberInFlightEvaluation(viewerId, evaluationId, seq);
}

export async function runEvaluation(options: {
  partSlug: string;
  program: TineProgram;
  values: Values;
  seq: number;
  viewerId: string;
  requestSignal: AbortSignal;
}): Promise<EvaluationRow> {
  const id = randomUUID();
  const startedAt = new Date();
  await query(
    `insert into evaluations (id, part_slug, viewer_id, seq, status, engine_version, geometry_digest,
       volume, bbox, faces, solid, diagnostics, started_at, finished_at)
     values ($1,$2,$3,$4,'running',$5,null,0,'[0,0,0]'::jsonb,0,null,'[]'::jsonb,$6,null)`,
    [id, options.partSlug, options.viewerId, options.seq, ENGINE_VERSION, startedAt],
  );

  const controller = new AbortController();
  running.set(id, controller);
  const onRequestAbort = (): void => controller.abort();
  options.requestSignal.addEventListener('abort', onRequestAbort, { once: true });

  await supersede(options.viewerId, id, options.seq);

  const finish = async (
    status: 'succeeded' | 'failed' | 'cancelled',
    patch: {
      digest?: string | null;
      volume?: number;
      bbox?: [number, number, number];
      faces?: number;
      solid?: unknown;
      diagnostics?: Diagnostic[];
    },
  ): Promise<EvaluationRow> => {
    const result = await query<EvaluationRow>(
      `update evaluations set status = $2, geometry_digest = $3, volume = $4, bbox = $5, faces = $6,
         solid = $7, diagnostics = $8, finished_at = now() where id = $1 returning *`,
      [
        id,
        status,
        patch.digest ?? null,
        patch.volume ?? 0,
        JSON.stringify(patch.bbox ?? [0, 0, 0]),
        patch.faces ?? 0,
        patch.solid === undefined ? null : JSON.stringify(patch.solid),
        JSON.stringify(patch.diagnostics ?? []),
      ],
    );
    return result.rows[0];
  };

  try {
    const delay = await readEvaluatorDelay(options.partSlug);
    const held = Math.min(delay, config.evalTimeoutMs);
    await wait(held, controller.signal);
    if (Date.now() - startedAt.getTime() >= config.evalTimeoutMs) {
      return await finish('failed', { diagnostics: [timeout(config.evalTimeoutMs)] });
    }
    const result = evaluateProgram(options.program, options.values);
    if (controller.signal.aborted) throw new Cancelled();
    if (!result.ok) {
      return await finish('failed', { diagnostics: [result.diagnostic] });
    }
    return await finish('succeeded', {
      digest: geometryDigest(result.solid),
      volume: roundTo(result.measures.volume, 3),
      bbox: [
        roundTo(result.measures.bbox[0], 3),
        roundTo(result.measures.bbox[1], 3),
        roundTo(result.measures.bbox[2], 3),
      ],
      faces: result.measures.faces,
      solid: result.solid,
      diagnostics: [],
    });
  } catch (error) {
    if (error instanceof Cancelled) return await finish('cancelled', {});
    throw error;
  } finally {
    running.delete(id);
    if (runningByViewer.get(options.viewerId) === id) runningByViewer.delete(options.viewerId);
    options.requestSignal.removeEventListener('abort', onRequestAbort);
    await forgetInFlightEvaluation(options.viewerId, id);
  }
}

/** POST /api/evaluations/cancel stops the viewer's in-flight evaluation. */
export async function cancelViewerEvaluation(viewerId: string): Promise<void> {
  const current = await readInFlightEvaluation(viewerId);
  const evaluationId = current?.evaluationId ?? runningByViewer.get(viewerId);
  if (evaluationId) await publishEvaluationCancel(evaluationId);
}

export async function evaluationCounts(
  viewerId: string,
): Promise<{ started: number; completed: number; cancelled: number }> {
  const result = await query<{ status: string; count: string }>(
    'select status, count(*)::text as count from evaluations where viewer_id = $1 group by status',
    [viewerId],
  );
  let started = 0;
  let completed = 0;
  let cancelled = 0;
  for (const row of result.rows) {
    const count = Number(row.count);
    started += count;
    if (row.status === 'succeeded' || row.status === 'failed') completed += count;
    if (row.status === 'cancelled') cancelled += count;
  }
  return { started, completed, cancelled };
}
