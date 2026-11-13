import type { PoolClient } from "pg";
import { hashPassword } from "./passwords.js";
import { newId } from "./sketchService.js";

/**
 * The exact sample product. Created once, against an empty database, under
 * an advisory lock so two server processes starting together create it
 * exactly once.
 */

interface EntitySpec {
  type: "point" | "line" | "circle" | "arc";
  geometry: Record<string, unknown>;
}

interface ConstraintSpec {
  kind: string;
  refs: string[];
  value_mm?: number;
}

export async function seedIfNeeded(client: PoolClient): Promise<void> {
  const existing = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM workspace");
  if (Number(existing.rows[0]!.count) > 0) return;
  const lock = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(918273645) AS locked");
  if (!lock.rows[0]!.locked) {
    // Another process is seeding: wait for it to finish.
    for (let i = 0; i < 100; i++) {
      const again = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM workspace");
      if (Number(again.rows[0]!.count) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return;
  }
  try {
    const recheck = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM workspace");
    if (Number(recheck.rows[0]!.count) > 0) return;
    await insertSeed(client);
  } finally {
    await client.query("SELECT pg_advisory_unlock(918273645)");
  }
}

async function insertSeed(client: PoolClient): Promise<void> {
  const materials = new Map<string, string>();
  for (const [name, density] of [
    ["6061-T6 aluminium", 2.7],
    ["Acetal (POM-C)", 1.41],
    ["PETG", 1.27]
  ] as const) {
    const id = newId();
    materials.set(name, id);
    await client.query(
      "INSERT INTO materials (id, name, density_g_cm3) VALUES ($1, $2, $3)",
      [id, name, density]
    );
  }

  const members = [
    { name: "Ines Varga", email: "ines@ostra-lighting.example", password: "lamp-founder-7341", role: "founder", units: "mm", precision: 2 },
    { name: "Teo Lindqvist", email: "teo@lindqvist-eng.example", password: "lamp-engineer-5826", role: "engineer", units: "in", precision: 3 }
  ];
  for (const m of members) {
    await client.query(
      `INSERT INTO members (id, name, email, password_hash, role, units, precision)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [newId(), m.name, m.email, await hashPassword(m.password), m.role, m.units, m.precision]
    );
  }

  const purchased = new Map<string, string>();
  for (const [name, mass] of [
    ["M4 × 12 socket head cap screw", 2.1],
    ["M3 brass heat-set insert", 0.4]
  ] as const) {
    const id = newId();
    purchased.set(name, id);
    await client.query(
      "INSERT INTO purchased_parts (id, name, declared_mass_g, revision) VALUES ($1, $2, $3, 1)",
      [id, name, mass]
    );
  }

  const partIds = new Map<string, string>();
  const parts: { name: string; material: string }[] = [
    { name: "Base Plate", material: "6061-T6 aluminium" },
    { name: "Arm Link", material: "6061-T6 aluminium" },
    { name: "Pivot Bracket", material: "Acetal (POM-C)" },
    { name: "Shade", material: "PETG" },
    { name: "Switch Cover", material: "PETG" }
  ];
  for (const p of parts) {
    const id = newId();
    partIds.set(p.name, id);
    await client.query(
      `INSERT INTO parts (id, name, material_id, revision, body_status, seeded)
       VALUES ($1, $2, $3, 1, $4, TRUE)`,
      [id, p.name, materials.get(p.material)!, p.name === "Switch Cover" ? "none" : "not_stored"]
    );
  }

  // Rectangle sketches with all eleven constraints, or only the first nine.
  const rectangle = (w: number, h: number, full: boolean): { entities: EntitySpec[]; constraints: ConstraintSpec[] } => ({
    entities: [
      { type: "line", geometry: { start: { x: 0, y: 0 }, end: { x: w, y: 0 } } },
      { type: "line", geometry: { start: { x: w, y: 0 }, end: { x: w, y: h } } },
      { type: "line", geometry: { start: { x: w, y: h }, end: { x: 0, y: h } } },
      { type: "line", geometry: { start: { x: 0, y: h }, end: { x: 0, y: 0 } } }
    ],
    constraints: full
      ? [
          { kind: "coincident", refs: ["$e1.end", "$e2.start"] },
          { kind: "coincident", refs: ["$e2.end", "$e3.start"] },
          { kind: "coincident", refs: ["$e3.end", "$e4.start"] },
          { kind: "coincident", refs: ["$e4.end", "$e1.start"] },
          { kind: "horizontal", refs: ["$e1"] },
          { kind: "vertical", refs: ["$e2"] },
          { kind: "horizontal", refs: ["$e3"] },
          { kind: "vertical", refs: ["$e4"] },
          { kind: "coincident", refs: ["$e1.start", "origin"] },
          { kind: "distance", refs: ["$e1"], value_mm: w },
          { kind: "distance", refs: ["$e2"], value_mm: h }
        ]
      : [
          { kind: "coincident", refs: ["$e1.end", "$e2.start"] },
          { kind: "coincident", refs: ["$e2.end", "$e3.start"] },
          { kind: "coincident", refs: ["$e3.end", "$e4.start"] },
          { kind: "coincident", refs: ["$e4.end", "$e1.start"] },
          { kind: "horizontal", refs: ["$e1"] },
          { kind: "vertical", refs: ["$e2"] },
          { kind: "horizontal", refs: ["$e3"] },
          { kind: "vertical", refs: ["$e4"] },
          { kind: "coincident", refs: ["$e1.start", "origin"] }
        ]
  });

  const insertSketch = async (
    partName: string,
    number: number,
    entities: EntitySpec[],
    constraints: ConstraintSpec[]
  ): Promise<string> => {
    const partId = partIds.get(partName)!;
    const sketchId = newId();
    const entityCounters: Record<string, number> = {};
    const constraintCounters: Record<string, number> = {};
    await client.query(
      `INSERT INTO sketches (id, part_id, name, plane, offset_mm, revision, slack, entity_counters, constraint_counters)
       VALUES ($1, $2, $3, 'top', 0, 1, 0, '{}', '{}')`,
      [sketchId, partId, `Sketch ${number}`]
    );
    const entityIds: string[] = [];
    for (const e of entities) {
      const id = newId();
      entityIds.push(id);
      const count = (entityCounters[e.type] ?? 0) + 1;
      entityCounters[e.type] = count;
      const label = `${e.type === "point" ? "Point" : e.type === "line" ? "Line" : e.type === "circle" ? "Circle" : "Arc"} ${count}`;
      await client.query(
        `INSERT INTO entities (id, sketch_id, type, label, number, geometry, created_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())`,
        [id, sketchId, e.type, label, count, JSON.stringify(e.geometry)]
      );
    }
    for (const c of constraints) {
      const refs = c.refs.map((r) => r.replace(/\$e(\d+)/, (_, i) => entityIds[Number(i) - 1]!));
      const count = (constraintCounters[c.kind] ?? 0) + 1;
      constraintCounters[c.kind] = count;
      const label = `${constraintWord(c.kind)} ${count}`;
      await client.query(
        `INSERT INTO constraints (id, sketch_id, kind, label, number, refs, value_mm, redundant, created_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, FALSE, now())`,
        [newId(), sketchId, c.kind, label, count, JSON.stringify(refs), c.value_mm ?? null]
      );
    }
    await client.query(
      `UPDATE sketches SET entity_counters = $1::jsonb, constraint_counters = $2::jsonb WHERE id = $3`,
      [JSON.stringify(entityCounters), JSON.stringify(constraintCounters), sketchId]
    );
    await client.query(
      "UPDATE parts SET next_sketch_number = $1 WHERE id = $2",
      [number, partId]
    );
    return sketchId;
  };

  const constraintWord = (kind: string): string => {
    switch (kind) {
      case "coincident": return "Coincident";
      case "horizontal": return "Horizontal";
      case "vertical": return "Vertical";
      case "parallel": return "Parallel";
      case "perpendicular": return "Perpendicular";
      case "equal": return "Equal";
      case "fix": return "Fix";
      case "distance": return "Distance";
      case "horizontal_distance": return "Horizontal distance";
      case "vertical_distance": return "Vertical distance";
      case "diameter": return "Diameter";
      case "radius": return "Radius";
      default: return kind;
    }
  };

  // Base Plate: rectangle 120x80 fully held; circle sketch fully held.
  const baseSketch1 = await insertSketch("Base Plate", 1, rectangle(120, 80, true).entities, rectangle(120, 80, true).constraints);
  const circleEntities: EntitySpec[] = [
    { type: "circle", geometry: { center: { x: 60, y: 40 }, radius: 10 } }
  ];
  const circleConstraints: ConstraintSpec[] = [
    { kind: "horizontal_distance", refs: ["origin", "$e1.center"], value_mm: 60 },
    { kind: "vertical_distance", refs: ["origin", "$e1.center"], value_mm: 40 },
    { kind: "diameter", refs: ["$e1"], value_mm: 20 }
  ];
  const baseSketch2 = await insertSketch("Base Plate", 2, circleEntities, circleConstraints);

  const armSketch = await insertSketch("Arm Link", 1, rectangle(160, 16, true).entities, rectangle(160, 16, true).constraints);
  const pivotSketch = await insertSketch("Pivot Bracket", 1, rectangle(30, 20, true).entities, rectangle(30, 20, true).constraints);
  const shadeEntities: EntitySpec[] = [
    { type: "circle", geometry: { center: { x: 0, y: 0 }, radius: 30 } },
    { type: "circle", geometry: { center: { x: 0, y: 0 }, radius: 28 } }
  ];
  const shadeConstraints: ConstraintSpec[] = [
    { kind: "coincident", refs: ["$e1.center", "origin"] },
    { kind: "diameter", refs: ["$e1"], value_mm: 60 },
    { kind: "coincident", refs: ["$e2.center", "origin"] },
    { kind: "diameter", refs: ["$e2"], value_mm: 56 }
  ];
  const shadeSketch = await insertSketch("Shade", 1, shadeEntities, shadeConstraints);
  const switchSketch = await insertSketch("Switch Cover", 1, rectangle(24, 16, false).entities, rectangle(24, 16, false).constraints);

  const insertFeature = async (
    partName: string,
    number: number,
    sketchId: string,
    operation: string,
    depth: number,
    direction: string
  ): Promise<void> => {
    await client.query(
      `INSERT INTO features (id, part_id, sketch_id, name, operation, depth_mm, direction, number)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [newId(), partIds.get(partName)!, sketchId, `Extrude ${number}`, operation, depth, direction, number]
    );
    await client.query("UPDATE parts SET next_feature_number = $1 WHERE id = $2", [number, partIds.get(partName)!]);
  };

  await insertFeature("Base Plate", 1, baseSketch1, "new", 8, "normal");
  await insertFeature("Base Plate", 2, baseSketch2, "cut", 20, "symmetric");
  await insertFeature("Arm Link", 1, armSketch, "new", 6, "normal");
  await insertFeature("Pivot Bracket", 1, pivotSketch, "new", 12, "normal");
  await insertFeature("Shade", 1, shadeSketch, "new", 40, "normal");
  void switchSketch;

  const assemblies = new Map<string, string>();
  for (const name of ["Ostra Desk Lamp", "Arm Assembly", "Head Assembly"]) {
    const id = newId();
    assemblies.set(name, id);
    await client.query(
      "INSERT INTO assemblies (id, name, revision, is_product) VALUES ($1, $2, 1, $3)",
      [id, name, name === "Ostra Desk Lamp"]
    );
  }

  let position = 0;
  const addInstance = async (
    assemblyName: string,
    type: "part" | "purchased" | "assembly",
    componentKey: { part?: string; purchased?: string; assembly?: string },
    quantity: number
  ): Promise<void> => {
    const componentId =
      type === "part"
        ? partIds.get(componentKey.part!)
        : type === "purchased"
          ? purchased.get(componentKey.purchased!)
          : assemblies.get(componentKey.assembly!);
    position += 1;
    await client.query(
      `INSERT INTO instances (id, assembly_id, component_type, component_id, quantity, position)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [newId(), assemblies.get(assemblyName)!, type, componentId!, quantity, position]
    );
  };

  await addInstance("Ostra Desk Lamp", "part", { part: "Base Plate" }, 1);
  await addInstance("Ostra Desk Lamp", "part", { part: "Pivot Bracket" }, 1);
  await addInstance("Ostra Desk Lamp", "purchased", { purchased: "M4 × 12 socket head cap screw" }, 2);
  await addInstance("Ostra Desk Lamp", "assembly", { assembly: "Arm Assembly" }, 1);
  await addInstance("Arm Assembly", "part", { part: "Arm Link" }, 2);
  await addInstance("Arm Assembly", "part", { part: "Pivot Bracket" }, 2);
  await addInstance("Arm Assembly", "purchased", { purchased: "M4 × 12 socket head cap screw" }, 4);
  await addInstance("Arm Assembly", "assembly", { assembly: "Head Assembly" }, 1);
  await addInstance("Head Assembly", "part", { part: "Shade" }, 1);
  await addInstance("Head Assembly", "purchased", { purchased: "M3 brass heat-set insert" }, 3);

  await client.query(
    `INSERT INTO workspace (id, name, product_assembly_id) VALUES (1, 'Ostra Lighting', $1)`,
    [assemblies.get("Ostra Desk Lamp")!]
  );
}
