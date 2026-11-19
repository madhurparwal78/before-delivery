import { UNKNOWN_CHANGE_MESSAGE } from '../../shared/messages.js';
import { checkAreaName, checkBreakpointWidth, checkCssLength, checkGap } from '../../shared/rules.js';
import { parseSize } from '../../shared/sizes.js';
import type { Axis, Change, LayoutState, Scope } from '../../shared/types.js';
import { readCss } from './css-reader.js';
import type { Limits } from '../config.js';
import { integer, invalid, number, record, refuse, text, type Json } from './input.js';
import { Refusal } from './refusal.js';

/** A change whose own form and values are checked; `apply_css` carries the state its CSS reads as. */
export type PreparedChange = Exclude<Change, { kind: 'apply_css' }> | (Extract<Change, { kind: 'apply_css' }> & { state: LayoutState });

function scopeOf(source: Json): Scope {
  const value = source.scope;
  if (value === 'base') return 'base';
  return integer(source, 'scope');
}

function axisOf(source: Json): Axis {
  const value = source.axis;
  if (value !== 'column' && value !== 'row') throw invalid();
  return value;
}

function rectOf(source: Json) {
  const rect = {
    row_start: integer(source, 'row_start'),
    column_start: integer(source, 'column_start'),
    row_end: integer(source, 'row_end'),
    column_end: integer(source, 'column_end'),
  };
  if (rect.row_start < 1 || rect.column_start < 1 || rect.row_end <= rect.row_start || rect.column_end <= rect.column_start) throw invalid();
  return rect;
}

/** The request's own form and values: everything about a change that does not need the current layout. */
export function prepareChange(raw: unknown, limits: Limits): PreparedChange {
  const source = record(raw);
  const kind = source.kind;
  if (typeof kind !== 'string') throw invalid();
  switch (kind) {
    case 'set_track': {
      const scope = scopeOf(source);
      const axis = axisOf(source);
      const index = integer(source, 'index');
      const parsed = parseSize(text(source, 'size'));
      if (!parsed.ok) throw new Refusal(parsed.message);
      return { kind, scope, axis, index, size: parsed.size };
    }
    case 'add_track':
      return { kind, scope: scopeOf(source), axis: axisOf(source), after: integer(source, 'after') };
    case 'remove_track':
      return { kind, scope: scopeOf(source), axis: axisOf(source), index: integer(source, 'index') };
    case 'set_gap': {
      const change = { kind, scope: scopeOf(source), row: number(source, 'row'), column: number(source, 'column') } as const;
      refuse(checkGap(change.row) ?? checkGap(change.column));
      return change;
    }
    case 'set_area': {
      const name = text(source, 'name');
      const scope = scopeOf(source);
      const rect = rectOf(source);
      refuse(checkAreaName(name));
      return { kind, scope, name, ...rect };
    }
    case 'rename_area': {
      const change = { kind, name: text(source, 'name'), new_name: text(source, 'new_name') } as const;
      refuse(checkAreaName(change.new_name));
      return change;
    }
    case 'clear_cells':
      return { kind, scope: scopeOf(source), ...rectOf(source) };
    case 'add_breakpoint': {
      const minWidth = number(source, 'min_width');
      refuse(checkBreakpointWidth(minWidth));
      return { kind, min_width: minWidth };
    }
    case 'remove_breakpoint':
      return { kind, min_width: number(source, 'min_width') };
    case 'apply_css': {
      const css = text(source, 'css');
      refuse(checkCssLength(css));
      return { kind, css, state: readCss(css, limits) };
    }
    case 'restore_version':
      return { kind, number: integer(source, 'number') };
    case 'undo':
    case 'redo':
      return { kind };
    default:
      throw new Refusal(UNKNOWN_CHANGE_MESSAGE);
  }
}
