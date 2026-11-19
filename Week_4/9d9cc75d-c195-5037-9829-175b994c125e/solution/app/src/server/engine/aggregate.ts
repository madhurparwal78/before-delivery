// The seven aggregations. They ignore nulls; over no values SUM, AVG, MEDIAN, MIN and MAX give null and COUNT gives 0.
// Results are rounded to 9 decimals, as every computed value is.
import { round9 } from '../../shared/display.ts';
import type { Agg, Cell, ValueType } from '../../shared/model.ts';
import { cellKey, compareValues } from './values.ts';

export function aggregate(fn: Agg, values: readonly Cell[], type: ValueType | null): Cell {
  const present = values.filter((v): v is Exclude<Cell, null> => v !== null);
  switch (fn) {
    case 'COUNT':
      return present.length;
    case 'COUNT_UNIQUE':
      return new Set(present.map((v) => cellKey(v, type))).size;
    case 'MIN':
    case 'MAX': {
      if (present.length === 0) return null;
      const sign = fn === 'MIN' ? -1 : 1;
      return present.reduce((best, v) => (compareValues(v, best) * sign > 0 ? v : best));
    }
    default:
      break;
  }
  const numbers = present.filter((v): v is number => typeof v === 'number');
  if (numbers.length === 0) return null;
  if (fn === 'MEDIAN') {
    const sorted = numbers.slice().sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    const upper = sorted[mid] ?? 0;
    return round9(sorted.length % 2 === 1 ? upper : ((sorted[mid - 1] ?? 0) + upper) / 2);
  }
  let sum = 0;
  for (const n of numbers) sum += n;
  return round9(fn === 'AVG' ? sum / numbers.length : sum);
}
