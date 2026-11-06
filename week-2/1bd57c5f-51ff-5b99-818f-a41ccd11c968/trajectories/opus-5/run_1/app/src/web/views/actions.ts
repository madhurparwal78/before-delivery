import { COPY, tradeLabel, type Trade } from '../../shared/domain.js';
import { remove, sendForm, sendJson } from '../lib/api.js';
import { announce } from '../lib/shell.js';
import type { Item, LocalItem, Note } from '../lib/types.js';
import {
  itemNumberText,
  messageOf,
  offlineNow,
  withPending,
  type JobCtx,
} from './jobctx.js';
import { STATUS_LABELS } from '../../shared/domain.js';

export type ItemChanges = Partial<{
  title: string;
  room_id: string;
  trade: Trade | null;
  cost_note: string | null;
  quantity: string | null;
  unit_cost: string | null;
  pin: { x: number; y: number } | null;
}>;

function previousValue(item: LocalItem, key: string): unknown {
  switch (key) {
    case 'title':
      return item.title;
    case 'room_id':
      return item.room_id;
    case 'trade':
      return item.trade;
    case 'cost_note':
      return item.cost_note ?? null;
    case 'quantity':
      return item.quantity ?? null;
    case 'unit_cost':
      return item.unit_cost ?? null;
    case 'pin':
      return item.pin;
    default:
      return null;
  }
}

export async function saveItemChanges(
  ctx: JobCtx,
  item: LocalItem,
  changes: ItemChanges,
  control: HTMLButtonElement | HTMLInputElement | HTMLSelectElement | null,
): Promise<void> {
  if (offlineNow()) {
    const encoded: Record<string, { from: unknown; to: unknown }> = {};
    for (const [key, value] of Object.entries(changes)) {
      encoded[key] = { from: previousValue(item, key), to: value as unknown };
    }
    ctx.state.enqueue({ type: 'update_item', item_id: item.id, changes: encoded });
    announce(`Item ${itemNumberText(item)} saved.`);
    ctx.render();
    return;
  }
  const encoded: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, value] of Object.entries(changes)) {
    encoded[key] = { from: previousValue(item, key), to: value as unknown };
  }
  ctx.state.applyOptimistic({ type: 'update_item', item_id: item.id, changes: encoded });
  await withPending(
    control,
    () => sendJson<Item>('PATCH', `/api/jobs/${ctx.state.jobId}/items/${item.id}`, changes),
    (value) => `Item ${value.number} saved.`,
    (message) => `Not saved: ${message}`,
  );
  await ctx.state.refresh();
  ctx.render();
}

export async function dropPin(
  ctx: JobCtx,
  item: LocalItem,
  pin: { x: number; y: number },
  control: HTMLButtonElement | null,
): Promise<boolean> {
  if (offlineNow()) {
    ctx.state.enqueue({
      type: 'update_item',
      item_id: item.id,
      changes: { pin: { from: item.pin, to: pin } },
    });
    const room = roomOfPin(ctx, pin);
    announce(`Pin dropped for item ${itemNumberText(item)} in ${room}.`);
    ctx.render();
    return true;
  }
  try {
    if (control !== null) {
      control.disabled = true;
      control.setAttribute('aria-busy', 'true');
    }
    announce(COPY.saving);
    const saved = await sendJson<Item>(
      'PATCH',
      `/api/jobs/${ctx.state.jobId}/items/${item.id}`,
      { pin },
    );
    await ctx.state.refresh();
    const room = ctx.state.data?.rooms.find((candidate) => candidate.id === saved.room_id);
    announce(`Pin dropped for item ${saved.number} in ${room?.name ?? ''}.`);
    ctx.render();
    return true;
  } catch (error) {
    announce(messageOf(error));
    ctx.render();
    return false;
  } finally {
    if (control !== null) {
      control.disabled = false;
      control.removeAttribute('aria-busy');
    }
  }
}

function roomOfPin(ctx: JobCtx, pin: { x: number; y: number }): string {
  for (const room of ctx.state.data?.rooms ?? []) {
    if (insideOutline(pin, room.outline)) return room.name;
  }
  return '';
}

function insideOutline(point: { x: number; y: number }, outline: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    if (a.x === b.x) {
      if (a.y > point.y !== b.y > point.y && point.x < a.x) inside = !inside;
      if (
        Math.abs(point.x - a.x) < 1e-9 &&
        point.y >= Math.min(a.y, b.y) - 1e-9 &&
        point.y <= Math.max(a.y, b.y) + 1e-9
      ) {
        return true;
      }
    } else if (
      Math.abs(point.y - a.y) < 1e-9 &&
      point.x >= Math.min(a.x, b.x) - 1e-9 &&
      point.x <= Math.max(a.x, b.x) + 1e-9
    ) {
      return true;
    }
  }
  return inside;
}

