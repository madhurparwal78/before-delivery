import { firstOverlap, sortAreas, sortBreakpoints } from '../../shared/grid.js';
import { TEMPLATE_MESSAGE, notRectangle, overlap } from '../../shared/messages.js';
import { checkAreaName, checkBreakpointAdd, checkBreakpointWidth, checkGap, checkTrackCount } from '../../shared/rules.js';
import { parseSize } from '../../shared/sizes.js';
import type { Area, Axis, Breakpoint, Gap, Grid, LayoutState } from '../../shared/types.js';
import type { Limits } from '../config.js';
import { integer, invalid, list, number, record, refuse, text, type Json } from './input.js';
import { Refusal } from './refusal.js';
import { isTemplateName } from '../../shared/templates.js';
import { template } from './templates.js';

function readTracks(source: Json, key: 'columns' | 'rows', axis: Axis, limits: Limits): string[] {
  const entries = list(source, key);
  const sizes = entries.map((entry) => {
    if (typeof entry !== 'string') throw invalid();
    const parsed = parseSize(entry);
    if (!parsed.ok) throw new Refusal(parsed.message);
    return parsed.size;
  });
  refuse(checkTrackCount(axis, sizes.length, limits.maxTracks));
  return sizes;
}

function readGap(value: unknown): Gap {
  const source = record(value);
  const gap = { row: number(source, 'row'), column: number(source, 'column') };
  refuse(checkGap(gap.row) ?? checkGap(gap.column));
  return gap;
}

function readAreas(source: Json, columnCount: number, rowCount: number): Area[] {
  const areas = list(source, 'areas').map((entry): Area => {
    const item = record(entry);
    const area = {
      name: text(item, 'name'),
      row_start: integer(item, 'row_start'),
      column_start: integer(item, 'column_start'),
      row_end: integer(item, 'row_end'),
      column_end: integer(item, 'column_end'),
    };
    refuse(checkAreaName(area.name));
    const inside = area.row_start >= 1 && area.column_start >= 1 && area.row_end > area.row_start && area.column_end > area.column_start;
    if (!inside || area.row_end > rowCount + 1 || area.column_end > columnCount + 1) throw invalid();
    return area;
  });
  const placed = sortAreas(areas);
  placed.forEach((area, index) => {
    const earlier = placed.slice(0, index);
    if (earlier.some((other) => other.name === area.name)) throw new Refusal(notRectangle(area.name));
    const blocker = firstOverlap(earlier, area.name, area);
    if (blocker) throw new Refusal(overlap(area.name, blocker.name));
  });
  return placed;
}

function readGrid(source: Json, limits: Limits): Grid {
  const columns = readTracks(source, 'columns', 'column', limits);
  const rows = readTracks(source, 'rows', 'row', limits);
  return { columns, rows, areas: readAreas(source, columns.length, rows.length) };
}

/** A layout state given as fields, or a starter template: checked with the editor's own rules and messages. */
export function readLayoutState(raw: unknown, limits: Limits): LayoutState {
  const source = record(raw);
  if (source.template !== undefined) {
    if (!isTemplateName(source.template)) throw new Refusal(TEMPLATE_MESSAGE);
    return template(source.template);
  }
  const grid = readGrid(source, limits);
  const gap = readGap(source.gap);
  const breakpoints: Breakpoint[] = [];
  for (const entry of list(source, 'breakpoints')) {
    const item = record(entry);
    const minWidth = number(item, 'min_width');
    refuse(checkBreakpointWidth(minWidth) ?? checkBreakpointAdd(breakpoints.map((breakpoint) => breakpoint.min_width), minWidth, limits.maxBreakpoints));
    breakpoints.push({ min_width: minWidth, ...readGrid(item, limits), gap: item.gap === null ? null : readGap(item.gap) });
  }
  return { ...grid, gap, breakpoints: sortBreakpoints(breakpoints) };
}

