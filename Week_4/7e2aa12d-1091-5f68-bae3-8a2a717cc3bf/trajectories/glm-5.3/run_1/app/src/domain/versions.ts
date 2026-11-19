// The one place that decides the differences between two saved versions.
import type { AreaLine, LayoutData } from './layout.js';
import { sortAreas } from './areas.js';
import { gapText } from './generate.js';

export interface StoredVersion { number: number; name: string; layout: LayoutData }

export function versionDifferences(from: StoredVersion, to: StoredVersion): string[] {
  const lines: string[] = [];
  const a = from.layout;
  const b = to.layout;
  if (a.columns.join(' ') !== b.columns.join(' ')) lines.push(`Columns: ${a.columns.join(' ')} → ${b.columns.join(' ')}`);
  if (a.rows.join(' ') !== b.rows.join(' ')) lines.push(`Rows: ${a.rows.join(' ')} → ${b.rows.join(' ')}`);
  if (gapText(a.gap) !== gapText(b.gap)) lines.push(`Gap: ${gapText(a.gap)} → ${gapText(b.gap)}`);

  const names = areaNames(a, b);
  for (const name of names) {
    const old = a.areas.find((x) => x.name === name);
    const neu = b.areas.find((x) => x.name === name);
    if (old && !neu) lines.push(`Area ${name} removed`);
    else if (!old && neu) lines.push(`Area ${name} added: ${neu.row_start} / ${neu.column_start} / ${neu.row_end} / ${neu.column_end}`);
    else if (old && neu && linesDiffer(old, neu)) {
      lines.push(`Area ${name}: ${linesOf(old)} → ${linesOf(neu)}`);
    }
  }

  const widths = breakpointWidths(a, b);
  for (const width of widths) {
    const oldBp = a.breakpoints.find((x) => x.min_width === width);
    const newBp = b.breakpoints.find((x) => x.min_width === width);
    if (!oldBp && newBp) lines.push(`Breakpoint From ${width}px added`);
    else if (oldBp && !newBp) lines.push(`Breakpoint From ${width}px removed`);
    else if (oldBp && newBp) breakpointLines(oldBp, newBp).forEach((line) => lines.push(`From ${width}px ${line}`));
  }
  if (lines.length === 0) return ['No differences.'];
  return lines;
}

function linesDiffer(a: AreaLine, b: AreaLine): boolean {
  return a.row_start !== b.row_start || a.column_start !== b.column_start || a.row_end !== b.row_end || a.column_end !== b.column_end;
}

function linesOf(area: AreaLine): string {
  return `${area.row_start} / ${area.column_start} / ${area.row_end} / ${area.column_end}`;
}

function areaNames(a: LayoutData, b: LayoutData): string[] {
  const names = new Set<string>();
  for (const area of sortAreas(a.areas)) names.add(area.name);
  for (const area of sortAreas(b.areas)) names.add(area.name);
  return [...names].sort();
}

function breakpointWidths(a: LayoutData, b: LayoutData): number[] {
  const widths = new Set<number>();
  for (const bp of a.breakpoints) widths.add(bp.min_width);
  for (const bp of b.breakpoints) widths.add(bp.min_width);
  return [...widths].sort((x, y) => x - y);
}

function breakpointLines(
  oldBp: LayoutData['breakpoints'][number],
  newBp: LayoutData['breakpoints'][number]
): string[] {
  const lines: string[] = [];
  const oldGapText = oldBp.gap ? gapText(oldBp.gap) : 'inherited';
  const newGapText = newBp.gap ? gapText(newBp.gap) : 'inherited';
  if (oldBp.columns.join(' ') !== newBp.columns.join(' ')) {
    lines.push(`Columns: ${oldBp.columns.join(' ')} → ${newBp.columns.join(' ')}`);
  }
  if (oldBp.rows.join(' ') !== newBp.rows.join(' ')) {
    lines.push(`Rows: ${oldBp.rows.join(' ')} → ${newBp.rows.join(' ')}`);
  }
  if (oldGapText !== newGapText) lines.push(`Gap: ${oldGapText} → ${newGapText}`);
  const names = new Set<string>();
  for (const area of oldBp.areas) names.add(area.name);
  for (const area of newBp.areas) names.add(area.name);
  for (const name of [...names].sort()) {
    const old = oldBp.areas.find((x) => x.name === name);
    const neu = newBp.areas.find((x) => x.name === name);
    if (old && !neu) lines.push(`Area ${name} removed`);
    else if (!old && neu) lines.push(`Area ${name} added: ${neu.row_start} / ${neu.column_start} / ${neu.row_end} / ${neu.column_end}`);
    else if (old && neu && linesDiffer(old, neu)) lines.push(`Area ${name}: ${linesOf(old)} → ${linesOf(neu)}`);
  }
  return lines;
}