export async function quickAdd(
  ctx: JobCtx,
  title: string,
  roomId: string,
  input: HTMLInputElement,
): Promise<void> {
  if (offlineNow()) {
    ctx.state.enqueue({
      type: 'create_item',
      client_item_id: ctx.state.newClientItemId(),
      fields: { title, room_id: roomId },
    });
    input.value = '';
    announce('Item new saved.');
    ctx.render();
    input.focus();
    return;
  }
  const provisional = ctx.state.newClientItemId();
  ctx.state.applyOptimistic({
    type: 'create_item',
    client_item_id: provisional,
    fields: { title, room_id: roomId },
  });
  input.value = '';
  const created = await withPending(
    null,
    () => sendJson<Item>('POST', `/api/jobs/${ctx.state.jobId}/items`, { title, room_id: roomId }),
    (value) => `Item ${value.number} saved.`,
    (message) => `Not saved: ${message}`,
  );
  if (created === null) input.value = title;
  await ctx.state.refresh();
  ctx.render();
  input.focus();
}

export async function runItemAction(
  ctx: JobCtx,
  item: LocalItem,
  action: 'start' | 'mark_done' | 'verify' | 'send_back' | 'reopen',
  reason: string | null,
  control: HTMLButtonElement | null,
): Promise<boolean> {
  if (offlineNow()) {
    ctx.state.enqueue({
      type: 'item_action',
      item_id: item.id,
      action,
      ...(reason === null ? {} : { reason }),
    });
    const next = ctx.state.itemByAnyId(item.id);
    announce(`Item ${itemNumberText(item)}: ${STATUS_LABELS[next?.status ?? item.status]}.`);
    ctx.render();
    return true;
  }
  ctx.state.applyOptimistic({ type: 'item_action', item_id: item.id, action });
  const result = await withPending(
    control,
    () =>
      sendJson<Item>('POST', `/api/jobs/${ctx.state.jobId}/items/${item.id}/actions`, {
        action,
        ...(reason === null ? {} : { reason }),
      }),
    (value) => `Item ${value.number}: ${STATUS_LABELS[value.status]}.`,
    (message) => `Not saved: ${message}`,
  );
  await ctx.state.refresh();
  ctx.render();
  return result !== null;
}

export async function deleteItem(
  ctx: JobCtx,
  item: LocalItem,
  control: HTMLButtonElement | null,
): Promise<boolean> {
  const done = await withPending(
    control,
    async () => {
      await remove(`/api/jobs/${ctx.state.jobId}/items/${item.id}`);
      return true;
    },
    () => `Item ${item.number} deleted.`,
    (message) => `Not saved: ${message}`,
  );
  if (done !== null) {
    ctx.ui.selectedItemId = null;
    await ctx.state.refresh();
  }
  ctx.render();
  return done !== null;
}

export async function postNote(
  ctx: JobCtx,
  item: LocalItem,
  body: string,
  audience: 'crew' | 'everyone',
  parentId: string | null,
  control: HTMLButtonElement | null,
): Promise<void> {
  if (offlineNow()) {
    ctx.state.enqueue({
      type: 'add_note',
      item_id: item.id,
      client_note_id: ctx.state.newClientItemId(),
      body,
      audience,
      ...(parentId === null ? {} : { parent_id: parentId }),
    });
    announce('Note posted.');
    ctx.render();
    return;
  }
  const saved = await withPending(
    control,
    () =>
      sendJson<Note>('POST', `/api/jobs/${ctx.state.jobId}/items/${item.id}/notes`, {
        body,
        audience,
        ...(parentId === null ? {} : { parent_id: parentId }),
      }),
    () => 'Note posted.',
    (message) => `Not saved: ${message}`,
  );
  if (saved !== null) await ctx.state.refresh();
  ctx.render();
}

/** The page works out one edit from the longest common start and end, in code points. */
export function diffEdit(before: string, after: string): { pos: number; del: number; insert: string } {
  const a = Array.from(before);
  const b = Array.from(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  ) {
    end++;
  }
  return {
    pos: start,
    del: a.length - start - end,
    insert: b.slice(start, b.length - end).join(''),
  };
}

export async function saveNoteEdit(
  ctx: JobCtx,
  item: LocalItem,
  note: Note,
  baseRev: number,
  text: string,
  control: HTMLButtonElement | null,
): Promise<boolean> {
  const edit = diffEdit(note.body, text);
  if (edit.del === 0 && edit.insert === '') return true;
  if (offlineNow()) {
    ctx.state.enqueue({
      type: 'edit_note',
      item_id: item.id,
      note_id: note.id,
      base_rev: baseRev,
      pos: edit.pos,
      delete: edit.del,
      insert: edit.insert,
    });
    announce('Note updated.');
    ctx.render();
    return true;
  }
  const saved = await withPending(
    control,
    () =>
      sendJson<Note>(
        'POST',
        `/api/jobs/${ctx.state.jobId}/items/${item.id}/notes/${note.id}/edits`,
        { base_rev: baseRev, pos: edit.pos, delete: edit.del, insert: edit.insert },
      ),
    () => 'Note updated.',
    (message) => `Not saved: ${message}`,
  );
  if (saved !== null) await ctx.state.refresh();
  ctx.render();
  return saved !== null;
}

