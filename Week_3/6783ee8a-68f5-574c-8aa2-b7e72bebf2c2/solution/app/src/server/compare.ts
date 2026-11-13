import type { Cell, CompareResult, CompareRow, DiffLine } from "../shared/api";

/** Compare tagging and the line diff: the only place that decides what changed between two notebooks. */

function lcsTable(a: string[], b: string[]): number[][] {
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  return table;
}

/** Line diff: `same` lines are a longest common subsequence, each checkpoint line matched to the earliest
 *  current line that still allows a longest one; between them every removed line precedes every added line. */
function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const table = lcsTable(a, b);
  const pairs: [number, number][] = [];
  let j = 0;
  for (let i = 0; i < a.length; i++) {
    const need = table[i]![j]!;
    if (need === 0) break;
    for (let k = j; k < b.length; k++) {
      if (a[i] === b[k] && 1 + table[i + 1]![k + 1]! === need) {
        pairs.push([i, k]);
        j = k + 1;
        break;
      }
    }
  }
  const lines: DiffLine[] = [];
  let ai = 0;
  let bi = 0;
  for (const [pi, pj] of [...pairs, [a.length, b.length] as [number, number]]) {
    while (ai < pi) lines.push({ op: "removed", line: a[ai++]! });
    while (bi < pj) lines.push({ op: "added", line: b[bi++]! });
    if (pi < a.length) lines.push({ op: "same", line: a[pi]! });
    ai = pi + 1;
    bi = pj + 1;
  }
  return lines;
}

/** The ids of the longest run of shared cells that keep their relative order; a tie keeps the run whose
 *  cells appear earliest in the current notebook. */
function keptInOrder(sharedInCurrentOrder: number[]): Set<number> {
  const n = sharedInCurrentOrder.length;
  const longest = new Array<number>(n).fill(1);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = i + 1; j < n; j++) {
      if (sharedInCurrentOrder[j]! > sharedInCurrentOrder[i]!) longest[i] = Math.max(longest[i]!, 1 + longest[j]!);
    }
  }
  const kept = new Set<number>();
  let need = Math.max(0, ...longest);
  let last = -1;
  for (let i = 0; i < n && need > 0; i++) {
    if (longest[i] === need && (last === -1 || sharedInCurrentOrder[i]! > sharedInCurrentOrder[last]!)) {
      kept.add(i);
      last = i;
      need--;
    }
  }
  return kept;
}

const sameOutputs = (a: Cell, b: Cell): boolean => JSON.stringify(a.outputs) === JSON.stringify(b.outputs);

export function compareNotebooks(checkpoint: Cell[], current: Cell[]): CompareResult {
  const before = new Map(checkpoint.map((cell, index) => [cell.id, index]));
  const now = new Set(current.map((cell) => cell.id));
  const shared = current.filter((cell) => before.has(cell.id));
  const kept = keptInOrder(shared.map((cell) => before.get(cell.id)!));
  const keptIds = new Set([...kept].map((index) => shared[index]!.id));

  const rowFor = (cell: Cell): CompareRow => {
    const old = checkpoint[before.get(cell.id) ?? -1];
    if (!old) return { tag: "Added", checkpoint_cell: null, current_cell: cell, source_diff: [], output_changed: false };
    const modified = old.source !== cell.source || old.cell_type !== cell.cell_type;
    const tag = modified ? "Modified" : keptIds.has(cell.id) ? "Unchanged" : "Moved";
    return {
      tag,
      checkpoint_cell: old,
      current_cell: cell,
      source_diff: modified ? lineDiff(old.source, cell.source) : [],
      output_changed: !sameOutputs(old, cell),
    };
  };

  const removedAfter = new Map<string | null, CompareRow[]>();
  let anchor: string | null = null;
  for (const cell of checkpoint) {
    if (now.has(cell.id)) {
      anchor = cell.id;
      continue;
    }
    const row: CompareRow = { tag: "Removed", checkpoint_cell: cell, current_cell: null, source_diff: [], output_changed: false };
    removedAfter.set(anchor, [...(removedAfter.get(anchor) ?? []), row]);
  }

  const rows: CompareRow[] = [...(removedAfter.get(null) ?? [])];
  for (const cell of current) rows.push(rowFor(cell), ...(removedAfter.get(cell.id) ?? []));
  const count = (tag: CompareRow["tag"]): number => rows.filter((row) => row.tag === tag).length;
  return { counts: { modified: count("Modified"), added: count("Added"), removed: count("Removed"), moved: count("Moved") }, rows };
}
