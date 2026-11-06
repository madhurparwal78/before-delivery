// Listing, paging, tag filters and search (brief: Listing and paging; Filters and search).
// Keys are ordered by UTF-8 byte order (the "C" collation); cursors are opaque and signed.
import { createHmac } from "node:crypto";
import { query, type Db } from "./db.js";
import { characters, PAGE_MAX, SCAN_BUDGET, SEARCH_RESULTS_MAX, utf8Bytes } from "./limits.js";
import { config } from "./config.js";
import type { Version } from "./objects.js";

// ---- Tag filters ----

type FilterNode =
  | { kind: "cmp"; key: string; negated: boolean; value: string; prefix: boolean }
  | { kind: "and" | "or"; left: FilterNode; right: FilterNode }
  | { kind: "not"; operand: FilterNode };

export class FilterError extends Error {}

type Token =
  | { kind: "(" | ")" | "and" | "or" | "not"; at: number }
  | { kind: "cmp"; at: number; node: Extract<FilterNode, { kind: "cmp" }> }
  | { kind: "end"; at: number };

const unreadable = (at: number): FilterError => new FilterError(`Tag filter could not be read near character ${at}.`);
const isSpace = (c: string | undefined): boolean => c === " " || c === "\t";
const BARE_KEY_STOP = new Set([" ", "\t", "(", ")", "=", "!", '"', "*"]);
const BARE_VALUE_STOP = new Set([" ", "\t", "(", ")", '"', "*"]);

// Reads one token at a time, so the first unreadable spot from the left is the one reported.
class Lexer {
  private i = 0;
  constructor(private readonly chars: string[]) {}

  private quoted(): string | null {
    const open = this.i;
    let out = "";
    this.i += 1;
    while (this.i < this.chars.length) {
      const c = this.chars[this.i] ?? "";
      if (c === "\\" && (this.chars[this.i + 1] === '"' || this.chars[this.i + 1] === "\\")) {
        out += this.chars[this.i + 1];
        this.i += 2;
      } else if (c === '"') {
        this.i += 1;
        return out;
      } else {
        out += c;
        this.i += 1;
      }
    }
    throw unreadable(open + 1);
  }

  private bare(stop: Set<string>): string {
    let out = "";
    while (this.i < this.chars.length && !stop.has(this.chars[this.i] ?? "")) out += this.chars[this.i++];
    return out;
  }

  next(): Token {
    while (isSpace(this.chars[this.i])) this.i += 1;
    const at = this.i + 1;
    const c = this.chars[this.i];
    if (c === undefined) return { kind: "end", at };
    if (c === "(" || c === ")") {
      this.i += 1;
      return { kind: c, at };
    }
    if (c === "*") throw unreadable(at);
    let key: string;
    let quotedKey = false;
    if (c === '"') {
      key = this.quoted() ?? "";
      quotedKey = true;
    } else {
      key = this.bare(BARE_KEY_STOP);
    }
    const after = this.chars[this.i];
    const ended = after === undefined || isSpace(after) || after === "(" || after === ")";
    if (!quotedKey && ended && (key === "and" || key === "or" || key === "not")) return { kind: key, at };
    let negated = false;
    if (after === "=") this.i += 1;
    else if (after === "!" && this.chars[this.i + 1] === "=") {
      negated = true;
      this.i += 2;
    } else if (after === "*") throw unreadable(this.i + 1);
    else throw unreadable(at);
    if (!quotedKey && key === "") throw unreadable(at);
    let value: string;
    let quotedValue = false;
    if (this.chars[this.i] === '"') {
      value = this.quoted() ?? "";
      quotedValue = true;
    } else {
      value = this.bare(BARE_VALUE_STOP);
    }
    let prefix = false;
    if (this.chars[this.i] === "*") {
      prefix = true;
      this.i += 1;
    } else if (!quotedValue && value === "") {
      throw unreadable(at);
    }
    const next = this.chars[this.i];
    if (next !== undefined && !isSpace(next) && next !== "(" && next !== ")") throw unreadable(this.i + 1);
    return { kind: "cmp", at, node: { kind: "cmp", key, negated, value, prefix } };
  }
}

class Parser {
  private token: Token;
  comparisons = 0;
  depth = 0;
  private open = 0;

  constructor(private readonly lexer: Lexer) {
    this.token = lexer.next();
  }

  private advance(): void {
    this.token = this.lexer.next();
  }

  parse(): FilterNode {
    const node = this.or();
    if (this.token.kind !== "end") throw unreadable(this.token.at);
    return node;
  }

