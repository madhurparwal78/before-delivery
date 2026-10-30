// Formula tokens. References keep their source span so a sheet rename or a shared-formula shift can rewrite them.
import { quoteSheetName } from "../refs.js";

export interface CellPart {
  col: number; // may exceed 26: such a reference is outside the grid
  row: number;
  absCol: boolean;
  absRow: boolean;
}

export type Token =
  | { t: "num"; v: number; start: number; end: number }
  | { t: "str"; v: string; start: number; end: number }
  | { t: "ident"; v: string; start: number; end: number }
  | { t: "sheet"; name: string; start: number; end: number }
  | { t: "cell"; a: CellPart; start: number; end: number }
  | { t: "range"; a: CellPart; b: CellPart; start: number; end: number }
  | { t: "cols"; a: CellPart; b: CellPart; start: number; end: number }
  | { t: "op"; v: string; start: number; end: number };

const SPACE = /\s+/y;
const QUOTED_SHEET = /'((?:[^']|'')+)'!/y;
const BARE_SHEET = /([A-Za-z_][A-Za-z0-9_.]*)!/y;
const COLS = /(\$?)([A-Za-z]{1,3})\s*:\s*(\$?)([A-Za-z]{1,3})(?![A-Za-z0-9_($!])/y;
const RANGE = /(\$?)([A-Za-z]{1,3})(\$?)(\d+)\s*:\s*(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(!])/y;
const CELL = /(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(!])/y;
const NUMBER = /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const STRING = /"((?:[^"]|"")*)"/y;
const IDENT = /[A-Za-z_][A-Za-z0-9_.]*/y;
const OPERATOR = /<=|>=|<>|[-+*/^&=<>(),]/y;

function letters(text: string): number {
  let n = 0;
  for (const ch of text.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n;
}

function at(re: RegExp, source: string, pos: number): RegExpExecArray | null {
  re.lastIndex = pos;
  return re.exec(source);
}

/** Tokenises a formula body (without its leading "="); null on a character no token accepts. */
export function tokenize(source: string): Token[] | null {
  const tokens: Token[] = [];
  let pos = 0;
  while (pos < source.length) {
    let m: RegExpExecArray | null;
    if ((m = at(SPACE, source, pos))) {
      pos += m[0].length;
      continue;
    }
    const start = pos;
    if ((m = at(QUOTED_SHEET, source, pos))) {
      tokens.push({ t: "sheet", name: m[1].replaceAll("''", "'"), start, end: start + m[0].length });
    } else if ((m = at(RANGE, source, pos))) {
      tokens.push({
        t: "range",
        a: { absCol: m[1] === "$", col: letters(m[2]), absRow: m[3] === "$", row: Number(m[4]) },
        b: { absCol: m[5] === "$", col: letters(m[6]), absRow: m[7] === "$", row: Number(m[8]) },
        start,
        end: start + m[0].length,
      });
    } else if ((m = at(CELL, source, pos))) {
      tokens.push({
        t: "cell",
        a: { absCol: m[1] === "$", col: letters(m[2]), absRow: m[3] === "$", row: Number(m[4]) },
        start,
        end: start + m[0].length,
      });
    } else if ((m = at(COLS, source, pos))) {
      tokens.push({
        t: "cols",
        a: { absCol: m[1] === "$", col: letters(m[2]), absRow: false, row: 1 },
        b: { absCol: m[3] === "$", col: letters(m[4]), absRow: false, row: 1 },
        start,
        end: start + m[0].length,
      });
    } else if ((m = at(BARE_SHEET, source, pos))) {
      tokens.push({ t: "sheet", name: m[1], start, end: start + m[0].length });
    } else if ((m = at(NUMBER, source, pos))) {
      tokens.push({ t: "num", v: Number(m[0]), start, end: start + m[0].length });
    } else if ((m = at(STRING, source, pos))) {
      tokens.push({ t: "str", v: m[1].replaceAll('""', '"'), start, end: start + m[0].length });
    } else if ((m = at(IDENT, source, pos))) {
      tokens.push({ t: "ident", v: m[0], start, end: start + m[0].length });
    } else if ((m = at(OPERATOR, source, pos))) {
      tokens.push({ t: "op", v: m[0], start, end: start + m[0].length });
    } else {
      return null;
    }
    pos = tokens[tokens.length - 1].end;
  }
  return tokens;
}

function splice(source: string, edits: Array<{ start: number; end: number; text: string }>): string {
  let out = source;
  for (const e of [...edits].sort((x, y) => y.start - x.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/** Rewrites every sheet qualifier naming `oldName` (case-insensitively) to `newName`. */
export function renameSheetInFormula(source: string, oldName: string, newName: string): string {
  const tokens = tokenize(source);
  if (!tokens) return source;
  const target = oldName.toLowerCase();
  const edits = tokens
    .filter((tok): tok is Extract<Token, { t: "sheet" }> => tok.t === "sheet" && tok.name.toLowerCase() === target)
    .map((tok) => ({ start: tok.start, end: tok.end, text: `${quoteSheetName(newName)}!` }));
  return edits.length ? splice(source, edits) : source;
}

function columnText(col: number): string {
  let s = "";
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function shiftPart(p: CellPart, rows: number, cols: number, withRow: boolean): string {
  const col = p.absCol ? p.col : p.col + cols;
  const row = p.absRow ? p.row : p.row + rows;
  return `${p.absCol ? "$" : ""}${columnText(col)}${withRow ? `${p.absRow ? "$" : ""}${row}` : ""}`;
}

/** Moves the relative parts of every reference, as when a shared xlsx formula is filled to another cell. */
export function shiftFormula(source: string, rows: number, cols: number): string {
  const tokens = tokenize(source);
  if (!tokens) return source;
  const edits: Array<{ start: number; end: number; text: string }> = [];
  for (const tok of tokens) {
    if (tok.t === "cell") edits.push({ start: tok.start, end: tok.end, text: shiftPart(tok.a, rows, cols, true) });
    if (tok.t === "range") {
      edits.push({ start: tok.start, end: tok.end, text: `${shiftPart(tok.a, rows, cols, true)}:${shiftPart(tok.b, rows, cols, true)}` });
    }
    if (tok.t === "cols") {
      edits.push({ start: tok.start, end: tok.end, text: `${shiftPart(tok.a, 0, cols, false)}:${shiftPart(tok.b, 0, cols, false)}` });
    }
  }
  return splice(source, edits);
}
