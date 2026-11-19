// The include-graph citation scan. Time is proportional to the scanned text: every lookup
// for a closing character uses a table built in one backward pass.
import { randomUUID } from "node:crypto";
import type { CitationReport, CitationWarning } from "../shared/api.ts";
import { membership } from "./access.ts";
import { signedIn } from "./auth.ts";
import { one, pool, type Db } from "./db.ts";
import { ok, type Context, type Reply } from "./http.ts";

const CITE_COMMANDS = new Set([
  "cite",
  "citep",
  "citet",
  "citealp",
  "citeauthor",
  "citeyear",
  "parencite",
  "textcite",
  "autocite",
  "footcite",
  "nocite",
]);
const SKIPPED_ENTRY_TYPES = new Set(["string", "preamble", "comment"]);

/** Normalise a name from the project root; null when it would leave the root. */
function resolvePath(raw: string, extension: (last: string) => string): string | null {
  const parts: string[] = [];
  for (const segment of raw.trim().split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  const last = parts.pop();
  if (last === undefined) return null;
  return [...parts, extension(last)].join("/");
}

const texName = (last: string): string => (last.includes(".") ? last : `${last}.tex`);
const bibName = (last: string): string => (last.endsWith(".bib") ? last : `${last}.bib`);

/** Line numbers by position: LF and CRLF both end a line. */
function lineIndex(text: string): (position: number) => number {
  const breaks: number[] = [];
  for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1)) breaks.push(at);
  return (position) => {
    let low = 0;
    let high = breaks.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if ((breaks[mid] as number) < position) low = mid + 1;
      else high = mid;
    }
    return low + 1;
  };
}

/** Text from an unescaped % to the end of the line becomes spaces; `\%` stays literal. */
function withoutComments(text: string): string {
  const out: string[] = [];
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const char = text.charCodeAt(i);
    if (char === 92) {
      i += 2;
    } else if (char === 37) {
      const end = text.indexOf("\n", i);
      const stop = end < 0 ? text.length : end;
      out.push(text.slice(start, i), " ".repeat(stop - i));
      start = stop;
      i = stop;
    } else {
      i += 1;
    }
  }
  out.push(text.slice(start));
  return out.join("");
}

/** next[c][i] = first index ≥ i holding c, or -1. */
function nextTable(text: string, char: number): Int32Array {
  const table = new Int32Array(text.length + 1);
  let next = -1;
  table[text.length] = -1;
  for (let i = text.length - 1; i >= 0; i -= 1) {
    if (text.charCodeAt(i) === char) next = i;
    table[i] = next;
  }
  return table;
}

interface TexScan {
  cites: CitationWarning[];
  citesAll: boolean;
  includes: string[];
  bibliographies: string[];
}

function isLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function scanTex(path: string, content: string): TexScan {
  const text = withoutComments(content);
  const closeBrace = nextTable(text, 125);
  const openBrace = nextTable(text, 123);
  const closeBracket = nextTable(text, 93);
  const lineOf = lineIndex(text);
  const scan: TexScan = { cites: [], citesAll: false, includes: [], bibliographies: [] };

  /** The braced argument starting at `at`, as [content, index after it], or null. */
  const braced = (at: number): [string, number] | null => {
    if (text.charCodeAt(at) !== 123) return null;
    const close = closeBrace[at + 1] ?? -1;
    if (close < 0) return null;
    const open = openBrace[at + 1] ?? -1;
    if (open >= 0 && open < close) return null;
    return [text.slice(at + 1, close), close + 1];
  };

  let i = text.indexOf("\\");
  while (i >= 0 && i < text.length) {
    let end = i + 1;
    while (end < text.length && isLetter(text.charCodeAt(end))) end += 1;
    if (end === i + 1) {
      i = text.indexOf("\\", i + 2);
      continue;
    }
    const name = text.slice(i + 1, end);
    let resume = end;
    if (CITE_COMMANDS.has(name)) {
      let at = end;
      if (text.charCodeAt(at) === 42) at += 1;
      let complete = true;
      for (let n = 0; n < 2 && text.charCodeAt(at) === 91; n += 1) {
        const close = closeBracket[at + 1] ?? -1;
        if (close < 0) {
          complete = false;
          break;
        }
        at = close + 1;
      }
      const keys = complete ? braced(at) : null;
      if (keys) {
        const line = lineOf(i);
        for (const raw of keys[0].split(",")) {
          const key = raw.trim();
          if (key === "") continue;
          if (key === "*" && name === "nocite") scan.citesAll = true;
          else scan.cites.push({ key, path, line });
        }
        resume = keys[1];
      }
    } else if (name === "input" || name === "include" || name === "bibliography" || name === "addbibresource") {
      const argument = braced(end);
      if (argument) {
        if (name === "input" || name === "include") scan.includes.push(argument[0]);
        else if (name === "addbibresource") scan.bibliographies.push(argument[0]);
        else scan.bibliographies.push(...argument[0].split(","));
        resume = argument[1];
      }
    }
    i = text.indexOf("\\", resume);
  }
  return scan;
}

