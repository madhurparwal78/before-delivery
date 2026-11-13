import { computeNumbering, compareClue, type WordIndex } from "./grid.js";
import { countChars, validName } from "./util.js";

export interface ParseProblem {
  line: number;
  message: string;
}

export interface ParsedClue {
  number: number;
  direction: "across" | "down";
  text: string;
}

export interface ParsedPuzzle {
  title: string;
  author: string;
  cols: number;
  rows: number;
  /** per row, per square: "#" or the upper-case answer */
  grid: string[][];
  blocks: string[];
  numbers: { row: number; col: number; number: number }[];
  clues: ParsedClue[];
}

export interface ParseResult {
  ok: boolean;
  puzzle?: ParsedPuzzle;
  problems: ParseProblem[];
}

export interface Ref {
  number: number;
  direction: "across" | "down";
}

export const MAX_TITLE_CHARS = 80;
export const MAX_AUTHOR_CHARS = 60;
export const MAX_CLUE_CHARS = 300;

export const clueLabel = (n: number, d: "across" | "down") => `${n} ${d === "across" ? "Across" : "Down"}`;

/**
 * The one place where clue reference groups are recognized. A group ends with
 * `-Across` or `-Down`; earlier numbers are joined by `, ` or ` and `.
 */
export function findReferences(text: string): Ref[] {
  const refs: Ref[] = [];
  for (const m of text.matchAll(/(\d+(?:\s*,\s*\d+)*(?:\s*and\s*\d+)*)-(Across|Down)/g)) {
    const group = m[1]!;
    const direction = m[2]!.toLowerCase() as "across" | "down";
    for (const n of group.split(/(?:\s*,\s*|\s*and\s*)/)) {
      const v = Number(n);
      if (Number.isSafeInteger(v)) refs.push({ number: v, direction });
    }
  }
  return refs;
}

export function isStarred(text: string): boolean {
  return text.trimStart().startsWith("*");
}

const keyOf = (n: number, d: "across" | "down") => `${d[0]}${n}`;

/**
 * The one place where a clue's linked clues are decided: the clues it refers to
 * plus the clues that refer to it, without repeats and without itself, in clue order.
 */
export function computeLinks(clues: ParsedClue[]): Map<string, { number: number; direction: "across" | "down" }[]> {
  const links = new Map<string, { number: number; direction: "across" | "down" }[]>();
  for (const c of clues) links.set(keyOf(c.number, c.direction), []);
  const starredKeys = new Set<string>();
  for (const c of clues) if (isStarred(c.text)) starredKeys.add(keyOf(c.number, c.direction));
  const add = (fromKey: string, ref: Ref) => {
    const toKey = keyOf(ref.number, ref.direction);
    if (fromKey === toKey) return;
    const list = links.get(fromKey);
    if (!list) return;
    if (list.some((x) => keyOf(x.number, x.direction) === toKey)) return;
    list.push(ref);
  };
  for (const c of clues) {
    const self = keyOf(c.number, c.direction);
    for (const ref of findReferences(c.text)) if (links.has(keyOf(ref.number, ref.direction))) add(self, ref);
    if (c.text.includes("starred clues")) {
      for (const k of starredKeys) {
        if (k === self) continue;
        add(self, { number: Number(k.slice(1)), direction: k[0] === "a" ? "across" : "down" });
      }
    }
  }
  for (const [self, list] of links) {
    for (const ref of list) {
      add(keyOf(ref.number, ref.direction), { number: Number(self.slice(1)), direction: self[0] === "a" ? "across" : "down" });
    }
  }
  for (const list of links.values()) list.sort(compareClue);
  return links;
}

interface Line {
  n: number;
  text: string;
}

function decodeBytes(bytes: Buffer, problems: ParseProblem[]): Line[] | null {
  let b = bytes;
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(b);
  } catch {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bad = -1;
    for (let i = 0; i < b.length; i++) {
      try {
        decoder.decode(b.subarray(i, i + 1), { stream: true });
      } catch {
        bad = i;
        break;
      }
    }
    if (bad === -1) {
      let j = b.length - 1;
      while (j > 0 && (b[j]! & 0xc0) === 0x80) j--;
      bad = j;
    }
    const lineOfBad = (b.subarray(0, bad).toString("latin1").match(/\n/g) || []).length + 1;
    problems.push({ line: lineOfBad, message: "file is not valid UTF-8" });
    return null;
  }
  return text.split(/\r\n|\r|\n/).map((t, i) => ({ n: i + 1, text: t.replace(/[ \t]+$/, "") }));
}

const emptyResult = (raw: ParseProblem[]): ParseResult => {
  const problems = [...raw].sort((a, b) => a.line - b.line).slice(0, 20);
  return { ok: false, problems };
};

