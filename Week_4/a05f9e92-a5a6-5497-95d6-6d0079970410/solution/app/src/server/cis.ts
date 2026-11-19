import type { Value } from "../shared/expression.js";
import type { Env } from "./env.js";
import { notFound, validation } from "./errors.js";
import { publish } from "./live.js";
import { classAttributes, classLabelOf, Graph, refuseCycle, validateRelationship, type ClassLabel, type Status } from "./map.js";
import { openProposalFor, proposeIfNeeded, type MajorView } from "./major.js";
import type { Ci } from "./world.js";

export interface CiJson {
  id: number;
  name: string;
  class: ClassLabel;
  criticality: number;
  business_critical: boolean;
  owner_department: string;
  status: string;
  effective_status: Status;
  attributes: Record<string, Value>;
  used_by: { departments: string[]; people: string[] };
}

const BASE = ["name", "class", "criticality", "business_critical", "owner_department", "status", "workspace"];

function present(value: Value | undefined): boolean {
  return value !== undefined && value !== null;
}

export async function ciList(env: Env): Promise<CiJson[]> {
  const graph = await Graph.load(env.world, env.tx);
  const statuses = graph.effectiveStatuses();
  const ids = new Map((await env.tx.query("SELECT id, name FROM cis")).map((r) => [r.name as string, r.id as number]));
  return [...env.world.cis.values()].map((ci) => ({
    id: ids.get(ci.name) ?? 0,
    name: ci.name,
    class: ci.class as ClassLabel,
    criticality: ci.criticality,
    business_critical: ci.business_critical,
    owner_department: ci.owner_department,
    status: ci.status,
    effective_status: statuses.get(ci.name) ?? "healthy",
    attributes: ci.attributes,
    used_by: ci.used_by ?? { departments: [], people: [] },
  }));
}

export async function ciByName(env: Env, name: string): Promise<CiJson> {
  const found = (await ciList(env)).find((c) => c.name === name);
  return found ?? notFound();
}

interface CiBody {
  name?: string;
  class?: string;
  criticality?: number;
  business_critical?: boolean;
  owner_department?: string;
  [attribute: string]: Value | undefined;
}

function splitBody(body: CiBody, label: ClassLabel): { attributes: Record<string, Value>; used_by: Ci["used_by"] } {
  const allowed = classAttributes(label);
  const attributes: Record<string, Value> = {};
  const errors: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (BASE.includes(key) || value === undefined) continue;
    if (!allowed.includes(key)) errors[key] = `${key} is not an attribute of ${label}.`;
    else if (key !== "used_by") attributes[key] = value;
  }
  if (label === "Cluster" && !present(attributes.required_healthy)) errors.required_healthy = "Required healthy is required for a cluster.";
  if (label === "Cluster" && present(attributes.required_healthy) && (!Number.isInteger(attributes.required_healthy) || (attributes.required_healthy as number) < 1)) errors.required_healthy = "Required healthy must be a whole number of at least 1.";
  if (Object.keys(errors).length > 0) validation(`${Object.keys(errors).length} problems to fix before saving.`, errors);
  const usedBy = body.used_by as unknown as { departments?: string[]; people?: string[] } | undefined;
  return { attributes, used_by: label === "Business service" ? { departments: usedBy?.departments ?? [], people: usedBy?.people ?? [] } : null };
}

function checkBase(env: Env, body: CiBody, creating: boolean): ClassLabel | null {
  const errors: Record<string, string> = {};
  const label = classLabelOf(body.class);
  if (creating) {
    if (typeof body.name !== "string" || body.name.trim() === "") errors.name = "Name is required.";
    if (!label) errors.class = "Choose a class.";
  }
  if (body.criticality !== undefined && ![1, 2, 3].includes(body.criticality)) errors.criticality = "Criticality must be 1, 2 or 3.";
  if (creating && body.status !== undefined && !["healthy", "degraded", "down"].includes(String(body.status))) errors.status = "Status must be down, degraded or healthy.";
  if (body.owner_department !== undefined && !env.world.departmentNames.has(body.owner_department)) errors.owner_department = `Department "${body.owner_department}" does not exist.`;
  if (typeof body.name === "string" && creating && env.world.itemName(body.name)) errors.name = "An item with this name already exists.";
  if (Object.keys(errors).length > 0) validation(`${Object.keys(errors).length} problems to fix before saving.`, errors);
  return label;
}

