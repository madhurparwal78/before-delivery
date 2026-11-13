import { append, clear, el } from './dom.js';
import type { SyncState } from './queue.js';

interface SyncStatus {
  readonly node: HTMLElement;
  readonly update: (state: SyncState) => void;
}

/** The waiting count, which falls only on the server's acknowledgement. */
export function syncStatus(): SyncStatus {
  const node = el('p', { class: 'status', role: 'status', 'aria-label': 'Sync' });
  const update = (state: SyncState): void => {
    clear(node);
    const lines: string[] = [`Waiting to sync ${state.waiting}`];
    if (state.needsFixing > 0) lines.push(`Needs fixing ${state.needsFixing}`);
    if (state.sending) lines.push('Sending readings');
    append(
      node,
      lines.map((line) => el('span', { style: 'display:block', text: line })),
    );
  };
  update({ waiting: 0, needsFixing: 0, sending: false });
  return { node, update };
}
