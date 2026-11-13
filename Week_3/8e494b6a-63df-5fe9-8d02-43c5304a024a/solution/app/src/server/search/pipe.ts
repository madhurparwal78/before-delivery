// Spoor Pipe (Business rules I): FROM, WHERE, STATS, SORT, LIMIT and KEEP over a stream's events.
import { config } from "../config";
import { errors } from "../errors";
import { now } from "../clock";
import { parseIsoInstant } from "../../shared/time";
import { formatDisplay } from "../../shared/zone";
import { Evaluator, WorkMeter } from "./evaluate";
import { conflictSentence, loadStreamContext, loadUniverse, schemaOf, typesOfField, type StreamContext } from "./context";
import { eventValues } from "./filters";
import { characters, checkLimits, parseQuery } from "./parser";
import { roundHalfAway } from "./scoring";
import type { FieldType, Scalar } from "./fields";
import type { StoredEvent } from "./events";
import { findStream, streamAllowed, type Access } from "../access";

const EVERYTHING_FROM = Number.MIN_SAFE_INTEGER;
const EVERYTHING_TO = Number.MAX_SAFE_INTEGER;
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 10_000;

type Raw = null | Scalar | Scalar[];
interface Column {
  name: string;
  type: FieldType;
  /** The event field behind the column, when the column is one (used for conflict checks). */
  field?: string;
}
interface Table {
  columns: Column[];
  rows: Raw[][];
}

interface Segment {
  word: string;
  wordAt: number;
  bodyStart: number;
  body: string[];
}

function splitSegments(chars: string[]): Segment[] {
  const pieces: Array<{ start: number; end: number }> = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i <= chars.length; i++) {
    const ch = chars[i];
    if (ch === "\\") i++;
    else if (ch === '"') quoted = !quoted;
    else if (i === chars.length || (ch === "|" && !quoted)) {
      pieces.push({ start, end: i });
      start = i + 1;
    }
  }
  return pieces.map(({ start: from, end }) => {
    let at = from;
    while (at < end && /\s/.test(chars[at] ?? "")) at++;
    let stop = at;
    while (stop < end && !/\s/.test(chars[stop] ?? "")) stop++;
    return { word: chars.slice(at, stop).join(""), wordAt: at, bodyStart: stop, body: chars.slice(stop, end) };
  });
}

interface Item {
  text: string;
  at: number;
}

/** Comma-separated items outside parentheses, each with the index of its first character. */
function splitItems(body: string[], bodyStart: number): Item[] {
  const items: Item[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i <= body.length; i++) {
    const ch = body[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (i === body.length || (ch === "," && depth === 0)) {
      const raw = body.slice(from, i).join("");
      const lead = raw.length - raw.trimStart().length;
      items.push({ text: raw.trim(), at: bodyStart + from + lead });
      from = i + 1;
    }
  }
  return items.filter((item) => item.text !== "" || items.length > 1);
}

const fail = (sentence: string, at?: number) => errors.pipeSyntax(at === undefined ? sentence : `${sentence} at position ${at + 1}.`, at === undefined ? undefined : at + 1);

function compareRaw(a: Raw, b: Raw): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  const x = Array.isArray(a) ? a.join(", ") : a;
  const y = Array.isArray(b) ? b.join(", ") : b;
  if (typeof x === "number" && typeof y === "number") return x - y;
  return String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0;
}

function cellOf(event: StoredEvent, field: string, type: FieldType): Raw {
  const values = eventValues(event, field).map((value) => (type === "date" && typeof value === "string" ? (parseIsoInstant(value) ?? value) : value));
  return values.length === 0 ? null : values.length === 1 ? (values[0] as Scalar) : values;
}

function fieldNames(ctx: StreamContext): string[] {
  const names = new Set<string>();
  for (const fields of ctx.types.values()) for (const field of fields.keys()) names.add(field);
  return [...names].sort();
}

