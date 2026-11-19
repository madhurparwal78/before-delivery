import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { execute, queryOne } from '../db/index.js';
import { ApiError } from '../http/errors.js';
import { checkGlb, type GlbPart, type GlbRefusal } from '../../shared/glb.js';
import { putModel } from '../storage/s3.js';
import { loadParts, modelFromRow, partFromRow, type GuideRow, type ModelRow } from './guides.js';
import type { ModelRecord, Part } from '../../shared/types.js';

export const refusalToError = (refusal: GlbRefusal): ApiError => {
  switch (refusal.error) {
    case 'model_too_large':
      return new ApiError(413, { error: 'model_too_large', limit: refusal.limit });
    case 'too_many_parts':
      return new ApiError(422, {
        error: 'too_many_parts',
        count: refusal.count,
        limit: refusal.limit,
      });
    case 'external_uri':
      return new ApiError(422, { error: 'external_uri' });
    default:
      return new ApiError(422, { error: 'not_glb' });
  }
};

export interface IngestResult {
  model: ModelRecord;
  parts: Part[];
  unbound: string[];
}

/**
 * Stores the file and binds parts to node paths. A replacement keeps every
 * part: parts whose node path no longer exists become unbound and are listed
 * by name, and nodes with no part become new parts.
 */
export async function storeModel(guide: GuideRow, bytes: Buffer): Promise<IngestResult> {
  const checked = checkGlb(new Uint8Array(bytes), config.limits);
  if (!checked.ok) throw refusalToError(checked.refusal);

  const modelId = randomUUID();
  const confirmation = await putModel(modelId, bytes);

  await execute(
    'INSERT INTO models (id, bytes, sha256, bbox_mm, node_paths) VALUES ($1, $2, $3, $4, $5)',
    [
      modelId,
      confirmation.bytes,
      confirmation.sha256,
      checked.value.bboxMm,
      checked.value.parts.map((part) => part.nodePath),
    ],
  );
  await execute(
    'UPDATE guides SET model_id = $2, model_scale_confirmed = false, revision = revision + 1 WHERE id = $1',
    [guide.id, modelId],
  );
  await syncParts(guide.id, checked.value.parts);

  const row = await queryOne<ModelRow>('SELECT id, bytes, sha256, bbox_mm FROM models WHERE id = $1', [
    modelId,
  ]);
  const parts = (await loadParts(guide.id)).map(partFromRow);
  const model = modelFromRow(row, Number(guide.model_scale), false);
  if (model === null) throw new ApiError(503, { error: 'storage_unavailable' });
  return {
    model,
    parts,
    unbound: parts.filter((part) => part.unbound).map((part) => part.name),
  };
}

async function syncParts(guideId: string, glbParts: readonly GlbPart[]): Promise<void> {
  const existing = await loadParts(guideId);
  const byNodePath = new Map(existing.filter((part) => part.node_path !== null).map((part) => [part.node_path ?? '', part]));
  const seen = new Set<string>();
  let position = 0;

  for (const glbPart of glbParts) {
    position += 1;
    const match = byNodePath.get(glbPart.nodePath);
    if (match) {
      seen.add(match.id);
      await execute(
        'UPDATE parts SET position = $2, bbox_min = $3, bbox_max = $4, colour = $5 WHERE id = $1',
        [match.id, position, glbPart.bboxMin, glbPart.bboxMax, glbPart.colour],
      );
      continue;
    }
    const id = randomUUID();
    seen.add(id);
    await execute(
      `INSERT INTO parts (id, guide_id, position, name, node_path, bbox_min, bbox_max, colour)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, guideId, position, glbPart.name, glbPart.nodePath, glbPart.bboxMin, glbPart.bboxMax, glbPart.colour],
    );
  }

  for (const part of existing) {
    if (seen.has(part.id)) continue;
    position += 1;
    await execute('UPDATE parts SET node_path = NULL, position = $2 WHERE id = $1', [
      part.id,
      position,
    ]);
  }
}

/** A model is readable by anyone who can see a guide or fork that references it. */
export async function modelIsReadableBy(modelId: string, userId: string | null): Promise<boolean> {
  const row = await queryOne<{ ok: boolean }>(
    `SELECT true AS ok FROM guides g
     LEFT JOIN guide_coauthors c ON c.guide_id = g.id AND c.user_id = $2::uuid
     LEFT JOIN versions v ON v.guide_id = g.id
     WHERE (g.model_id::text = $1 OR v.snapshot->>'model_id' = $1)
       AND (g.owner_id = $2::uuid OR c.user_id IS NOT NULL
            OR (g.visibility = 'public' AND g.state <> 'draft'))
     LIMIT 1`,
    [modelId, userId],
  );
  return row !== null;
}