export async function noteUndoRedo(
  ctx: JobCtx,
  item: LocalItem,
  note: Note,
  which: 'undo' | 'redo',
  control: HTMLButtonElement | null,
): Promise<void> {
  const saved = await withPending(
    control,
    () =>
      sendJson<Note>(
        'POST',
        `/api/jobs/${ctx.state.jobId}/items/${item.id}/notes/${note.id}/${which}`,
        {},
      ),
    () => (which === 'undo' ? 'Edit undone.' : 'Edit redone.'),
    (message) => `Not saved: ${message}`,
  );
  if (saved !== null) await ctx.state.refresh();
  ctx.render();
}

export async function uploadPhoto(
  ctx: JobCtx,
  item: LocalItem,
  file: File,
  kind: 'defect' | 'completion',
): Promise<void> {
  const form = new FormData();
  form.append('file', file);
  form.append('kind', kind);
  ctx.ui.uploadingPhotos.add(item.id);
  ctx.render();
  try {
    await sendForm('POST', `/api/jobs/${ctx.state.jobId}/items/${item.id}/photos`, form);
    announce('Photo saved.');
    await ctx.state.refresh();
  } catch (error) {
    announce(messageOf(error));
  } finally {
    ctx.ui.uploadingPhotos.delete(item.id);
    ctx.render();
  }
}

export async function removePhoto(
  ctx: JobCtx,
  photoId: string,
  control: HTMLButtonElement | null,
): Promise<void> {
  const done = await withPending(
    control,
    async () => {
      await remove(`/api/jobs/${ctx.state.jobId}/photos/${photoId}`);
      return true;
    },
    () => 'Photo removed.',
    (message) => message,
  );
  if (done !== null) await ctx.state.refresh();
  ctx.render();
}

export async function resolveConflict(
  ctx: JobCtx,
  item: LocalItem,
  field: string,
  value: unknown,
  control: HTMLButtonElement | null,
): Promise<void> {
  const done = await withPending(
    control,
    () =>
      sendJson<Item>('POST', `/api/jobs/${ctx.state.jobId}/items/${item.id}/resolve`, {
        field,
        value,
      }),
    () => 'Conflict resolved.',
    (message) => message,
  );
  if (done !== null) await ctx.state.refresh();
  ctx.render();
}

export async function setBlockers(
  ctx: JobCtx,
  item: LocalItem,
  ids: string[],
  control: HTMLButtonElement | null,
): Promise<boolean> {
  const done = await withPending(
    control,
    () =>
      sendJson<Item>('PUT', `/api/jobs/${ctx.state.jobId}/items/${item.id}/blocked-by`, {
        item_ids: ids,
      }),
    (value) => `Item ${value.number} saved.`,
    (message) => `Not saved: ${message}`,
  );
  if (done !== null) await ctx.state.refresh();
  ctx.render();
  return done !== null;
}

export async function runBulk(
  ctx: JobCtx,
  action: 'verify' | 'set_trade',
  ids: string[],
  trade: Trade | null,
  control: HTMLButtonElement | null,
): Promise<void> {
  ctx.ui.nothingChanged = null;
  if (control !== null) {
    control.disabled = true;
    control.setAttribute('aria-busy', 'true');
  }
  announce(COPY.saving);
  try {
    await sendJson<{ items: Item[] }>('POST', `/api/jobs/${ctx.state.jobId}/items/bulk`, {
      action,
      item_ids: ids,
      ...(action === 'set_trade' ? { trade } : {}),
    });
    announce(
      action === 'verify'
        ? `${ids.length} items checked off.`
        : `${ids.length} items assigned to ${trade === null ? 'No trade' : tradeLabel(trade)}.`,
    );
    await ctx.state.refresh();
  } catch (error) {
    const body = error instanceof Object && 'body' in error ? (error as { body: Record<string, unknown> }).body : null;
    const failures = body?.failures as { number: number; message: string }[] | undefined;
    if (failures !== undefined) {
      ctx.ui.nothingChanged = failures.map((entry) => ({
        number: entry.number,
        message: entry.message,
      }));
    }
    announce(`Not saved: ${messageOf(error)}`);
  } finally {
    if (control !== null) {
      control.disabled = false;
      control.removeAttribute('aria-busy');
    }
    ctx.render();
  }
}
