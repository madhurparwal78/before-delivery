import type { Area, Grid, LayoutState } from './types.js';
import { areaOrder, scopesOf } from './grid.js';

export const gapText = (gap: { row: number; column: number }): string =>
  gap.row === gap.column ? `${gap.row}px` : `${gap.row}px ${gap.column}px`;

/** The quoted `grid-template-areas` rows of a grid; every cell is an area name or `.`. */
function areaRows(grid: Grid): string[] {
  const cells = grid.rows.map(() => grid.columns.map(() => '.'));
  for (const area of grid.areas) {
    for (let row = area.row_start; row < area.row_end; row++) {
      for (let column = area.column_start; column < area.column_end; column++) cells[row - 1][column - 1] = area.name;
    }
  }
  return cells.map((row) => `"${row.join(' ')}"`);
}

function areasLines(grid: Grid, indent: string): string[] {
  if (grid.areas.length === 0) return [];
  const rows = areaRows(grid);
  return [`${indent}grid-template-areas:`, ...rows.map((row, i) => `${indent}  ${row}${i === rows.length - 1 ? ';' : ''}`)];
}

const placed = (grid: Grid): Set<string> => new Set(grid.areas.map((area: Area) => area.name));

export function generateCss(state: LayoutState): string {
  const lines = [
    '.layout {',
    '  display: grid;',
    `  grid-template-columns: ${state.columns.join(' ')};`,
    `  grid-template-rows: ${state.rows.join(' ')};`,
    `  gap: ${gapText(state.gap)};`,
    ...areasLines(state, '  '),
    '}',
  ];
  const names = areaOrder(state);
  if (names.length) {
    lines.push('', ...names.map((name) => `.${name} { grid-area: ${name}; }`));
    const basePlaced = placed(state);
    lines.push(...names.filter((name) => !basePlaced.has(name)).map((name) => `.${name} { display: none; }`));
  }
  const scopes = scopesOf(state);
  state.breakpoints.forEach((breakpoint, index) => {
    const narrower = placed(scopes[index].grid);
    const own = placed(breakpoint);
    lines.push('', `@media (min-width: ${breakpoint.min_width}px) {`, '  .layout {');
    lines.push(`    grid-template-columns: ${breakpoint.columns.join(' ')};`, `    grid-template-rows: ${breakpoint.rows.join(' ')};`);
    if (breakpoint.gap) lines.push(`    gap: ${gapText(breakpoint.gap)};`);
    lines.push(...(breakpoint.areas.length ? areasLines(breakpoint, '    ') : ['    grid-template-areas: none;']));
    lines.push('  }');
    lines.push(...names.filter((name) => narrower.has(name) && !own.has(name)).map((name) => `  .${name} { display: none; }`));
    lines.push(...names.filter((name) => own.has(name) && !narrower.has(name)).map((name) => `  .${name} { display: block; }`));
    lines.push('}');
  });
  return `${lines.join('\n')}\n`;
}

export function generateHtml(state: LayoutState): string {
  const names = areaOrder(state);
  if (names.length === 0) return '<div class="layout"></div>\n';
  return `<div class="layout">\n${names.map((name) => `  <div class="${name}">${name}</div>`).join('\n')}\n</div>\n`;
}
