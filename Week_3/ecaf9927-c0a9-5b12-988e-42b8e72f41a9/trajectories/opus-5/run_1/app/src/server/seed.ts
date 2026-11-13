import type { ComponentType, ConstraintKind, EntityGeometry, Plane } from '../shared/api.js';
import { hashPassword, newId } from './auth.js';
import { withSeedLock, type Db } from './db.js';
import { runPartSave } from './domain/partSave.js';
import { constraintLabel, entityLabel, nextLabelNumber } from './repo/parts.js';
import { WORKSPACE_ID } from './repo/workspace.js';
import { storageReachable } from './storage.js';

type SeedConstraint = {
  kind: ConstraintKind;
  refs: string[];
  value?: number;
  fixAt?: { x: number; y: number };
};

type SeedSketch = {
  plane: Plane;
  offset: number;
  entities: EntityGeometry[];
  constraints: (ids: string[]) => SeedConstraint[];
};

type SeedFeature = {
  sketch: number;
  operation: 'new' | 'join' | 'cut' | 'intersect';
  depth: number;
  direction: 'normal' | 'reverse' | 'symmetric';
};

function rectangleSketch(width: number, height: number, withDistances: boolean): SeedSketch {
  return {
    plane: 'top',
    offset: 0,
    entities: [
      { type: 'line', start: { x: 0, y: 0 }, end: { x: width, y: 0 } },
      { type: 'line', start: { x: width, y: 0 }, end: { x: width, y: height } },
      { type: 'line', start: { x: width, y: height }, end: { x: 0, y: height } },
      { type: 'line', start: { x: 0, y: height }, end: { x: 0, y: 0 } },
    ],
    constraints: ([one, two, three, four]) => {
      const list: SeedConstraint[] = [
        { kind: 'coincident', refs: [`${one}.end`, `${two}.start`] },
        { kind: 'coincident', refs: [`${two}.end`, `${three}.start`] },
        { kind: 'coincident', refs: [`${three}.end`, `${four}.start`] },
        { kind: 'coincident', refs: [`${four}.end`, `${one}.start`] },
        { kind: 'horizontal', refs: [one as string] },
        { kind: 'vertical', refs: [two as string] },
        { kind: 'horizontal', refs: [three as string] },
        { kind: 'vertical', refs: [four as string] },
        { kind: 'coincident', refs: [`${one}.start`, 'origin'] },
      ];
      if (withDistances) {
        list.push({ kind: 'distance', refs: [one as string], value: width });
        list.push({ kind: 'distance', refs: [two as string], value: height });
      }
      return list;
    },
  };
}

const MATERIALS = [
  { id: 'aluminium-6061-t6', name: '6061-T6 aluminium', density: 2.7 },
  { id: 'acetal-pom-c', name: 'Acetal (POM-C)', density: 1.41 },
  { id: 'petg', name: 'PETG', density: 1.27 },
];

const PURCHASED = [
  { name: 'M4 \u00d7 12 socket head cap screw', mass: 2.1 },
  { name: 'M3 brass heat-set insert', mass: 0.4 },
];

