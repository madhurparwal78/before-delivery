import { now } from "./clock.js";
import { query, type Tx } from "./db.js";
import { fail, validation } from "./errors.js";
import type { Ci, World } from "./world.js";

export const CLASS_LABELS = ["Configuration item", "Business service", "Application", "Server", "Virtual server", "Cluster", "Network device", "Storage"] as const;
export type ClassLabel = (typeof CLASS_LABELS)[number];

const CLASS_TREE: Record<ClassLabel, { parent: ClassLabel | null; own: string[] }> = {
  "Configuration item": { parent: null, own: ["name", "criticality", "business_critical", "owner_department", "status"] },
  "Business service": { parent: "Configuration item", own: ["used_by"] },
  Application: { parent: "Configuration item", own: ["version"] },
  Server: { parent: "Configuration item", own: ["operating_system", "location"] },
  "Virtual server": { parent: "Server", own: ["host_name"] },
  Cluster: { parent: "Configuration item", own: ["required_healthy"] },
  "Network device": { parent: "Configuration item", own: ["location"] },
  Storage: { parent: "Configuration item", own: ["capacity_gb"] },
};

export function classAttributes(label: ClassLabel): string[] {
  const out: string[] = [];
  for (let c: ClassLabel | null = label; c; c = CLASS_TREE[c].parent) out.unshift(...CLASS_TREE[c].own);
  return out;
}

export function classLabelOf(raw: unknown): ClassLabel | null {
  if (typeof raw !== "string") return null;
  return CLASS_LABELS.find((label) => label === raw || label.toLowerCase().replace(/ /g, "_") === raw) ?? null;
}

const RELATIONSHIP_TYPES = ["depends on", "runs on", "hosted by", "member of", "connects to", "backs up"] as const;
const DEPENDENCY_TYPES = ["depends on", "runs on", "hosted by"];

export type Status = "healthy" | "degraded" | "down" | "maintenance";
interface Edge {
  source: string;
  type: string;
  target: string;
}

export interface AffectedItem {
  ci: { name: string; class: string; criticality: number; business_critical: boolean };
  path: string[];
  tier: 1 | 2 | 3;
  people_added: number;
  running_people: number;
}

export interface Impact {
  ci: string;
  status: string;
  base_people: number;
  affected: AffectedItem[];
  degraded: { ci: string; path: string[] }[];
  people_total: number;
  business_critical_affected: number;
  affectedNames: string[];
}

const RANK: Record<string, number> = { healthy: 0, maintenance: 0, degraded: 1, down: 2 };
const worst = (a: string, b: string): string => ((RANK[a] ?? 0) >= (RANK[b] ?? 0) ? a : b);

/** The service map: items, typed relationships and maintenance windows at one instant. */
export class Graph {
  readonly edges: Edge[] = [];
  private readonly maintenance = new Set<string>();

  constructor(
    readonly cis: Map<string, Ci>,
    edges: Edge[],
    windows: Array<{ ci: string; start: number; end: number }>,
    readonly world: World,
    at: number,
  ) {
    this.edges = edges;
    for (const w of windows) if (w.start <= at && at < w.end) this.maintenance.add(w.ci);
  }

  static async load(world: World, tx?: Tx, at: number = now()): Promise<Graph> {
    const run = tx ? tx.query.bind(tx) : query;
    const edges = await run("SELECT source, type, target FROM relationships");
    const windows = await run("SELECT ci, start_at, end_at FROM maintenance");
    return new Graph(
      world.cis,
      edges.map((e) => ({ source: e.source as string, type: e.type as string, target: e.target as string })),
      windows.map((w) => ({ ci: w.ci as string, start: Date.parse(w.start_at as string), end: Date.parse(w.end_at as string) })),
      world,
      at,
    );
  }

  inMaintenance(name: string): boolean {
    return this.maintenance.has(name);
  }

  private dependencies(name: string): string[] {
    return this.edges.filter((e) => e.source === name && DEPENDENCY_TYPES.includes(e.type)).map((e) => e.target);
  }

