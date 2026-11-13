import { layoutGrid, type Direction, type GridLayout } from '../../shared/grid';
import {
  computeLinks,
  findReferences,
  isStarred,
  starredReferenceIndex,
  type ClueEntry,
} from '../../shared/references';
import { graphemeLength } from '../../shared/text';
import type { ClueJson } from '../../shared/types';

export interface ParsedPuzzle {
  title: string;
  author: string;
  cols: number;
  rows: number;
  blocks: string[];
  solution: string[][];
  numbers: { row: number; col: number; number: number }[];
  clues: { across: ClueJson[]; down: ClueJson[] };
}

export type ParseResult =
  | { ok: true; puzzle: ParsedPuzzle }
  | { ok: false; count: number; lines: string[] };

const MAX_REPORTED = 20;

/** Index of the first byte that is not part of a valid UTF-8 sequence, or -1. */
function firstInvalidUtf8Byte(bytes: Uint8Array): number {
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    let extra = 0;
    let min = 0;
    let value = 0;
    if (b <= 0x7f) {
      i += 1;
      continue;
    } else if (b >= 0xc2 && b <= 0xdf) {
      extra = 1;
      min = 0x80;
      value = b & 0x1f;
    } else if (b >= 0xe0 && b <= 0xef) {
      extra = 2;
      min = 0x800;
      value = b & 0x0f;
    } else if (b >= 0xf0 && b <= 0xf4) {
      extra = 3;
      min = 0x10000;
      value = b & 0x07;
    } else {
      return i;
    }
    if (i + extra >= bytes.length) return i;
    for (let k = 1; k <= extra; k += 1) {
      const next = bytes[i + k];
      if (next < 0x80 || next > 0xbf) return i;
      value = (value << 6) | (next & 0x3f);
    }
    if (value < min || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return i;
    i += extra + 1;
  }
  return -1;
}

function lineOfByte(bytes: Uint8Array, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (bytes[i] === 0x0a) line += 1;
  return line;
}

interface Problem {
  line: number;
  message: string;
}

class ProblemList {
  private readonly problems: Problem[] = [];

  private readonly claimed = new Set<number>();

  add(line: number, message: string): void {
    if (this.claimed.has(line)) return;
    this.claimed.add(line);
    this.problems.push({ line, message });
  }

  get count(): number {
    return this.problems.length;
  }

  get empty(): boolean {
    return this.problems.length === 0;
  }

  result(): { ok: false; count: number; lines: string[] } {
    const sorted = [...this.problems].sort((a, b) => a.line - b.line);
    return {
      ok: false,
      count: sorted.length,
      lines: sorted.slice(0, MAX_REPORTED).map((p) => `Line ${p.line}: ${p.message}`),
    };
  }
}

interface GridLineParse {
  squares: string[];
  problem: string | null;
}

function parseGridLine(text: string): GridLineParse {
  const squares: string[] = [];
  let badCharacter: string | null = null;
  let rebusContent: string | null = null;
  let unclosed = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '{') {
      const close = text.indexOf('}', i + 1);
      if (close === -1) {
        unclosed = true;
        break;
      }
      const inner = text.slice(i + 1, close);
      if (!/^[A-Za-z0-9]{1,8}$/.test(inner) && rebusContent === null) rebusContent = inner;
      squares.push(inner.toUpperCase());
      i = close + 1;
    } else if (/^[A-Za-z]$/.test(ch)) {
      squares.push(ch.toUpperCase());
      i += 1;
    } else if (ch === '#') {
      squares.push('#');
      i += 1;
    } else {
      if (badCharacter === null) badCharacter = ch;
      i += 1;
    }
  }
  let problem: string | null = null;
  if (badCharacter !== null) problem = `unexpected character ${badCharacter} in grid row`;
  else if (rebusContent !== null)
    problem = `rebus {${rebusContent}} must be 1 to 8 letters or digits`;
  else if (unclosed) problem = 'rebus brace is not closed';
  return { squares, problem };
}

interface RawClue {
  line: number;
  direction: Direction;
  number: number;
  text: string;
}

function clueName(number: number, direction: Direction): string {
  return `clue ${number} ${direction === 'across' ? 'Across' : 'Down'}`;
}