function eventTable(ctx: StreamContext, events: StoredEvent[]): Table {
  const columns: Column[] = [
    { name: "_id", type: "keyword", field: "_id" },
    { name: "@timestamp", type: "date", field: "@timestamp" },
    ...fieldNames(ctx).map((field) => ({ name: field, type: typesOfField(ctx, field)[0] ?? "text", field })),
  ];
  const ordered = [...events].sort((a, b) => b.ts - a.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { columns, rows: ordered.map((event) => columns.map((column) => cellOf(event, column.field as string, column.type))) };
}

function columnAt(table: Table, name: string, at: number): { column: Column; index: number } {
  const index = table.columns.findIndex((column) => column.name === name);
  const column = table.columns[index];
  if (!column) throw fail(`Unknown column ${name}`, at);
  return { column, index };
}

interface Aggregate {
  fn: "count" | "avg" | "max" | "min" | "sum";
  field: string | null;
  as: string;
  at: number;
}

function parseAggregates(items: Item[]): Aggregate[] {
  return items.map((item) => {
    const match = /^(count|avg|max|min|sum)\(\s*(\*|[^)\s]+)\s*\)\s+AS\s+([A-Za-z_][A-Za-z0-9_]*)$/i.exec(item.text);
    if (!match || (match[1]?.toLowerCase() === "count") !== (match[2] === "*")) throw fail("Expected a value", item.at);
    return { fn: match[1]?.toLowerCase() as Aggregate["fn"], field: match[2] === "*" ? null : (match[2] as string), as: match[3] as string, at: item.at };
  });
}

function aggregate(ctx: StreamContext, aggregates: Aggregate[], by: { field: string; at: number } | null, events: StoredEvent[]): Table {
  const typeOf = (field: string, at: number): FieldType => {
    const type = typesOfField(ctx, field)[0];
    if (!type) throw fail(`Unknown column ${field}`, at);
    const sentence = conflictSentence(ctx, field, EVERYTHING_FROM, EVERYTHING_TO);
    if (sentence) throw errors.fieldConflict(sentence);
    return type;
  };
  const byType = by ? typeOf(by.field, by.at) : null;
  const columns: Column[] = by && byType ? [{ name: by.field, type: byType, field: by.field }] : [];
  const sourceTypes: FieldType[] = aggregates.map((agg) => (agg.field === null ? "number" : typeOf(agg.field, agg.at)));
  aggregates.forEach((agg, k) => {
    const type = sourceTypes[k] as FieldType;
    if ((agg.fn === "avg" || agg.fn === "sum") && type !== "number") throw errors.pipeSyntax(`${agg.fn} needs a number field: ${agg.field} is ${type}.`);
    columns.push({ name: agg.as, type: agg.fn === "max" || agg.fn === "min" ? type : "number" });
  });
  const groups = new Map<string, { key: Raw; events: StoredEvent[] }>();
  for (const event of events) {
    const keys: Raw[] = by && byType ? [...new Set(eventValues(event, by.field).map((v) => (byType === "date" && typeof v === "string" ? (parseIsoInstant(v) ?? v) : v)))] : ["all"];
    for (const key of keys.length === 0 ? [null] : keys) {
      const slot = groups.get(String(key)) ?? { key, events: [] };
      slot.events.push(event);
      groups.set(String(key), slot);
    }
  }
  if (!by && groups.size === 0) groups.set("all", { key: "all", events: [] });
  const rows = [...groups.values()].sort((a, b) => compareRaw(a.key, b.key)).map((group) => {
    const row: Raw[] = by ? [group.key] : [];
    aggregates.forEach((agg, k) => {
      const type = sourceTypes[k] as FieldType;
      const values = agg.field === null ? [] : group.events.flatMap((event) => eventValues(event, agg.field as string).map((v) => (type === "date" && typeof v === "string" ? (parseIsoInstant(v) ?? v) : v)));
      if (agg.fn === "count") row.push(group.events.length);
      else if (values.length === 0) row.push(null);
      else if (agg.fn === "sum" || agg.fn === "avg") {
        const total = (values as number[]).reduce((sum, v) => sum + v, 0);
        row.push(agg.fn === "sum" ? total : roundHalfAway(total / values.length, 4));
      } else row.push(values.reduce((best, v) => ((agg.fn === "max" ? v > best : v < best) ? v : best)));
    });
    return row;
  });
  return { columns, rows };
}

function present(raw: Raw, type: FieldType, zone: string): unknown {
  if (raw === null) return null;
  if (Array.isArray(raw)) return raw.map((v) => String(present(v, type, zone))).join(", ");
  return type === "date" && typeof raw === "number" ? formatDisplay(raw, zone) : raw;
}