  private or(): FilterNode {
    let left = this.and();
    while (this.token.kind === "or") {
      this.advance();
      left = { kind: "or", left, right: this.and() };
    }
    return left;
  }

  private and(): FilterNode {
    let left = this.not();
    while (this.token.kind === "and") {
      this.advance();
      left = { kind: "and", left, right: this.not() };
    }
    return left;
  }

  private not(): FilterNode {
    if (this.token.kind === "not") {
      this.advance();
      return { kind: "not", operand: this.not() };
    }
    return this.primary();
  }

  private primary(): FilterNode {
    const token = this.token;
    if (token.kind === "cmp") {
      this.comparisons += 1;
      this.advance();
      return token.node;
    }
    if (token.kind === "(") {
      this.open += 1;
      this.depth = Math.max(this.depth, this.open);
      this.advance();
      const inner = this.or();
      if (this.token.kind !== ")") throw unreadable(this.token.at);
      this.open -= 1;
      this.advance();
      return inner;
    }
    throw unreadable(token.at);
  }
}

export interface TagFilter {
  source: string;
  node: FilterNode | null;
}

// Validates a tag filter in the brief's order: length, readability, comparisons, nesting.
export function parseTagFilter(source: string): TagFilter {
  if (characters(source) > 256) throw new FilterError("Tag filters are limited to 256 characters.");
  if (source.trim() === "") return { source: "", node: null };
  const parser = new Parser(new Lexer([...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(source)].map((s) => s.segment)));
  const node = parser.parse();
  if (parser.comparisons > 10) throw new FilterError("Tag filters are limited to 10 comparisons.");
  if (parser.depth > 3) throw new FilterError("Tag filters are limited to 3 levels of parentheses.");
  return { source, node };
}

function matchesFilter(node: FilterNode | null, tags: Record<string, string>): boolean {
  if (!node) return true;
  switch (node.kind) {
    case "and": return matchesFilter(node.left, tags) && matchesFilter(node.right, tags);
    case "or": return matchesFilter(node.left, tags) || matchesFilter(node.right, tags);
    case "not": return !matchesFilter(node.operand, tags);
    case "cmp": {
      if (!Object.hasOwn(tags, node.key)) return false;
      const value = tags[node.key] ?? "";
      const equal = node.prefix ? value.startsWith(node.value) : value === node.value;
      return node.negated ? !equal : equal;
    }
  }
}

// ---- Paging ----

export interface Position {
  key: string;
  inclusive: boolean;
}

interface CursorScope {
  bucketId: number;
  prefix: string;
  delimiter: string;
  filter: string;
}

export class CursorError extends Error {}

const cursorMac = (payload: string): string =>
  createHmac("sha256", `cursor\u0000${config.secretKey}`).update(payload).digest("base64url").slice(0, 22);

export function encodeCursor(scope: CursorScope, position: Position): string {
  const payload = Buffer.from(JSON.stringify([scope.bucketId, scope.prefix, scope.delimiter, scope.filter, position.key,
    position.inclusive ? 1 : 0])).toString("base64url");
  return `${payload}.${cursorMac(payload)}`;
}

export function decodeCursor(token: string, scope: CursorScope): Position {
  const [payload, mac] = token.split(".");
  if (!payload || !mac || cursorMac(payload) !== mac) throw new CursorError();
  const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!Array.isArray(parsed) || parsed.length !== 6) throw new CursorError();
  const [bucketId, prefix, delimiter, filter, key, inclusive] = parsed as [unknown, unknown, unknown, unknown, unknown, unknown];
  if (bucketId !== scope.bucketId || prefix !== scope.prefix || delimiter !== scope.delimiter || filter !== scope.filter ||
      typeof key !== "string") throw new CursorError();
  return { key, inclusive: inclusive === 1 };
}

// The smallest string greater than every string that starts with `value`.
function successor(value: string): string {
  const points = [...value];
  const last = points.pop();
  if (last === undefined) return "";
  return points.join("") + String.fromCodePoint((last.codePointAt(0) ?? 0) + 1);
}

// A start-after key that would roll up into a common prefix resumes after every key under it.
export function positionAfter(key: string, prefix: string, delimiter: string): Position {
  if (delimiter && key.startsWith(prefix)) {
    const at = key.indexOf(delimiter, prefix.length);
    if (at >= 0) return { key: successor(key.slice(0, at + delimiter.length)), inclusive: true };
  }
  return { key, inclusive: false };
}

