import { PANES, type Diff, type DiffRow, type Files, type PaneDiff } from "../shared/types.js";

const MAX_TABLE_CELLS = 25_000_000;

function lines(pane: string): string[] {
  return pane === "" ? [] : pane.split("\n");
}

function lcsTable(a: string[], b: string[]): Int32Array | null {
  const width = b.length + 1;
  if ((a.length + 1) * width > MAX_TABLE_CELLS) return null;
  const table = new Int32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const down = table[(i + 1) * width + j] ?? 0;
      const right = table[i * width + j + 1] ?? 0;
      table[i * width + j] = a[i] === b[j] ? (table[(i + 1) * width + j + 1] ?? 0) + 1 : Math.max(down, right);
    }
  }
  return table;
}

function middleRows(a: string[], b: string[]): DiffRow[] {
  const table = lcsTable(a, b);
  if (table === null) {
    return [...a.map((text) => ({ change: "removed" as const, text })), ...b.map((text) => ({ change: "added" as const, text }))];
  }
  const width = b.length + 1;
  const at = (i: number, j: number): number => table[i * width + j] ?? 0;
  const rows: DiffRow[] = [];
  let removed: DiffRow[] = [];
  let added: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const left = a[i] as string;
    if (left === b[j] && at(i, j) === at(i + 1, j + 1) + 1) {
      rows.push(...removed, ...added, { change: "same", text: left });
      removed = [];
      added = [];
      i++;
      j++;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      removed.push({ change: "removed", text: left });
      i++;
    } else {
      added.push({ change: "added", text: b[j] as string });
      j++;
    }
  }
  for (; i < a.length; i++) removed.push({ change: "removed", text: a[i] as string });
  for (; j < b.length; j++) added.push({ change: "added", text: b[j] as string });
  return [...rows, ...removed, ...added];
}

function paneDiff(before: string, after: string): PaneDiff {
  const a = lines(before);
  const b = lines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const same = (text: string): DiffRow => ({ change: "same", text });
  const rows = [
    ...a.slice(0, start).map(same),
    ...middleRows(a.slice(start, a.length - end), b.slice(start, b.length - end)),
    ...a.slice(a.length - end).map(same),
  ];
  return {
    added: rows.filter((row) => row.change === "added").length,
    removed: rows.filter((row) => row.change === "removed").length,
    rows,
  };
}

export function diffFiles(before: Files, after: Files): Omit<Diff, "a" | "b"> {
  const [html, css, js] = PANES.map((pane) => paneDiff(before[pane], after[pane])) as [PaneDiff, PaneDiff, PaneDiff];
  return { added: html.added + css.added + js.added, removed: html.removed + css.removed + js.removed, panes: { html, css, js } };
}

export function changedCharacters(diff: Omit<Diff, "a" | "b">): number {
  let total = 0;
  for (const pane of PANES) {
    for (const row of diff.panes[pane].rows) if (row.change !== "same") total += [...row.text].length;
  }
  return total;
}
