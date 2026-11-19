// Impact names helper shared by route modules.

import { Db, clock } from '../db.js';
import { CiNode, Edge, MaintenanceWindow, computeImpact } from '../servicemap.js';
import { loadCis, loadEdges, loadMaintenance, departmentMembers } from './mapload.js';

/** The affected item names for an item as if it were down. The item's own
 *  status is treated as down regardless of its stored state. */
export async function computeImpactForNames(db: Db, name: string): Promise<{ affected: string[] }> {
  const cis = await loadCis(db);
  const edges = await loadEdges(db);
  const maintenance = await loadMaintenance(db);
  const index = cis.findIndex(c => c.name.toLowerCase() === name.toLowerCase());
  if (index < 0) return { affected: [] };
  const asDown: CiNode[] = cis.map((c, i) => i === index ? { ...c, status: 'down' } : c);
  const failed = asDown[index];
  const impact = computeImpact(failed, asDown, edges, maintenance, clock.nowMs(), await departmentMembers(db));
  return { affected: impact.affected.map(p => p.ci.name) };
}

/** The distinct affected-people total for an item as if it were down. */
export async function computePeopleTotal(db: Db, name: string): Promise<number> {
  const cis = await loadCis(db);
  const edges = await loadEdges(db);
  const maintenance = await loadMaintenance(db);
  const index = cis.findIndex(c => c.name.toLowerCase() === name.toLowerCase());
  if (index < 0) return 0;
  const asDown: CiNode[] = cis.map((c, i) => i === index ? { ...c, status: 'down' } : c);
  const impact = computeImpact(asDown[index], asDown, edges, maintenance, clock.nowMs(), await departmentMembers(db));
  return impact.people_total;
}

export type { CiNode, Edge, MaintenanceWindow };
