import type { FormulaCheckValid } from '../../../../shared/model.ts';
import { TABLE_CALCULATION_FUNCTIONS } from './functions.ts';

/** The published query order, one label per step. */
export const QUERY_ORDER: readonly string[] = [
  'row-level security',
  'data source filter',
  'context filter',
  'AT expressions and {agg}',
  'dimension filter and top N',
  'PLUS and MINUS expressions',
  'aggregation',
  'measure filter',
  'table calculation',
  'table calculation filter',
  'totals and reference lines',
];

function withoutTextLiterals(formula: string): string {
  return formula.replace(/'(?:[^']|'')*'/g, "''");
}

/**
 * The 1-based query-order step a valid formula's result lands at. A table calculation lands at 9. A level-of-detail
 * expression yields a row-level value computed at its own step, 6 for PLUS and MINUS and 4 for AT and `{agg}`, so
 * it wins over the check's `aggregate` flag. Otherwise an aggregate lands at 7 (aggregation), and a plain
 * row-level formula, whose per-row value dimension filters can read, at 5.
 */
export function landingStep(formula: string, check: FormulaCheckValid): number {
  const code = withoutTextLiterals(formula);
  if (new RegExp(`\\b(${TABLE_CALCULATION_FUNCTIONS.join('|')})\\s*\\(`).test(code)) return 9;
  if (/\{\s*(PLUS|MINUS)\b/.test(code)) return 6;
  if (code.includes('{')) return 4;
  return check.aggregate ? 7 : 5;
}
