// Doc bodies are stored byte for byte, but a textarea reports every line ending as a line feed.
// `withStoredEndings` puts the original ending back on each line the person did not edit.

export function forEditor(stored: string): string {
  return stored.replace(/\r\n?/g, "\n");
}

interface Line {
  text: string;
  end: string;
}

function linesOf(stored: string): Line[] {
  const lines: Line[] = [];
  let at = 0;
  for (const match of stored.matchAll(/\r\n|\n|\r/g)) {
    lines.push({ text: stored.slice(at, match.index), end: match[0] });
    at = match.index + match[0].length;
  }
  lines.push({ text: stored.slice(at), end: "" });
  return lines;
}

const MAX_COMPARED = 2000;

/** Pairs equal lines of the edited middle (longest common subsequence). */
function matchMiddle(before: Line[], after: string[], offset: number, kept: Map<number, Line>): void {
  if (before.length > MAX_COMPARED || after.length > MAX_COMPARED) return;
  const table = Array.from({ length: before.length + 1 }, () => new Array<number>(after.length + 1).fill(0));
  const cell = (i: number, j: number): number => table[i]?.[j] ?? 0;
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      (table[i] as number[])[j] = before[i]?.text === after[j] ? cell(i + 1, j + 1) + 1 : Math.max(cell(i + 1, j), cell(i, j + 1));
    }
  }
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i]?.text === after[j]) {
      kept.set(j + offset, before[i] as Line);
      i++;
      j++;
    } else if (cell(i + 1, j) >= cell(i, j + 1)) i++;
    else j++;
  }
}

export function withStoredEndings(stored: string, edited: string): string {
  if (forEditor(stored) === edited) return stored;
  const before = linesOf(stored);
  const after = edited.split("\n");
  const kept = new Map<number, Line>();
  let start = 0;
  while (start < before.length && start < after.length && before[start]?.text === after[start]) {
    kept.set(start, before[start] as Line);
    start++;
  }
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1]?.text === after[endAfter - 1]) {
    endBefore--;
    endAfter--;
    kept.set(endAfter, before[endBefore] as Line);
  }
  matchMiddle(before.slice(start, endBefore), after.slice(start, endAfter), start, kept);
  return after.map((text, i) => (i === after.length - 1 ? text : text + (kept.get(i)?.end || "\n"))).join("");
}
