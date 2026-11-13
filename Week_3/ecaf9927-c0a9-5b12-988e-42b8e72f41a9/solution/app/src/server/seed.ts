import { randomUUID } from 'node:crypto';
import type { ConstraintKind, Operation, Direction } from '../shared/api';
import { hashPassword } from './auth';
import { CONSTRAINT_WORDS } from '../shared/constraint-rules';
import { SEED_LOCK, applySchema, pool, transaction, type Db } from './db';
import { beginSave, finishSave, recoverInterruptedSaves } from './parts';
import { reserveName } from './names';
import { storageReachable } from './storage';

interface SeedConstraint {
  kind: ConstraintKind;
  refs: string[];
  value?: number;
  sign?: 1 | -1;
}

interface Ids {
  founder: string;
  engineer: string;
}

async function insertSketch(
  db: Db,
  ids: Ids,
  partId: string,
  name: string,
  entities: { label: string; geometry: object; id: string }[],
  constraints: SeedConstraint[],
): Promise<string> {
  const sketchId = randomUUID();
  const counts = (items: string[]) => items.reduce<Record<string, number>>((acc, k) => ({ ...acc, [k]: (acc[k] ?? 0) + 1 }), {});
  const entityCounters = counts(entities.map((e) => (e.geometry as { type: string }).type));
  const constraintCounters = counts(constraints.map((c) => c.kind));
  await db.query(
    'INSERT INTO sketches (id, part_id, name, plane, offset_mm, saved_by, entity_counters, constraint_counters) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [sketchId, partId, name, 'top', 0, ids.founder, JSON.stringify(entityCounters), JSON.stringify(constraintCounters)],
  );
  for (const e of entities) {
    await db.query('INSERT INTO entities (id, sketch_id, label, geometry) VALUES ($1, $2, $3, $4)', [e.id, sketchId, e.label, JSON.stringify(e.geometry)]);
  }
  const seen: Record<string, number> = {};
  for (const c of constraints) {
    seen[c.kind] = (seen[c.kind] ?? 0) + 1;
    await db.query(
      'INSERT INTO constraints (id, sketch_id, label, kind, refs, value_mm, sign) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [randomUUID(), sketchId, `${CONSTRAINT_WORDS[c.kind]} ${seen[c.kind]}`, c.kind, JSON.stringify(c.refs), c.value ?? null, c.sign ?? 1],
    );
  }
  return sketchId;
}

/** The rectangle layout: four lines, joined and squared, anchored at the origin, with up to two distances. */
async function rectangleSketch(db: Db, ids: Ids, partId: string, width: number, height: number, dimensioned: boolean): Promise<string> {
  const [l1, l2, l3, l4] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()] as [string, string, string, string];
  const line = (id: string, n: number, x1: number, y1: number, x2: number, y2: number) => ({
    id,
    label: `Line ${n}`,
    geometry: { type: 'line', start: { x: x1, y: y1 }, end: { x: x2, y: y2 } },
  });
  const constraints: SeedConstraint[] = [
    { kind: 'coincident', refs: [`${l1}.end`, `${l2}.start`] },
    { kind: 'coincident', refs: [`${l2}.end`, `${l3}.start`] },
    { kind: 'coincident', refs: [`${l3}.end`, `${l4}.start`] },
    { kind: 'coincident', refs: [`${l4}.end`, `${l1}.start`] },
    { kind: 'horizontal', refs: [l1] },
    { kind: 'vertical', refs: [l2] },
    { kind: 'horizontal', refs: [l3] },
    { kind: 'vertical', refs: [l4] },
    { kind: 'coincident', refs: [`${l1}.start`, 'origin'] },
    ...(dimensioned
      ? [
          { kind: 'distance', refs: [l1], value: width } satisfies SeedConstraint,
          { kind: 'distance', refs: [l2], value: height } satisfies SeedConstraint,
        ]
      : []),
  ];
  return insertSketch(
    db,
    ids,
    partId,
    'Sketch 1',
    [
      line(l1, 1, 0, 0, width, 0),
      line(l2, 2, width, 0, width, height),
      line(l3, 3, width, height, 0, height),
      line(l4, 4, 0, height, 0, 0),
    ],
    constraints,
  );
}

