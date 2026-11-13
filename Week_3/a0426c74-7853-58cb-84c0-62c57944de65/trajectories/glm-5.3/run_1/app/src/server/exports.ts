import { pool } from './db.js';
import { storage } from './api.js';
import { loadDrawing } from './ops.js';
import { serialisePlotfold } from '../shared/format.js';
import { sheetSvg, entityToElement } from '../shared/svg.js';
import type { ResolvedEntity } from '../shared/geometry.js';

// An export job advances one step of 20 percent per interval, writes after the
// fourth step, and reaches ready only when MinIO confirms the object.
export async function advanceExports(now: Date): Promise<void> {
  const jobs = await pool.query<{ id: string; drawing_id: string; format: string; state: string; progress: string; step_at: Date }>(
    "SELECT id, drawing_id, format, state, progress::text AS progress, step_at FROM exports WHERE state IN ('queued','running')",
  );
  for (const job of jobs.rows) {
    const stepAt = job.step_at ? new Date(job.step_at) : new Date(now.getTime());
    const due = stepAt.getTime() + exportStepMs();
    if (due > now.getTime()) continue;
    const progress = Number(job.progress);
    const next = Math.min(progress + 20, 100);
    if (job.state === 'queued') {
      await pool.query('UPDATE exports SET state = $2, progress = $3, step_at = $4 WHERE id = $1', [job.id, 'running', next, now]);
      continue;
    }
    if (next >= 100) {
      await finishExport(job.id, job.drawing_id, job.format);
      continue;
    }
    if (next === 80) {
      const written = await writeExport(job.id, job.drawing_id, job.format);
      if (!written) {
        await pool.query('UPDATE exports SET state = $2, progress = $3, step_at = NULL WHERE id = $1', [job.id, 'failed', 80]);
        continue;
      }
    }
    await pool.query('UPDATE exports SET progress = $2, step_at = $3 WHERE id = $1', [job.id, next, now]);
  }
}

function exportStepMs(): number {
  return Number(process.env.PLOT_EXPORT_STEP_MS ?? 400);
}

async function exportBytes(drawingId: string, format: string): Promise<Buffer | null> {
  const loaded = await loadDrawing(drawingId);
  if (!loaded) return null;
  const { engine } = loaded;
  engine.refreshAssociations();
  if (format === 'svg') {
    const entities: Record<string, ResolvedEntity> = {};
    for (const handle of engine.model.order) {
      const entity = engine.model.entities[handle];
      if (entity) entities[handle] = entity as ResolvedEntity;
    }
    const svg = sheetSvg(
      { layers: engine.model.layers, entities, order: engine.model.order, blocks: engine.model.blocks, dimStyles: engine.model.dim_styles },
      420,
      297,
    );
    return Buffer.from(svg, 'utf8');
  }
  const text = serialisePlotfold({
    layers: Object.values(engine.model.layers),
    entities: engine.model.order.map((handle) => engine.model.entities[handle]).filter((e): e is NonNullable<typeof e> => Boolean(e)),
    blocks: Object.values(engine.model.blocks),
  });
  return Buffer.from(text, 'utf8');
}

async function writeExport(exportId: string, drawingId: string, format: string): Promise<boolean> {
  const bytes = await exportBytes(drawingId, format);
  if (!bytes) return false;
  const key = `exports/${drawingId}/${exportId}.${format === 'svg' ? 'svg' : 'plot.txt'}`;
  try {
    await storage.put(key, bytes, format === 'svg' ? 'image/svg+xml' : 'text/plain; charset=utf-8');
    return true;
  } catch {
    return false;
  }
}

async function finishExport(exportId: string, drawingId: string, format: string): Promise<void> {
  const key = `exports/${drawingId}/${exportId}.${format === 'svg' ? 'svg' : 'plot.txt'}`;
  const written = await writeExport(exportId, drawingId, format);
  if (!written) {
    await pool.query('UPDATE exports SET state = $2, progress = $3, step_at = NULL WHERE id = $1', [exportId, 'failed', 80]);
    return;
  }
  try {
    const check = await storage.get(key);
    if (!check) {
      await pool.query('UPDATE exports SET state = $2, progress = $3, step_at = NULL WHERE id = $1', [exportId, 'failed', 80]);
      return;
    }
  } catch {
    await pool.query('UPDATE exports SET state = $2, progress = $3, step_at = NULL WHERE id = $1', [exportId, 'failed', 80]);
    return;
  }
  await pool.query('UPDATE exports SET state = $2, progress = 100, step_at = NULL WHERE id = $1', [exportId, 'ready']);
}
