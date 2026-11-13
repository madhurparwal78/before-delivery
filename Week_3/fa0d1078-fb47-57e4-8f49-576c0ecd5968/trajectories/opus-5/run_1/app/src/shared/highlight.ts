import { cellBox, cellColumn, cellRow, type Cell, type Digit } from './board';

/**
 * The tokens `row`, `column`, `box`, `same-digit` in that order for a cell,
 * given the selected cell. The selected cell itself reads `selected`.
 */
export function highlightTokens(
  cell: Cell,
  selected: Cell,
  valueAt: (cell: Cell) => Digit | null,
): string {
  if (cell === selected) return 'selected';
  const tokens: string[] = [];
  if (cellRow(cell) === cellRow(selected)) tokens.push('row');
  if (cellColumn(cell) === cellColumn(selected)) tokens.push('column');
  if (cellBox(cell) === cellBox(selected)) tokens.push('box');
  const selectedValue = valueAt(selected);
  if (selectedValue !== null && valueAt(cell) === selectedValue) tokens.push('same-digit');
  return tokens.join(' ');
}
