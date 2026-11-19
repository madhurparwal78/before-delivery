import { areaRowsOf } from './area.js';
import { codeAreaOrder, effectiveGap, nextNarrowerScope, sortedBreakpoints } from './grid.js';
import type { Gap, LayoutState, Scope } from './types.js';
import { getScopeGrid } from './grid.js';

export function gapText(gap: Gap): string {
  if (gap.row === gap.column) return `${gap.row}px`;
  return `${gap.row}px ${gap.column}px`;
}

function placedNames(state: LayoutState, scope: Scope): Set<string> {
  const grid = getScopeGrid(state, scope);
  return new Set(grid ? grid.areas.map((area) => area.name) : []);
}

function areaRowLines(state: LayoutState, scope: Scope, indent: string): string[] {
  const grid = getScopeGrid(state, scope);
  if (!grid) return [];
  return areaRowsOf(grid).map((cells) => `${indent}"${cells.join(' ')}"`);
}

/** The single source of the code pane, the preview and the API `css` field. */
export function generateCss(state: LayoutState): string {
  const lines: string[] = [];
  const order = codeAreaOrder(state);
  const basePlaced = placedNames(state, 'base');

  lines.push('.layout {');
  lines.push('  display: grid;');
  lines.push(`  grid-template-columns: ${state.columns.join(' ')};`);
  lines.push(`  grid-template-rows: ${state.rows.join(' ')};`);
  lines.push(`  gap: ${gapText(state.gap)};`);
  if (basePlaced.size > 0) {
    lines.push('  grid-template-areas:');
    const rows = areaRowLines(state, 'base', '    ');
    rows.forEach((row, position) => {
      lines.push(position === rows.length - 1 ? `${row};` : row);
    });
  }
  lines.push('}');

  if (order.length > 0) {
    lines.push('');
    for (const name of order) lines.push(`.${name} { grid-area: ${name}; }`);
    for (const name of order) {
      if (!basePlaced.has(name)) lines.push(`.${name} { display: none; }`);
    }
  }

  for (const breakpoint of sortedBreakpoints(state)) {
    const scope: Scope = breakpoint.min_width;
    const placed = placedNames(state, scope);
    const narrower = placedNames(state, nextNarrowerScope(state, breakpoint.min_width));
    lines.push('');
    lines.push(`@media (min-width: ${breakpoint.min_width}px) {`);
    lines.push('  .layout {');
    lines.push(`    grid-template-columns: ${breakpoint.columns.join(' ')};`);
    lines.push(`    grid-template-rows: ${breakpoint.rows.join(' ')};`);
    if (breakpoint.gap) lines.push(`    gap: ${gapText(breakpoint.gap)};`);
    if (placed.size === 0) {
      lines.push('    grid-template-areas: none;');
    } else {
      lines.push('    grid-template-areas:');
      const rows = areaRowLines(state, scope, '      ');
      rows.forEach((row, position) => {
        lines.push(position === rows.length - 1 ? `${row};` : row);
      });
    }
    lines.push('  }');
    for (const name of order) {
      if (!placed.has(name) && narrower.has(name)) lines.push(`  .${name} { display: none; }`);
    }
    for (const name of order) {
      if (placed.has(name) && !narrower.has(name)) lines.push(`  .${name} { display: block; }`);
    }
    lines.push('}');
  }

  return `${lines.join('\n')}\n`;
}

export function generateHtml(state: LayoutState): string {
  const order = codeAreaOrder(state);
  if (order.length === 0) return '<div class="layout"></div>\n';
  const lines = ['<div class="layout">'];
  for (const name of order) lines.push(`  <div class="${name}">${name}</div>`);
  lines.push('</div>');
  return `${lines.join('\n')}\n`;
}

/** The gap in effect for a scope, written as the generated code writes it. */
export function scopeGapText(state: LayoutState, scope: Scope): string {
  return gapText(effectiveGap(state, scope));
}