export async function runPipe(access: Access, text: string, zone: string) {
  const { settings } = config;
  const chars = characters(text);
  if (chars.length > settings.queryMaxLen) throw errors.queryTooLong(settings.queryMaxLen);
  const segments = splitSegments(chars);
  const head = segments[0];
  if (!head || head.word.toUpperCase() !== "FROM") throw fail("FROM must come first.");
  const nameItems = head.body.join("").trim();
  if (nameItems === "") throw fail("Expected a value", chars.length);
  const found = await findStream(access.space.id, nameItems);
  if (!found) throw fail(`Stream ${nameItems} doesn't exist.`);
  if (!streamAllowed(access, found.name)) throw errors.keyScope("read", found.name);
  const ctx = await loadStreamContext(found, access.space.id);
  const meter = new WorkMeter(settings.queryWorkMax, settings.queryBudgetMs);
  const universe = await loadUniverse(ctx, EVERYTHING_FROM, EVERYTHING_TO);
  const nowMs = now();
  let events = universe.events;
  let table: Table | null = null;
  let limited = false;
  const ensureTable = (): Table => (table ??= eventTable(ctx, events));

  for (const segment of segments.slice(1)) {
    const word = segment.word.toUpperCase();
    const items = (): Item[] => splitItems(segment.body, segment.bodyStart);
    if (word === "FROM") throw fail("FROM must come first.");
    if (word === "WHERE") {
      if (table) throw fail(`Unknown command ${segment.word}`, segment.wordAt);
      const query = segment.body.join("");
      const lead = query.length - query.trimStart().length;
      const offset = segment.bodyStart + lead;
      checkLimits(query.trim());
      const ast = parseQuery(query.trim(), schemaOf(ctx), nowMs, offset);
      const matches = await new Evaluator({ events, index: universe.index, types: ctx.types, nowMs, meter }).run(ast);
      events = events.filter((event) => matches.has(event.id));
    } else if (word === "STATS") {
      if (table) throw fail(`Unknown command ${segment.word}`, segment.wordAt);
      const body = segment.body.join("");
      const by = /\sBY\s+(\S+)\s*$/i.exec(body);
      const aggregates = parseAggregates(splitItems(by ? segment.body.slice(0, characters(body.slice(0, by.index)).length) : segment.body, segment.bodyStart));
      const field = by?.[1];
      const trimmed = characters(body.trimEnd());
      table = aggregate(ctx, aggregates, field === undefined ? null : { field, at: segment.bodyStart + trimmed.length - characters(field).length }, events);
    } else if (word === "SORT") {
      const current = ensureTable();
      const keys = items().map((item) => {
        const [name = "", direction] = item.text.split(/\s+/);
        if (direction !== undefined && !/^(asc|desc)$/i.test(direction)) throw fail("Expected a value", item.at + name.length + 1);
        const { column, index } = columnAt(current, name, item.at);
        if (column.field) {
          const sentence = conflictSentence(ctx, column.field, EVERYTHING_FROM, EVERYTHING_TO);
          if (sentence) throw errors.fieldConflict(sentence);
        }
        return { index, descending: direction?.toLowerCase() === "desc" };
      });
      current.rows.sort((a, b) => {
        for (const { index, descending } of keys) {
          const x = a[index] as Raw;
          const y = b[index] as Raw;
          if (x === null || y === null) {
            if (x !== y) return x === null ? 1 : -1;
            continue;
          }
          const order = compareRaw(x, y);
          if (order !== 0) return descending ? -order : order;
        }
        for (let k = 0; k < a.length; k++) {
          const order = compareRaw(a[k] as Raw, b[k] as Raw);
          if (order !== 0) return order;
        }
        return 0;
      });
    } else if (word === "LIMIT") {
      const current = ensureTable();
      const raw = segment.body.join("").trim();
      const at = segment.bodyStart + (segment.body.join("").length - segment.body.join("").trimStart().length);
      if (!/^\d+$/.test(raw)) throw fail("Expected a number", at);
      if (Number(raw) > MAX_LIMIT) throw fail(`LIMIT can be at most ${MAX_LIMIT}.`);
      current.rows = current.rows.slice(0, Number(raw));
      limited = true;
    } else if (word === "KEEP") {
      const current = ensureTable();
      const picked = items().map((item) => columnAt(current, item.text, item.at).index);
      current.columns = picked.map((index) => current.columns[index] as Column);
      current.rows = current.rows.map((row) => picked.map((index) => row[index] as Raw));
    } else {
      throw fail(`Unknown command ${segment.word}`, segment.wordAt);
    }
  }
  const result = ensureTable();
  const rows = limited ? result.rows : result.rows.slice(0, DEFAULT_LIMIT);
  return {
    columns: result.columns.map(({ name, type }) => ({ name, type })),
    rows: rows.map((row) => row.map((cell, index) => present(cell, (result.columns[index] as Column).type, zone))),
    partial: universe.partial,
    skipped_generations: universe.skipped,
  };
}