  /** Items that need the given item: depend on it, run on it, are hosted by it, or (a cluster) have it as a member. */
  dependents(name: string): { name: string; type: string }[] {
    const direct = this.edges.filter((e) => e.target === name && DEPENDENCY_TYPES.includes(e.type)).map((e) => ({ name: e.source, type: e.type }));
    const clusters = this.edges.filter((e) => e.type === "member of" && e.source === name).map((e) => ({ name: e.target, type: "member of" }));
    return [...direct, ...clusters].sort((a, b) => {
      const ca = this.cis.get(a.name)?.criticality ?? 0;
      const cb = this.cis.get(b.name)?.criticality ?? 0;
      return cb - ca || (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0);
    });
  }

  /** Effective status of every item; `declared` may override an item's own status. */
  effectiveStatuses(declared: Map<string, string> = new Map()): Map<string, Status> {
    const memo = new Map<string, Status>();
    const visiting = new Set<string>();
    const resolve = (name: string): Status => {
      const known = memo.get(name);
      if (known) return known;
      if (visiting.has(name)) return "healthy";
      visiting.add(name);
      const ci = this.cis.get(name);
      let result: Status;
      if (this.maintenance.has(name)) result = "maintenance";
      else {
        let status = declared.get(name) ?? ci?.status ?? "healthy";
        for (const dependency of this.dependencies(name)) {
          const inherited = resolve(dependency);
          status = worst(status, inherited === "maintenance" ? "healthy" : inherited);
        }
        if (ci?.class === "Cluster") {
          const members = this.edges.filter((e) => e.type === "member of" && e.target === name).map((e) => e.source);
          const needed = Number(ci.attributes.required_healthy ?? 1);
          const healthy = members.filter((m) => {
            const s = resolve(m);
            return s === "healthy" || s === "maintenance";
          }).length;
          if (members.length > 0 && healthy < members.length) status = worst(status, healthy >= needed ? "degraded" : "down");
        }
        result = status as Status;
      }
      visiting.delete(name);
      memo.set(name, result);
      return result;
    };
    for (const name of this.cis.keys()) resolve(name);
    return memo;
  }

  peopleOf(name: string): string[] {
    const ci = this.cis.get(name);
    if (!ci || ci.class !== "Business service" || !ci.used_by) return [];
    const fromDepartments = ci.used_by.departments.flatMap((d) => this.world.departmentMembers(d));
    return [...new Set([...fromDepartments, ...ci.used_by.people])];
  }

  /** Depth-first, preorder walk of everything an item's failure takes down or degrades. */
  impact(failed: string, asStatus?: "down" | "degraded"): Impact {
    const current = this.effectiveStatuses(asStatus ? new Map([[failed, asStatus]]) : new Map());
    const baseline = this.effectiveStatuses(new Map([[failed, "healthy"]]));
    const affected: AffectedItem[] = [];
    const degraded: { ci: string; path: string[] }[] = [];
    const seen = new Set<string>([failed]);
    const people = new Set<string>(this.peopleOf(failed));
    const basePeople = people.size;
    const changed = (name: string): "down" | "degraded" | null => {
      const now = current.get(name);
      const before = baseline.get(name);
      if (now === "down" && before !== "down") return "down";
      if (now === "degraded" && before !== "degraded" && before !== "down") return "degraded";
      return null;
    };
    const walk = (name: string, path: string[]): void => {
      for (const dependent of this.dependents(name)) {
        if (seen.has(dependent.name)) continue;
        const effect = changed(dependent.name);
        if (!effect) continue;
        seen.add(dependent.name);
        const here = [dependent.type, ...path];
        const ci = this.cis.get(dependent.name)!;
        if (effect === "down") {
          const before = people.size;
          for (const person of this.peopleOf(dependent.name)) people.add(person);
          affected.push({
            ci: { name: ci.name, class: ci.class, criticality: ci.criticality, business_critical: ci.business_critical },
            path: here,
            tier: ci.business_critical ? 1 : ci.criticality === 3 ? 2 : 3,
            people_added: people.size - before,
            running_people: people.size,
          });
        } else degraded.push({ ci: dependent.name, path: here });
        walk(dependent.name, here);
      }
    };
    walk(failed, []);
    const criticalServices = affected.filter((a) => a.ci.class === "Business service" && a.ci.business_critical).length;
    return {
      ci: failed,
      status: current.get(failed) ?? "healthy",
      base_people: basePeople,
      affected,
      degraded,
      people_total: people.size,
      business_critical_affected: criticalServices,
      affectedNames: affected.map((a) => a.ci.name),
    };
  }

