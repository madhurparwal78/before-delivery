import { gapText } from './generate.js';
import type { Area, Gap, LayoutState } from './types.js';

function lines(area: Area): string {
  return `${area.row_start} / ${area.column_start} / ${area.row_end} / ${area.column_end}`;
}

function gapWords(gap: Gap | null): string {
  return gap ? gapText(gap) : 'inherited';
}

function gridLines(
  prefix: string,
  from: { columns: string[]; rows: string[]; areas: Area[]; gap: Gap | null },
  to: { columns: string[]; rows: string[]; areas: Area[]; gap: Gap | null },
): string[] {
  const out: string[] = [];
  const fromColumns = from.columns.join(' ');
  const toColumns = to.columns.join(' ');
  if (fromColumns !== toColumns) out.push(`${prefix}Columns: ${fromColumns} → ${toColumns}`);
  const fromRows = from.rows.join(' ');
  const toRows = to.rows.join(' ');
  if (fromRows !== toRows) out.push(`${prefix}Rows: ${fromRows} → ${toRows}`);
  const fromGap = gapWords(from.gap);
  const toGap = gapWords(to.gap);
  if (fromGap !== toGap) out.push(`${prefix}Gap: ${fromGap} → ${toGap}`);

  const names = [...new Set([...from.areas.map((area) => area.name), ...to.areas.map((area) => area.name)])].sort();
  for (const name of names) {
    const was = from.areas.find((area) => area.name === name);
    const now = to.areas.find((area) => area.name === name);
    if (!was && now) out.push(`${prefix}Area ${name} added: ${lines(now)}`);
    else if (was && !now) out.push(`${prefix}Area ${name} removed`);
    else if (was && now && lines(was) !== lines(now)) {
      out.push(`${prefix}Area ${name}: ${lines(was)} → ${lines(now)}`);
    }
  }
  return out;
}

/** The published list of differences between two saved versions. */
export function versionDifferences(from: LayoutState, to: LayoutState): string[] {
  const out = gridLines(
    '',
    { columns: from.columns, rows: from.rows, areas: from.areas, gap: from.gap },
    { columns: to.columns, rows: to.rows, areas: to.areas, gap: to.gap },
  );

  const widths = [
    ...new Set([
      ...from.breakpoints.map((breakpoint) => breakpoint.min_width),
      ...to.breakpoints.map((breakpoint) => breakpoint.min_width),
    ]),
  ].sort((a, b) => a - b);

  for (const width of widths) {
    const was = from.breakpoints.find((item) => item.min_width === width);
    const now = to.breakpoints.find((item) => item.min_width === width);
    if (!was && now) {
      out.push(`Breakpoint From ${width}px added`);
      continue;
    }
    if (was && !now) {
      out.push(`Breakpoint From ${width}px removed`);
      continue;
    }
    if (was && now) out.push(...gridLines(`From ${width}px `, was, now));
  }

  if (out.length === 0) return ['No differences.'];
  return out;
}
