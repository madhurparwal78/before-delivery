import { createHash, randomUUID } from 'node:crypto';
import { guideAccess } from './access';
import { limits } from './config';
import { guideById, isUuid, workingJson } from './content';
import { one, pool, transaction, type Db } from './db';
import { ApiError, modelTooLarge, notFound, unprocessable } from './errors';
import { RawBody, type Ctx } from './http';
import { emitGuide } from './live';
import { getObject, modelKey, putConfirmed } from './s3';
import { syncFieldPaths } from './working';
import { checkGlb, type GlbPart } from '../shared/glb';

/** A guide's parts follow its model: bound parts keep their ids, vanished node paths turn unbound, new nodes become parts. */
async function reconcileParts(db: Db, guideId: string, modelParts: GlbPart[]): Promise<void> {
  const existing = await db.query<{ id: string; node_path: string }>('SELECT id, node_path FROM parts WHERE guide_id = $1', [guideId]);
  const paths = new Set(modelParts.map((p) => p.nodePath));
  for (const part of existing.rows) await db.query('UPDATE parts SET unbound = $1 WHERE id = $2', [!paths.has(part.node_path), part.id]);
  const bound = new Set(existing.rows.map((p) => p.node_path));
  let position = existing.rows.length;
  for (const part of modelParts.filter((p) => !bound.has(p.nodePath)))
    await db.query(
      'INSERT INTO parts (id, guide_id, position, name, node_path) VALUES ($1, $2, $3, $4, $5)',
      [randomUUID(), guideId, ++position, part.name, part.nodePath],
    );
}

export async function uploadModel(ctx: Ctx): Promise<unknown> {
  const { guide } = await guideAccess(ctx, ctx.params.id!, { session: true, role: 'member', confirmed: true });
  let bytes: Buffer;
  try {
    bytes = await ctx.raw();
  } catch (error) {
    if (error instanceof ApiError && error.status === 413) throw modelTooLarge(limits.model_max_bytes);
    throw error;
  }
  const checked = checkGlb(bytes, { modelMaxBytes: limits.model_max_bytes, modelMaxParts: limits.model_max_parts });
  if (!checked.ok) {
    const { error, ...rest } = checked.refusal;
    throw error === 'model_too_large' ? modelTooLarge(limits.model_max_bytes) : unprocessable(error, rest);
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const modelId = randomUUID();
  await putConfirmed(modelKey(modelId), bytes, sha256);
  const { model } = checked;
  await transaction(async (db) => {
    await db.query('SELECT 1 FROM guides WHERE id = $1 FOR UPDATE', [guide.id]);
    await db.query('INSERT INTO models (id, bytes, sha256, bounds, nodes) VALUES ($1, $2, $3, $4, $5)', [
      modelId, bytes.length, sha256, JSON.stringify(model.bounds), JSON.stringify(model.parts),
    ]);
    await db.query('UPDATE guides SET model_id = $1, model_scale_confirmed = false, revision = revision + 1 WHERE id = $2', [modelId, guide.id]);
    await reconcileParts(db, guide.id, model.parts);
    await syncFieldPaths(db, guide.id);
  });
  const work = await workingJson(pool, (await guideById(pool, guide.id))!);
  emitGuide(guide.id, { type: 'working' });
  return {
    model: work.model,
    parts: work.parts,
    unbound: work.parts.filter((p) => p.unbound).map((p) => p.name),
  };
}

const MODEL_FILE = /^([0-9a-f-]{36})\.glb$/;

/** A model is readable by anyone who can see a guide, or a version, or a fork that references it. */
export async function serveModel(ctx: Ctx): Promise<unknown> {
  const modelId = MODEL_FILE.exec(ctx.params.file ?? '')?.[1];
  if (!modelId || !isUuid(modelId)) throw notFound();
  const readable = await one(
    pool,
    `SELECT 1 FROM guides g
      WHERE (g.model_id = $1 OR EXISTS (SELECT 1 FROM versions v WHERE v.guide_id = g.id AND v.model_id = $1))
        AND ((g.visibility = 'public' AND g.state IN ('published', 'withdrawn')) OR g.owner_id = $2
             OR EXISTS (SELECT 1 FROM coauthors c WHERE c.guide_id = g.id AND c.user_id = $2))
      LIMIT 1`,
    [modelId, ctx.user?.id ?? '00000000-0000-0000-0000-000000000000'],
  );
  if (!readable) throw notFound();
  const bytes = await getObject(modelKey(modelId));
  if (!bytes) throw notFound();
  return new RawBody(bytes, 'model/gltf-binary', { 'Cache-Control': 'private, max-age=300' });
}


