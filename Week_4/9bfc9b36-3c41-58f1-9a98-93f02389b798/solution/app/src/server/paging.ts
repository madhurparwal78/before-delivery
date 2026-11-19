/** Opaque cursors bound to the filter that produced them, and the keyset and in-memory pagers that use them. */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { invalid } from "./errors.js";
import { FIELD, wholeNumberCopy } from "../shared/copy.js";
import type { Page } from "../shared/types.js";
import { rows, type Queryable, type Row } from "./db.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const secret = createHash("sha256").update(`boltrope-cursor:${config.clientSecret}`).digest();

type Key = (string | number)[];

function encodeCursor(filter: string, key: Key): string {
  const payload = Buffer.from(JSON.stringify({ f: filter, k: key })).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

function decodeCursor(token: string, filter: string): Key {
  const fail = (copy: string) => invalid({ cursor: copy });
  const [payload, mac, ...extra] = token.split(".");
  if (!payload || !mac || extra.length) throw fail(FIELD.cursorInvalid);
  const expected = createHmac("sha256", secret).update(payload).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw fail(FIELD.cursorInvalid);
  let parsed: { f?: unknown; k?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw fail(FIELD.cursorInvalid);
  }
  if (!Array.isArray(parsed.k) || typeof parsed.f !== "string") throw fail(FIELD.cursorInvalid);
  if (parsed.f !== filter) throw fail(FIELD.cursorOtherFilter);
  return parsed.k as Key;
}

export interface PageRequest {
  limit: number;
  cursor: string | null;
}

export function pageRequest(query: URLSearchParams): PageRequest {
  const raw = query.get("limit");
  let limit = DEFAULT_LIMIT;
  if (raw !== null) {
    if (!/^-?\d+$/.test(raw) || Number(raw) < 1) throw invalid({ limit: wholeNumberCopy(1, MAX_LIMIT) });
    limit = Math.min(Number(raw), MAX_LIMIT);
  }
  return { limit, cursor: query.get("cursor") };
}

interface KeysetOptions<T> {
  /** A SELECT whose rows carry the columns `k1` (and `k2`) the page is ordered by. */
  base: string;
  params: unknown[];
  types: [string] | [string, string];
  direction: "asc" | "desc";
  filter: string;
  request: PageRequest;
  map: (row: Row) => T;
}

export async function keysetPage<T>(db: Queryable, options: KeysetOptions<T>): Promise<Page<T>> {
  const { base, params, types, direction, filter, request, map } = options;
  const compare = direction === "desc" ? "<" : ">";
  const columns = types.map((_, index) => `k${index + 1}`);
  const order = columns.map((column) => `${column} ${direction}`).join(", ");
  let where = "";
  const values = [...params];
  if (request.cursor !== null) {
    const key = decodeCursor(request.cursor, filter);
    if (key.length !== types.length) throw invalid({ cursor: FIELD.cursorInvalid });
    const marks = types.map((type, index) => `$${values.length + index + 1}::${type}`);
    values.push(...key);
    where = `WHERE (${columns.join(", ")}) ${compare} (${marks.join(", ")})`;
  }
  const found = await rows(db, `SELECT * FROM (${base}) q ${where} ORDER BY ${order} LIMIT ${request.limit + 1}`, values);
  const total = (await rows(db, `SELECT count(*)::int AS n FROM (${base}) q`, params))[0]!.n as number;
  const more = found.length > request.limit;
  const shown = found.slice(0, request.limit);
  const last = shown[shown.length - 1];
  const keyOf = (row: Row): Key => columns.map((column) => (row[column] instanceof Date ? (row[column] as Date).toISOString() : row[column]));
  return { items: shown.map(map), next_cursor: more && last ? encodeCursor(filter, keyOf(last)) : null, total };
}

/** The same cursor contract over a list the caller has already computed and ordered. */
export function slicePage<T>(items: T[], keyOf: (item: T) => number, direction: "asc" | "desc", filter: string, request: PageRequest): Page<T> {
  let start = 0;
  if (request.cursor !== null) {
    const key = decodeCursor(request.cursor, filter);
    if (key.length !== 1 || typeof key[0] !== "number") throw invalid({ cursor: FIELD.cursorInvalid });
    const after = key[0];
    start = items.findIndex((item) => (direction === "desc" ? keyOf(item) < after : keyOf(item) > after));
    if (start < 0) start = items.length;
  }
  const shown = items.slice(start, start + request.limit);
  const last = shown[shown.length - 1];
  const more = start + request.limit < items.length;
  return { items: shown, next_cursor: more && last ? encodeCursor(filter, [keyOf(last)]) : null, total: items.length };
}
