import { readAddress, writeAddress, type Address } from './address.js';
import { loadDetail } from './actions.js';
import { getState, setState } from './store.js';
import { orderedIds, triageTasks } from './view.js';

type AddressPatch = Partial<Address>;

/** View, department, filter, grouping, cycle and open details each add one history entry. */
export function go(patch: AddressPatch): void {
  apply(patch, false);
}

export function replace(patch: AddressPatch): void {
  apply(patch, true);
}

function apply(patch: AddressPatch, isReplace: boolean): void {
  const next: Address = { ...getState().address, ...patch };
  const text = writeAddress(next);
  if (text !== `${window.location.pathname}${window.location.search}`) {
    if (isReplace) window.history.replaceState(null, '', text);
    else window.history.pushState(null, '', text);
  }
  const previousTask = getState().address.task;
  setState({ address: next });
  if (next.task !== previousTask) void loadDetail(next.task);
  settle();
}

export function navigateTo(path: string, patch: AddressPatch = {}): void {
  const next: Address = {
    ...getState().address,
    row: null,
    task: null,
    ...patch,
    path,
  };
  window.history.pushState(null, '', writeAddress(next));
  setState({ address: next, selection: [], anchor: null, current: null });
  void loadDetail(next.task);
  settle();
}

export function onPopState(): void {
  const next = readAddress();
  const previousTask = getState().address.task;
  setState({ address: next });
  if (next.task !== previousTask) void loadDetail(next.task);
  settle();
}

let lastIds: string[] = [];

/**
 * Keeps the current row in step with the view: an unknown row or task falls back to the
 * default and the address is rewritten without adding history. When the current row leaves
 * the view, the next row becomes current, or the previous one if there is no next.
 */
export function settle(): void {
  const state = getState();
  if (!state.loaded) return;
  if (state.address.path === '/triage') {
    const ids = triageTasks(state).map((task) => task.id);
    const current = pickCurrent(state.current, ids);
    lastIds = ids;
    if (current !== state.current) setState({ current });
    return;
  }
  if (state.address.path !== '/tasks') {
    lastIds = [];
    if (state.current !== null) setState({ current: null });
    return;
  }

  const ids = orderedIds(state);
  let row = state.address.row;
  let task = state.address.task;
  let rewrite = false;
  if (row !== null && !ids.includes(row)) {
    row = null;
    rewrite = true;
  }
  if (task !== null && !state.tasks.has(task)) {
    task = null;
    rewrite = true;
  }
  const current = row !== null ? row : pickCurrent(state.current, ids);
  lastIds = ids;
  if (rewrite) {
    const next: Address = { ...state.address, row, task };
    window.history.replaceState(null, '', writeAddress(next));
    setState({ address: next, current });
    return;
  }
  if (current !== state.current) setState({ current });
}

function pickCurrent(current: string | null, ids: string[]): string | null {
  if (current !== null && ids.includes(current)) return current;
  if (current !== null) {
    const was = lastIds.indexOf(current);
    if (was !== -1) {
      for (let index = was + 1; index < lastIds.length; index += 1) {
        const candidate = lastIds[index] as string;
        if (ids.includes(candidate)) return candidate;
      }
      for (let index = was - 1; index >= 0; index -= 1) {
        const candidate = lastIds[index] as string;
        if (ids.includes(candidate)) return candidate;
      }
    }
  }
  return ids[0] ?? null;
}

/** Moving the current row replaces `row` without adding history. */
export function setCurrentRow(id: string | null): void {
  setState({ current: id });
  if (getState().address.path === '/tasks') replace({ row: id });
}
