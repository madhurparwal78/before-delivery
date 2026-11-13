import { api } from '../api.js';
import { announce } from '../dom.js';
import { clear, opsForSync, pending, type QueuedOp } from '../queue.js';
import type { Item, ListSummary, SyncResult } from '../apiTypes.js';
import { state, loadCloset, loadLists } from '../main.js';

/**
 * Reconnection. The queued offline changes replay through POST /api/sync in
 * order, once each, and the Sync results region announces how many applied
 * and one sentence for each refused change.
 */

export interface SyncOutcome {
  applied: number;
  total: number;
  sentences: string[];
}

/** The published sentence for one refused change. */
function refusalSentence(result: SyncResult, op: QueuedOp, items: readonly Item[], lists: readonly ListSummary[]): string {
  const list = lists.find((candidate) => candidate.id === op.listId);
  const item = items.find((candidate) => candidate.id === op.itemId);
  const itemName = item?.name ?? 'that change';
  const listName = list?.name ?? 'that list';
  const listState = list?.state ?? 'planning';
  switch (result.reason) {
    case 'item_retired':
    case 'unknown_item':
      return `Not synced: ${itemName} is no longer in your closet.`;
    case 'quantity_exceeds_owned':
      return `Not synced: you own only ${item?.unitsOwned ?? 0} of ${itemName}.`;
    case 'list_not_editable':
      return `Not synced: ${listName} is ${listState} and can't be edited.`;
    case 'line_changed':
      return `Not synced: ${itemName} was changed on another device.`;
    default:
      return `Not synced: ${itemName} had already changed.`;
  }
}

function nameOf(result: SyncResult, items: readonly Item[]): string {
  const id = (result as unknown as { itemId?: string }).itemId;
  if (typeof id === 'string') {
    const item = items.find((candidate) => candidate.id === id);
    if (item !== undefined) return item.name;
  }
  return 'that change';
}

function unitsOf(result: SyncResult, items: readonly Item[]): string {
  const id = (result as unknown as { itemId?: string }).itemId;
  if (typeof id === 'string') {
    const item = items.find((candidate) => candidate.id === id);
    if (item !== undefined) return String(item.unitsOwned);
  }
  return '0';
}

function listName(result: SyncResult, lists: readonly ListSummary[]): string {
  const id = (result as unknown as { listId?: string }).listId;
  if (typeof id === 'string') {
    const list = lists.find((candidate) => candidate.id === id);
    if (list !== undefined) return list.name;
  }
  return 'that list';
}

function listState(result: SyncResult, lists: readonly ListSummary[]): string {
  const id = (result as unknown as { listId?: string }).listId;
  if (typeof id === 'string') {
    const list = lists.find((candidate) => candidate.id === id);
    if (list !== undefined) return list.state;
  }
  return 'planning';
}

export interface SyncAnswer {
  outcome: SyncOutcome | null;
  held: boolean;
}

/** Sends the whole queue once. A 401 holds the queue for the next sign-in. */
export async function syncNow(): Promise<SyncAnswer> {
  const ops = pending().slice();
  if (ops.length === 0) {
    announce('Sync results', '');
    return { outcome: null, held: false };
  }
  const answer = await api.post<{ results: SyncResult[]; lists: ListSummary[] }>('/api/sync', { ops: opsForSync() });
  if (!answer.ok) {
    if (answer.failure.status === 401) return { outcome: null, held: true };
    return { outcome: null, held: false };
  }
  const { results } = answer.body;
  const applied = results.filter((result) => result.result === 'applied').length;
  const sentences = results
    .map((result, index) => ({ result, op: ops[index] as QueuedOp | undefined }))
    .filter((entry) => entry.result.result === 'refused')
    .map((entry) => refusalSentence(entry.result, entry.op ?? ({ opId: '', listId: '', itemId: '', type: 'unpack' } as QueuedOp), state.items, answer.body.lists));
  const summary = `Back online. Synced ${applied} of ${ops.length} changes.${sentences.length > 0 ? ' ' : ''}${sentences.join(' ')}`;
  announce('Sync results', summary);
  // The queue has now been sent; each op is remembered by opId on the server.
  clear();
  await loadCloset();
  await loadLists();
  return { outcome: { applied, total: ops.length, sentences }, held: false };
}
