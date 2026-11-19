// Service map: classes, relationships, layout, effective status and impact.
// One place decides impact traversal and outage spread.

export type CiClass =
  | 'configuration_item' | 'business_service' | 'application' | 'server'
  | 'virtual_server' | 'cluster' | 'network_device' | 'storage';

export const CLASS_PARENT: Record<CiClass, CiClass | null> = {
  configuration_item: null,
  business_service: 'configuration_item',
  application: 'configuration_item',
  server: 'configuration_item',
  virtual_server: 'server',
  cluster: 'configuration_item',
  network_device: 'configuration_item',
  storage: 'configuration_item',
};

export const CLASS_LABEL: Record<CiClass, string> = {
  configuration_item: 'Configuration item',
  business_service: 'Business service',
  application: 'Application',
  server: 'Server',
  virtual_server: 'Virtual server',
  cluster: 'Cluster',
  network_device: 'Network device',
  storage: 'Storage',
};

export const CLASS_ATTRIBUTES: Record<CiClass, string[]> = {
  configuration_item: ['name', 'criticality', 'business_critical', 'owner_department', 'status'],
  business_service: ['used_by'],
  application: ['version'],
  server: ['operating_system', 'location'],
  virtual_server: ['host_name'],
  cluster: ['required_healthy'],
  network_device: ['location'],
  storage: ['capacity_gb'],
};

/** Attributes a class has, including inherited ones. */
export function attributesFor(cls: CiClass): string[] {
  const out = new Set<string>();
  let cur: CiClass | null = cls;
  while (cur) {
    for (const a of CLASS_ATTRIBUTES[cur]) out.add(a);
    cur = CLASS_PARENT[cur];
  }
  return [...out];
}

export const RELATIONSHIP_TYPES = ['depends on', 'runs on', 'hosted by', 'member of', 'connects to', 'backs up'] as const;
export type RelationshipType = typeof RELATIONSHIP_TYPES[number];

/** The dependency relationships: only these affect status. */
export const DEPENDENCY_TYPES: RelationshipType[] = ['depends on', 'runs on', 'hosted by'];

export interface CiNode {
  name: string;
  class: CiClass;
  criticality: number;
  business_critical: boolean;
  owner_department: string | null;
  status: 'healthy' | 'degraded' | 'down';
  attributes: Record<string, unknown>;
  used_by_departments: string[];
  used_by_people: string[];
}

export interface Edge { source: string; type: RelationshipType; target: string }

export interface MaintenanceWindow { ci: string; start: number; end: number }

/** Layout: dependency relationships plus cluster-to-member edges.
 *  Layer 0 items have no outgoing layout edge; others are 1 + max target layer. */
