// The one place that generates the canonical CSS and HTML for a layout.
import type { LayoutData, AreaLine, Gap, Breakpoint } from './layout.js';
import { sortAreas } from './areas.js';

export function gapText(gap: Gap): string {
  if (gap.row === gap.column) return `${gap.row}px`;
  return `${gap.row}px ${gap.column}px`;
}

export function areasText(areas: AreaLine[], rowCount: number, columnCount: number): string {
  const grid: string[][] = Array.from({ length: rowCount }, () => Array<string>(columnCount).fill('.'));
  for (const area of areas) {
    for (let r = area.row_start; r < area.row_end; r += 1) {
      for (let c = area.column_start; c < area.column_end; c += 1) {
        grid[r - 1]![c - 1] = area.name;
      }
    }
  }
  return grid.map((row) => row.join(' ')).join('\n');
}

/** Area order for rules: base reading order, then each breakpoint narrowest first. */
export function ruleAreaOrder(layout: LayoutData): string[] {
  const order: string[] = [];
  for (const area of sortAreas(layout.areas)) if (!order.includes(area.name)) order.push(area.name);
  for (const bp of layout.breakpoints) {
    for (const area of sortAreas(bp.areas)) if (!order.includes(area.name)) order.push(area.name);
  }
  return order;
}

/** The one decision on the canonical CSS and HTML. */
export function generateCss(layout: LayoutData): string {
  const order = ruleAreaOrder(layout);
  const parts: string[] = [];
  const baseLines: string[] = ['  display: grid;', `  grid-template-columns: ${layout.columns.join(' ')};`, `  grid-template-rows: ${layout.rows.join(' ')};`, `  gap: ${gapText(layout.gap)};`];
  if (layout.areas.length > 0) {
    baseLines.push('  grid-template-areas:');
    const rows = areasText(layout.areas, layout.rows.length, layout.columns.length).split('\n');
    baseLines.push(rows.map((row, index) => `    "${row}"${index === rows.length - 1 ? ';' : ''}`).join('\n'));
  }
  parts.push(`.layout {\n${baseLines.join('\n')}\n}`);
  const gridAreaRules = order.map((name) => `.${name} { grid-area: ${name}; }`).join('\n');
  const hiddenBase = order.filter((name) => !layout.areas.some((a) => a.name === name));
  const hiddenRules = hiddenBase.map((name) => `.${name} { display: none; }`).join('\n');
  if (gridAreaRules && hiddenRules) {
    // One block for the grid-area rules and the base display: none rules.
    parts.push(gridAreaRules + '\n' + hiddenRules);
  } else if (gridAreaRules) {
    parts.push(gridAreaRules);
  } else if (hiddenRules) {
    parts.push(hiddenRules);
  }

  let previousPlaced = new Set(layout.areas.map((a) => a.name));
  for (const bp of layout.breakpoints) {
    const lines: string[] = [];
    lines.push(`grid-template-columns: ${bp.columns.join(' ')};`);
    lines.push(`grid-template-rows: ${bp.rows.join(' ')};`);
    if (bp.gap) lines.push(`gap: ${gapText(bp.gap)};`);
    const placed = new Set(bp.areas.map((a) => a.name));
    if (bp.areas.length > 0) {
      lines.push('grid-template-areas:');
      const rows = areasText(bp.areas, bp.rows.length, bp.columns.length).split('\n');
      rows.forEach((row, index) => lines.push(`  "${row}"${index === rows.length - 1 ? ';' : ''}`));
    } else {
      lines.push('grid-template-areas: none;');
    }
    const block = [`  .layout {\n${lines.map((l) => `    ${l}`).join('\n')}\n  }`];
    for (const name of order) {
      if (!placed.has(name) && previousPlaced.has(name)) block.push(`  .${name} { display: none; }`);
    }
    for (const name of order) {
      if (placed.has(name) && !previousPlaced.has(name)) block.push(`  .${name} { display: block; }`);
    }
    block.push('}');
    parts.push(`@media (min-width: ${bp.min_width}px) {\n${block.join('\n')}`);
    previousPlaced = placed;
  }
  return parts.join('\n\n') + '\n';
}

export function generateHtml(layout: LayoutData): string {
  const order = ruleAreaOrder(layout);
  if (order.length === 0) return '<div class="layout"></div>\n';
  const body = order.map((name) => `  <div class="${name}">${name}</div>`).join('\n');
  return `<div class="layout">\n${body}\n</div>\n`;
}