export async function createCi(env: Env, body: CiBody): Promise<CiJson> {
  const label = checkBase(env, body, true)!;
  const { attributes, used_by } = splitBody(body, label);
  const status = typeof body.status === "string" ? body.status : "healthy";
  await env.tx.query("INSERT INTO cis (name, class, criticality, business_critical, owner_department, status, attributes, used_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", [
    body.name,
    label,
    body.criticality ?? 2,
    body.business_critical ?? false,
    body.owner_department ?? "IT provider",
    status,
    JSON.stringify(attributes),
    used_by ? JSON.stringify(used_by) : null,
  ]);
  env.world.cis.set(body.name!, { name: body.name!, class: label, criticality: body.criticality ?? 2, business_critical: body.business_critical ?? false, owner_department: body.owner_department ?? "IT provider", status, attributes, used_by });
  env.tx.after.push(() => publish("list:ci", "changed", {}));
  return ciByName(env, body.name!);
}

export async function updateCi(env: Env, name: string, body: CiBody): Promise<CiJson> {
  const existing = env.world.cis.get(name);
  if (!existing) return notFound();
  checkBase(env, body, false);
  const label = (classLabelOf(body.class) ?? (existing.class as ClassLabel)) as ClassLabel;
  const { attributes, used_by } = splitBody({ ...existing.attributes, used_by: existing.used_by as unknown as Value, ...body, class: label }, label);
  await env.tx.query("UPDATE cis SET class = $2, criticality = $3, business_critical = $4, owner_department = $5, attributes = $6, used_by = $7 WHERE name = $1", [
    name,
    label,
    body.criticality ?? existing.criticality,
    body.business_critical ?? existing.business_critical,
    body.owner_department ?? existing.owner_department,
    JSON.stringify({ ...existing.attributes, ...attributes }),
    used_by ? JSON.stringify(used_by) : null,
  ]);
  env.tx.after.push(() => publish("list:ci", "changed", {}));
  return ciByName(env, name);
}

export async function addRelationship(env: Env, body: { source?: unknown; type?: unknown; target?: unknown }): Promise<{ source: string; type: string; target: string }> {
  const edge = validateRelationship(env.world, body.source, body.type, body.target);
  const graph = await Graph.load(env.world, env.tx);
  if (graph.edges.some((e) => e.source === edge.source && e.type === edge.type && e.target === edge.target)) validation("That relationship already exists.");
  refuseCycle(graph, edge.source, edge.type, edge.target);
  await env.tx.query("INSERT INTO relationships (source, type, target) VALUES ($1, $2, $3)", [edge.source, edge.type, edge.target]);
  env.tx.after.push(() => publish("list:ci", "changed", {}));
  return edge;
}

export async function removeRelationship(env: Env, body: { source?: unknown; type?: unknown; target?: unknown }): Promise<void> {
  const edge = validateRelationship(env.world, body.source, body.type, body.target);
  await env.tx.query("DELETE FROM relationships WHERE source = $1 AND type = $2 AND target = $3", [edge.source, edge.type, edge.target]);
  env.tx.after.push(() => publish("list:ci", "changed", {}));
}

export async function setStatus(env: Env, name: string, status: unknown): Promise<{ ci: CiJson; impact: MajorView["impact"] }> {
  if (status !== "down" && status !== "degraded" && status !== "healthy") return validation("Status must be down, degraded or healthy.", { status: "Choose a status." });
  const ci = env.world.cis.get(name);
  if (!ci) return notFound();
  await env.tx.query("UPDATE cis SET status = $2 WHERE name = $1", [name, status]);
  ci.status = status;
  const { affectedNames, ...impact } = (await Graph.load(env.world, env.tx)).impact(name);
  if (status !== "healthy") await proposeIfNeeded(env, { ...impact, affectedNames });
  env.tx.after.push(() => publish("list:ci", "changed", {}));
  return { ci: await ciByName(env, name), impact: { ...impact, proposal: await openProposalFor(env, name) } };
}

export async function scheduleMaintenance(env: Env, name: string, body: { start?: string; end?: string }): Promise<{ ci: string; start: string; end: string }> {
  if (!env.world.cis.has(name)) return notFound();
  const start = typeof body.start === "string" ? Date.parse(body.start) : NaN;
  const end = typeof body.end === "string" ? Date.parse(body.end) : NaN;
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return validation("Give a start and an end, with the end after the start.", { end: "The end must be after the start." });
  await env.tx.query("INSERT INTO maintenance (ci, start_at, end_at) VALUES ($1, $2, $3)", [name, new Date(start).toISOString(), new Date(end).toISOString()]);
  env.tx.after.push(() => publish("list:ci", "changed", {}));
  return { ci: name, start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}

export async function serviceMap(env: Env): Promise<{ nodes: unknown[]; edges: unknown[] }> {
  const graph = await Graph.load(env.world, env.tx);
  const statuses = graph.effectiveStatuses();
  return {
    nodes: graph.layout().map((n) => ({ name: n.name, class: env.world.cis.get(n.name)!.class, status: statuses.get(n.name) ?? "healthy", layer: n.layer, x: n.x, y: n.y })),
    edges: graph.edges.map((e) => ({ source: e.source, type: e.type, target: e.target })),
  };
}
