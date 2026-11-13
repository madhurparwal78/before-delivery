import { randomUUID } from 'node:crypto';
import type { Direction, Material, Operation, Part, Plane } from '../shared/api';
import { DIRECTIONS, OPERATIONS, PLANES } from '../shared/api';
import { pool, transaction, type Db } from './db';
import { forbidden, profileNotReady } from './errors';
import { FIELD_MESSAGES } from '../shared/messages';
import { closedLoops } from '../shared/profile';
import { buildBody, type ExtrudeStep, type Mesh } from './geometry/kernel';
import { massProperties } from './geometry/mass';
import { parseCoordinate } from '../shared/lengths';
import { claimName, releaseName } from './names';
import {
  featuresOf,
  loadSketch,
  materialById,
  partJson,
  partRow,
  type MemberRow,
  type PartRow,
} from './repo';
import { putObject } from './storage';
import { Validator, objectBody, parseName, requireCurrentRevision } from './validate';

/** A part save that has been recorded as Saving and still has to reach storage. */
interface PendingSave {
  partId: string;
  build: number;
  payload: Buffer;
  figures: ReturnType<typeof massProperties>;
}

const bodyKey = (partId: string, build: number): string => `bodies/${partId}/build-${build}.json`;

async function extrudeSteps(db: Db, partId: string): Promise<ExtrudeStep[]> {
  const features = await featuresOf(db, partId);
  const steps: ExtrudeStep[] = [];
  for (const feature of features) {
    const sketch = await loadSketch(db, feature.sketch_id);
    const loops = closedLoops(sketch.entities, sketch.constraints);
    if (!loops) throw profileNotReady(sketch.row.name);
    steps.push({
      operation: feature.operation,
      loops,
      plane: sketch.row.plane,
      offset_mm: sketch.row.offsetMm,
      depth_mm: feature.depth_mm,
      direction: feature.direction,
    });
  }
  return steps;
}

/** Builds the body from the part's extrudes; refuses (throwing) when an extrude leaves nothing or separate pieces. */
async function rebuild(db: Db, part: PartRow): Promise<Mesh | undefined> {
  return buildBody(await extrudeSteps(db, part.id));
}

/**
 * Part body states, decided here: a part with no extrudes stays `none`; any other part save takes the next
 * build number and becomes `saving` until storage confirms or refuses.
 */
export async function beginSave(db: Db, partId: string): Promise<PendingSave | undefined> {
  const part = await partRow(db, partId, true);
  const mesh = await rebuild(db, part);
  if (!mesh) return undefined;
  const material = (await materialById(db, part.materialId)) as Material;
  const build = part.buildCounter + 1;
  await db.query("UPDATE parts SET build_counter = $2, body_status = 'saving' WHERE id = $1", [partId, build]);
  const payload = Buffer.from(
    JSON.stringify({ part_id: partId, build, units: 'mm', vertices: mesh.vertices, triangles: mesh.triangles }),
  );
  return { partId, build, payload, figures: massProperties(mesh, material.density_g_cm3) };
}

/** Writes the body object and records the outcome: Stored only after storage confirms, otherwise Not stored. */
export async function finishSave(pending: PendingSave): Promise<void> {
  const key = bodyKey(pending.partId, pending.build);
  const written = await putObject(key, pending.payload);
  await transaction(async (db) => {
    const part = await partRow(db, pending.partId, true);
    const latest = part.buildCounter === pending.build;
    const newer = written && pending.build > (part.confirmed?.build ?? 0);
    const confirmed = newer ? { build: pending.build, object_key: key, ...pending.figures } : part.confirmed;
    const status = latest ? (written ? 'stored' : 'not_stored') : part.bodyStatus;
    await db.query('UPDATE parts SET body_status = $2, confirmed = $3 WHERE id = $1', [
      pending.partId,
      status,
      confirmed ? JSON.stringify(confirmed) : null,
    ]);
  });
}

/** Commits a part change then settles the save; the response comes only once storage has answered. */
export async function savedPart(partId: string, change: (db: Db) => Promise<PendingSave | undefined>): Promise<Part> {
  const pending = await transaction(change);
  if (pending) await finishSave(pending);
  return partJson(pool, partId);
}

