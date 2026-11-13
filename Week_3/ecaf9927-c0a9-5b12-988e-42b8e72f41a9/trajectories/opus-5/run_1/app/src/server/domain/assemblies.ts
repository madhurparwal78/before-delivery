import type {
  Assembly,
  Bom,
  BomLine,
  BodyStatus,
  ComponentType,
  TreeRow,
} from '../../shared/api.js';
import type { Db } from '../db.js';
import { WORKSPACE_ID } from '../repo/workspace.js';

type PartEntry = {
  name: string;
  materialName: string;
  massG: number | null;
  bodyStatus: BodyStatus;
};

type InstanceEntry = {
  id: string;
  componentType: ComponentType;
  componentId: string;
  quantity: number;
};

type AssemblyEntry = { id: string; name: string; revision: number; instances: InstanceEntry[] };

export type Catalogue = {
  parts: Map<string, PartEntry>;
  purchased: Map<string, { name: string; massG: number }>;
  assemblies: Map<string, AssemblyEntry>;
};

export async function loadCatalogue(db: Db): Promise<Catalogue> {
  type PartRow = {
    id: string;
    name: string;
    material_name: string;
    body_status: BodyStatus;
    mass_g: number | null;
  };
  const { rows: partRows } = await db.query<PartRow>(
    `select p.id, p.name, m.name as material_name, p.body_status,
            (p.confirmed->>'mass_g')::double precision as mass_g
       from parts p join materials m on m.id = p.material_id
      where p.workspace_id = $1`,
    [WORKSPACE_ID],
  );
  const { rows: purchasedRows } = await db.query<{ id: string; name: string; declared_mass_g: number }>(
    'select id, name, declared_mass_g from purchased_parts where workspace_id = $1',
    [WORKSPACE_ID],
  );
  const { rows: assemblyRows } = await db.query<{ id: string; name: string; revision: number }>(
    'select id, name, revision from assemblies where workspace_id = $1 order by ord',
    [WORKSPACE_ID],
  );
  type InstanceRow = {
    id: string;
    assembly_id: string;
    component_type: ComponentType;
    component_id: string;
    quantity: number;
  };
  const { rows: instanceRows } = await db.query<InstanceRow>(
    `select i.id, i.assembly_id, i.component_type, i.component_id, i.quantity
       from instances i join assemblies a on a.id = i.assembly_id
      where a.workspace_id = $1 order by i.ord`,
    [WORKSPACE_ID],
  );

  const assemblies = new Map<string, AssemblyEntry>();
  for (const row of assemblyRows) {
    assemblies.set(row.id, { id: row.id, name: row.name, revision: row.revision, instances: [] });
  }
  for (const row of instanceRows) {
    assemblies.get(row.assembly_id)?.instances.push({
      id: row.id,
      componentType: row.component_type,
      componentId: row.component_id,
      quantity: row.quantity,
    });
  }
  return {
    parts: new Map(
      partRows.map((row) => [
        row.id,
        {
          name: row.name,
          materialName: row.material_name,
          massG: row.mass_g,
          bodyStatus: row.body_status,
        },
      ]),
    ),
    purchased: new Map(
      purchasedRows.map((row) => [row.id, { name: row.name, massG: row.declared_mass_g }]),
    ),
    assemblies,
  };
}

export function componentName(catalogue: Catalogue, type: ComponentType, id: string): string | null {
  if (type === 'part') return catalogue.parts.get(id)?.name ?? null;
  if (type === 'purchased') return catalogue.purchased.get(id)?.name ?? null;
  return catalogue.assemblies.get(id)?.name ?? null;
}

type Accumulator = Map<string, { type: 'part' | 'purchased'; id: string; quantity: number }>;

function accumulate(
  catalogue: Catalogue,
  assemblyId: string,
  multiplier: number,
  into: Accumulator,
): void {
  const assembly = catalogue.assemblies.get(assemblyId);
  if (!assembly) return;
  for (const instance of assembly.instances) {
    const scaled = multiplier * instance.quantity;
    if (instance.componentType === 'assembly') {
      accumulate(catalogue, instance.componentId, scaled, into);
      continue;
    }
    const key = `${instance.componentType}:${instance.componentId}`;
    const existing = into.get(key);
    if (existing) existing.quantity += scaled;
    else into.set(key, { type: instance.componentType, id: instance.componentId, quantity: scaled });
  }
}

/**
 * Rolls quantities up through every nesting level, one line per distinct item, with
 * purchased parts at their declared mass.
 */
