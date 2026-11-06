import type { Priority } from '../shared/domain.js';
import { bulkSet, undoLast } from './actions.js';
import { commandTargets } from './commands.js';
import { go, setCurrentRow } from './navigation.js';
import { getState, setState } from './store.js';
import { orderedIds, triageTasks } from './view.js';

let shiftBase: string[] = [];

function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) return target.type !== 'checkbox' && target.type !== 'file';
  return false;
}

function keyScope(target: EventTarget | null): 'tasks' | 'triage' | null {
  if (!(target instanceof HTMLElement)) return null;
  const holder = target.closest<HTMLElement>('[data-keys]');
  const scope = holder?.dataset.keys;
  return scope === 'tasks' || scope === 'triage' ? scope : null;
}

function rowIds(scope: 'tasks' | 'triage'): string[] {
  const state = getState();
  return scope === 'triage'
    ? triageTasks(state).map((task) => task.id)
    : orderedIds(state);
}

function moveCurrent(scope: 'tasks' | 'triage', step: number | 'first' | 'last'): string | null {
  const ids = rowIds(scope);
  if (ids.length === 0) return null;
  const index = ids.indexOf(getState().current ?? '');
  let next: number;
  if (step === 'first') next = 0;
  else if (step === 'last') next = ids.length - 1;
  else next = Math.min(ids.length - 1, Math.max(0, (index === -1 ? 0 : index) + step));
  const id = ids[next] ?? null;
  if (scope === 'triage') setState({ current: id });
  else setCurrentRow(id);
  return id;
}

function focusCurrentRow(): void {
  const id = getState().current;
  if (id === null) return;
  document.querySelector<HTMLElement>(`[data-task-row="${id}"]`)?.focus();
}

function toggleSelection(id: string): void {
  setState((state) => ({
    selection: state.selection.includes(id)
      ? state.selection.filter((entry) => entry !== id)
      : [...state.selection, id],
    anchor: null,
  }));
  shiftBase = [];
}

function extendSelection(scope: 'tasks' | 'triage', step: number): void {
  const state = getState();
  const ids = rowIds(scope);
  const anchor = state.anchor ?? state.current;
  if (state.anchor === null) shiftBase = [...state.selection];
  const moved = moveCurrent(scope, step);
  if (moved === null || anchor === null) return;
  const from = ids.indexOf(anchor);
  const to = ids.indexOf(moved);
  const range = ids.slice(Math.min(from, to), Math.max(from, to) + 1);
  setState({ anchor, selection: [...new Set([...shiftBase, ...range])] });
  focusCurrentRow();
}

function openPaletteWith(text: string): void {
  setState({ palette: { open: true, text } });
}

function neighbourColumnRow(step: number): string | null {
  const state = getState();
  const current = state.current;
  if (current === null) return null;
  const columns = document.querySelectorAll<HTMLElement>('[data-column]');
  const list = [...columns];
  const columnIndex = list.findIndex((column) =>
    column.querySelector(`[data-task-row="${current}"]`),
  );
  if (columnIndex === -1) return null;
  const target = list[columnIndex + step];
  if (!target) return null;
  const rows = [...target.querySelectorAll<HTMLElement>('[data-task-row]')];
  if (rows.length === 0) return null;
  const position = [
    ...(list[columnIndex] as HTMLElement).querySelectorAll<HTMLElement>('[data-task-row]'),
  ].findIndex((row) => row.dataset.taskRow === current);
  const row = rows[Math.min(position, rows.length - 1)];
  return row?.dataset.taskRow ?? null;
}

export function handleKeyDown(event: KeyboardEvent): void {
  const state = getState();
  const typing = isTextField(event.target);
  const key = event.key;

  if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'k') {
    event.preventDefault();
    openPaletteWith('');
    return;
  }
  if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'z') {
    if (typing) return;
    event.preventDefault();
    void undoLast();
    return;
  }
  if (state.palette.open || state.dialog.kind !== 'none') return;
  if (typing || event.altKey || event.ctrlKey || event.metaKey) return;

  const scope = keyScope(event.target);
  if (scope === null) return;

  if (event.shiftKey) {
    if (key === 'ArrowDown') {
      event.preventDefault();
      extendSelection(scope, 1);
      return;
    }
    if (key === 'ArrowUp') {
      event.preventDefault();
      extendSelection(scope, -1);
      return;
    }
    return;
  }

  switch (key) {
    case 'j':
    case 'ArrowDown':
      event.preventDefault();
      setState({ anchor: null });
      moveCurrent(scope, 1);
      focusCurrentRow();
      return;
    case 'k':
    case 'ArrowUp':
      event.preventDefault();
      setState({ anchor: null });
      moveCurrent(scope, -1);
      focusCurrentRow();
      return;
    case 'Home':
      event.preventDefault();
      moveCurrent(scope, 'first');
      focusCurrentRow();
      return;
    case 'End':
      event.preventDefault();
      moveCurrent(scope, 'last');
      focusCurrentRow();
      return;
    case 'ArrowLeft':
    case 'ArrowRight':
      if (scope === 'tasks' && state.address.view === 'board' && state.width >= 1200) {
        const id = neighbourColumnRow(key === 'ArrowLeft' ? -1 : 1);
        if (id !== null) {
          event.preventDefault();
          setCurrentRow(id);
          focusCurrentRow();
        }
      }
      return;
    case 'Enter':
      if (scope === 'tasks' && state.current !== null) {
        event.preventDefault();
        go({ task: state.current });
      }
      return;
    case 'Escape':
      event.preventDefault();
      if (state.address.task !== null) go({ task: null });
      else if (state.selection.length > 0) setState({ selection: [], anchor: null });
      return;
    default:
      break;
  }

  if (scope === 'triage' && state.current !== null) {
    if (key === 'a') {
      event.preventDefault();
      setState({ dialog: { kind: 'accept', task: state.current } });
    } else if (key === 'd') {
      event.preventDefault();
      setState({ dialog: { kind: 'decline', task: state.current } });
    } else if (key === 'm') {
      event.preventDefault();
      setState({ dialog: { kind: 'merge', task: state.current } });
    }
    return;
  }

  if (scope !== 'tasks') return;

  if (key === 'x') {
    event.preventDefault();
    if (state.current !== null) toggleSelection(state.current);
    return;
  }
  if (/^[0-4]$/.test(key)) {
    event.preventDefault();
    const targets = commandTargets();
    if (targets.length > 0) void bulkSet(targets, { priority: Number(key) as Priority });
    return;
  }
  if (key === 'a') {
    event.preventDefault();
    openPaletteWith('Assign to ');
    return;
  }
  if (key === 's') {
    event.preventDefault();
    openPaletteWith('Move to ');
    return;
  }
  if (key === 'p') {
    event.preventDefault();
    openPaletteWith('Set priority: ');
    return;
  }
  if (key === 'c') {
    event.preventDefault();
    setState({ dialog: { kind: 'new-task', parent: null } });
  }
}