  /** Layered coordinates: layer 0 has no outgoing layout edge; rows run from the highest layer down. */
  layout(): Array<{ name: string; layer: number; x: number; y: number }> {
    const out = new Map<string, string[]>();
    for (const name of this.cis.keys()) out.set(name, []);
    for (const e of this.edges) {
      if (DEPENDENCY_TYPES.includes(e.type)) out.get(e.source)?.push(e.target);
      else if (e.type === "member of") out.get(e.target)?.push(e.source);
    }
    const layers = new Map<string, number>();
    const layerOf = (name: string): number => {
      const known = layers.get(name);
      if (known !== undefined) return known;
      layers.set(name, 0);
      const targets = out.get(name) ?? [];
      const value = targets.length === 0 ? 0 : 1 + Math.max(...targets.map(layerOf));
      layers.set(name, value);
      return value;
    };
    for (const name of out.keys()) layerOf(name);
    const top = Math.max(0, ...layers.values());
    const placed: Array<{ name: string; layer: number; x: number; y: number }> = [];
    for (let layer = top; layer >= 0; layer--) {
      const row = [...layers.entries()]
        .filter(([, l]) => l === layer)
        .map(([name]) => name)
        .sort((a, b) => (this.cis.get(b)!.criticality - this.cis.get(a)!.criticality) || (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0));
      row.forEach((name, position) => placed.push({ name, layer, x: 40 + 200 * position, y: 40 + 120 * (top - layer) }));
    }
    return placed;
  }

  /** The chain of existing dependency relationships from one item to another, if any. */
  dependencyChain(from: string, to: string): string[] | null {
    const visit = (name: string, trail: string[]): string[] | null => {
      if (name === to) return trail;
      for (const e of this.edges) {
        if (e.source === name && DEPENDENCY_TYPES.includes(e.type) && !trail.includes(e.target)) {
          const found = visit(e.target, [...trail, e.target]);
          if (found) return found;
        }
      }
      return null;
    };
    return visit(from, [from]);
  }

  /** Every item the given item depends on, transitively. */
  dependsOnClosure(name: string): Set<string> {
    const found = new Set<string>();
    const visit = (current: string): void => {
      for (const e of this.edges) {
        if (e.source === current && DEPENDENCY_TYPES.includes(e.type) && !found.has(e.target)) {
          found.add(e.target);
          visit(e.target);
        }
      }
    };
    visit(name);
    return found;
  }
}

export function refuseCycle(graph: Graph, source: string, type: string, target: string): void {
  if (!DEPENDENCY_TYPES.includes(type)) return;
  const chain = graph.dependencyChain(target, source);
  if (chain) fail(422, "cycle", `This relationship would form a dependency loop: ${source} -> ${chain.join(" -> ")}.`);
}

export function validateRelationship(world: World, source: unknown, type: unknown, target: unknown): { source: string; type: string; target: string } {
  if (typeof source !== "string" || !world.cis.has(source)) validation(`Unknown item "${String(source)}".`, { source: "Choose an existing item." });
  if (typeof target !== "string" || !world.cis.has(target)) validation(`Unknown item "${String(target)}".`, { target: "Choose an existing item." });
  if (typeof type !== "string" || !(RELATIONSHIP_TYPES as readonly string[]).includes(type)) validation(`Relationship type must be one of ${RELATIONSHIP_TYPES.join(", ")}.`, { type: "Choose a listed type." });
  if (source === target) validation("An item cannot relate to itself.");
  return { source: source as string, type: type as string, target: target as string };
}
