import { holds, type Value } from "../shared/expression.js";
import { fieldSpec, PRIORITY_LABELS, SCALE_LABELS, stateLabel } from "../shared/fields.js";
import { composeFilter, FilterError, filterNode, parseFilter, type Builder } from "../shared/filtertext.js";
import { TABLES, type Table } from "../shared/types.js";
import { now } from "./clock.js";
import type { Access } from "./access.js";
import type { Env } from "./env.js";
import { settings } from "./config.js";
import { fail } from "./errors.js";
import { summarize, type SummaryJson } from "./records.js";
import { addDays, isoWithOffset, localParts, wallToInstant } from "../shared/tz.js";
import { recordScope, toRecord, type Fields, type RecordObj } from "./world.js";

interface ListParams {
  filter?: string;
  q?: string;
  sort?: string;
  dir?: string;
  page?: number;
  group_by?: string;
  columns?: string;
}

export interface GroupJson {
  value: Value;
  label: string;
  count: number;
  filter: string;
}

export interface ListJson {
  records: SummaryJson[];
  total: number;
  page: number;
  page_size: number;
  groups?: GroupJson[];
}

export function unknownField(path: string): never {
  return fail(422, "unknown_field", `Unknown field "${path}".`);
}

/** Refuses a field path that does not exist or that the viewer can never read. */
function assertReadablePath(table: Table, path: string, access: Access): void {
  const parts = path.split(".");
  const spec = fieldSpec(table, parts[0]!);
  if (!spec || !access.readableForTable(table, parts[0]!) || (parts.length > 1 && !spec.reference)) unknownField(path);
}

interface Visible {
  rec: RecordObj;
  fields: Fields;
}

/** Records the viewer may see, each with the fields they may not read removed. */
async function visibleRecords(env: Env, table: Table): Promise<Visible[]> {
  const access = await env.access();
  const rows = await env.tx.query("SELECT * FROM records WHERE table_name = $1 ORDER BY number", [table]);
  const out: Visible[] = [];
  for (const row of rows) {
    const rec = toRecord(row);
    if (!access.canRead(rec)) continue;
    const readable = access.readable(rec);
    const fields: Fields = {};
    for (const [name, value] of Object.entries(rec.fields)) if (readable.has(name)) fields[name] = value;
    out.push({ rec, fields });
  }
  return out;
}

export function parseBuilder(table: Table, text: string, access: Access): Builder {
  try {
    const builder = parseFilter(text);
    for (const group of builder.groups) for (const c of group.conditions) assertReadablePath(table, c.path, access);
    return builder;
  } catch (error) {
    if (error instanceof FilterError) {
      if (error.code === "filter_too_complex") return fail(422, "filter_too_complex", error.message);
      return fail(422, "expression_error", error.message);
    }
    throw error;
  }
}

function scopeFor(env: Env, table: Table, visible: Visible): ReturnType<typeof recordScope> {
  return recordScope(env.world, { table, number: visible.rec.number, fields: visible.fields }, env.actorRef);
}

function groupValue(env: Env, table: Table, visible: Visible, path: string): Value {
  return scopeFor(env, table, visible).path(path.split("."));
}

function labelFor(env: Env, table: Table, path: string, value: Value): string {
  if (value === null || value === "") return "(empty)";
  const root = path.split(".")[0]!;
  if (path === "priority") return `${value} ${PRIORITY_LABELS[Number(value)] ?? ""}`.trim();
  if (path === "impact" || path === "urgency") return `${value} ${SCALE_LABELS[Number(value)] ?? ""}`.trim();
  if (path === "state") return stateLabel(table, String(value));
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (fieldSpec(table, root)?.reference === "user" && !path.includes(".")) return env.world.displayName(String(value));
  return String(value);
}

