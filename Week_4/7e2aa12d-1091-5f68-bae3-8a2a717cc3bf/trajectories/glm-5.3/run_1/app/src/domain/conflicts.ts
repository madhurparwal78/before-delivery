// The one place that decides whether a stale change conflicts with a newer one.

export interface Rect { row_start: number; column_start: number; row_end: number; column_end: number }

export type ScopeKey = 'base' | number | 'any';

export type Atom =
  | { type: 'track'; scope: ScopeKey; axis: 'column' | 'row'; index: number }
  | { type: 'scope'; scope: ScopeKey }
  | { type: 'gap'; scope: ScopeKey }
  | { type: 'area'; scope: ScopeKey; name: string }
  | { type: 'cells'; scope: ScopeKey; rect: Rect }
  | { type: 'whole' };

export interface AreaRef { name: string; rect: Rect }

/** The pieces of the layout one change touches. */
export function atomsOf(change: Record<string, unknown>): Atom[] {
  const kind = change['kind'];
  const scope = scopeKey(change['scope']);
  switch (kind) {
    case 'set_track':
      return [{ type: 'track', scope, axis: axisOf(change['axis']), index: numberOf(change['index']) }];
    case 'add_track':
    case 'remove_track':
      return [{ type: 'scope', scope }];
    case 'set_gap':
      return [{ type: 'gap', scope }];
    case 'set_area': {
      const rect = rectOf(change);
      return [
        { type: 'area', scope, name: String(change['name'] ?? '') },
        { type: 'cells', scope, rect },
      ];
    }
    case 'rename_area':
      return [
        { type: 'area', scope: 'any', name: String(change['name'] ?? '') },
        { type: 'area', scope: 'any', name: String(change['new_name'] ?? '') },
      ];
    case 'clear_cells': {
      const rect = rectOf(change);
      return [{ type: 'cells', scope, rect }];
    }
    case 'apply_css':
    case 'restore_version':
    case 'add_breakpoint':
    case 'remove_breakpoint':
      return [{ type: 'whole' }];
    default:
      return [{ type: 'whole' }];
  }
}

export function scopeKey(value: unknown): ScopeKey {
  if (value === undefined || value === null || value === 'base') return 'base';
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && value !== '' && Number.isInteger(Number(value))) return Number(value);
  return 'any';
}

function axisOf(value: unknown): 'column' | 'row' {
  return value === 'row' ? 'row' : 'column';
}

function numberOf(value: unknown): number {
  return typeof value === 'number' ? value : Number(value);
}

function rectOf(change: Record<string, unknown>): Rect {
  return {
    row_start: numberOf(change['row_start']),
    column_start: numberOf(change['column_start']),
    row_end: numberOf(change['row_end']),
    column_end: numberOf(change['column_end']),
  };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.row_start < b.row_end && a.row_end > b.row_start && a.column_start < b.column_end && a.column_end > b.column_start;
}

function sameScope(a: ScopeKey, b: ScopeKey): boolean {
  if (a === 'any' || b === 'any') return true;
  return a === b;
}

export function atomsOverlap(a: Atom, b: Atom): boolean {
  if (a.type === 'whole' || b.type === 'whole') return true;
  if (a.type === 'gap' || b.type === 'gap') {
    if (a.type === 'gap' && b.type === 'gap') return sameScope(a.scope, b.scope);
    // A gap change does not conflict with tracks, cells or areas.
    return false;
  }
  if (a.type === 'scope' || b.type === 'scope') {
    const scopeAtom = a.type === 'scope' ? a : b;
    const other = a.type === 'scope' ? b : a;
    return sameScope(scopeAtom.scope, scopeOfAtom(other));
  }
  if (a.type === 'track' && b.type === 'track') {
    return a.axis === b.axis && a.index === b.index && sameScope(a.scope, b.scope);
  }
  if (a.type === 'area' && b.type === 'area') {
    return a.name === b.name && sameScope(a.scope, b.scope);
  }
  if (a.type === 'cells' && b.type === 'cells') {
    return sameScope(a.scope, b.scope) && rectsOverlap(a.rect, b.rect);
  }
  if ((a.type === 'area' && b.type === 'cells') || (a.type === 'cells' && b.type === 'area')) {
    return sameScope(a.scope, b.scope);
  }
  return false;
}

function scopeOfAtom(atom: Atom): ScopeKey {
  if (atom.type === 'track' || atom.type === 'gap' || atom.type === 'area' || atom.type === 'cells') return atom.scope;
  return 'any';
}

/** True when a later change by another designer touches the same target. */
export function findConflict(
  change: Record<string, unknown>,
  later: Array<{ username: string; change: Record<string, unknown> }>,
): string | null {
  const mine = atomsOf(change);
  for (const entry of later) {
    const theirs = atomsOf(entry.change);
    for (const a of mine) {
      for (const b of theirs) {
        if (atomsOverlap(a, b)) return entry.username;
      }
    }
  }
  return null;
}