/** The one place where the Overlap text format is parsed and checked. */
export function parseOverlapText(bytes: Buffer, maxGrid: number): ParseResult {
  const problems: ParseProblem[] = [];
  const lines = decodeBytes(bytes, problems);
  if (!lines) return emptyResult(problems);
  const lineAfter = (): number => lines[lines.length - 1]!.n + 1;
  const content = lines.filter((l) => l.text.trim() !== "");

  if (content.length === 0 || content[0]!.text !== "Overlap 1") {
    problems.push({ line: content.length === 0 ? 1 : content[0]!.n, message: "first line must be Overlap 1" });
    return emptyResult(problems);
  }

  const headers = [
    { key: "Title:", name: "Title" },
    { key: "Author:", name: "Author" },
    { key: "Size:", name: "Size" },
  ];
  let idx = 1;
  let title = "";
  let author = "";
  let sizeOk = false;
  let cols = 0;
  let rows = 0;
  for (const spec of headers) {
    const l = content[idx];
    if (!l || !l.text.startsWith(spec.key)) {
      problems.push({ line: l ? l.n : lineAfter(), message: `expected the ${spec.name}: line` });
      break;
    }
    const value = l.text.slice(spec.key.length).trim();
    if (spec.name === "Title") {
      title = value;
      if (!validName(value, MAX_TITLE_CHARS)) problems.push({ line: l.n, message: "Title must be 1 to 80 characters" });
    } else if (spec.name === "Author") {
      author = value;
      if (!validName(value, MAX_AUTHOR_CHARS)) problems.push({ line: l.n, message: "Author must be 1 to 60 characters" });
    } else {
      const m = /^(\d+)x(\d+)$/.exec(value);
      if (!m) problems.push({ line: l.n, message: "Size must look like 15x15" });
      else {
        const c = Number(m[1]);
        const r = Number(m[2]);
        if (c < 3 || r < 3 || c > maxGrid || r > maxGrid) {
          problems.push({ line: l.n, message: `grid size must be from 3x3 to ${maxGrid}x${maxGrid}` });
        } else {
          sizeOk = true;
          cols = c;
          rows = r;
        }
      }
    }
    idx++;
  }
  if (problems.some((p) => p.message.startsWith("expected the"))) return emptyResult(problems);

  const gridHeader = content[idx];
  if (!gridHeader || gridHeader.text !== "Grid:") {
    problems.push({ line: gridHeader ? gridHeader.n : lineAfter(), message: "expected the Grid: line" });
    return emptyResult(problems);
  }

  const headerIdx = lines.findIndex((l) => l.n === gridHeader.n);
  const gridLines: Line[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.text === "" || l.text.trim() === "Across:" || l.text.trim() === "Down:") break;
    gridLines.push(l);
  }

  let gridOk = sizeOk;
  const gridRows: string[][] = [];
  if (sizeOk) {
    for (const gl of gridLines) {
      const chars = [...gl.text];
      const entries: string[] = [];
      let problem: string | null = null;
      let i = 0;
      scan: while (i < chars.length) {
        const c = chars[i]!;
        if (c === "#") {
          entries.push("#");
          i++;
        } else if (c === "{") {
          const close = chars.indexOf("}", i + 1);
          if (close === -1) {
            problem = "rebus brace is not closed";
            break scan;
          }
          const inner = chars.slice(i + 1, close).join("");
          if (inner.length < 1 || inner.length > 8 || !/^[A-Za-z0-9]+$/.test(inner)) {
            problem = `rebus {${inner}} must be 1 to 8 letters or digits`;
            break scan;
          }
          entries.push(inner.toUpperCase());
          i = close + 1;
        } else if (/[A-Za-z]/.test(c)) {
          entries.push(c.toUpperCase());
          i++;
        } else {
          problem = `unexpected character ${c} in grid row`;
          break scan;
        }
      }
      if (!problem && entries.length !== cols) problem = `grid row has ${entries.length} squares, expected ${cols}`;
      if (problem) {
        problems.push({ line: gl.n, message: problem });
        gridOk = false;
        continue;
      }
      gridRows.push(entries);
    }
    if (gridRows.length !== rows) {
      problems.push({ line: gridHeader.n, message: `grid has ${gridRows.length} rows, expected ${rows}` });
      gridOk = false;
    }
  }

  let words: WordIndex[] = [];
  let numberGrid: number[][] = [];
  let gridClean = gridOk && gridRows.length === rows;
  if (gridClean) {
    const white = gridRows.map((r) => r.map((v) => v !== "#"));
    const numbering = computeNumbering(cols, rows, white);
    words = numbering.words;
    numberGrid = numbering.number;
    const covered = new Set<string>();
    for (const w of words) for (const cell of w.cells) covered.add(`${cell.row},${cell.col}`);
    orphanScan: for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (gridRows[r]![c]! !== "#" && !covered.has(`${r},${c}`)) {
          problems.push({
            line: gridLines[r]!.n,
            message: `square at row ${r + 1}, column ${c + 1} is not part of any word`,
          });
          gridClean = false;
          break orphanScan;
        }
      }
    }
  }
  const wordMatchRuns = gridClean;

  const findBlock = (name: string): Line | null => {
    for (const l of lines) if (l.n > gridHeader.n && l.text.trim() === name) return l;
    return null;
  };
  const acrossH = findBlock("Across:");
  const downH = findBlock("Down:");
  if (!acrossH) problems.push({ line: lineAfter(), message: "expected the Across: line" });
  if (!downH) problems.push({ line: lineAfter(), message: "expected the Down: line" });
  if (!acrossH || !downH) return emptyResult(problems);
  const collectBlock = (start: Line, stop: Line | null): Line[] => {
    const out: Line[] = [];
    for (const l of lines) {
      if (l.n <= start.n) continue;
      if (stop && l.n >= stop.n) break;
      if (l.text.trim() === "") continue;
      out.push(l);
    }
    return out;
  };
  const acrossLines = collectBlock(acrossH, downH);
  const downLines = collectBlock(downH, null);

  interface ClueEntry {
    number: number;
    text: string;
    line: number;
  }
  const parsed: { across: Map<number, ClueEntry>; down: Map<number, ClueEntry> } = { across: new Map(), down: new Map() };
  const reportedLines = new Set<number>();
  const report = (line: number, message: string) => {
    if (reportedLines.has(line)) return;
    reportedLines.add(line);
    problems.push({ line, message });
  };

  const scanClues = (block: Line[], direction: "across" | "down") => {
    const wordsHere = words.filter((w) => w.direction === direction);
    const seen = new Set<number>();
    for (const l of block) {
      const m = /^(\d+)\.[ \t]+(.*)$/.exec(l.text);
      if (!m) {
        report(l.n, "clue must look like 12. Clue text");
        continue;
      }
      const number = Number(m[1]);
      const text = m[2]!;
      if (countChars(text) > MAX_CLUE_CHARS) {
        report(l.n, `clue ${clueLabel(number, direction)} is longer than 300 characters`);
        continue;
      }
      if (wordMatchRuns && !wordsHere.some((w) => w.number === number)) {
        report(l.n, `clue ${number} ${direction === "across" ? "Across" : "Down"} has no matching word in the grid`);
        continue;
      }
      if (seen.has(number)) {
        report(l.n, `clue ${number} ${direction === "across" ? "Across" : "Down"} appears twice`);
        continue;
      }
      seen.add(number);
      parsed[direction].set(number, { number, text, line: l.n });
    }
  };
  scanClues(acrossLines, "across");
  scanClues(downLines, "down");

  if (wordMatchRuns) {
    for (const direction of ["across", "down"] as const) {
      const block = direction === "across" ? acrossLines : downLines;
      for (const l of block) {
        const m = /^(\d+)\.[ \t]+(.*)$/.exec(l.text);
        if (!m) continue;
        const number = Number(m[1]);
        const text = m[2]!;
        const entry = parsed[direction].get(number);
        if (!entry || entry.line !== l.n) continue;
        const label = clueLabel(number, direction);
        for (const ref of findReferences(text)) {
          if (ref.number === number && ref.direction === direction) continue;
          if (!parsed[ref.direction].has(ref.number)) {
            report(l.n, `clue ${label} refers to ${clueLabel(ref.number, ref.direction)}, which is not in the grid`);
            break;
          }
        }
        if (reportedLines.has(l.n)) continue;
        if (text.includes("starred clues")) {
          const starredOther =
            [...parsed.across.entries()].some(([n, e]) => isStarred(e.text) && !(direction === "across" && n === number)) ||
            [...parsed.down.entries()].some(([n, e]) => isStarred(e.text) && !(direction === "down" && n === number));
          if (!starredOther) report(l.n, `clue ${label} refers to starred clues, but no clue is starred`);
        }
      }
    }
  }

  if (wordMatchRowsOk(wordMatchRuns)) {
    for (const direction of ["across", "down"] as const) {
      const wordsHere = words.filter((w) => w.direction === direction);
      const have = parsed[direction];
      const missing = wordsHere.filter((w) => !have.has(w.number)).map((w) => w.number).sort((a, b) => a - b);
      if (missing.length > 0) {
        const heading = direction === "across" ? acrossH : downH;
        problems.push({ line: heading.n, message: `missing clue for ${missing.map((n) => clueLabel(n, direction)).join(", ")}` });
      }
    }
  }

  if (problems.length > 0) return emptyResult(problems);

  const numbers: { row: number; col: number; number: number }[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (numberGrid[r]![c]! > 0) numbers.push({ row: r, col: c, number: numberGrid[r]![c]! });

  const clues: ParsedClue[] = [];
  for (const direction of ["across", "down"] as const)
    for (const e of parsed[direction].values()) clues.push({ number: e.number, direction, text: e.text });

  return {
    ok: true,
    problems: [],
    puzzle: {
      title,
      author,
      cols,
      rows,
      grid: gridRows,
      blocks: gridRows.map((r) => r.map((v) => (v === "#" ? "#" : ".")).join("")),
      numbers,
      clues,
    },
  };
}

function wordMatchRowsOk(v: boolean): boolean {
  return v;
}
