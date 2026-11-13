import type { PoolClient } from "pg";
import type { Bom, BomLine, ComponentType, TreeRow } from "../shared/types.js";

/**
 * The single place for the bill of materials rollup and the assembly tree.
 */

interface PartSummary {
  id: string;
  name: string;
  mass: number | null;
  body_status: string;
  material: string | null;
}

interface PurchasedSummary {
  id: string;
  name: string;
  declared_mass_g: number;
}

export interface AssemblyContext {
  parts: Map<string, PartSummary>;
  purchased: Map<string, PurchasedSummary>;
  assemblies: Map<string, { id: string; name: string; revision: number }>;
  instances: Map<string, { id: string; assembly_id: string; component_type: ComponentType; component_id: string; quantity: number; position: number }[]>;
}

export async function loadAssemblyContext(client: PoolClient): Promise<AssemblyContext> {
  const parts = new Map<string, PartSummary>();
  const partRows = (
    await client.query<{
      id: string;
      name: string;
      confirmed_mass_g: number | null;
      body_status: string;
      material: string | null;
    }>(
      `SELECT p.id, p.name, p.confirmed_mass_g, p.body_status, m.name AS material
       FROM parts p LEFT JOIN materials m ON m.id = p.material_id`
    )
  ).rows;
  for (const row of partRows) {
    parts.set(row.id, {
      id: row.id,
      name: row.name,
      mass: row.confirmed_mass_g,
      body_status: row.body_status,
      material: row.material
    });
  }
  const purchased = new Map<string, PurchasedSummary>();
  for (const row of (
    await client.query<{ id: string; name: string; declared_mass_g: number }>("SELECT id, name, declared_mass_g FROM purchased_parts")
  ).rows) {
    purchased.set(row.id, { id: row.id, name: row.name, declared_mass_g: row.declared_mass_g });
  }
  const assemblies = new Map<string, { id: string; name: string; revision: number }>();
  for (const row of (
    await client.query<{ id: string; name: string; revision: number }>("SELECT id, name, revision FROM assemblies")
  ).rows) {
    assemblies.set(row.id, { id: row.id, name: row.name, revision: row.revision });
  }
  const instances = new Map<string, { id: string; assembly_id: string; component_type: ComponentType; component_id: string; quantity: number; position: number }[]>();
  for (const row of (
    await client.query<{
      id: string;
      assembly_id: string;
      component_type: ComponentType;
      component_id: string;
      quantity: number;
      position: number;
    }>("SELECT id, assembly_id, component_type, component_id, quantity, position FROM instances ORDER BY assembly_id, position")
  ).rows) {
    const list = instances.get(row.assembly_id) ?? [];
    list.push(row);
    instances.set(row.assembly_id, list);
  }
  return { parts, purchased, assemblies, instances };
}

interface RolledLine {
  type: "part" | "purchased";
  id: string;
  name: string;
  material: string | null;
  quantity: number;
  unitMass: number | null;
  bodyStatus: string;
}

