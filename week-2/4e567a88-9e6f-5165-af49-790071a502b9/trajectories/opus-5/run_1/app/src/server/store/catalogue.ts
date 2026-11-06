import { Queryable, db, nextId } from '../db';
import { InputSchema } from '../schema';
import { ModelRow, RateRow } from '../types';

interface ModelDbRow {
  slug: string;
  name: string;
  modality: string;
  unit: string;
  unit_label: string;
  input_schema: unknown;
  position: number;
}

function toModel(row: ModelDbRow): ModelRow {
  return {
    slug: row.slug,
    name: row.name,
    modality: row.modality,
    unit: row.unit,
    unitLabel: row.unit_label,
    inputSchema: row.input_schema,
    position: row.position,
  };
}

export async function allModels(): Promise<ModelRow[]> {
  const { rows } = await db.query<ModelDbRow>(
    'SELECT slug, name, modality, unit, unit_label, input_schema, position FROM models ORDER BY position',
  );
  return rows.map(toModel);
}

export async function modelBySlug(slug: string): Promise<ModelRow | null> {
  const { rows } = await db.query<ModelDbRow>(
    'SELECT slug, name, modality, unit, unit_label, input_schema, position FROM models WHERE slug = $1',
    [slug],
  );
  return rows[0] ? toModel(rows[0]) : null;
}

export function schemaOf(model: ModelRow): InputSchema {
  return model.inputSchema as InputSchema;
}

interface RateDbRow {
  id: string;
  model_slug: string;
  micro_per_unit: string;
  effective_at: Date;
  created_by: string;
}

function toRate(row: RateDbRow): RateRow {
  return {
    id: row.id,
    modelSlug: row.model_slug,
    microPerUnit: BigInt(row.micro_per_unit),
    effectiveAt: row.effective_at,
    createdBy: row.created_by,
  };
}

export async function ratesOf(slug: string): Promise<RateRow[]> {
  const { rows } = await db.query<RateDbRow>(
    'SELECT id, model_slug, micro_per_unit, effective_at, created_by FROM rates WHERE model_slug = $1 ORDER BY effective_at, id',
    [slug],
  );
  return rows.map(toRate);
}

/** The rate in effect at an instant: the latest whose effective instant is at or before it. */
export async function rateAt(client: Queryable, slug: string, instant: Date): Promise<RateRow | null> {
  const { rows } = await client.query<RateDbRow>(
    `SELECT id, model_slug, micro_per_unit, effective_at, created_by
       FROM rates WHERE model_slug = $1 AND effective_at <= $2
      ORDER BY effective_at DESC, id DESC LIMIT 1`,
    [slug, instant],
  );
  return rows[0] ? toRate(rows[0]) : null;
}

export async function rateById(slug: string, id: string): Promise<RateRow | null> {
  const { rows } = await db.query<RateDbRow>(
    'SELECT id, model_slug, micro_per_unit, effective_at, created_by FROM rates WHERE model_slug = $1 AND id = $2',
    [slug, id],
  );
  return rows[0] ? toRate(rows[0]) : null;
}

export async function insertRate(
  slug: string,
  microPerUnit: bigint,
  effectiveAt: Date,
  createdBy: string,
): Promise<RateRow> {
  const id = await nextId(db, 'rate_seq', 'r_');
  await db.query(
    'INSERT INTO rates (id, model_slug, micro_per_unit, effective_at, created_by) VALUES ($1, $2, $3, $4, $5)',
    [id, slug, microPerUnit.toString(), effectiveAt, createdBy],
  );
  return { id, modelSlug: slug, microPerUnit, effectiveAt, createdBy };
}

export async function deleteRate(id: string): Promise<void> {
  await db.query('DELETE FROM rates WHERE id = $1', [id]);
}

export function rateStatus(rates: readonly RateRow[], rate: RateRow, now: Date): 'past' | 'current' | 'scheduled' {
  if (rate.effectiveAt.getTime() > now.getTime()) return 'scheduled';
  const effective = rates
    .filter((candidate) => candidate.effectiveAt.getTime() <= now.getTime())
    .sort((a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime());
  const current = effective[effective.length - 1];
  return current && current.id === rate.id ? 'current' : 'past';
}