function compareValues(a: Value, b: Value): number {
  if (a === null || a === "") return b === null || b === "" ? 0 : 1;
  if (b === null || b === "") return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

function groupFilter(path: string, value: Value): string {
  const builder: Builder = {
    connector: "and",
    groups: [{ connector: "and", conditions: [value === null || value === "" ? { path, op: "is_empty", value: null } : { path, op: "=", value }] }],
  };
  return composeFilter(builder);
}

export async function matching(env: Env, table: Table, params: ListParams): Promise<{ visible: Visible[]; builder: Builder }> {
  const access = await env.access();
  const builder = params.filter ? parseBuilder(table, params.filter, access) : { connector: "and" as const, groups: [] };
  const node = filterNode(builder);
  const needsWorld = params.filter ? builder.groups.some((g) => g.conditions.some((c) => c.path.includes("."))) : false;
  if (needsWorld) await env.world.loadRecords(env.tx);
  let visible = await visibleRecords(env, table);
  if (node) visible = visible.filter((v) => holds(node, scopeFor(env, table, v)));
  const q = params.q?.trim().toLowerCase();
  if (q) {
    visible = visible.filter((v) => [v.rec.number, v.fields.short_description, v.fields.title, v.fields.description].some((text) => typeof text === "string" && text.toLowerCase().includes(q)));
  }
  if (params.sort) assertReadablePath(table, params.sort, access);
  const sort = params.sort ?? "number";
  const direction = params.dir === "desc" ? -1 : 1;
  visible.sort((a, b) => direction * compareValues(groupValue(env, table, a, sort), groupValue(env, table, b, sort)) || (a.rec.number < b.rec.number ? -1 : 1));
  return { visible, builder };
}

export async function listRecords(env: Env, table: Table, params: ListParams): Promise<ListJson> {
  const access = await env.access();
  const { visible } = await matching(env, table, params);
  const size = settings.LIST_PAGE_SIZE;
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const columns = params.columns ? params.columns.split(",").map((c) => c.trim()).filter((c) => c !== "") : undefined;
  const shown = columns?.filter((c) => fieldSpec(table, c) !== undefined && access.readableForTable(table, c));
  const slice = visible.slice((page - 1) * size, page * size).map((v) => ({ ...v.rec, fields: v.fields }));
  const result: ListJson = { records: await summarize(env, slice, shown), total: visible.length, page, page_size: size };
  if (params.group_by) {
    assertReadablePath(table, params.group_by, access);
    const counts = new Map<string, { value: Value; count: number }>();
    for (const v of visible) {
      const value = groupValue(env, table, v, params.group_by);
      const key = JSON.stringify(value ?? null);
      counts.set(key, { value: value ?? null, count: (counts.get(key)?.count ?? 0) + 1 });
    }
    result.groups = [...counts.values()]
      .sort((a, b) => compareValues(a.value, b.value))
      .map((g) => ({ value: g.value, label: labelFor(env, table, params.group_by!, g.value), count: g.count, filter: groupFilter(params.group_by!, g.value) }));
  }
  return result;
}

export async function searchRecords(env: Env, q: string): Promise<SummaryJson[]> {
  const found: RecordObj[] = [];
  for (const table of TABLES) {
    const { visible } = await matching(env, table, { q });
    found.push(...visible.map((v) => ({ ...v.rec, fields: v.fields })));
  }
  found.sort((a, b) => (a.number < b.number ? -1 : a.number > b.number ? 1 : 0));
  return summarize(env, found.slice(0, 20));
}

interface AggregateJson {
  groups: GroupJson[];
  total: number;
}

interface BucketSpec {
  bucket: "day" | "week";
  dateField: string;
  zone: string;
}

/** Fourteen buckets ending with the one that holds the server clock, in the given zone; each bucket's filter carries offsets. */
function buckets(spec: BucketSpec): Array<{ key: string; start: number; end: number; filter: string }> {
  const today = localParts(now(), spec.zone);
  const step = spec.bucket === "week" ? 7 : 1;
  const mondayShift = spec.bucket === "week" ? today.weekday : 0;
  const out: Array<{ key: string; start: number; end: number; filter: string }> = [];
  for (let i = 13; i >= 0; i--) {
    const first = addDays(today.year, today.month, today.day, -mondayShift - i * step);
    const last = addDays(first.year, first.month, first.day, step);
    const start = wallToInstant(first.year, first.month, first.day, 0, 0, spec.zone);
    const end = wallToInstant(last.year, last.month, last.day, 0, 0, spec.zone);
    const builder: Builder = {
      connector: "and",
      groups: [
        { connector: "and", conditions: [{ path: spec.dateField, op: ">=", value: isoWithOffset(start, spec.zone) }] },
        { connector: "and", conditions: [{ path: spec.dateField, op: "<", value: isoWithOffset(end, spec.zone) }] },
      ],
    };
    out.push({ key: `${first.year}-${String(first.month).padStart(2, "0")}-${String(first.day).padStart(2, "0")}`, start, end, filter: composeFilter(builder) });
  }
  return out;
}

export async function aggregate(env: Env, body: { table: Table; filter?: string; group_by?: string | null; bucket?: "day" | "week" | null; date_field?: string | null; time_zone?: string | null }): Promise<AggregateJson> {
  const access = await env.access();
  const { visible } = await matching(env, body.table, { filter: body.filter ?? "" });
  if (body.bucket) {
    const field = body.date_field ?? "created_at";
    assertReadablePath(body.table, field, access);
    const list = buckets({ bucket: body.bucket, dateField: field, zone: body.time_zone ?? env.user.time_zone });
    const groups = list.map((b) => ({
      key: b.key,
      label: b.key,
      count: visible.filter((v) => typeof v.fields[field] === "string" && Date.parse(v.fields[field] as string) >= b.start && Date.parse(v.fields[field] as string) < b.end).length,
      filter: b.filter,
    }));
    return { groups: groups as unknown as GroupJson[], total: groups.reduce((s, g) => s + g.count, 0) };
  }
  if (body.group_by) {
    assertReadablePath(body.table, body.group_by, access);
    const counts = new Map<string, { value: Value; count: number }>();
    for (const v of visible) {
      const value = groupValue(env, body.table, v, body.group_by);
      const key = JSON.stringify(value ?? null);
      counts.set(key, { value: value ?? null, count: (counts.get(key)?.count ?? 0) + 1 });
    }
    const groups = [...counts.values()].sort((a, b) => compareValues(a.value, b.value)).map((g) => ({ key: g.value as Value, label: labelFor(env, body.table, body.group_by!, g.value), count: g.count, filter: groupFilter(body.group_by!, g.value) }));
    return { groups: groups as unknown as GroupJson[], total: visible.length };
  }
  return { groups: [], total: visible.length };
}