function scanBib(path: string, content: string): CitationWarning[] {
  const entries: CitationWarning[] = [];
  const lineOf = lineIndex(content);
  let comma = -1;
  for (let at = content.indexOf("@"); at >= 0; at = content.indexOf("@", at + 1)) {
    let end = at + 1;
    while (end < content.length && isLetter(content.charCodeAt(end))) end += 1;
    const delimiter = content.charCodeAt(end);
    if (end === at + 1 || (delimiter !== 123 && delimiter !== 40)) continue;
    if (SKIPPED_ENTRY_TYPES.has(content.slice(at + 1, end).toLowerCase())) continue;
    if (comma <= end) comma = content.indexOf(",", end + 1);
    if (comma < 0) break;
    const key = content.slice(end + 1, comma).trim();
    if (key !== "") entries.push({ key, path, line: lineOf(at) });
  }
  return entries;
}

const byPlace = (a: CitationWarning, b: CitationWarning): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

function citationLists(files: Map<string, string>): Pick<CitationReport, "undefined" | "unused" | "duplicate"> {
  const empty = { undefined: [], unused: [], duplicate: [] };
  if (!files.has("main.tex")) return empty;
  const cites: CitationWarning[] = [];
  const bibNames = new Set<string>();
  const seen = new Set<string>(["main.tex"]);
  const queue = ["main.tex"];
  let citesAll = false;
  while (queue.length > 0) {
    const path = queue.shift() as string;
    const scan = scanTex(path, files.get(path) ?? "");
    cites.push(...scan.cites);
    citesAll ||= scan.citesAll;
    for (const raw of scan.includes) {
      const target = resolvePath(raw, texName);
      if (target && files.has(target) && !seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
    for (const raw of scan.bibliographies) {
      const target = resolvePath(raw, bibName);
      if (target && files.has(target)) bibNames.add(target);
    }
  }
  const entries = [...bibNames].flatMap((path) => scanBib(path, files.get(path) ?? "")).sort(byPlace);
  cites.sort(byPlace);
  const defined = new Set(entries.map((entry) => entry.key));
  const cited = new Set(cites.map((cite) => cite.key));
  const firstOf = (items: CitationWarning[]): CitationWarning[] => {
    const firsts = new Map<string, CitationWarning>();
    for (const item of items) if (!firsts.has(item.key)) firsts.set(item.key, item);
    return [...firsts.values()];
  };
  const duplicate: CitationWarning[] = [];
  const counted = new Set<string>();
  for (const entry of entries) {
    if (counted.has(entry.key)) duplicate.push(entry);
    counted.add(entry.key);
  }
  return {
    undefined: firstOf(cites).filter((cite) => !defined.has(cite.key)).sort(byPlace),
    unused: citesAll ? [] : firstOf(entries).filter((entry) => !cited.has(entry.key)).sort(byPlace),
    duplicate,
  };
}

/** The stored report of a project revision, computed once on first request. */
export async function citationReport(db: Db, projectId: string, revision: number): Promise<CitationReport> {
  const stored = await one<{ report: CitationReport }>(
    db,
    "SELECT report FROM citation_reports WHERE project_id = $1 AND project_revision = $2",
    [projectId, revision],
  );
  if (stored) return stored.report;
  const rows = await db.query<{ path: string; content: string }>(
    `SELECT t.path, tr.content FROM tree t JOIN text_revisions tr ON tr.file_id = t.file_id AND tr.revision = t.text_revision
      WHERE t.project_id = $1 AND t.project_revision = $2`,
    [projectId, revision],
  );
  const files = new Map(rows.rows.map((row) => [row.path, row.content]));
  const report: CitationReport = { projectRevision: revision, checkId: randomUUID(), ...citationLists(files) };
  const saved = await db.query<{ report: CitationReport }>(
    `INSERT INTO citation_reports (project_id, project_revision, check_id, report) VALUES ($1, $2, $3, $4)
     ON CONFLICT (project_id, project_revision) DO UPDATE SET report = citation_reports.report
     RETURNING report`,
    [projectId, revision, report.checkId, JSON.stringify(report)],
  );
  return saved.rows[0]?.report ?? report;
}

export async function readCitations(ctx: Context): Promise<Reply> {
  const user = await signedIn(ctx);
  const { project } = await membership(pool, user.id, ctx.params.pid ?? "");
  return ok(await citationReport(pool, project.id, project.revision));
}