/** A save the server stopped in the middle of is Not stored at the next boot. */
export async function recoverInterruptedSaves(): Promise<void> {
  await pool.query("UPDATE parts SET body_status = 'not_stored' WHERE body_status = 'saving'");
}

export function requireFounder(member: MemberRow): void {
  if (member.role !== 'founder') throw forbidden();
}

export async function createPart(member: MemberRow, input: unknown): Promise<Part> {
  requireFounder(member);
  const body = objectBody(input);
  const id = randomUUID();
  return transaction(async (db) => {
    const v = new Validator();
    const name = v.take('name', () => parseName(body['name']));
    const material = typeof body['material_id'] === 'string' ? await materialById(db, body['material_id']) : undefined;
    if (!material) v.fail('material_id', FIELD_MESSAGES.material);
    if (name) await claimName(db, v, name, 'name', id);
    v.done();
    await db.query(
      'INSERT INTO parts (id, name, saved_by, material_id) VALUES ($1, $2, $3, $4)',
      [id, name, member.id, (material as Material).id],
    );
    return partJson(db, id);
  });
}

export async function updatePart(member: MemberRow, id: string, input: unknown): Promise<Part> {
  await partRow(pool, id);
  requireFounder(member);
  const body = objectBody(input);
  return savedPart(id, async (db) => {
    const part = await partRow(db, id, true);
    const v = new Validator();
    await requireCurrentRevision(db, v, body['base_revision'], part, part.name);
    const name = 'name' in body ? v.take('name', () => parseName(body['name'])) : undefined;
    const material = 'material_id' in body ? (typeof body['material_id'] === 'string' ? await materialById(db, body['material_id']) : undefined) : undefined;
    if ('material_id' in body && !material) v.fail('material_id', FIELD_MESSAGES.material);
    if (name && name.toLowerCase() !== part.name.toLowerCase()) await claimName(db, v, name, 'name', id);
    v.done();
    if (name && name.toLowerCase() !== part.name.toLowerCase()) await releaseName(db, part.name);
    await db.query(
      'UPDATE parts SET name = COALESCE($2, name), material_id = COALESCE($3, material_id), revision = revision + 1, saved_by = $4 WHERE id = $1',
      [id, name ?? null, material?.id ?? null, member.id],
    );
    return beginSave(db, id);
  });
}

/** Save part: a part save with no other change. */
export async function saveOnly(id: string): Promise<Part> {
  await partRow(pool, id);
  return savedPart(id, (db) => beginSave(db, id));
}

export async function createSketch(member: MemberRow, id: string, input: unknown): Promise<{ sketch: string; part: Part }> {
  await partRow(pool, id);
  requireFounder(member);
  const body = objectBody(input);
  let sketchId = '';
  const part = await savedPart(id, async (db) => {
    const row = await partRow(db, id, true);
    const v = new Validator();
    await requireCurrentRevision(db, v, body['base_revision'], row, row.name);
    const plane = PLANES.includes(body['plane'] as Plane) ? (body['plane'] as Plane) : undefined;
    if (!plane) v.fail('plane', FIELD_MESSAGES.option);
    const offset = v.take('offset', () => parseCoordinate(body['offset'], member.units));
    v.done();
    sketchId = randomUUID();
    await db.query(
      'INSERT INTO sketches (id, part_id, name, plane, offset_mm, saved_by) VALUES ($1, $2, $3, $4, $5, $6)',
      [sketchId, id, `Sketch ${row.nextSketch}`, plane, offset, member.id],
    );
    await db.query('UPDATE parts SET next_sketch = next_sketch + 1, revision = revision + 1, saved_by = $2 WHERE id = $1', [id, member.id]);
    return beginSave(db, id);
  });
  return { sketch: sketchId, part };
}

/** Operation order, decided here: the first extrude makes the body, later ones join, cut or intersect. */
export function operationFits(operation: unknown, existingFeatures: number): operation is Operation {
  return OPERATIONS.includes(operation as Operation) && (operation === 'new') === (existingFeatures === 0);
}

export function parseDirection(v: Validator, input: unknown): Direction | undefined {
  if (DIRECTIONS.includes(input as Direction)) return input as Direction;
  v.fail('direction', FIELD_MESSAGES.option);
  return undefined;
}