async function insertPart(db: Db, ids: Ids, name: string, materialId: string, sketches: number, features: number): Promise<string> {
  const id = randomUUID();
  await db.query('INSERT INTO parts (id, name, saved_by, material_id, next_sketch, next_feature, body_status) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
    id,
    name,
    ids.founder,
    materialId,
    sketches + 1,
    features + 1,
    features > 0 ? 'not_stored' : 'none',
  ]);
  await reserveName(db, name, id);
  return id;
}

async function insertFeature(db: Db, partId: string, sketchId: string, n: number, operation: Operation, depth: number, direction: Direction): Promise<void> {
  await db.query('INSERT INTO features (id, part_id, sketch_id, name, operation, depth_mm, direction) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
    randomUUID(),
    partId,
    sketchId,
    `Extrude ${n}`,
    operation,
    depth,
    direction,
  ]);
}

async function seedWorkspace(db: Db): Promise<void> {
  const ids: Ids = { founder: randomUUID(), engineer: randomUUID() };
  await db.query('INSERT INTO members (id, name, email, role, password_hash, units, precision) VALUES ($1, $2, $3, $4, $5, $6, $7), ($8, $9, $10, $11, $12, $13, $14)', [
    ids.founder, 'Ines Varga', 'ines@ostra-lighting.example', 'founder', await hashPassword('lamp-founder-7341'), 'mm', 2,
    ids.engineer, 'Teo Lindqvist', 'teo@lindqvist-eng.example', 'engineer', await hashPassword('lamp-engineer-5826'), 'in', 3,
  ]);
  const material = new Map<string, string>();
  for (const [name, density] of [['6061-T6 aluminium', 2.7], ['Acetal (POM-C)', 1.41], ['PETG', 1.27]] as const) {
    const id = randomUUID();
    material.set(name, id);
    await db.query('INSERT INTO materials (id, name, density_g_cm3) VALUES ($1, $2, $3)', [id, name, density]);
  }
  const purchased = new Map<string, string>();
  for (const [name, mass] of [['M4 × 12 socket head cap screw', 2.1], ['M3 brass heat-set insert', 0.4]] as const) {
    const id = randomUUID();
    purchased.set(name, id);
    await db.query('INSERT INTO purchased_parts (id, name, declared_mass_g, saved_by) VALUES ($1, $2, $3, $4)', [id, name, mass, ids.founder]);
    await reserveName(db, name, id);
  }

  const circle = (label: string, x: number, y: number, radius: number) => ({ id: randomUUID(), label, geometry: { type: 'circle', center: { x, y }, radius } });
  const parts = new Map<string, string>();

  const base = await insertPart(db, ids, 'Base Plate', material.get('6061-T6 aluminium') as string, 2, 2);
  const baseSketch1 = await rectangleSketch(db, ids, base, 120, 80, true);
  const hole = circle('Circle 1', 60, 40, 10);
  const baseSketch2 = await insertSketch(db, ids, base, 'Sketch 2', [hole], [
    { kind: 'horizontal_distance', refs: ['origin', `${hole.id}.center`], value: 60 },
    { kind: 'vertical_distance', refs: ['origin', `${hole.id}.center`], value: 40 },
    { kind: 'diameter', refs: [hole.id], value: 20 },
  ]);
  await insertFeature(db, base, baseSketch1, 1, 'new', 8, 'normal');
  await insertFeature(db, base, baseSketch2, 2, 'cut', 20, 'symmetric');
  parts.set('Base Plate', base);

  for (const [name, mat, w, h, depth] of [
    ['Arm Link', '6061-T6 aluminium', 160, 16, 6],
    ['Pivot Bracket', 'Acetal (POM-C)', 30, 20, 12],
  ] as const) {
    const id = await insertPart(db, ids, name, material.get(mat) as string, 1, 1);
    await insertFeature(db, id, await rectangleSketch(db, ids, id, w, h, true), 1, 'new', depth, 'normal');
    parts.set(name, id);
  }

  const shade = await insertPart(db, ids, 'Shade', material.get('PETG') as string, 1, 1);
  const outer = circle('Circle 1', 0, 0, 30);
  const inner = circle('Circle 2', 0, 0, 28);
  const shadeSketch = await insertSketch(db, ids, shade, 'Sketch 1', [outer, inner], [
    { kind: 'coincident', refs: [`${outer.id}.center`, 'origin'] },
    { kind: 'diameter', refs: [outer.id], value: 60 },
    { kind: 'coincident', refs: [`${inner.id}.center`, 'origin'] },
    { kind: 'diameter', refs: [inner.id], value: 56 },
  ]);
  await insertFeature(db, shade, shadeSketch, 1, 'new', 40, 'normal');
  parts.set('Shade', shade);

  const cover = await insertPart(db, ids, 'Switch Cover', material.get('PETG') as string, 1, 0);
  await rectangleSketch(db, ids, cover, 24, 16, false);

  const [lamp, arm, head] = [randomUUID(), randomUUID(), randomUUID()] as [string, string, string];
  for (const [id, name] of [[lamp, 'Ostra Desk Lamp'], [arm, 'Arm Assembly'], [head, 'Head Assembly']] as const) {
    await db.query('INSERT INTO assemblies (id, name, saved_by) VALUES ($1, $2, $3)', [id, name, ids.founder]);
    await reserveName(db, name, id);
  }
  const m4 = purchased.get('M4 × 12 socket head cap screw') as string;
  const m3 = purchased.get('M3 brass heat-set insert') as string;
  const place = async (assembly: string, type: string, component: string, quantity: number) => {
    await db.query('INSERT INTO instances (id, assembly_id, component_type, component_id, quantity) VALUES ($1, $2, $3, $4, $5)', [randomUUID(), assembly, type, component, quantity]);
  };
  await place(lamp, 'part', parts.get('Base Plate') as string, 1);
  await place(lamp, 'part', parts.get('Pivot Bracket') as string, 1);
  await place(lamp, 'purchased', m4, 2);
  await place(lamp, 'assembly', arm, 1);
  await place(arm, 'part', parts.get('Arm Link') as string, 2);
  await place(arm, 'part', parts.get('Pivot Bracket') as string, 2);
  await place(arm, 'purchased', m4, 4);
  await place(arm, 'assembly', head, 1);
  await place(head, 'part', parts.get('Shade') as string, 1);
  await place(head, 'purchased', m3, 3);
  await db.query('INSERT INTO workspace (id, name, product_assembly_id) VALUES (1, $1, $2)', ['Ostra Lighting', lamp]);
}

/** Writes the body of every part that has extrudes but was never stored, when storage is reachable. */
async function storeSeededBodies(): Promise<void> {
  await recoverInterruptedSaves();
  if (!(await storageReachable())) return;
  const { rows } = await pool.query<{ id: string }>(
    "SELECT id FROM parts WHERE confirmed IS NULL AND body_status = 'not_stored' AND EXISTS (SELECT 1 FROM features WHERE part_id = parts.id) ORDER BY seq",
  );
  for (const { id } of rows) {
    const pending = await transaction((db) => beginSave(db, id));
    if (pending) await finishSave(pending);
  }
}

/** Applies the schema, seeds an empty database exactly once, and writes the seeded bodies. Safe to run in two processes at once. */
export async function prepare(): Promise<void> {
  const lock = await pool.connect();
  try {
    await lock.query('SELECT pg_advisory_lock($1)', [SEED_LOCK]);
    await applySchema(lock);
    const { rowCount } = await lock.query('SELECT 1 FROM workspace');
    if (rowCount === 0) await transaction(seedWorkspace);
    await storeSeededBodies();
  } finally {
    await lock.query('SELECT pg_advisory_unlock($1)', [SEED_LOCK]).catch(() => undefined);
    lock.release();
  }
}
