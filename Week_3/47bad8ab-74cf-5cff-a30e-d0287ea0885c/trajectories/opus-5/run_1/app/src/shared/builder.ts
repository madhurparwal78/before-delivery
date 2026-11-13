import {
  directionLabel,
  layoutGrid,
  whiteSquaresDisconnected,
  type Direction,
  type GridLayout,
} from './grid';
import { findReferences, isStarred, starredReferenceIndex, type ClueEntry } from './references';
import { graphemeLength, slugifyTitle } from './text';

export type Symmetry = 'None' | 'Rotational' | 'Left-right' | 'Top-bottom' | 'Diagonal';

export interface BuilderDraft {
  title: string;
  author: string;
  cols: number;
  rows: number;
  symmetry: Symmetry;
  /** A letter, '#' for a black square, or '' for an empty white square. */
  cells: string[][];
  /** Clue text keyed by `<direction>:<row>:<col>` of the word's start square. */
  clues: Map<string, string>;
}

export const clueKey = (direction: Direction, row: number, col: number): string =>
  `${direction}:${row}:${col}`;

export function defaultSymmetry(cols: number, rows: number): Symmetry {
  return cols * rows < 49 ? 'None' : 'Rotational';
}

export function symmetryPartner(
  symmetry: Symmetry,
  cols: number,
  rows: number,
  row: number,
  col: number,
): { row: number; col: number } | null {
  switch (symmetry) {
    case 'Rotational':
      return { row: rows - 1 - row, col: cols - 1 - col };
    case 'Left-right':
      return { row, col: cols - 1 - col };
    case 'Top-bottom':
      return { row: rows - 1 - row, col };
    case 'Diagonal':
      return { row: col, col: row };
    case 'None':
      return null;
  }
}

export function builderLayout(draft: BuilderDraft): GridLayout {
  return layoutGrid(draft.cells.map((row) => row.map((cell) => cell === '#')));
}

function clueEntries(draft: BuilderDraft, layout: GridLayout): ClueEntry[] {
  return layout.words.map((word) => ({
    number: word.number,
    direction: word.direction,
    text: (draft.clues.get(clueKey(word.direction, word.row, word.col)) ?? '').trim(),
  }));
}

/** The builder's problems, in the published order. */
export function builderProblems(draft: BuilderDraft): string[] {
  const problems: string[] = [];
  const title = draft.title.trim();
  const author = draft.author.trim();
  if (graphemeLength(title) < 1 || graphemeLength(title) > 80) {
    problems.push('Title must be 1 to 80 characters');
  }
  if (graphemeLength(author) < 1 || graphemeLength(author) > 60) {
    problems.push('Author must be 1 to 60 characters');
  }

  const layout = builderLayout(draft);
  for (const orphan of layout.orphans) {
    problems.push(
      `Square at row ${orphan.row + 1}, column ${orphan.col + 1} is not part of any word`,
    );
  }
  if (whiteSquaresDisconnected(draft.cells.map((row) => row.map((cell) => cell === '#')))) {
    problems.push('The white squares are not all connected');
  }
  for (let row = 0; row < draft.rows; row += 1) {
    const empty = draft.cells[row].filter((cell) => cell === '').length;
    if (empty === 1) problems.push(`Row ${row + 1} has 1 empty square`);
    else if (empty > 1) problems.push(`Row ${row + 1} has ${empty} empty squares`);
  }

  const entries = clueEntries(draft, layout);
  const anyStarred = entries.some((entry) => isStarred(entry.text));
  for (const word of layout.words) {
    const name = `${word.number} ${directionLabel(word.direction)}`;
    const text = (draft.clues.get(clueKey(word.direction, word.row, word.col)) ?? '').trim();
    if (text === '') {
      problems.push(`${name} has no clue`);
      continue;
    }
    if (graphemeLength(text) > 300) {
      problems.push(`${name} clue is longer than 300 characters`);
      continue;
    }
    const candidates: { index: number; message: string }[] = [];
    for (const hit of findReferences(text)) {
      const exists = layout.words.some(
        (candidate) => candidate.number === hit.number && candidate.direction === hit.direction,
      );
      if (!exists) {
        candidates.push({
          index: hit.index,
          message: `${name} refers to ${hit.number} ${directionLabel(hit.direction)}, which is not in the grid`,
        });
      }
    }
    const starredAt = starredReferenceIndex(text);
    if (starredAt >= 0 && !anyStarred) {
      candidates.push({
        index: starredAt,
        message: `${name} refers to starred clues, but no clue is starred`,
      });
    }
    candidates.sort((a, b) => a.index - b.index);
    if (candidates.length > 0) problems.push(candidates[0].message);
  }
  return problems;
}

/** The builder's Overlap text: LF line endings and a final LF. */
export function builderText(draft: BuilderDraft): string {
  const layout = builderLayout(draft);
  const lines: string[] = [
    'Overlap 1',
    `Title: ${draft.title.trim()}`,
    `Author: ${draft.author.trim()}`,
    `Size: ${draft.cols}x${draft.rows}`,
    '',
    'Grid:',
  ];
  for (const row of draft.cells) {
    lines.push(row.map((cell) => (cell === '' ? '#' : cell.toUpperCase())).join(''));
  }
  for (const direction of ['across', 'down'] as Direction[]) {
    lines.push('', `${directionLabel(direction)}:`);
    for (const word of layout.words.filter((candidate) => candidate.direction === direction)) {
      const text = (draft.clues.get(clueKey(direction, word.row, word.col)) ?? '').trim();
      lines.push(`${word.number}. ${text}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export function builderFileName(title: string): string {
  return `${slugifyTitle(title.trim())}.overlap.txt`;
}