export function billOfMaterials(catalogue: Catalogue, assemblyId: string): Bom {
  const accumulator: Accumulator = new Map();
  accumulate(catalogue, assemblyId, 1, accumulator);
  const lines: BomLine[] = [];
  for (const entry of accumulator.values()) {
    if (entry.type === 'part') {
      const part = catalogue.parts.get(entry.id);
      if (!part) continue;
      lines.push({
        item: { type: 'part', id: entry.id, name: part.name },
        kind: 'made',
        material: part.materialName,
        quantity: entry.quantity,
        unit_mass_g: part.massG,
        line_mass_g: part.massG === null ? null : part.massG * entry.quantity,
        body_status: part.bodyStatus,
      });
      continue;
    }
    const purchased = catalogue.purchased.get(entry.id);
    if (!purchased) continue;
    lines.push({
      item: { type: 'purchased', id: entry.id, name: purchased.name },
      kind: 'purchased',
      material: null,
      quantity: entry.quantity,
      unit_mass_g: purchased.massG,
      line_mass_g: purchased.massG * entry.quantity,
      body_status: null,
    });
  }
  lines.sort((left, right) =>
    left.item.name.toLowerCase().localeCompare(right.item.name.toLowerCase()),
  );
  return {
    assembly_id: assemblyId,
    lines,
    total_mass_g: lines.reduce((total, line) => total + (line.line_mass_g ?? 0), 0),
    part_count: lines.reduce((total, line) => total + line.quantity, 0),
    line_count: lines.length,
  };
}

function unitMass(catalogue: Catalogue, type: ComponentType, id: string): number | null {
  if (type === 'part') return catalogue.parts.get(id)?.massG ?? null;
  if (type === 'purchased') return catalogue.purchased.get(id)?.massG ?? null;
  return billOfMaterials(catalogue, id).total_mass_g;
}

function pieces(catalogue: Catalogue, type: ComponentType, id: string, quantity: number): number {
  if (type === 'assembly') return quantity * billOfMaterials(catalogue, id).part_count;
  return quantity;
}

export function assemblyTree(catalogue: Catalogue, assemblyId: string): TreeRow[] {
  const assembly = catalogue.assemblies.get(assemblyId);
  if (!assembly) return [];
  return assembly.instances.map((instance) => {
    const mass = unitMass(catalogue, instance.componentType, instance.componentId);
    const row: TreeRow = {
      instance_id: instance.id,
      component: {
        type: instance.componentType,
        id: instance.componentId,
        name: componentName(catalogue, instance.componentType, instance.componentId) ?? '',
      },
      quantity: instance.quantity,
      unit_mass_g: mass,
      subtotal_mass_g: mass === null ? null : mass * instance.quantity,
      pieces: pieces(catalogue, instance.componentType, instance.componentId, instance.quantity),
      body_status:
        instance.componentType === 'part'
          ? catalogue.parts.get(instance.componentId)?.bodyStatus ?? null
          : null,
    };
    if (instance.componentType === 'assembly') {
      row.children = assemblyTree(catalogue, instance.componentId);
    }
    return row;
  });
}

export function toAssemblyResource(catalogue: Catalogue, assemblyId: string): Assembly {
  const assembly = catalogue.assemblies.get(assemblyId) as AssemblyEntry;
  const bom = billOfMaterials(catalogue, assemblyId);
  return {
    id: assembly.id,
    name: assembly.name,
    revision: assembly.revision,
    instances: assembly.instances.map((instance) => ({
      id: instance.id,
      component: {
        type: instance.componentType,
        id: instance.componentId,
        name: componentName(catalogue, instance.componentType, instance.componentId) ?? '',
      },
      quantity: instance.quantity,
    })),
    rollup: {
      mass_g: bom.total_mass_g,
      part_count: bom.part_count,
      line_count: bom.line_count,
    },
  };
}

/** True when placing the component would make an assembly contain itself. */
export function wouldCycle(
  catalogue: Catalogue,
  assemblyId: string,
  componentType: ComponentType,
  componentId: string,
): boolean {
  if (componentType !== 'assembly') return false;
  if (componentId === assemblyId) return true;
  const seen = new Set<string>();
  const stack = [componentId];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (current === assemblyId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const instance of catalogue.assemblies.get(current)?.instances ?? []) {
      if (instance.componentType === 'assembly') stack.push(instance.componentId);
    }
  }
  return false;
}
