import { randomUUID } from 'node:crypto';
import type { Feature, Part } from '../shared/api';
import { pool } from './db';
import { notFound, profileNotReady } from './errors';
import { FIELD_MESSAGES } from '../shared/messages';
import { closedLoops } from '../shared/profile';
import { once, requireKey, type Idempotent } from './idempotency';
import { parseLength } from '../shared/lengths';
import { beginSave, finishSave, operationFits, parseDirection, requireFounder, savedPart } from './parts';
import { analysisOf, featuresOf, loadSketch, partJson, partRow, type MemberRow } from './repo';
import { Validator, objectBody, requireCurrentRevision } from './validate';

export async function createFeature(member: MemberRow, partId: string, key: string | undefined, input: unknown): Promise<Idempotent> {
  await partRow(pool, partId);
  requireFounder(member);
  const body = objectBody(input);
  return once(member.id, `/api/parts/${partId}/features`, key, input, async (db) => {
    const part = await partRow(db, partId, true);
    const v = new Validator();
    await requireCurrentRevision(db, v, body['base_revision'], part, part.name);
    requireKey(v, key);
    const sketches = await db.query<{ id: string }>('SELECT id FROM sketches WHERE part_id = $1', [partId]);
    const sketchId = sketches.rows.find((s) => s.id === body['sketch_id'])?.id;
    if (!sketchId) v.fail('sketch_id', FIELD_MESSAGES.option);
    const existing = await featuresOf(db, partId);
    if (!operationFits(body['operation'], existing.length)) v.fail('operation', FIELD_MESSAGES.operation);
    const depth = v.take('depth', () => parseLength(body['depth'], member.units));
    const direction = parseDirection(v, body['direction']);
    v.done();
    const sketch = await loadSketch(db, sketchId as string);
    const loops = closedLoops(sketch.entities, sketch.constraints);
    if (!loops || analysisOf(sketch).slack > 0) throw profileNotReady(sketch.row.name);
    const feature: Feature = {
      id: randomUUID(),
      name: `Extrude ${part.nextFeature}`,
      sketch_id: sketch.row.id,
      operation: body['operation'] as Feature['operation'],
      depth_mm: depth as number,
      direction: direction as Feature['direction'],
    };
    await db.query(
      'INSERT INTO features (id, part_id, sketch_id, name, operation, depth_mm, direction) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [feature.id, partId, feature.sketch_id, feature.name, feature.operation, feature.depth_mm, feature.direction],
    );
    await db.query('UPDATE parts SET next_feature = next_feature + 1, revision = revision + 1, saved_by = $2 WHERE id = $1', [partId, member.id]);
    const pending = await beginSave(db, partId);
    return {
      outcome: { status: 201, body: { feature, part: await partJson(db, partId) } },
      settle: async () => {
        if (pending) await finishSave(pending);
        return { feature, part: await partJson(pool, partId) };
      },
    };
  });
}

export async function updateFeature(
  member: MemberRow,
  partId: string,
  featureId: string,
  input: unknown,
): Promise<{ feature: Feature; part: Part }> {
  await partRow(pool, partId);
  if (!(await featuresOf(pool, partId)).some((f) => f.id === featureId)) throw notFound();
  requireFounder(member);
  const body = objectBody(input);
  const part = await savedPart(partId, async (db) => {
    const row = await partRow(db, partId, true);
    const v = new Validator();
    await requireCurrentRevision(db, v, body['base_revision'], row, row.name);
    const depth = 'depth' in body ? v.take('depth', () => parseLength(body['depth'], member.units)) : undefined;
    const direction = 'direction' in body ? parseDirection(v, body['direction']) : undefined;
    v.done();
    await db.query(
      'UPDATE features SET depth_mm = COALESCE($2, depth_mm), direction = COALESCE($3, direction) WHERE id = $1',
      [featureId, depth ?? null, direction ?? null],
    );
    await db.query('UPDATE parts SET revision = revision + 1, saved_by = $2 WHERE id = $1', [partId, member.id]);
    return beginSave(db, partId);
  });
  return { feature: part.features.find((f) => f.id === featureId) as Feature, part };
}
