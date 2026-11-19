// Table calculations over the marks left after the measure filter. Compute using decides which view dimensions are
// addressed; the others partition. Within a partition marks keep the view's order, and nothing restarts other than the
// partition.
import type { Cell, TableCalc, TableCalcKind } from '../../shared/model.ts';

export type Shelf = 'rows' | 'columns' | 'detail' | 'color';

interface TableDim {
  name: string;
  shelf: Shelf;
}

/** Which dimensions a calculation runs along; without a pill setting it is Table across. */
function addressed(dims: readonly TableDim[], using: TableCalc | null): boolean[] {
  const innermostRow = dims.map((d) => d.shelf).lastIndexOf('rows');
  return dims.map((dim, i) => {
    switch (using?.using ?? 'table_across') {
      case 'table_across':
        return dim.shelf === 'columns';
      case 'table_down':
        return dim.shelf === 'rows';
      case 'pane_down':
        return i === innermostRow;
      case 'chosen':
        return using?.fields.includes(dim.name) ?? false;
    }
  });
}

/** Mark indexes per partition, each in mark order. `keys[m][d]` is mark m's key under dimension d. */
export function partitions(dims: readonly TableDim[], keys: readonly (readonly string[])[], using: TableCalc | null): number[][] {
  const along = addressed(dims, using);
  const groups = new Map<string, number[]>();
  keys.forEach((markKeys, mark) => {
    const key = markKeys.filter((_, d) => !along[d]).join('\u0001');
    const group = groups.get(key);
    if (group) group.push(mark);
    else groups.set(key, [mark]);
  });
  return [...groups.values()];
}

export function applyTableCalc(kind: TableCalcKind, values: readonly Cell[], parts: readonly number[][]): Cell[] {
  const out: Cell[] = values.map(() => null);
  const num = (mark: number): number | null => {
    const v = values[mark];
    return typeof v === 'number' ? v : null;
  };
  for (const part of parts) {
    switch (kind) {
      case 'run_total': {
        let total = 0;
        for (const mark of part) {
          const v = num(mark);
          if (v === null) continue;
          total += v;
          out[mark] = total;
        }
        break;
      }
      case 'prev_diff':
        part.forEach((mark, i) => {
          const v = num(mark);
          const before = i === 0 ? null : num(part[i - 1] ?? -1);
          out[mark] = v === null || before === null ? null : v - before;
        });
        break;
      case 'share': {
        let total = 0;
        for (const mark of part) total += num(mark) ?? 0;
        for (const mark of part) {
          const v = num(mark);
          out[mark] = v === null || total === 0 ? null : v / total;
        }
        break;
      }
      case 'rank': {
        const ranked = part.filter((m) => num(m) !== null).sort((a, b) => (num(b) ?? 0) - (num(a) ?? 0));
        ranked.forEach((mark, i) => {
          const before = ranked[i - 1];
          out[mark] = before !== undefined && num(before) === num(mark) ? (out[before] ?? null) : i + 1;
        });
        break;
      }
    }
  }
  return out;
}
