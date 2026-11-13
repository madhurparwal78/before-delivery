import type { Assembly, Bom, BomLine, BodyStatus, ComponentType, Instance, Rollup, TreeRow } from '../shared/api';
import type { Queryable } from './db';

interface PartEntry {
  id: string;
  name: string;
  material: string;
  massG: number | null;
  bodyStatus: BodyStatus;
}

interface PurchasedEntry {
  id: string;
  name: string;
  massG: number;
}

interface InstanceEntry {
  id: string;
  type: ComponentType;
  componentId: string;
  quantity: number;
}

interface AssemblyEntry {
  id: string;
  name: string;
  revision: number;
  instances: InstanceEntry[];
}

/** Everything an assembly figure depends on, read in one go so rollups are computed fresh on every read. */
interface Catalog {
  parts: Map<string, PartEntry>;
  purchased: Map<string, PurchasedEntry>;
  assemblies: Map<string, AssemblyEntry>;
}

interface PartDb { id: string; name: string; material: string; confirmed: { mass_g: number } | null; body_status: BodyStatus }
interface PurchasedDb { id: string; name: string; declared_mass_g: number }
interface AssemblyDb { id: string; name: string; revision: number }
interface InstanceDb { id: string; assembly_id: string; component_type: ComponentType; component_id: string; quantity: number }

export async function loadCatalog(q: Queryable): Promise<Catalog> {
  // One after another: inside a transaction q is a single connection, which must not run two queries at once.
  const parts = await q.query<PartDb>('SELECT p.id, p.name, m.name AS material, p.confirmed, p.body_status FROM parts p JOIN materials m ON m.id = p.material_id');
  const purchased = await q.query<PurchasedDb>('SELECT id, name, declared_mass_g FROM purchased_parts');
  const assemblies = await q.query<AssemblyDb>('SELECT id, name, revision FROM assemblies ORDER BY seq');
  const instances = await q.query<InstanceDb>('SELECT id, assembly_id, component_type, component_id, quantity FROM instances ORDER BY seq');
  const catalog: Catalog = {
    parts: new Map(parts.rows.map((r) => [r.id, { id: r.id, name: r.name, material: r.material, massG: r.confirmed?.mass_g ?? null, bodyStatus: r.body_status }])),
    purchased: new Map(purchased.rows.map((r) => [r.id, { id: r.id, name: r.name, massG: r.declared_mass_g }])),
    assemblies: new Map(assemblies.rows.map((r) => [r.id, { id: r.id, name: r.name, revision: r.revision, instances: [] }])),
  };
  for (const r of instances.rows) {
    catalog.assemblies.get(r.assembly_id)?.instances.push({ id: r.id, type: r.component_type, componentId: r.component_id, quantity: r.quantity });
  }
  return catalog;
}

const assemblyOf = (catalog: Catalog, id: string): AssemblyEntry => catalog.assemblies.get(id) as AssemblyEntry;

const nameOf = (catalog: Catalog, type: ComponentType, id: string): string =>
  ((type === 'part' ? catalog.parts : type === 'purchased' ? catalog.purchased : catalog.assemblies).get(id) as { name: string }).name;

/** The bill of materials rollup: each leaf item's quantity is the sum over every path of the product of instance quantities. */
function rolledUpQuantities(catalog: Catalog, assemblyId: string, factor = 1, into = new Map<string, number>()): Map<string, number> {
  for (const instance of catalog.assemblies.get(assemblyId)?.instances ?? []) {
    if (instance.type === 'assembly') {
      rolledUpQuantities(catalog, instance.componentId, factor * instance.quantity, into);
    } else {
      const key = `${instance.type}:${instance.componentId}`;
      into.set(key, (into.get(key) ?? 0) + factor * instance.quantity);
    }
  }
  return into;
}

function unitMassOf(catalog: Catalog, key: string): number | null {
  const [type, id = ''] = key.split(':');
  return type === 'part' ? (catalog.parts.get(id) as PartEntry).massG : (catalog.purchased.get(id) as PurchasedEntry).massG;
}

export function bomOf(catalog: Catalog, assemblyId: string): Bom {
  const lines: BomLine[] = [...rolledUpQuantities(catalog, assemblyId)].map(([key, quantity]) => {
    const [type, id = ''] = key.split(':');
    const unit = unitMassOf(catalog, key);
    if (type === 'part') {
      const part = catalog.parts.get(id) as PartEntry;
      return { item: { type: 'part', id, name: part.name }, kind: 'made', material: part.material, quantity, unit_mass_g: unit, line_mass_g: unit === null ? null : quantity * unit, body_status: part.bodyStatus };
    }
    const purchased = catalog.purchased.get(id) as PurchasedEntry;
    return { item: { type: 'purchased', id, name: purchased.name }, kind: 'purchased', material: null, quantity, unit_mass_g: unit, line_mass_g: unit === null ? null : quantity * unit, body_status: null };
  });
  lines.sort((a, b) => (a.item.name.toLowerCase() < b.item.name.toLowerCase() ? -1 : 1));
  return {
    assembly_id: assemblyId,
    lines,
    total_mass_g: lines.reduce((sum, l) => sum + (l.line_mass_g ?? 0), 0),
    part_count: lines.reduce((sum, l) => sum + l.quantity, 0),
    line_count: lines.length,
  };
}

const rollupOf = (catalog: Catalog, assemblyId: string): Rollup => {
  const bom = bomOf(catalog, assemblyId);
  return { mass_g: bom.total_mass_g, part_count: bom.part_count, line_count: bom.line_count };
};

export function treeOf(catalog: Catalog, assemblyId: string): TreeRow[] {
  return assemblyOf(catalog, assemblyId).instances.map((instance): TreeRow => {
    const component = { type: instance.type, id: instance.componentId, name: nameOf(catalog, instance.type, instance.componentId) };
    if (instance.type === 'assembly') {
      const rollup = rollupOf(catalog, instance.componentId);
      return {
        instance_id: instance.id,
        component,
        quantity: instance.quantity,
        unit_mass_g: rollup.mass_g,
        subtotal_mass_g: instance.quantity * rollup.mass_g,
        pieces: instance.quantity * rollup.part_count,
        body_status: null,
        children: treeOf(catalog, instance.componentId),
      };
    }
    const unit = unitMassOf(catalog, `${instance.type}:${instance.componentId}`);
    return {
      instance_id: instance.id,
      component,
      quantity: instance.quantity,
      unit_mass_g: unit,
      subtotal_mass_g: unit === null ? null : instance.quantity * unit,
      pieces: instance.quantity,
      body_status: instance.type === 'part' ? (catalog.parts.get(instance.componentId) as PartEntry).bodyStatus : null,
    };
  });
}

export function assemblyJson(catalog: Catalog, id: string): Assembly {
  const entry = assemblyOf(catalog, id);
  const instances: Instance[] = entry.instances.map((i) => ({
    id: i.id,
    component: { type: i.type, id: i.componentId, name: nameOf(catalog, i.type, i.componentId) },
    quantity: i.quantity,
  }));
  return { id, name: entry.name, revision: entry.revision, instances, rollup: rollupOf(catalog, id) };
}

/** Whether `candidate` is `assemblyId` itself or contains it at any depth; placing it there would make a cycle. */
export function wouldContainItself(catalog: Catalog, assemblyId: string, candidate: string): boolean {
  if (candidate === assemblyId) return true;
  return assemblyOf(catalog, candidate).instances.some(
    (i) => i.type === 'assembly' && wouldContainItself(catalog, assemblyId, i.componentId),
  );
}
