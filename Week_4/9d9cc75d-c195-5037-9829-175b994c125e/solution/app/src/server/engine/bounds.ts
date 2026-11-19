// Bounded work: the View notices for the limits, and the work a view costs, counted before it runs. The time budget
// is enforced while it runs (work.ts).
import { formatCount, formatNumber } from '../../shared/display.ts';
import { rowNodes } from './formula/checker.ts';
import type { RNode } from './formula/resolved.ts';

export const hiddenNotice = (field: string): string => `${field} is hidden.`;
export const NO_ROWS_NOTICE = 'No rows for your account.';
export const workNotice = (max: number): string => `This view needs too much work. The limit is ${formatCount(max)} steps.`;
export const timeNotice = (budgetMs: number): string =>
  `This view took too long. The limit is ${formatNumber(budgetMs / 1000)} seconds.`;
export const markNotice = (marks: number, max: number): string =>
  `This view would draw ${formatCount(marks)} marks. The limit is ${formatCount(max)}. Add a filter or remove a field.`;

/** The source's rows times the row-level nodes of every formula the view uses. */
export function workOf(rowCount: number, formulas: Iterable<RNode>): number {
  let nodes = 0;
  for (const root of formulas) nodes += rowNodes(root);
  return rowCount * nodes;
}
