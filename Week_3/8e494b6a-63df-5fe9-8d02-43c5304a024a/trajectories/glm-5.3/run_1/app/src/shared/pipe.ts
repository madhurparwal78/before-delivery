/**
 * Spoor Pipe parser (rule I). Throws PipeError with a 1-based position in the whole pipe text.
 */
export interface PipeAgg {
  fn: "count" | "avg" | "max" | "min" | "sum";
  field: string | null;
  alias: string;
}

export interface PipeStats {
  aggs: PipeAgg[];
  by: string | null;
}

export interface PipeSort {
  col: string;
  dir: "ASC" | "DESC";
}

export interface Pipe {
  from: { stream: string; pos: number };
  where: { q: string; pos: number } | null;
  stats: PipeStats | null;
  sort: PipeSort[];
  limit: number;
  keep: string[] | null;
}

export class PipeError extends Error {
  constructor(
    public text: string,
    public position: number,
  ) {
    super(text);
  }
}

interface Token {
  w: string;
  start: number;
}

const AGG_RE = /^(count|avg|max|min|sum)\((.+)\)$/;
const COMMANDS = ["FROM", "WHERE", "STATS", "SORT", "LIMIT", "KEEP"];

export function parsePipe(text: string): Pipe {
  const toks = tokenize(text);
  if (toks.length === 0) throw new PipeError("FROM must come first.", 1);
  let idx = 0;

  const first = toks[0];
  const upper = first.w.toUpperCase();
  if (upper !== "FROM") {
    if (COMMANDS.includes(upper)) throw new PipeError("FROM must come first.", first.start + 1);
    throw new PipeError(`Unknown command ${first.w} at position ${first.start + 1}.`, first.start + 1);
  }
  idx = 1;
  if (idx >= toks.length) throw new PipeError("FROM must come first.", 1);
  const streamTok = toks[idx];
  const from = { stream: streamTok.w, pos: streamTok.start + 1 };
  idx += 1;

  let where: Pipe["where"] = null;
  let stats: PipeStats | null = null;
  const sort: PipeSort[] = [];
  let limit = 1000;
  let keep: string[] | null = null;

  while (idx < toks.length) {
    const tok = toks[idx];
    const kw = tok.w.toUpperCase();
    if (tok.w === "|") {
      idx += 1;
      continue;
    }
    if (kw === "WHERE") {
      if (idx + 1 >= toks.length) throw new PipeError("Expected AND or OR at position 1.", 1);
      const startTok = toks[idx + 1];
      let endIdx = toks.length;
      for (let i = idx + 1; i < toks.length; i += 1) {
        if (isCommand(toks[i].w) || toks[i].w === "|") {
          endIdx = i;
          break;
        }
      }
      const start = startTok.start;
      const endPos = endIdx === toks.length ? text.length : toks[endIdx].start;
      where = { q: text.slice(start, endPos).trim(), pos: start + 1 };
      idx = endIdx;
    } else if (kw === "STATS") {
      const res = parseStats(toks, idx + 1);
      stats = res.stats;
      idx = res.endIndex;
    } else if (kw === "SORT") {
      const res = parseSort(toks, idx + 1);
      sort.push(...res.sorts);
      idx = res.endIndex;
    } else if (kw === "LIMIT") {
      idx += 1;
      if (idx >= toks.length) throw new PipeError("LIMIT can be at most 10000.", tok.start + 1);
      const t = toks[idx];
      if (!/^\d+$/.test(t.w)) throw new PipeError("LIMIT can be at most 10000.", t.start + 1);
      const n = Number(t.w);
      if (n > 10000) throw new PipeError("LIMIT can be at most 10000.", t.start + 1);
      limit = n;
      idx += 1;
    } else if (kw === "KEEP") {
      idx += 1;
      const cols: string[] = [];
      while (idx < toks.length && !isCommand(toks[idx].w) && toks[idx].w !== "|") {
        cols.push(toks[idx].w);
        idx += 1;
      }
      keep = cols;
    } else {
      throw new PipeError(`Unknown command ${tok.w} at position ${tok.start + 1}.`, tok.start + 1);
    }
  }
  return { from, where, stats, sort, limit, keep };
}

function isCommand(w: string): boolean {
  return COMMANDS.includes(w.toUpperCase());
}

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/[\s,]/.test(c)) {
      i += 1;
      continue;
    }
    if (c === "|") {
      out.push({ w: "|", start: i });
      i += 1;
      continue;
    }
    const start = i;
    if (c === "(" || c === ")") {
      out.push({ w: c, start: i });
      i += 1;
      continue;
    }
    let j = i;
    let depth = 0;
    while (j < text.length) {
      const ch = text[j];
      if (ch === "(") {
        depth += 1;
        j += 1;
        continue;
      }
      if (ch === ")") {
        if (depth === 0) break;
        depth -= 1;
        j += 1;
        continue;
      }
      if (depth === 0 && /[\s,|]/.test(ch)) break;
      j += 1;
    }
    out.push({ w: text.slice(i, j), start: i });
    i = j;
  }
  return out;
}

function parseStats(toks: Token[], idx: number): { stats: PipeStats; endIndex: number } {
  const aggs: PipeAgg[] = [];
  let by: string | null = null;
  let i = idx;
  while (i < toks.length && !isCommand(toks[i].w) && toks[i].w !== "|") {
    const t = toks[i];
    const m = AGG_RE.exec(t.w);
    if (m) {
      const fn = m[1] as PipeAgg["fn"];
      const inner = m[2];
      if (fn !== "count" && inner === "*") {
        throw new PipeError(`Unknown column * at position ${t.start + 1}.`, t.start + 1);
      }
      i += 1;
      let alias: string;
      if (i < toks.length && toks[i].w.toUpperCase() === "AS" && i + 1 < toks.length) {
        alias = toks[i + 1].w;
        i += 2;
      } else {
        alias = inner === "*" ? fn : `${fn}_${inner.replace(/\./g, "_")}`;
      }
      aggs.push({ fn, field: inner === "*" ? null : inner, alias });
      if (i < toks.length && toks[i].w === ",") i += 1;
      continue;
    }
    if (t.w.toUpperCase() === "BY") {
      i += 1;
      if (i >= toks.length || isCommand(toks[i].w)) {
        throw new PipeError(`Unknown column BY at position ${t.start + 1}.`, t.start + 1);
      }
      by = toks[i].w;
      i += 1;
      continue;
    }
    throw new PipeError(`Unknown column ${t.w} at position ${t.start + 1}.`, t.start + 1);
  }
  if (aggs.length === 0) throw new PipeError("FROM must come first.", 1);
  return { stats: { aggs, by }, endIndex: i };
}

function parseSort(toks: Token[], idx: number): { sorts: PipeSort[]; endIndex: number } {
  const sorts: PipeSort[] = [];
  let i = idx;
  while (i < toks.length && !isCommand(toks[i].w) && toks[i].w !== "|") {
    const col = toks[i].w;
    i += 1;
    let dir: "ASC" | "DESC" = "ASC";
    if (i < toks.length && !isCommand(toks[i].w) && toks[i].w !== ",") {
      const d = toks[i].w.toUpperCase();
      if (d === "ASC" || d === "DESC") {
        dir = d;
        i += 1;
      }
    }
    if (i < toks.length && toks[i].w === ",") i += 1;
    sorts.push({ col, dir });
  }
  if (sorts.length === 0) throw new PipeError("FROM must come first.", 1);
  return { sorts, endIndex: i };
}
