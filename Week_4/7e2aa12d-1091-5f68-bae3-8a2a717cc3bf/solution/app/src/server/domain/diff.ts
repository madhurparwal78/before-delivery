import { gapText } from '../../shared/codegen.js';
import type { Area, Gap, Grid, LayoutState } from '../../shared/types.js';

const lines = (area: Area): string => `${area.row_start} / ${area.column_start} / ${area.row_end} / ${area.column_end}`;
const gapLabel = (gap: Gap | null): string => (gap === null ? 'inherited' : gapText(gap));

function areaDifferences(from: Grid, to: Grid, prefix: string): string[] {
  const before = new Map(from.areas.map((area) => [area.name, area]));
  const after = new Map(to.areas.map((area) => [area.name, area]));
  const out: string[] = [];
  for (const name of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const old = before.get(name);
    const next = after.get(name);
    if (!old && next) out.push(`${prefix}Area ${name} added: ${lines(next)}`);
    else if (old && !next) out.push(`${prefix}Area ${name} removed`);
    else if (old && next && lines(old) !== lines(next)) out.push(`${prefix}Area ${name}: ${lines(old)} → ${lines(next)}`);
  }
  return out;
}

function trackDifferences(from: Grid, to: Grid, prefix: string): string[] {
  const out: string[] = [];
  if (from.columns.join(' ') !== to.columns.join(' ')) out.push(`${prefix}Columns: ${from.columns.join(' ')} → ${to.columns.join(' ')}`);
  if (from.rows.join(' ') !== to.rows.join(' ')) out.push(`${prefix}Rows: ${from.rows.join(' ')} → ${to.rows.join(' ')}`);
  return out;
}

/** One line per difference between two saved layouts, in the published order. */
export function compareStates(from: LayoutState, to: LayoutState): string[] {
  const out = trackDifferences(from, to, '');
  if (gapLabel(from.gap) !== gapLabel(to.gap)) out.push(`Gap: ${gapLabel(from.gap)} → ${gapLabel(to.gap)}`);
  out.push(...areaDifferences(from, to, ''));
  const before = new Map(from.breakpoints.map((breakpoint) => [breakpoint.min_width, breakpoint]));
  const after = new Map(to.breakpoints.map((breakpoint) => [breakpoint.min_width, breakpoint]));
  for (const width of [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a - b)) {
    const old = before.get(width);
    const next = after.get(width);
    const prefix = `From ${width}px `;
    if (!old) out.push(`Breakpoint From ${width}px added`);
    else if (!next) out.push(`Breakpoint From ${width}px removed`);
    else {
      out.push(...trackDifferences(old, next, prefix));
      if (gapLabel(old.gap) !== gapLabel(next.gap)) out.push(`${prefix}Gap: ${gapLabel(old.gap)} → ${gapLabel(next.gap)}`);
      out.push(...areaDifferences(old, next, prefix));
    }
  }
  return out.length ? out : ['No differences.'];
}