const PARTS: { name: string; material: string; sketches: SeedSketch[]; features: SeedFeature[] }[] = [
  {
    name: 'Base Plate',
    material: 'aluminium-6061-t6',
    sketches: [
      rectangleSketch(120, 80, true),
      {
        plane: 'top',
        offset: 0,
        entities: [{ type: 'circle', center: { x: 60, y: 40 }, radius: 10 }],
        constraints: ([circle]) => [
          { kind: 'horizontal_distance', refs: ['origin', `${circle}.center`], value: 60 },
          { kind: 'vertical_distance', refs: ['origin', `${circle}.center`], value: 40 },
          { kind: 'diameter', refs: [circle as string], value: 20 },
        ],
      },
    ],
    features: [
      { sketch: 0, operation: 'new', depth: 8, direction: 'normal' },
      { sketch: 1, operation: 'cut', depth: 20, direction: 'symmetric' },
    ],
  },
  {
    name: 'Arm Link',
    material: 'aluminium-6061-t6',
    sketches: [rectangleSketch(160, 16, true)],
    features: [{ sketch: 0, operation: 'new', depth: 6, direction: 'normal' }],
  },
  {
    name: 'Pivot Bracket',
    material: 'acetal-pom-c',
    sketches: [rectangleSketch(30, 20, true)],
    features: [{ sketch: 0, operation: 'new', depth: 12, direction: 'normal' }],
  },
  {
    name: 'Shade',
    material: 'petg',
    sketches: [
      {
        plane: 'top',
        offset: 0,
        entities: [
          { type: 'circle', center: { x: 0, y: 0 }, radius: 30 },
          { type: 'circle', center: { x: 0, y: 0 }, radius: 28 },
        ],
        constraints: ([outer, inner]) => [
          { kind: 'coincident', refs: [`${outer}.center`, 'origin'] },
          { kind: 'diameter', refs: [outer as string], value: 60 },
          { kind: 'coincident', refs: [`${inner}.center`, 'origin'] },
          { kind: 'diameter', refs: [inner as string], value: 56 },
        ],
      },
    ],
    features: [{ sketch: 0, operation: 'new', depth: 40, direction: 'normal' }],
  },
  {
    name: 'Switch Cover',
    material: 'petg',
    sketches: [rectangleSketch(24, 16, false)],
    features: [],
  },
];

const ASSEMBLIES: { name: string; instances: { name: string; type: ComponentType; quantity: number }[] }[] = [
  {
    name: 'Ostra Desk Lamp',
    instances: [
      { name: 'Base Plate', type: 'part', quantity: 1 },
      { name: 'Pivot Bracket', type: 'part', quantity: 1 },
      { name: 'M4 \u00d7 12 socket head cap screw', type: 'purchased', quantity: 2 },
      { name: 'Arm Assembly', type: 'assembly', quantity: 1 },
    ],
  },
  {
    name: 'Arm Assembly',
    instances: [
      { name: 'Arm Link', type: 'part', quantity: 2 },
      { name: 'Pivot Bracket', type: 'part', quantity: 2 },
      { name: 'M4 \u00d7 12 socket head cap screw', type: 'purchased', quantity: 4 },
      { name: 'Head Assembly', type: 'assembly', quantity: 1 },
    ],
  },
  {
    name: 'Head Assembly',
    instances: [
      { name: 'Shade', type: 'part', quantity: 1 },
      { name: 'M3 brass heat-set insert', type: 'purchased', quantity: 3 },
    ],
  },
];