export function computeLayout(cis: CiNode[], edges: Edge[]): { nodes: Array<{ name: string; layer: number; x: number; y: number }>; rows: string[][] } {
  const byName = new Map(cis.map(c => [c.name.toLowerCase(), c]));
  const outgoing = new Map<string, string[]>();
  for (const e of edges) {
    const isDependency = DEPENDENCY_TYPES.includes(e.type);
    const isMember = e.type === 'member of';
    if (!isDependency && !isMember) continue;
    // "X member of Y" draws an edge from the cluster Y to the member X.
    const from = isMember ? e.target : e.source;
    const to = isMember ? e.source : e.target;
    if (!byName.has(from.toLowerCase()) || !byName.has(to.toLowerCase())) continue;
    if (!outgoing.has(from)) outgoing.set(from, []);
    outgoing.get(from)!.push(to);
  }

  const layers = new Map<string, number>();
  const resolve = (name: string, seen: Set<string>): number => {
    const key = name.toLowerCase();
    if (layers.has(key)) return layers.get(key)!;
    if (seen.has(key)) return 0;
    seen.add(key);
    const targets = outgoing.get(name) ?? [];
    let layer = 0;
    for (const t of targets) layer = Math.max(layer, 1 + resolve(t, new Set(seen)));
    layers.set(key, layer);
    return layer;
  };
  for (const ci of cis) resolve(ci.name, new Set());

  const maxLayer = Math.max(...[...layers.values()]);
  const rows: string[][] = [];
  for (let l = maxLayer; l >= 0; l--) {
    const members = cis.filter(c => layers.get(c.name.toLowerCase()) === l);
    members.sort((a, b) => (a.criticality - b.criticality) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    rows.push(members.map(m => m.name));
  }

  const nodes: Array<{ name: string; layer: number; x: number; y: number }> = [];
  rows.forEach((row, rowIndex) => {
    row.forEach((name, pos) => {
      const layer = layers.get(name.toLowerCase()) ?? 0;
      nodes.push({ name, layer, x: 40 + 200 * pos, y: 40 + 120 * (maxLayer - layer) });
    });
    void rowIndex;
  });
  return { nodes, rows };
}

/** Effective status: worst of own and inherited, with cluster member rules
 *  and maintenance windows holding the spread. */
export function effectiveStatuses(cis: CiNode[], edges: Edge[], maintenance: MaintenanceWindow[], now: number): Map<string, 'healthy' | 'degraded' | 'down' | 'maintenance'> {
  const byName = new Map(cis.map(c => [c.name.toLowerCase(), c]));

  // Dependency edges point from dependent to target; dependents of X are those
  // whose source is X? No: "X depends on Y" means X needs Y, so Y's dependents
  // are the sources of edges whose target is Y.
  const dependentsOf = new Map<string, string[]>();
  const targetsOf = new Map<string, string[]>();
  for (const e of edges) {
    const from = e.source.toLowerCase();
    const to = e.target.toLowerCase();
    if (!DEPENDENCY_TYPES.includes(e.type)) continue;
    if (!dependentsOf.has(to)) dependentsOf.set(to, []);
    dependentsOf.get(to)!.push(e.source);
    if (!targetsOf.has(from)) targetsOf.set(from, []);
    targetsOf.get(from)!.push(e.target);
  }

  // Cluster membership: a cluster's members are the sources of "member of".
  const membersOf = new Map<string, string[]>();
  const clusterOf = new Map<string, string>();
  for (const e of edges) {
    if (e.type !== 'member of') continue;
    if (!membersOf.has(e.target.toLowerCase())) membersOf.set(e.target.toLowerCase(), []);
    membersOf.get(e.target.toLowerCase())!.push(e.source);
    clusterOf.set(e.source.toLowerCase(), e.target);
  }

  const inMaintenance = (name: string): boolean =>
    maintenance.some(w => w.ci.toLowerCase() === name.toLowerCase() && now >= w.start && now < w.end);

  const memo = new Map<string, 'healthy' | 'degraded' | 'down'>();

  const worst = (a: string, b: string): string => {
    const order = ['down', 'degraded', 'healthy'];
    return order.indexOf(a) <= order.indexOf(b) ? a : b;
  };

  const compute = (name: string, seen: Set<string>): 'healthy' | 'degraded' | 'down' => {
    const key = name.toLowerCase();
    if (memo.has(key)) return memo.get(key)!;
    if (seen.has(key)) return 'healthy';
    seen.add(key);
    const node = byName.get(key);
    if (!node) return 'healthy';

    let status = node.status as 'healthy' | 'degraded' | 'down';

    // Cluster member rule.
    const members = membersOf.get(key);
    if (members && members.length) {
      const required = Number(node.attributes.required_healthy ?? 1);
      const healthy = members.filter(m => compute(m, new Set(seen)) === 'healthy').length;
      const clusterStatus = healthy === members.length ? 'healthy' : (healthy >= required && healthy < members.length) ? 'degraded' : 'down';
      status = worst(status, clusterStatus) as 'healthy' | 'degraded' | 'down';
    }

    // Inherited from dependency targets, but a target in maintenance counts healthy.
    for (const target of targetsOf.get(key) ?? []) {
      let t: 'healthy' | 'degraded' | 'down';
      if (inMaintenance(target)) t = 'healthy';
      else t = compute(target, new Set(seen));
      status = worst(status, t) as 'healthy' | 'degraded' | 'down';
    }

    memo.set(key, status);
    return status;
  };

  const out = new Map<string, 'healthy' | 'degraded' | 'down' | 'maintenance'>();
  for (const ci of cis) {
    const status = compute(ci.name, new Set());
    out.set(ci.name, inMaintenance(ci.name) ? 'maintenance' : status);
  }
  return out;
}

export interface ImpactPanel {
  ci: CiNode;
  path: string[];
  tier: 1 | 2 | 3;
  people_added: number;
  running_people: number;
}

export interface ImpactResult {
  ci: string;
  status: 'healthy' | 'degraded' | 'down';
  base_people: number;
  affected: ImpactPanel[];
  degraded: Array<{ ci: string; path: string[] }>;
  people_total: number;
  business_critical_affected: number;
}

/** People of a business service: members of its used_by departments plus its
 *  used_by people. People affected is the distinct set across the failed item
 *  and every affected business service. */
export function peopleOfService(ci: CiNode, departmentMembers: Map<string, string[]>): string[] {
  const out = new Set<string>(ci.used_by_people);
  for (const dep of ci.used_by_departments) {
    for (const member of departmentMembers.get(dep) ?? []) out.add(member);
  }
  return [...out];
}

/** Impact traversal: depth-first preorder from the failed item along dependents. */
export function computeImpact(failed: CiNode, cis: CiNode[], edges: Edge[], maintenance: MaintenanceWindow[], now: number, departmentMembers: Map<string, string[]>): ImpactResult {
  const statuses = effectiveStatuses(cis, edges, maintenance, now);
  const byName = new Map(cis.map(c => [c.name.toLowerCase(), c]));

  // Dependents: items that depend on, run on, are hosted by, or have as a
  // member the current item. A cluster's members count as its dependents for
  // this walk.
  const dependentsOf = new Map<string, Array<{ name: string; rel: string }>>();
  for (const e of edges) {
    const push = (target: string, name: string, rel: string): void => {
      const key = target.toLowerCase();
      if (!dependentsOf.has(key)) dependentsOf.set(key, []);
      dependentsOf.get(key)!.push({ name, rel });
    };
    if (DEPENDENCY_TYPES.includes(e.type)) push(e.target, e.source, e.type);
    if (e.type === 'member of') push(e.target, e.source, e.type);
  }
  // Sort dependents by criticality descending (1 is highest), then name
  // case-insensitively, so the preorder walk matches the published order.
  for (const list of dependentsOf.values()) {
    list.sort((a, b) => {
      const ca = byName.get(a.name.toLowerCase())?.criticality ?? 3;
      const cb = byName.get(b.name.toLowerCase())?.criticality ?? 3;
      if (ca !== cb) return cb - ca;
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });
  }

  const affected: ImpactPanel[] = [];
  const degradedList: Array<{ ci: string; path: string[] }> = [];
  const visited = new Set<string>([failed.name.toLowerCase()]);

  const walk = (name: string, path: string[]): void => {
    for (const dep of dependentsOf.get(name.toLowerCase()) ?? []) {
      const key = dep.name.toLowerCase();
      if (visited.has(key)) continue;
      visited.add(key);
      if (inMaintenanceNow(dep.name, maintenance, now)) continue;
      const status = statuses.get(dep.name) ?? 'healthy';
      const nextPath = [dep.rel, ...path];
      if (status === 'down') {
        const node = byName.get(key)!;
        affected.push({ ci: node, path: nextPath, tier: tierOf(node), people_added: 0, running_people: 0 });
        walk(dep.name, nextPath);
      } else if (status === 'degraded') {
        const node = byName.get(key)!;
        degradedList.push({ ci: node.name, path: nextPath });
        walk(dep.name, nextPath);
      } else {
        // Healthy dependents stop the spread; their own dependents are checked
        // only through them, and nothing spreads past a healthy item.
      }
    }
  };
  walk(failed.name, []);

  const basePeople = failed.class === 'business_service' ? peopleOfService(failed, departmentMembers) : [];

  let running = new Set(basePeople);
  for (const panel of affected) {
    if (panel.ci.class === 'business_service') {
      const people = peopleOfService(panel.ci, departmentMembers);
      const before = running.size;
      for (const p of people) running.add(p);
      panel.people_added = running.size - before;
      panel.running_people = running.size;
    } else {
      panel.people_added = 0;
      panel.running_people = running.size;
    }
  }

  const businessCriticalAffected = affected.filter(p => p.ci.business_critical).length;
  const peopleTotal = running.size;

  return {
    ci: failed.name,
    status: failed.status,
    base_people: basePeople.length,
    affected,
    degraded: degradedList,
    people_total: peopleTotal,
    business_critical_affected: businessCriticalAffected,
  };
}

function tierOf(ci: CiNode): 1 | 2 | 3 {
  if (ci.business_critical) return 1;
  if (ci.criticality === 3) return 2;
  return 3;
}

function inMaintenanceNow(name: string, maintenance: MaintenanceWindow[], now: number): boolean {
  return maintenance.some(w => w.ci.toLowerCase() === name.toLowerCase() && now >= w.start && now < w.end);
}

/** Would adding source->target close a dependency loop? Returns the loop. */
export function findCycle(source: string, target: string, edges: Edge[]): string[] | null {
  const graph = new Map<string, string[]>();
  for (const e of edges) {
    if (!DEPENDENCY_TYPES.includes(e.type)) continue;
    if (!graph.has(e.source)) graph.set(e.source, []);
    graph.get(e.source)!.push(e.target);
  }
  // Walk from target back to source.
  const path: string[] = [];
  const seen = new Set<string>();
  const walk = (node: string): boolean => {
    if (node.toLowerCase() === source.toLowerCase()) {
      path.unshift(node);
      return true;
    }
    if (seen.has(node)) return false;
    seen.add(node);
    for (const next of graph.get(node) ?? []) {
      if (walk(next)) {
        path.unshift(node);
        return true;
      }
    }
    return false;
  };
  if (walk(target)) {
    return [source, ...path];
  }
  return null;
}