function badReferenceMessage(
  clue: RawClue,
  clues: RawClue[],
  layout: GridLayout,
): string | null {
  const candidates: { index: number; message: string }[] = [];
  for (const hit of findReferences(clue.text)) {
    const exists = layout.words.some(
      (w) => w.number === hit.number && w.direction === hit.direction,
    );
    if (!exists) {
      candidates.push({
        index: hit.index,
        message: `${clueName(clue.number, clue.direction)} refers to ${hit.number} ${
          hit.direction === 'across' ? 'Across' : 'Down'
        }, which is not in the grid`,
      });
    }
  }
  const starredAt = starredReferenceIndex(clue.text);
  if (starredAt >= 0 && !clues.some((c) => isStarred(c.text))) {
    candidates.push({
      index: starredAt,
      message: `${clueName(clue.number, clue.direction)} refers to starred clues, but no clue is starred`,
    });
  }
  candidates.sort((a, b) => a.index - b.index);
  return candidates.length > 0 ? candidates[0].message : null;
}

export function parseOverlapText(bytes: Uint8Array, maxGrid: number): ParseResult {
  const problems = new ProblemList();

  const badByte = firstInvalidUtf8Byte(bytes);
  if (badByte >= 0) {
    problems.add(lineOfByte(bytes, badByte), 'file is not valid UTF-8');
    return problems.result();
  }

  let text = new TextDecoder('utf-8').decode(bytes);
  if (text.startsWith('\uFEFF')) text = text.slice(1);
  const lines = text.split(/\r\n|\n/).map((line) => line.replace(/[ \r]+$/, ''));
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const endLine = lines.length + 1;
  const isBlank = (index: number): boolean => /^ *$/.test(lines[index] ?? '');

  if ((lines[0] ?? '') !== 'Overlap 1') {
    problems.add(1, 'first line must be Overlap 1');
    return problems.result();
  }

  let cursor = 1;
  const nextNonBlank = (): number => {
    while (cursor < lines.length && isBlank(cursor)) cursor += 1;
    return cursor < lines.length ? cursor : -1;
  };
  const expectKey = (
    key: 'Title' | 'Author' | 'Size' | 'Grid' | 'Across' | 'Down',
  ): { index: number; value: string } | null => {
    const index = nextNonBlank();
    if (index === -1) {
      problems.add(endLine, `expected the ${key}: line`);
      return null;
    }
    const line = lines[index];
    if (!line.startsWith(`${key}:`)) {
      problems.add(index + 1, `expected the ${key}: line`);
      return null;
    }
    cursor = index + 1;
    return { index, value: line.slice(key.length + 1).trim() };
  };

  const title = expectKey('Title');
  if (!title) return problems.result();
  if (graphemeLength(title.value) < 1 || graphemeLength(title.value) > 80) {
    problems.add(title.index + 1, 'Title must be 1 to 80 characters');
  }

  const author = expectKey('Author');
  if (!author) return problems.result();
  if (graphemeLength(author.value) < 1 || graphemeLength(author.value) > 60) {
    problems.add(author.index + 1, 'Author must be 1 to 60 characters');
  }

  const size = expectKey('Size');
  if (!size) return problems.result();
  const sizeMatch = /^(\d+)x(\d+)$/.exec(size.value);
  let cols = 0;
  let rows = 0;
  let sizeGood = false;
  if (!sizeMatch) {
    problems.add(size.index + 1, 'Size must look like 15x15');
  } else {
    cols = Number(sizeMatch[1]);
    rows = Number(sizeMatch[2]);
    if (cols < 3 || rows < 3 || cols > maxGrid || rows > maxGrid) {
      problems.add(size.index + 1, `grid size must be from 3x3 to ${maxGrid}x${maxGrid}`);
    } else {
      sizeGood = true;
    }
  }

  const grid = expectKey('Grid');
  if (!grid) return problems.result();

  const gridLines: { index: number; parse: GridLineParse }[] = [];
  while (cursor < lines.length && !isBlank(cursor) && !lines[cursor].startsWith('Across:')) {
    gridLines.push({ index: cursor, parse: parseGridLine(lines[cursor]) });
    cursor += 1;
  }

  let gridClean = sizeGood;
  for (const line of gridLines) {
    if (line.parse.problem !== null) {
      problems.add(line.index + 1, line.parse.problem);
      gridClean = false;
    } else if (sizeGood && line.parse.squares.length !== cols) {
      problems.add(
        line.index + 1,
        `grid row has ${line.parse.squares.length} squares, expected ${cols}`,
      );
      gridClean = false;
    }
  }
  if (sizeGood && gridLines.length !== rows) {
    problems.add(grid.index + 1, `grid has ${gridLines.length} rows, expected ${rows}`);
    gridClean = false;
  }

  let layout: GridLayout = { cols: 0, rows: 0, numbers: [], words: [], orphans: [] };
  let solution: string[][] = [];
  let wordMatching = false;
  if (gridClean) {
    solution = gridLines.map((line) => line.parse.squares);
    const black = solution.map((row) => row.map((square) => square === '#'));
    layout = layoutGrid(black);
    wordMatching = layout.orphans.length === 0;
    const reported = new Set<number>();
    for (const orphan of layout.orphans) {
      if (reported.has(orphan.row)) continue;
      reported.add(orphan.row);
      problems.add(
        gridLines[orphan.row].index + 1,
        `square at row ${orphan.row + 1}, column ${orphan.col + 1} is not part of any word`,
      );
    }
  }

  const across = expectKey('Across');
  if (!across) return problems.result();

  const clueLines: { index: number; direction: Direction }[] = [];
  while (cursor < lines.length && !lines[cursor].startsWith('Down:')) {
    if (!isBlank(cursor)) clueLines.push({ index: cursor, direction: 'across' });
    cursor += 1;
  }
  const downIndex = cursor < lines.length ? cursor : -1;
  if (downIndex === -1) {
    problems.add(endLine, 'expected the Down: line');
  } else {
    cursor = downIndex + 1;
    while (cursor < lines.length) {
      if (!isBlank(cursor)) clueLines.push({ index: cursor, direction: 'down' });
      cursor += 1;
    }
  }

  const clues: RawClue[] = [];
  const syntaxProblems: { index: number; message: string }[] = [];
  for (const line of clueLines) {
    const match = /^(\d+)\. +(.*)$/.exec(lines[line.index]);
    if (!match) {
      syntaxProblems.push({ index: line.index, message: 'clue must look like 12. Clue text' });
      continue;
    }
    clues.push({
      line: line.index + 1,
      direction: line.direction,
      number: Number(match[1]),
      text: match[2].trim(),
    });
  }

  for (const problem of syntaxProblems) problems.add(problem.index + 1, problem.message);

  const seen = new Map<string, number>();
  for (const clue of clues) {
    const key = `${clue.direction}:${clue.number}`;
    const name = clueName(clue.number, clue.direction);
    const duplicate = seen.has(key);
    if (!duplicate) seen.set(key, clue.line);
    if (graphemeLength(clue.text) > 300) {
      problems.add(clue.line, `${name} is longer than 300 characters`);
      continue;
    }
    if (wordMatching) {
      const word = layout.words.find(
        (w) => w.number === clue.number && w.direction === clue.direction,
      );
      if (!word) {
        problems.add(clue.line, `${name} has no matching word in the grid`);
        continue;
      }
      const reference = badReferenceMessage(clue, clues, layout);
      if (reference !== null) {
        problems.add(clue.line, reference);
        continue;
      }
    }
    if (duplicate) problems.add(clue.line, `${name} appears twice`);
  }

  if (wordMatching && downIndex !== -1) {
    for (const block of [
      { direction: 'across' as Direction, line: across.index + 1 },
      { direction: 'down' as Direction, line: downIndex + 1 },
    ]) {
      const missing = layout.words
        .filter((w) => w.direction === block.direction)
        .filter((w) => !seen.has(`${block.direction}:${w.number}`))
        .map((w) => `${w.number} ${block.direction === 'across' ? 'Across' : 'Down'}`);
      if (missing.length > 0) {
        problems.add(block.line, `missing clue for ${missing.join(', ')}`);
      }
    }
  }

  if (!problems.empty) return problems.result();

  const entries: ClueEntry[] = clues.map((clue) => ({
    number: clue.number,
    direction: clue.direction,
    text: clue.text,
  }));
  const links = computeLinks(entries);
  const clueJson = (direction: Direction): ClueJson[] =>
    layout.words
      .filter((word) => word.direction === direction)
      .map((word) => {
        const clue = clues.find((c) => c.number === word.number && c.direction === direction);
        return {
          number: word.number,
          row: word.row,
          col: word.col,
          length: word.length,
          text: clue ? clue.text : '',
          links: links.get(`${direction}:${word.number}`) ?? [],
        };
      });

  return {
    ok: true,
    puzzle: {
      title: title.value,
      author: author.value,
      cols,
      rows,
      blocks: solution.map((row) => row.map((square) => (square === '#' ? '#' : '.')).join('')),
      solution,
      numbers: layout.numbers,
      clues: { across: clueJson('across'), down: clueJson('down') },
    },
  };
}
