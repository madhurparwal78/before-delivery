import type { ChangeEvent, ServiceStatus } from '../shared/types.js';
import { alreadyApplied, loadDetail, reloadTasks } from './actions.js';
import { playCascade, playReverseCascade, reblockRows } from './cascade.js';
import { applySnapshot, applyTasks, getState, setState } from './store.js';
import { settle } from './navigation.js';

/** Each tab keeps the change stream open and applies every change in place. */
export function startLiveUpdates(): void {
  const source = new EventSource('/api/events');
  let dropped = false;

  source.addEventListener('open', () => {
    if (dropped) {
      dropped = false;
      void reloadTasks();
    }
  });
  source.addEventListener('error', () => {
    dropped = true;
  });
  source.addEventListener('status', (event) => {
    setState({ status: JSON.parse((event as MessageEvent<string>).data) as ServiceStatus });
  });
  source.addEventListener('change', (event) => {
    applyRemoteChange(JSON.parse((event as MessageEvent<string>).data) as ChangeEvent);
  });
}

function applyRemoteChange(change: ChangeEvent): void {
  if (alreadyApplied(change.change)) return;
  const open = getState().address.task;
  if ('attachment' in change) {
    applySnapshot(change.snapshot);
    if (open === change.attachment.task) void loadDetail(open);
    return;
  }
  applyTasks(change.tasks);
  applySnapshot(change.snapshot);
  const first = change.tasks[0]?.id ?? null;
  playCascade(first, change.cascade);
  if (change.kind === 'undo') playReverseCascade(first, change.reblocked);
  else reblockRows(change.reblocked);
  if (open !== null && change.tasks.some((task) => task.id === open)) void loadDetail(open);
  settle();
}
