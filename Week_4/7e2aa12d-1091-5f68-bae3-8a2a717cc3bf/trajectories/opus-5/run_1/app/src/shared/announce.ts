import { decideSetArea } from './area.js';
import { codeAreaOrder, effectiveGap, getScopeGrid, normaliseRect, scopeLabel } from './grid.js';
import type { Change, LayoutState, Scope } from './types.js';

function placedNames(state: LayoutState, scope: Scope): Set<string> {
  const grid = getScopeGrid(state, scope);
  return new Set(grid ? grid.areas.map((area) => area.name) : []);
}

function removedInScope(before: LayoutState, after: LayoutState, scope: Scope): string[] {
  const kept = placedNames(after, scope);
  const gone = placedNames(before, scope);
  return codeAreaOrder(before).filter((name) => gone.has(name) && !kept.has(name));
}

function allNames(state: LayoutState): Set<string> {
  return new Set(codeAreaOrder(state));
}

function trackWord(axis: 'column' | 'row'): string {
  return axis === 'column' ? 'Column' : 'Row';
}

/** The published announcement for an applied change, seen by the author and echoed to peers. */
export function describeChange(change: Change, before: LayoutState, after: LayoutState): string {
  switch (change.kind) {
    case 'set_track': {
      const grid = getScopeGrid(after, change.scope);
      const sizes = change.axis === 'column' ? grid?.columns : grid?.rows;
      const size = sizes?.[change.index - 1] ?? change.size;
      return `${trackWord(change.axis)} ${change.index} set to ${size}.`;
    }
    case 'add_track':
      return `${trackWord(change.axis)} added after ${change.axis} ${change.after}.`;
    case 'remove_track': {
      const removed = removedInScope(before, after, change.scope);
      return (
        `${trackWord(change.axis)} ${change.index} removed.` +
        removed.map((name) => ` Area ${name} removed.`).join('')
      );
    }
    case 'set_gap': {
      const was = effectiveGap(before, change.scope);
      const now = effectiveGap(after, change.scope);
      const parts: string[] = [];
      if (was.row !== now.row) parts.push(`Row gap set to ${now.row}px.`);
      if (was.column !== now.column) parts.push(`Column gap set to ${now.column}px.`);
      if (parts.length === 0) parts.push(`Row gap set to ${now.row}px.`);
      return parts.join(' ');
    }
    case 'set_area': {
      const grid = getScopeGrid(before, change.scope);
      if (!grid) return `Area ${change.name} created.`;
      const outcome = decideSetArea(before, grid, change.name, normaliseRect(change));
      if (outcome.kind === 'rename') return `Area ${outcome.previousName} renamed to ${change.name}.`;
      if (outcome.kind === 'extend') return `Area ${change.name} extended.`;
      return `Area ${change.name} created.`;
    }
    case 'rename_area':
      return `Area ${change.name} renamed to ${change.new_name}.`;
    case 'clear_cells': {
      const removed = removedInScope(before, after, change.scope);
      return 'Cells cleared.' + removed.map((name) => ` Area ${name} removed.`).join('');
    }
    case 'add_breakpoint':
      return `Breakpoint ${scopeLabel(change.min_width)} added.`;
    case 'remove_breakpoint':
      return `Breakpoint ${scopeLabel(change.min_width)} removed.`;
    case 'apply_css': {
      const was = allNames(before);
      const now = allNames(after);
      const added = codeAreaOrder(after).filter((name) => !was.has(name));
      const removed = codeAreaOrder(before).filter((name) => !now.has(name));
      let text = 'CSS applied.';
      if (added.length > 0) text += ` Areas added: ${added.join(', ')}.`;
      if (removed.length > 0) text += ` Areas removed: ${removed.join(', ')}.`;
      return text;
    }
    case 'restore_version':
      return `Restored version ${change.number}.`;
    case 'undo':
      return 'Undone.';
    case 'redo':
      return 'Redone.';
  }
}
