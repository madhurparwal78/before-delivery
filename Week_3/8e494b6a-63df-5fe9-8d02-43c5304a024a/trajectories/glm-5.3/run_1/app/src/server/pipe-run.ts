/**
 * Spoor Pipe execution (rule I).
 */
import type { PoolClient } from "pg";
import type { Pipe } from "../shared/pipe";
import type { FieldType, FlattenedEvent } from "../shared/types";
import { analyze } from "../shared/analyze";
import { flatten, fmtFixed, valuesOf } from "../shared/util";
import { errors } from "./errors";
import { listGenerations, requireStream } from "./events";
import { runSearch, type SearchParams, type LoadedEvent } from "./search";
import { parseQuery, collectLeaves, QueryError } from "../shared/query";
import type { Ctx } from "./context";

interface Row {
  values: Record<string, unknown>;
  types: Map<string, FieldType | "number">;
}

/** Run a parsed pipe over a stream. */
export async function runPipe(db: PoolClient, ctx: Ctx, pipe: Pipe): Promise<{ columns: { name: string; type: string }[]; rows: unknown[][] }> {
  const stream = await requireStream(db, ctx.spaceId, pipe.from.stream);
  const gens = await listGenerations(db, stream.id);
  const mapping = new Map<string, FieldType>();
  for (const g of gens) {
    const res = await db.query<{ field: string; type: FieldType }>(
      "SELECT field, type FROM mappings WHERE generation_id = $1",
      [g.id],
    );
    for (const r of res.rows) if (!mapping.has(r.field)) mapping.set(r.field, r.type);
  }

  // Load events. Pipes cover the whole stream.
  const params: SearchParams = {
    stream,
    spaceSlug: ctx.spaceSlug,
    q: pipe.where?.q ?? "",
    fromMs: 0,
    toMs: 8640000000000000,
    filters: [],
    sort: null,
    size: 100000,
    offset: 0,
    explain: false,
    id: null,
  };
  let loaded: LoadedEvent[];
  try {
    const result = await runSearch(db, params);
    loaded = result.ordered;
  } catch (err) {
    if (err instanceof QueryError) {
      const pos = (pipe.where?.pos ?? 1) + err.position - 1;
      throw new (require("../shared/pipe").PipeError)(err.text, pos);
    }
    throw err;
  }

  let rows: { flat: Record<string, unknown> }[] = loaded.map((le) => ({ flat: flatten(le.row.fields) }));

  if (!pipe.stats) {
    const columns = ["_id", "@timestamp", ...[...mapping.keys()].sort()];
    const out = rows.map((r, i) => {
      const values: Record<string, unknown> = {
        _id: loaded[i].row.event_id,
        "@timestamp": loaded[i].row.ts,
        ...r.flat,
      };
      return { values, types: new Map<string, FieldType | "number">() };
    });
    return finish(out, columns, pipe, mapping, loaded);
  }

  // STATS
  const stats = pipe.stats;
  const groups = new Map<string, { rows: { flat: Record<string, unknown> }[]; values: unknown[] }>();
  for (const r of rows) {
    const keys = stats.by ? valuesOf(r.flat[stats.by]).map((v) => String(v)) : [""];
    for (const k of keys) {
      const g = groups.get(k) ?? { rows: [], values: [] };
      g.rows.push(r);
      if (stats.by) g.values.push(valuesOf(r.flat[stats.by]));
      groups.set(k, g);
    }
  }
  const statRows: { values: Record<string, unknown> }[] = [];
  for (const [key, g] of [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const values: Record<string, unknown> = {};
    if (stats.by) values[stats.by] = key;
    for (const agg of stats.aggs) {
      if (agg.fn === "count") {
        values[agg.alias] = g.rows.length;
        continue;
      }
      const type = mapping.get(agg.field ?? "");
      if (type !== "number") {
        throw errors.pipeSyntax(`${agg.fn} needs a number field: ${agg.field} is ${type ?? "text"}.`);
      }
      const nums: number[] = [];
      for (const r of g.rows) {
        for (const v of valuesOf(r.flat[agg.field ?? ""])) {
          if (typeof v === "number") nums.push(v);
        }
      }
      if (agg.fn === "avg") values[agg.alias] = nums.length === 0 ? null : fmtFixed(nums.reduce((a, b) => a + b, 0) / nums.length, 4);
      if (agg.fn === "max") values[agg.alias] = nums.length === 0 ? null : Math.max(...nums);
      if (agg.fn === "min") values[agg.alias] = nums.length === 0 ? null : Math.min(...nums);
      if (agg.fn === "sum") values[agg.alias] = nums.length === 0 ? null : nums.reduce((a, b) => a + b, 0);
    }
    statRows.push({ values });
  }
  const statColumns = [
    ...(stats.by ? [stats.by] : []),
    ...stats.aggs.map((a) => a.alias),
  ];
  const statTypes = new Map<string, FieldType | "number">();
  for (const a of stats.aggs) statTypes.set(a.alias, "number");
  if (stats.by) statTypes.set(stats.by, mapping.get(stats.by) ?? "text");
  return finishStat(statRows, statColumns, pipe, statTypes);
}

function finishStat(
  rows: { values: Record<string, unknown> }[],
  columns: string[],
  pipe: Pipe,
  types: Map<string, FieldType | "number">,
): { columns: { name: string; type: string }[]; rows: unknown[][] } {
  let data = rows.map((r) => r.values);
  if (pipe.sort.length > 0) {
    data = sortRows(data, pipe.sort, columns);
  }
  data = data.slice(0, pipe.limit);
  const kept = pipe.keep ?? columns;
  for (const col of kept) {
    if (!columns.includes(col)) {
      throw errors.pipeSyntax(`Unknown column ${col} at position 1.`, 1);
    }
  }
  const outCols = kept.map((c) => ({ name: c, type: String(types.get(c) ?? "text") }));
  const outRows = data.map((r) => kept.map((c) => formatPipeValue(r[c], types.get(c))));
  return { columns: outCols, rows: outRows };
}

function finish(
  rows: { values: Record<string, unknown>; types: Map<string, FieldType | "number"> }[],
  columns: string[],
  pipe: Pipe,
  mapping: Map<string, FieldType>,
  loaded: LoadedEvent[],
): { columns: { name: string; type: string }[]; rows: unknown[][] } {
  let data = rows.map((r) => r.values);
  if (pipe.sort.length > 0) {
    data = sortRows(data, pipe.sort, columns);
  } else {
    data.sort((a, b) => {
      const ta = (a["@timestamp"] as Date).getTime();
      const tb = (b["@timestamp"] as Date).getTime();
      if (tb !== ta) return tb - ta;
      return String(a._id) < String(b._id) ? -1 : 1;
    });
  }
  data = data.slice(0, pipe.limit);
  const kept = pipe.keep ?? columns;
  for (const col of kept) {
    if (!columns.includes(col)) {
      throw errors.pipeSyntax(`Unknown column ${col} at position 1.`, 1);
    }
  }
  const types = new Map<string, string>();
  types.set("_id", "keyword");
  types.set("@timestamp", "date");
  for (const [f, t] of mapping) types.set(f, t);
  const outCols = kept.map((c) => ({ name: c, type: types.get(c) ?? "text" }));
  const outRows = data.map((r) => kept.map((c) => formatPipeValue(r[c], types.get(c) as string | undefined)));
  return { columns: outCols, rows: outRows };
}

function sortRows(
  data: Record<string, unknown>[],
  sorts: { col: string; dir: "ASC" | "DESC" }[],
  columns: string[],
): Record<string, unknown>[] {
  const compare = (a: Record<string, unknown>, b: Record<string, unknown>): number => {
    for (const s of sorts) {
      if (!columns.includes(s.col)) {
        throw errors.pipeSyntax(`Unknown column ${s.col} at position 1.`, 1);
      }
      const av = a[s.col];
      const bv = b[s.col];
      const missingA = av === undefined || av === null;
      const missingB = bv === undefined || bv === null;
      if (missingA && !missingB) return 1;
      if (!missingA && missingB) return -1;
      if (!missingA && !missingB) {
        let c = 0;
        if (typeof av === "number" && typeof bv === "number") c = av - bv;
        else {
          const sa = String(av);
          const sb = String(bv);
          c = sa < sb ? -1 : sa > sb ? 1 : 0;
        }
        if (c !== 0) return s.dir === "DESC" ? -c : c;
      }
    }
    // ties on all kept columns ascending
    for (const col of columns) {
      const av = a[col];
      const bv = b[col];
      const sa = av === undefined || av === null ? "" : String(av);
      const sb = bv === undefined || bv === null ? "" : String(bv);
      if (sa !== sb) return sa < sb ? -1 : 1;
    }
    return 0;
  };
  return [...data].sort(compare);
}

function formatPipeValue(value: unknown, type: string | undefined): unknown {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) {
    return value.map((v) => formatPipeValue(v, type)).join(", ");
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value;
  return String(value);
}