interface ListRequest {
  bucketId: number;
  prefix: string;
  delimiter: string;
  filter: TagFilter;
  from: Position | null;
  limit: number;
}

type ListingEntry = { kind: "object"; version: Version } | { kind: "prefix"; prefix: string };

interface ListResult {
  entries: ListingEntry[];
  next: Position | null;
  truncated: boolean;
}

// Walks current versions in key order from `from`, rolling keys up into common prefixes, until the
// page holds `limit` entries or the scan budget of 10,000 index entries runs out.
export async function listEntries(db: Db, request: ListRequest): Promise<ListResult> {
  const { prefix, delimiter } = request;
  const upper = prefix ? successor(prefix) : null;
  let position: Position = request.from ?? { key: prefix, inclusive: true };
  const entries: ListingEntry[] = [];
  let scanned = 0;
  for (;;) {
    const batch = Math.min(1000, SCAN_BUDGET - scanned + 1);
    const rows = await query<Version>(db,
      `SELECT * FROM versions WHERE bucket_id = $1 AND current AND key ${position.inclusive ? ">=" : ">"} $2
         AND ($3::text IS NULL OR key < $3) AND key >= $4 ORDER BY key LIMIT $5`,
      [request.bucketId, position.key, upper, prefix, batch]);
    if (rows.length === 0) return { entries, next: null, truncated: false };
    let jumped = false;
    for (const row of rows) {
      if (scanned === SCAN_BUDGET) return { entries, next: { key: row.key, inclusive: true }, truncated: true };
      scanned += 1;
      const at = delimiter ? row.key.indexOf(delimiter, prefix.length) : -1;
      const matches = matchesFilter(request.filter.node, row.tags);
      if (at >= 0) {
        if (matches) {
          const common = row.key.slice(0, at + delimiter.length);
          entries.push({ kind: "prefix", prefix: common });
          position = { key: successor(common), inclusive: true };
          jumped = true;
        } else {
          position = { key: row.key, inclusive: false };
        }
      } else {
        if (matches) entries.push({ kind: "object", version: row });
        position = { key: row.key, inclusive: false };
      }
      if (entries.length === request.limit) {
        const more = await query(db,
          `SELECT 1 FROM versions WHERE bucket_id = $1 AND current AND key ${position.inclusive ? ">=" : ">"} $2
             AND ($3::text IS NULL OR key < $3) LIMIT 1`, [request.bucketId, position.key, upper]);
        return { entries, next: more.length ? position : null, truncated: false };
      }
      if (jumped) break;
    }
    if (!jumped && rows.length < batch) return { entries, next: null, truncated: false };
  }
}

export function validatePrefix(prefix: string): boolean {
  return utf8Bytes(prefix) <= 1024;
}

export function validateDelimiter(delimiter: string): boolean {
  return delimiter === "" || characters(delimiter) === 1;
}

export const DEFAULT_PAGE = 100;
export const pageLimitAllowed = (value: number): boolean => Number.isInteger(value) && value >= 1 && value <= PAGE_MAX;

// ---- Search ----

interface SearchHit {
  bucket: string;
  key: string;
  size: number;
  last_modified: Date;
}

// Case-insensitive key substrings across the caller's own workspace only, at most 50 results.
export async function searchKeys(db: Db, workspaceId: string, q: string): Promise<{ items: SearchHit[]; truncated: boolean }> {
  const rows = await query<SearchHit & { hit: boolean; scanned: number }>(db,
    `WITH scanned AS (
       SELECT b.name AS bucket, v.key, v.size, v.last_modified FROM versions v JOIN buckets b ON b.id = v.bucket_id
       WHERE b.workspace_id = $1 AND v.current ORDER BY b.name COLLATE "C", v.key LIMIT $3)
     SELECT *, (SELECT count(*)::int FROM scanned) AS scanned FROM scanned
     WHERE strpos(lower(key), lower($2)) > 0 ORDER BY bucket COLLATE "C", key LIMIT $4`,
    [workspaceId, q, SCAN_BUDGET, SEARCH_RESULTS_MAX + 1]);
  const items = rows.slice(0, SEARCH_RESULTS_MAX).map(({ bucket, key, size, last_modified }) => ({ bucket, key, size, last_modified }));
  const scannedAll = (rows[0]?.scanned ?? 0) < SCAN_BUDGET;
  return { items, truncated: rows.length > SEARCH_RESULTS_MAX || (!scannedAll && items.length < SEARCH_RESULTS_MAX) };
}