async function createSketch(
  db: Db,
  partId: string,
  index: number,
  sketch: SeedSketch,
  founderId: string,
): Promise<string> {
  const sketchId = newId();
  await db.query(
    'insert into sketches (id, part_id, name, plane, offset_mm, saved_by) values ($1, $2, $3, $4, $5, $6)',
    [sketchId, partId, `Sketch ${index + 1}`, sketch.plane, sketch.offset, founderId],
  );
  const entityIds: string[] = [];
  for (const geometry of sketch.entities) {
    const id = newId();
    const label = entityLabel(geometry.type, await nextLabelNumber(db, sketchId, geometry.type));
    await db.query(
      'insert into sketch_entities (id, sketch_id, label, geometry) values ($1, $2, $3, $4)',
      [id, sketchId, label, JSON.stringify(geometry)],
    );
    entityIds.push(id);
  }
  for (const constraint of sketch.constraints(entityIds)) {
    const label = constraintLabel(constraint.kind, await nextLabelNumber(db, sketchId, constraint.kind));
    await db.query(
      `insert into sketch_constraints (id, sketch_id, label, kind, refs, value_mm, fix_at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        newId(),
        sketchId,
        label,
        constraint.kind,
        JSON.stringify(constraint.refs),
        constraint.value ?? null,
        constraint.fixAt ? JSON.stringify(constraint.fixAt) : null,
      ],
    );
  }
  return sketchId;
}

async function seedWorkspace(db: Db): Promise<void> {
  await db.query('insert into workspaces (id, name) values ($1, $2)', [WORKSPACE_ID, 'Ostra Lighting']);

  const founderId = newId();
  const engineerId = newId();
  await db.query(
    `insert into members (id, workspace_id, name, email, password_hash, role, units, precision)
     values ($1, $2, $3, $4, $5, 'founder', 'mm', 2)`,
    [
      founderId,
      WORKSPACE_ID,
      'Ines Varga',
      'ines@ostra-lighting.example',
      await hashPassword('lamp-founder-7341'),
    ],
  );
  await db.query(
    `insert into members (id, workspace_id, name, email, password_hash, role, units, precision)
     values ($1, $2, $3, $4, $5, 'engineer', 'in', 3)`,
    [
      engineerId,
      WORKSPACE_ID,
      'Teo Lindqvist',
      'teo@lindqvist-eng.example',
      await hashPassword('lamp-engineer-5826'),
    ],
  );

  for (const material of MATERIALS) {
    await db.query(
      'insert into materials (id, workspace_id, name, density_g_cm3) values ($1, $2, $3, $4)',
      [material.id, WORKSPACE_ID, material.name, material.density],
    );
  }

  const componentIds = new Map<string, string>();
  for (const purchased of PURCHASED) {
    const id = newId();
    await db.query(
      `insert into purchased_parts (id, workspace_id, name, declared_mass_g, saved_by)
       values ($1, $2, $3, $4, $5)`,
      [id, WORKSPACE_ID, purchased.name, purchased.mass, founderId],
    );
    componentIds.set(purchased.name, id);
  }

  for (const part of PARTS) {
    const partId = newId();
    await db.query(
      `insert into parts (id, workspace_id, name, material_id, saved_by, body_status, next_sketch_seq, next_feature_seq)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        partId,
        WORKSPACE_ID,
        part.name,
        part.material,
        founderId,
        part.features.length === 0 ? 'none' : 'not_stored',
        part.sketches.length + 1,
        part.features.length + 1,
      ],
    );
    componentIds.set(part.name, partId);
    const sketchIds: string[] = [];
    for (let index = 0; index < part.sketches.length; index += 1) {
      sketchIds.push(
        await createSketch(db, partId, index, part.sketches[index] as SeedSketch, founderId),
      );
    }
    for (let index = 0; index < part.features.length; index += 1) {
      const feature = part.features[index] as SeedFeature;
      await db.query(
        `insert into features (id, part_id, name, sketch_id, operation, depth_mm, direction)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          newId(),
          partId,
          `Extrude ${index + 1}`,
          sketchIds[feature.sketch] as string,
          feature.operation,
          feature.depth,
          feature.direction,
        ],
      );
    }
  }

  for (const assembly of ASSEMBLIES) {
    const id = newId();
    await db.query('insert into assemblies (id, workspace_id, name, saved_by) values ($1, $2, $3, $4)', [
      id,
      WORKSPACE_ID,
      assembly.name,
      founderId,
    ]);
    componentIds.set(assembly.name, id);
  }
  for (const assembly of ASSEMBLIES) {
    for (const instance of assembly.instances) {
      await db.query(
        `insert into instances (id, assembly_id, component_type, component_id, quantity)
         values ($1, $2, $3, $4, $5)`,
        [
          newId(),
          componentIds.get(assembly.name) as string,
          instance.type,
          componentIds.get(instance.name) as string,
          instance.quantity,
        ],
      );
    }
  }

  await db.query('update workspaces set product_assembly_id = $2 where id = $1', [
    WORKSPACE_ID,
    componentIds.get('Ostra Desk Lamp') as string,
  ]);
}

export async function ensureSeed(): Promise<void> {
  await withSeedLock(async (db) => {
    const { rows } = await db.query<{ id: string }>('select id from workspaces where id = $1', [
      WORKSPACE_ID,
    ]);
    if (rows.length === 0) await seedWorkspace(db);
  });
}

/**
 * Writes the body of any part that has never been stored, unless storage is down.
 * Held under the boot lock so simultaneous boots do not each take a build number.
 */
export async function writeMissingSeedBodies(): Promise<void> {
  if (!(await storageReachable())) return;
  await withSeedLock(async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `select p.id from parts p
        where p.confirmed is null
          and exists (select 1 from features f where f.part_id = p.id)`,
    );
    for (const row of rows) await runPartSave(row.id, async () => undefined);
  });
}