/** The rolled-up bill of materials: one line per distinct item. */
export function bomOf(ctx: AssemblyContext, assemblyId: string): Bom {
  const lines = new Map<string, RolledLine>();
  const walk = (assembly: string, factor: number): void => {
    for (const inst of ctx.instances.get(assembly) ?? []) {
      if (inst.component_type === "assembly") {
        walk(inst.component_id, factor * inst.quantity);
      } else if (inst.component_type === "part") {
        const part = ctx.parts.get(inst.component_id);
        if (!part) continue;
        const key = `part:${part.id}`;
        const existing = lines.get(key);
        const quantity = (existing?.quantity ?? 0) + factor * inst.quantity;
        lines.set(key, {
          type: "part",
          id: part.id,
          name: part.name,
          material: part.material,
          quantity,
          unitMass: part.mass,
          bodyStatus: part.body_status
        });
      } else {
        const item = ctx.purchased.get(inst.component_id);
        if (!item) continue;
        const key = `purchased:${item.id}`;
        const existing = lines.get(key);
        const quantity = (existing?.quantity ?? 0) + factor * inst.quantity;
        lines.set(key, {
          type: "purchased",
          id: item.id,
          name: item.name,
          material: null,
          quantity,
          unitMass: item.declared_mass_g,
          bodyStatus: "stored"
        });
      }
    }
  };
  walk(assemblyId, 1);
  const rolled: BomLine[] = [...lines.values()]
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
    .map((line) => ({
      item: { type: line.type, id: line.id, name: line.name },
      kind: line.type === "part" ? "made" : "purchased",
      material: line.material,
      quantity: line.quantity,
      unit_mass_g: line.unitMass,
      line_mass_g: line.unitMass === null ? null : line.unitMass * line.quantity,
      body_status: line.bodyStatus as BomLine["body_status"]
    }));
  const totalMass = rolled.reduce((sum, l) => sum + (l.line_mass_g ?? 0), 0);
  const partCount = rolled.reduce((sum, l) => sum + l.quantity, 0);
  return {
    assembly_id: assemblyId,
    lines: rolled,
    total_mass_g: totalMass,
    part_count: partCount,
    line_count: rolled.length
  };
}

/** Totals of an assembly itself, used for its tree rows and rollup. */
export function rollupOf(ctx: AssemblyContext, assemblyId: string): {
  mass_g: number;
  part_count: number;
  line_count: number;
} {
  const bom = bomOf(ctx, assemblyId);
  return { mass_g: bom.total_mass_g, part_count: bom.part_count, line_count: bom.line_count };
}

/** The assembly tree: nested rows with per-instance masses and piece counts. */
export function treeOf(ctx: AssemblyContext, assemblyId: string): TreeRow[] {
  const rows: TreeRow[] = [];
  for (const inst of ctx.instances.get(assemblyId) ?? []) {
    if (inst.component_type === "assembly") {
      const childRows = treeOf(ctx, inst.component_id);
      const rollup = rollupOf(ctx, inst.component_id);
      rows.push({
        instance_id: inst.id,
        component: {
          type: "assembly",
          id: inst.component_id,
          name: ctx.assemblies.get(inst.component_id)?.name ?? ""
        },
        quantity: inst.quantity,
        unit_mass_g: rollup.mass_g,
        subtotal_mass_g: rollup.mass_g * inst.quantity,
        pieces: rollup.part_count * inst.quantity,
        body_status: null,
        children: childRows
      });
    } else if (inst.component_type === "part") {
      const part = ctx.parts.get(inst.component_id);
      const mass = part?.mass ?? null;
      rows.push({
        instance_id: inst.id,
        component: { type: "part", id: inst.component_id, name: part?.name ?? "" },
        quantity: inst.quantity,
        unit_mass_g: mass,
        subtotal_mass_g: mass === null ? null : mass * inst.quantity,
        pieces: inst.quantity,
        body_status: (part?.body_status ?? "none") as TreeRow["body_status"],
      });
    } else {
      const item = ctx.purchased.get(inst.component_id);
      rows.push({
        instance_id: inst.id,
        component: { type: "purchased", id: inst.component_id, name: item?.name ?? "" },
        quantity: inst.quantity,
        unit_mass_g: item?.declared_mass_g ?? null,
        subtotal_mass_g: (item?.declared_mass_g ?? 0) * inst.quantity,
        pieces: inst.quantity,
        body_status: null
      });
    }
  }
  return rows;
}

/**
 * The single cycle check: adding candidate inside container would create a
 * cycle when container is already reachable from candidate.
 */
export function wouldCycle(ctx: AssemblyContext, containerId: string, candidateId: string): boolean {
  if (containerId === candidateId) return true;
  const seen = new Set<string>();
  const stack = [candidateId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const inst of ctx.instances.get(current) ?? []) {
      if (inst.component_type === "assembly") {
        if (inst.component_id === containerId) return true;
        stack.push(inst.component_id);
      }
    }
  }
  return false;
}
