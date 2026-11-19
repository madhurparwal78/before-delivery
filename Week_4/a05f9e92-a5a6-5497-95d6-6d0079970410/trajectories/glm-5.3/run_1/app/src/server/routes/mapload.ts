// Loaders for the service map, shared by route modules.

import { Db } from '../db.js';
import { CiClass, RelationshipType, CiNode, Edge, MaintenanceWindow } from '../servicemap.js';

export async function loadCis(db: Db): Promise<CiNode[]> {
  const res = await db.query(`SELECT name, "class", criticality, business_critical, owner_department, status, attributes, used_by_departments, used_by_people FROM cis ORDER BY name`);
  return res.rows.map((r: Record<string, unknown>) => ({
    name: String(r.name),
    class: r.class as CiClass,
    criticality: Number(r.criticality),
    business_critical: Boolean(r.business_critical),
    owner_department: r.owner_department === null ? null : String(r.owner_department),
    status: r.status as CiNode['status'],
    attributes: (r.attributes ?? {}) as Record<string, unknown>,
    used_by_departments: (r.used_by_departments ?? []) as string[],
    used_by_people: (r.used_by_people ?? []) as string[],
  }));
}

export async function loadEdges(db: Db): Promise<Edge[]> {
  const res = await db.query(`SELECT source, type, target FROM relationships`);
  return res.rows.map((r: Record<string, unknown>) => ({
    source: String(r.source), type: r.type as RelationshipType, target: String(r.target),
  }));
}

export async function loadMaintenance(db: Db): Promise<MaintenanceWindow[]> {
  const res = await db.query(`SELECT ci, start, "end" FROM maintenance_windows`);
  return res.rows.map((r: Record<string, unknown>) => ({
    ci: String(r.ci),
    start: new Date(r.start as Date).getTime(),
    end: new Date(r.end as Date).getTime(),
  }));
}

export async function departmentMembers(db: Db): Promise<Map<string, string[]>> {
  const res = await db.query(`SELECT username, department FROM people`);
  const out = new Map<string, string[]>();
  for (const row of res.rows) {
    const dept = String(row.department ?? '');
    if (!out.has(dept)) out.set(dept, []);
    out.get(dept)!.push(String(row.username));
  }
  return out;
}
