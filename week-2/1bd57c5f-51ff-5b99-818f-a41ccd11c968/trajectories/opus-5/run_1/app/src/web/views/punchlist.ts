import {
  COPY,
  CONFLICT_FIELD_LABELS,
  STATUS_LABELS,
  TRADE_KEYS,
  TRADE_LABELS,
  tradeLabel,
  type ConflictField,
  type ItemStatus,
  type Trade,
} from '../../shared/domain.js';
import { getJson, RequestFailed } from '../lib/api.js';
import { announce } from '../lib/shell.js';
import {
  button,
  el,
  labelledField,
  money,
  openDialog,
  option,
  prefersReducedMotion,
} from '../lib/dom.js';
import type { AccessCard, Conflict, LocalItem, Note, Room } from '../lib/types.js';
import {
  deleteItem,
  noteUndoRedo,
  postNote,
  quickAdd,
  removePhoto,
  resolveConflict,
  runBulk,
  runItemAction,
  saveItemChanges,
  saveNoteEdit,
  setBlockers,
  uploadPhoto,
} from './actions.js';
import {
  currentMode,
  itemNumberText,
  messageOf,
  offlineNow,
  rowName,
  type JobCtx,
} from './jobctx.js';
import { jobLocal } from './tabs.js';

const STATUS_OPTIONS: [string, string][] = [
  ['all', 'All'],
  ['open', 'Open'],
  ['in_progress', 'In progress'],
  ['ready_for_check', 'Ready for check'],
  ['verified', 'Verified'],
];

export function roomOf(ctx: JobCtx, item: LocalItem): Room | undefined {
  return ctx.state.data?.rooms.find((room) => room.id === item.room_id);
}

function matchesFilters(ctx: JobCtx, item: LocalItem): boolean {
  const filters = ctx.ui.filters;
  if (filters.room !== 'all' && item.room_id !== filters.room) return false;
  if (filters.status !== 'all' && item.status !== filters.status) return false;
  if (filters.trade === 'crew' && item.trade !== null) return false;
  if (filters.trade !== 'all' && filters.trade !== 'crew' && item.trade !== filters.trade) {
    return false;
  }
  return true;
}

export function shownItems(ctx: JobCtx): LocalItem[] {
  const data = ctx.state.data;
  if (data === null) return [];
  const order = new Map(data.rooms.map((room, index) => [room.id, index]));
  return data.items
    .filter((item) => matchesFilters(ctx, item))
    .sort(
      (a, b) => (order.get(a.room_id) ?? 0) - (order.get(b.room_id) ?? 0) || a.number - b.number,
    );
}

function canEdit(ctx: JobCtx): boolean {
  const role = ctx.state.data!.job.my_role;
  return role === 'owner' || role === 'lead';
}

function jobOpen(ctx: JobCtx): boolean {
  return ctx.state.data!.job.status !== 'closed_out';
}

/* ------------------------------------------------------------ house access */

function accessRegion(ctx: JobCtx): HTMLElement {
  const data = ctx.state.data!;
  const region = el('section', { class: 'access', role: 'region', 'aria-label': 'House access' });
  const card = ctx.ui.codes;
  if (card !== null) {
    region.append(
      el('dl', { class: 'codes' }, [
        el('dt', {}, ['Lockbox']),
        el('dd', { class: 'num' }, [card.lockbox_code]),
        el('dt', {}, ['Alarm']),
        el('dd', { class: 'num' }, [card.alarm_code]),
        el('dt', {}, ['Garage']),
        el('dd', { class: 'num' }, [card.garage_code]),
        el('dt', {}, ['House note']),
        el('dd', {}, [card.house_note]),
      ]),
    );
    if (card.visible_until !== null) {
      region.append(
        el('p', { class: 'num' }, [
          `Codes visible until ${jobLocal(card.visible_until, data.job.time_zone).slice(11)}`,
        ]),
      );
    }
    region.append(
      button('Hide access codes', { 'data-fk': 'hidecodes' }, () => {
        ctx.ui.codes = null;
        ctx.render();
      }),
    );
  } else {
    region.append(
      button('Show access codes', { 'data-fk': 'showcodes' }, (event) => {
        void revealCodes(ctx, event.currentTarget as HTMLButtonElement);
      }),
    );
  }
  if (ctx.ui.codesError !== null) {
    region.append(el('p', { class: 'fielderror' }, [ctx.ui.codesError]));
  }
  if (data.job.my_role === 'trade' && data.job.next_visit !== null) {
    const next = data.job.next_visit.starts_at.replace('T', ' ').slice(0, 16);
    region.append(el('p', { class: 'num' }, [`Next visit: ${next}`]));
  }
  return region;
}

async function revealCodes(ctx: JobCtx, control: HTMLButtonElement): Promise<void> {
  ctx.ui.codesError = null;
  control.disabled = true;
  control.setAttribute('aria-busy', 'true');
  announce(COPY.saving);
  try {
    ctx.ui.codes = await getJson<AccessCard>(`/api/jobs/${ctx.state.jobId}/access`);
    announce('');
  } catch (error) {
    ctx.ui.codesError = messageOf(error);
    announce(ctx.ui.codesError);
  } finally {
    control.disabled = false;
    control.removeAttribute('aria-busy');
    ctx.render();
  }
}

export function accessTabPanel(ctx: JobCtx): HTMLElement {
  return accessRegion(ctx);
}

/* ---------------------------------------------------------------- the list */

export function buildList(
  ctx: JobCtx,
  hooks: { startPlacement: (itemId: string) => void },
): HTMLElement {
  const data = ctx.state.data!;
  const role = data.job.my_role;
  const list = el('section', { class: 'listpane', role: 'region', 'aria-label': 'Punch list' });

  if (role === 'trade') list.append(accessRegion(ctx));
  if (role !== 'trade' && jobOpen(ctx)) list.append(quickAddRow(ctx));
  list.append(filterRow(ctx));
  if (canEdit(ctx) && jobOpen(ctx)) list.append(bulkRow(ctx));
  if (ctx.ui.nothingChanged !== null) list.append(nothingChangedAlert(ctx));
  if (canEdit(ctx)) {
    const conflicts = conflictRegion(ctx);
    if (conflicts !== null) list.append(conflicts);
  }

  for (const room of data.rooms) {
    const group = el('section', { class: 'roomgroup' });
    group.append(
      el('h2', { class: 'roomheading' }, [room.name]),
      el('p', { class: 'roomcount num' }, [
        `${room.counts.verified} of ${room.counts.total} verified`,
      ]),
    );
    const rows = data.items
      .filter((item) => item.room_id === room.id)
      .sort((a, b) => a.number - b.number);
    const visible = rows.filter((item) => matchesFilters(ctx, item));
    const ul = el('ul', { class: 'rows', 'aria-label': `${room.name} items` });
    for (const item of visible) ul.append(buildRow(ctx, item, hooks));
    group.append(ul);
    if (rows.length === 0) {
      group.append(el('p', { class: 'empty' }, [COPY.emptyRoom]));
    }
    list.append(group);
  }
  return list;
}

function quickAddRow(ctx: JobCtx): HTMLElement {
  const data = ctx.state.data!;
  const field = labelledField('Quick add item', { 'data-fk': 'quickadd' });
  const picker = el('select', {
    'aria-label': 'Quick add room',
    'data-fk': 'quickaddroom',
  }) as HTMLSelectElement;
  for (const room of data.rooms) picker.append(option(room.id, room.name));
  const selected = ctx.state.data!.items.find((item) => item.id === ctx.ui.selectedItemId);
  picker.value = ctx.ui.quickAddRoom ?? selected?.room_id ?? data.rooms[0]?.id ?? '';
  picker.addEventListener('change', () => {
    ctx.ui.quickAddRoom = picker.value;
  });
  field.input.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key !== 'Enter') return;
    event.preventDefault();
    const title = (field.input as HTMLInputElement).value.trim();
    if (title === '' || picker.value === '') return;
    void quickAdd(ctx, title, picker.value, field.input as HTMLInputElement);
  });
  field.input.addEventListener('input', () => {
    ctx.ui.drafts.quickadd = (field.input as HTMLInputElement).value;
  });
  (field.input as HTMLInputElement).value = ctx.ui.drafts.quickadd ?? '';
  return el('div', { class: 'quickadd' }, [field.wrap, picker]);
}

function filterRow(ctx: JobCtx): HTMLElement {
  const data = ctx.state.data!;
  const roomPicker = el('select', { 'aria-label': 'Show room', 'data-fk': 'filterroom' });
  roomPicker.append(option('all', 'All rooms'));
  for (const room of data.rooms) roomPicker.append(option(room.id, room.name));
  roomPicker.value = ctx.ui.filters.room;
  roomPicker.addEventListener('change', () => {
    ctx.ui.filters.room = (roomPicker as HTMLSelectElement).value;
    ctx.render();
  });

  const statusPicker = el('select', { 'aria-label': 'Show status', 'data-fk': 'filterstatus' });
  for (const [value, label] of STATUS_OPTIONS) statusPicker.append(option(value, label));
  statusPicker.value = ctx.ui.filters.status;
  statusPicker.addEventListener('change', () => {
    ctx.ui.filters.status = (statusPicker as HTMLSelectElement).value;
    ctx.render();
  });

  const tradePicker = el('select', { 'aria-label': 'Show trade', 'data-fk': 'filtertrade' });
  tradePicker.append(option('all', 'All trades'), option('crew', 'Crew'));
  for (const trade of TRADE_KEYS) tradePicker.append(option(trade, TRADE_LABELS[trade]));
  tradePicker.value = ctx.ui.filters.trade;
  tradePicker.addEventListener('change', () => {
    ctx.ui.filters.trade = (tradePicker as HTMLSelectElement).value;
    ctx.render();
  });

  return el('div', { class: 'filters' }, [roomPicker, statusPicker, tradePicker]);
}

function bulkRow(ctx: JobCtx): HTMLElement {
  const shown = shownItems(ctx).filter((item) => item.local !== true);
  const count = shown.length;
  const disabled = count === 0 || offlineNow();
  const checkOff = button(
    `Check off ${count} shown`,
    { 'data-fk': 'bulkcheck', disabled: disabled ? 'true' : null },
    (event) =>
      void runBulk(
        ctx,
        'verify',
        shown.map((item) => item.id),
        null,
        event.currentTarget as HTMLButtonElement,
      ),
  );
  checkOff.disabled = disabled;

  const picker = el('select', {
    'aria-label': 'Assign shown to',
    'data-fk': 'assigntrade',
  }) as HTMLSelectElement;
  picker.append(option('all', 'All trades'), option('crew', 'Crew'));
  for (const trade of TRADE_KEYS) picker.append(option(trade, TRADE_LABELS[trade]));
  picker.value = ctx.ui.assignTrade;
  picker.addEventListener('change', () => {
    ctx.ui.assignTrade = picker.value;
  });

  const assign = button(
    `Assign ${count} shown`,
    { 'data-fk': 'bulkassign' },
    (event) =>
      void runBulk(
        ctx,
        'set_trade',
        shown.map((item) => item.id),
        ctx.ui.assignTrade === 'crew' || ctx.ui.assignTrade === 'all'
          ? null
          : (ctx.ui.assignTrade as Trade),
        event.currentTarget as HTMLButtonElement,
      ),
  );
  assign.disabled = disabled;
  return el('div', { class: 'bulk' }, [checkOff, picker, assign]);
}

function nothingChangedAlert(ctx: JobCtx): HTMLElement {
  const failures = ctx.ui.nothingChanged ?? [];
  return el('div', { class: 'nothingchanged', role: 'alert', 'aria-label': 'Nothing changed' }, [
    el('h2', {}, ['Nothing changed']),
    el(
      'ul',
      {},
      [...failures]
        .sort((a, b) => a.number - b.number)
        .map((entry) => el('li', {}, [`Item ${entry.number}: ${entry.message}`])),
    ),
  ]);
}

/* ------------------------------------------------------------- conflicts */

function conflictValueText(ctx: JobCtx, field: string, value: unknown): string {
  if (field === 'pin') {
    if (value === null) return 'No pin';
    const point = value as { x: number; y: number };
    return `${Math.floor(point.x * 100 + 0.5)}%, ${Math.floor(point.y * 100 + 0.5)}%`;
  }
  if (field === 'room_id') {
    return ctx.state.data!.rooms.find((room) => room.id === value)?.name ?? '';
  }
  if (field === 'trade') return value === null ? 'No trade' : tradeLabel(value as Trade);
  if (field === 'quantity' || field === 'unit_cost') {
    return value === null ? 'No value' : String(value);
  }
  return value === null ? '' : String(value);
}

function conflictRegion(ctx: JobCtx): HTMLElement | null {
  const data = ctx.state.data!;
  const groups: HTMLElement[] = [];
  for (const item of [...data.items].sort((a, b) => a.number - b.number)) {
    for (const conflict of item.conflicts ?? []) {
      groups.push(conflictGroup(ctx, item, conflict));
    }
  }
  if (groups.length === 0) return null;
  return el(
    'section',
    { class: 'conflicts', role: 'region', 'aria-label': COPY.conflictHeading },
    [el('h2', {}, [COPY.conflictHeading]), ...groups],
  );
}

function conflictGroup(ctx: JobCtx, item: LocalItem, conflict: Conflict): HTMLElement {
  const label = CONFLICT_FIELD_LABELS[conflict.field as ConflictField] ?? conflict.field;
  const group = el('div', { class: 'conflictgroup', role: 'group', 'aria-label': `Item ${item.number}: ${label}` }, [
    el('h3', {}, [`Item ${item.number}: ${label}`]),
  ]);
  for (const side of [
    { value: conflict.server_value, by: conflict.server_by },
    { value: conflict.phone_value, by: conflict.phone_by },
  ]) {
    const text = conflictValueText(ctx, conflict.field, side.value);
    group.append(el('p', {}, [`${side.by} set ${text}`]));
    group.append(
      button(`Keep ${text}`, { 'data-fk': `keep-${item.id}-${conflict.field}-${text}` }, (event) =>
        void resolveConflict(
          ctx,
          item,
          conflict.field,
          side.value,
          event.currentTarget as HTMLButtonElement,
        ),
      ),
    );
  }
  return group;
}

/* -------------------------------------------------------------- the rows */

function mayStart(ctx: JobCtx, item: LocalItem): boolean {
  const role = ctx.state.data!.job.my_role;
  if (role === 'owner' || role === 'lead') return true;
  return role === 'trade' && item.trade !== null && item.trade === ctx.state.data!.job.my_trade;
}

function buildRow(
  ctx: JobCtx,
  item: LocalItem,
  hooks: { startPlacement: (itemId: string) => void },
): HTMLElement {
  const selected = ctx.ui.selectedItemId === item.id;
  const number = itemNumberText(item);
  const row = el('li', {
    class: `row${selected ? ' selected' : ''}`,
    'aria-label': rowName(item),
    tabindex: '0',
    'data-fk': `row-${item.id}`,
    'data-item': item.id,
    draggable: canEdit(ctx) ? 'true' : null,
  });
  if (selected) row.setAttribute('aria-current', 'true');

  const summary = el('div', { class: 'rowsummary' }, [
    el('span', { class: 'rownumber num' }, [number]),
    el('span', { class: 'rowtitle' }, [item.title]),
    el('span', { class: 'rowtrade' }, [item.trade === null ? 'Crew' : TRADE_LABELS[item.trade]]),
    el('span', { class: `rowstatus status-${item.status}` }, [STATUS_LABELS[item.status]]),
  ]);
  if (item.pin_status === 'placed') {
    summary.append(el('span', { class: 'pinglyph', 'aria-hidden': 'true' }, ['◆']));
  } else if (item.pin_status === 'needs_review') {
    summary.append(el('span', { class: 'rowreview' }, [COPY.reviewText]));
  }
  if (item.blocked_by.length > 0) {
    summary.append(
      el('span', { class: 'rowwaiting' }, [`Waiting on ${item.blocked_by.join(', ')}`]),
    );
  }
  if (selected && item.pin !== null && prefersReducedMotion()) {
    summary.append(
      el('span', { class: 'rowpinned' }, [`Pinned in ${roomOf(ctx, item)?.name ?? ''}`]),
    );
  }

  const actions = el('div', { class: 'rowactions' });
  if (canEdit(ctx) && jobOpen(ctx) && item.local !== true) {
    actions.append(
      button(`Check off item ${number}`, { 'data-fk': `verify-${item.id}` }, (event) =>
        void runItemAction(ctx, item, 'verify', null, event.currentTarget as HTMLButtonElement),
      ),
    );
  }
  if (item.status === 'open' && mayStart(ctx, item) && jobOpen(ctx) && item.local !== true) {
    actions.append(
      button(`Start item ${number}`, { 'data-fk': `start-${item.id}` }, (event) =>
        void runItemAction(ctx, item, 'start', null, event.currentTarget as HTMLButtonElement),
      ),
    );
  }
  if (item.status === 'in_progress' && mayStart(ctx, item) && jobOpen(ctx) && item.local !== true) {
    actions.append(
      button(`Mark item ${number} done`, { 'data-fk': `done-${item.id}` }, (event) =>
        void runItemAction(ctx, item, 'mark_done', null, event.currentTarget as HTMLButtonElement),
      ),
    );
  }
  summary.append(actions);

  const transient = el('p', { class: 'rowtransient' });
  if (ctx.ui.uploadingPhotos.has(item.id)) transient.textContent = COPY.photoUploading;
  else if ((item.pendingKeys ?? []).length > 0) transient.textContent = COPY.waitingToSync;
  else if (item.notSaved) transient.textContent = item.notSaved;
  summary.append(transient);

  row.append(summary);
  if (selected) row.append(buildDetails(ctx, item, hooks));

  row.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('button, input, select, textarea, a') !== null) return;
    select(ctx, item.id);
  });
  row.addEventListener('keydown', (event) => {
    const key = event.key;
    const target = event.target as HTMLElement;
    const typing = target.matches('input, textarea, select');
    if ((key === 'Enter' || key === ' ') && target === row) {
      event.preventDefault();
      select(ctx, item.id);
      return;
    }
    if (key === 'Escape' && !typing && ctx.ui.placement === null) {
      event.preventDefault();
      ctx.ui.selectedItemId = null;
      ctx.render();
      return;
    }
    if ((key === 'p' || key === 'P') && !typing) {
      event.preventDefault();
      hooks.startPlacement(item.id);
    }
  });
  if (canEdit(ctx)) {
    row.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData('text/snaglight-item', item.id);
    });
  }
  return row;
}

/** The row that takes focus once a row leaves the list. */
function nextRowAfter(ctx: JobCtx, itemId: string): string | null {
  const shown = shownItems(ctx);
  const at = shown.findIndex((item) => item.id === itemId);
  if (at === -1) return null;
  const next = shown[at + 1] ?? shown[at - 1];
  return next === undefined ? null : next.id;
}

export function select(ctx: JobCtx, itemId: string): void {
  ctx.ui.selectedItemId = itemId;
  const item = ctx.state.data!.items.find((candidate) => candidate.id === itemId);
  ctx.ui.pendingFrame = item?.room_id ?? null;
  if (currentMode() === 'sheet') ctx.ui.showPlan = true;
  ctx.render();
}

/* ------------------------------------------------------------ the details */

function buildDetails(
  ctx: JobCtx,
  item: LocalItem,
  hooks: { startPlacement: (itemId: string) => void },
): HTMLElement {
  const data = ctx.state.data!;
  const number = itemNumberText(item);
  const region = el('div', {
    class: 'details',
    role: 'region',
    'aria-label': `Item ${number} details`,
  });
  const editable = canEdit(ctx) && jobOpen(ctx);

  if (editable) {
    const title = labelledField('Title', { 'data-fk': `title-${item.id}` });
    (title.input as HTMLInputElement).value = ctx.ui.drafts[`title-${item.id}`] ?? item.title;
    bindText(ctx, title.input as HTMLInputElement, `title-${item.id}`, (value) =>
      saveItemChanges(ctx, item, { title: value }, null),
    );
    region.append(title.wrap);

    const roomPicker = el('select', {
      'aria-label': 'Room',
      'data-fk': `room-${item.id}`,
    }) as HTMLSelectElement;
    for (const room of data.rooms) roomPicker.append(option(room.id, room.name));
    roomPicker.value = item.room_id;
    roomPicker.addEventListener('change', () => {
      void saveItemChanges(ctx, item, { room_id: roomPicker.value }, roomPicker);
    });
    region.append(roomPicker);

    const tradePicker = el('select', {
      'aria-label': 'Trade',
      'data-fk': `trade-${item.id}`,
    }) as HTMLSelectElement;
    tradePicker.append(option('', 'No trade'));
    for (const trade of TRADE_KEYS) tradePicker.append(option(trade, TRADE_LABELS[trade]));
    tradePicker.value = item.trade ?? '';
    tradePicker.addEventListener('change', () => {
      void saveItemChanges(
        ctx,
        item,
        { trade: tradePicker.value === '' ? null : (tradePicker.value as Trade) },
        tradePicker,
      );
    });
    region.append(tradePicker);

    const costNote = labelledField('Cost note', { 'data-fk': `costnote-${item.id}` });
    (costNote.input as HTMLInputElement).value =
      ctx.ui.drafts[`costnote-${item.id}`] ?? item.cost_note ?? '';
    bindText(ctx, costNote.input as HTMLInputElement, `costnote-${item.id}`, (value) =>
      saveItemChanges(ctx, item, { cost_note: value }, null),
    );
    region.append(costNote.wrap);

    const quantity = labelledField('Quantity', { 'data-fk': `quantity-${item.id}`, inputmode: 'decimal' });
    (quantity.input as HTMLInputElement).value =
      ctx.ui.drafts[`quantity-${item.id}`] ?? item.quantity ?? '';
    bindText(ctx, quantity.input as HTMLInputElement, `quantity-${item.id}`, (value) =>
      saveItemChanges(ctx, item, { quantity: value === '' ? null : value }, null),
    );
    region.append(quantity.wrap);

    const unitCost = labelledField('Unit cost', { 'data-fk': `unitcost-${item.id}`, inputmode: 'decimal' });
    (unitCost.input as HTMLInputElement).value =
      ctx.ui.drafts[`unitcost-${item.id}`] ?? item.unit_cost ?? '';
    bindText(ctx, unitCost.input as HTMLInputElement, `unitcost-${item.id}`, (value) =>
      saveItemChanges(ctx, item, { unit_cost: value === '' ? null : value }, null),
    );
    region.append(unitCost.wrap);

    region.append(
      el('p', { class: 'linetotal num' }, [`Line total ${money(item.line_total ?? '0.00')}`]),
    );
  } else {
    region.append(
      el('dl', { class: 'readonly' }, [
        el('dt', {}, ['Title']),
        el('dd', {}, [item.title]),
        el('dt', {}, ['Room']),
        el('dd', {}, [roomOf(ctx, item)?.name ?? '']),
        el('dt', {}, ['Trade']),
        el('dd', {}, [item.trade === null ? 'Crew' : TRADE_LABELS[item.trade]]),
      ]),
    );
  }

  const mayPlacePin =
    jobOpen(ctx) &&
    (canEdit(ctx) ||
      (data.job.my_role === 'homeowner' && item.created_by.role === 'homeowner'));
  if (mayPlacePin) {
    region.append(
      button('Place pin', { 'data-fk': `placepin-${item.id}` }, () =>
        hooks.startPlacement(item.id),
      ),
    );
  }

  if (canEdit(ctx) && jobOpen(ctx) && item.local !== true) {
    const waits = button(`Waits on`, { 'data-fk': `waitson-${item.id}` }, (event) =>
      openWaitsOn(ctx, item, event.currentTarget as HTMLButtonElement),
    );
    waits.disabled = offlineNow();
    waits.textContent = 'Waits on';
    region.append(waits);
  }

  region.append(photoControls(ctx, item));
  region.append(noteThread(ctx, item));

  if (item.status === 'ready_for_check' && canEdit(ctx) && jobOpen(ctx)) {
    region.append(
      button('Send back', { 'data-fk': `sendback-${item.id}` }, (event) =>
        openSendBack(ctx, item, event.currentTarget as HTMLButtonElement),
      ),
    );
  }
  if (item.status === 'verified' && data.job.my_role === 'owner' && jobOpen(ctx)) {
    region.append(
      button(`Reopen item ${number}`, { 'data-fk': `reopen-${item.id}` }, (event) =>
        void runItemAction(ctx, item, 'reopen', null, event.currentTarget as HTMLButtonElement),
      ),
    );
  }
  const mayDelete =
    jobOpen(ctx) &&
    item.local !== true &&
    ((data.job.my_role === 'owner' && item.status !== 'verified') ||
      (data.job.my_role === 'lead' &&
        item.status === 'open' &&
        item.created_by.role === 'lead'));
  if (mayDelete) {
    const control = button(`Delete item ${number}`, { 'data-fk': `delete-${item.id}` }, (event) =>
      openDeleteItem(ctx, item, event.currentTarget as HTMLButtonElement),
    );
    control.disabled = offlineNow();
    region.append(control);
  }
  if (item.sent_back_reason) {
    region.append(el('p', { class: 'sentback' }, [item.sent_back_reason]));
  }
  return region;
}

function bindText(
  ctx: JobCtx,
  input: HTMLInputElement,
  key: string,
  save: (value: string) => Promise<void>,
): void {
  input.addEventListener('input', () => {
    ctx.ui.drafts[key] = input.value;
  });
  const commit = (): void => {
    const value = input.value;
    delete ctx.ui.drafts[key];
    void save(value);
  };
  input.addEventListener('blur', () => {
    if (ctx.ui.drafts[key] === undefined) return;
    commit();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    commit();
  });
}

function photoControls(ctx: JobCtx, item: LocalItem): HTMLElement {
  const data = ctx.state.data!;
  const wrap = el('div', { class: 'photos' });
  const role = data.job.my_role;
  const offline = offlineNow();

  const addInput = (label: string, kind: 'defect' | 'completion'): void => {
    const field = labelledField(label, { type: 'file', accept: 'image/*', 'data-fk': `${kind}-${item.id}` });
    const input = field.input as HTMLInputElement;
    input.disabled = offline || !jobOpen(ctx);
    if (offline) field.error.textContent = COPY.photosOffline;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file === undefined) return;
      void uploadPhoto(ctx, item, file, kind);
    });
    wrap.append(field.wrap);
  };
  if ((role === 'owner' || role === 'lead') && item.local !== true) addInput('Add defect photo', 'defect');
  if (
    item.local !== true &&
    (role === 'owner' ||
      role === 'lead' ||
      (role === 'trade' && item.trade !== null && item.trade === data.job.my_trade))
  ) {
    addInput('Add completion photo', 'completion');
  }

  if (item.photos.length > 0) {
    const list = el('ul', { class: 'photolist', 'aria-label': 'Photos' });
    item.photos.forEach((photo, index) => {
      const entry = el('li', {}, [
        el('img', { src: photo.url, alt: `${photo.kind} photo ${index + 1}`, class: 'thumb' }),
      ]);
      const mayRemove =
        jobOpen(ctx) && (role === 'owner' || role === 'lead' || photo.uploaded_by.role === role);
      if (mayRemove) {
        entry.append(
          button(`Remove photo ${index + 1}`, { 'data-fk': `rmphoto-${photo.id}` }, (event) =>
            void removePhoto(ctx, photo.id, event.currentTarget as HTMLButtonElement),
          ),
        );
      }
      list.append(entry);
    });
    wrap.append(list);
  }
  return wrap;
}

function noteThread(ctx: JobCtx, item: LocalItem): HTMLElement {
  const data = ctx.state.data!;
  const wrap = el('div', { class: 'notes' });
  for (const note of item.notes) {
    wrap.append(noteBlock(ctx, item, note, false));
    for (const reply of note.replies ?? []) wrap.append(noteBlock(ctx, item, reply, true));
  }
  if (!jobOpen(ctx)) return wrap;

  const field = labelledField('Add a note', { 'data-fk': `addnote-${item.id}` });
  (field.input as HTMLInputElement).value = ctx.ui.drafts[`addnote-${item.id}`] ?? '';
  field.input.addEventListener('input', () => {
    ctx.ui.drafts[`addnote-${item.id}`] = (field.input as HTMLInputElement).value;
  });
  const row = el('div', { class: 'noteform' }, [field.wrap]);
  let audience: 'crew' | 'everyone' = 'everyone';
  if (data.job.my_role !== 'homeowner') {
    const picker = el('select', {
      'aria-label': 'Who can see this',
      'data-fk': `audience-${item.id}`,
    }) as HTMLSelectElement;
    picker.append(option('crew', 'Crew only'), option('everyone', 'Everyone'));
    picker.value = 'everyone';
    picker.addEventListener('change', () => {
      audience = picker.value as 'crew' | 'everyone';
    });
    row.append(picker);
  }
  row.append(
    button('Post note', { 'data-fk': `postnote-${item.id}` }, (event) => {
      const body = (field.input as HTMLInputElement).value;
      if (body.trim() === '') return;
      delete ctx.ui.drafts[`addnote-${item.id}`];
      void postNote(ctx, item, body, audience, null, event.currentTarget as HTMLButtonElement);
    }),
  );
  wrap.append(row);
  return wrap;
}

function noteBlock(ctx: JobCtx, item: LocalItem, note: Note, isReply: boolean): HTMLElement {
  const block = el('div', { class: `note${isReply ? ' reply' : ''}` }, [
    el('p', { class: 'notebody' }, [note.body]),
    el('p', { class: 'notemeta' }, [
      `${note.author.name} · ${note.audience === 'crew' ? 'Crew only' : 'Everyone'}`,
    ]),
  ]);
  const editing = ctx.ui.noteEditing.has(note.id);
  const data = ctx.state.data!;
  const mayEdit =
    jobOpen(ctx) &&
    (data.job.my_role === 'owner' ||
      data.job.my_role === 'lead' ||
      note.author.role === data.job.my_role);
  if (mayEdit) {
    if (editing) {
      const field = labelledField('Edit note', { 'data-fk': `editnote-${note.id}` });
      const input = field.input as HTMLInputElement;
      input.value = ctx.ui.drafts[`editnote-${note.id}`] ?? note.body;
      const baseRev = Number(ctx.ui.drafts[`editbase-${note.id}`] ?? note.rev);
      ctx.ui.drafts[`editbase-${note.id}`] = String(baseRev);
      input.addEventListener('input', () => {
        ctx.ui.drafts[`editnote-${note.id}`] = input.value;
      });
      block.append(
        field.wrap,
        button('Save note', { 'data-fk': `savenote-${note.id}` }, (event) => {
          void (async () => {
            const ok = await saveNoteEdit(
              ctx,
              item,
              note,
              baseRev,
              input.value,
              event.currentTarget as HTMLButtonElement,
            );
            if (ok) {
              ctx.ui.noteEditing.delete(note.id);
              delete ctx.ui.drafts[`editnote-${note.id}`];
              delete ctx.ui.drafts[`editbase-${note.id}`];
              ctx.render();
            }
          })();
        }),
      );
    } else {
      block.append(
        button('Edit note', { 'data-fk': `edit-${note.id}` }, () => {
          ctx.ui.noteEditing.add(note.id);
          ctx.ui.drafts[`editbase-${note.id}`] = String(note.rev);
          ctx.render();
        }),
      );
    }
    const undo = button('Undo my edit', { 'data-fk': `undo-${note.id}` }, (event) =>
      void noteUndoRedo(ctx, item, note, 'undo', event.currentTarget as HTMLButtonElement),
    );
    const redo = button('Redo my edit', { 'data-fk': `redo-${note.id}` }, (event) =>
      void noteUndoRedo(ctx, item, note, 'redo', event.currentTarget as HTMLButtonElement),
    );
    undo.disabled = offlineNow();
    redo.disabled = offlineNow();
    block.append(undo, redo);
  }
  if (!isReply && jobOpen(ctx)) {
    const replyField = labelledField('Reply', { 'data-fk': `replyfield-${note.id}` });
    (replyField.input as HTMLInputElement).value = ctx.ui.drafts[`reply-${note.id}`] ?? '';
    replyField.input.addEventListener('input', () => {
      ctx.ui.drafts[`reply-${note.id}`] = (replyField.input as HTMLInputElement).value;
    });
    block.append(
      replyField.wrap,
      button('Reply', { 'data-fk': `reply-${note.id}` }, (event) => {
        const body = (replyField.input as HTMLInputElement).value;
        if (body.trim() === '') return;
        delete ctx.ui.drafts[`reply-${note.id}`];
        void postNote(
          ctx,
          item,
          body,
          note.audience,
          note.id,
          event.currentTarget as HTMLButtonElement,
        );
      }),
    );
  }
  return block;
}

/* ----------------------------------------------------------------- dialogs */

function openWaitsOn(ctx: JobCtx, item: LocalItem, opener: HTMLButtonElement): void {
  const number = itemNumberText(item);
  openDialog(
    `Waits on item ${number}`,
    (dialog) => {
      const boxes: HTMLInputElement[] = [];
      for (const other of ctx.state.data!.items) {
        if (other.id === item.id || other.local === true) continue;
        const field = labelledField(`Item ${other.number}: ${other.title}`, { type: 'checkbox' });
        const input = field.input as HTMLInputElement;
        input.checked = item.blocked_by.includes(other.number);
        input.dataset.itemId = other.id;
        boxes.push(input);
        dialog.body.append(field.wrap);
      }
      dialog.body.append(
        button('Save', {}, (event) => {
          void (async () => {
            const ids = boxes.filter((box) => box.checked).map((box) => box.dataset.itemId!);
            const ok = await setBlockers(ctx, item, ids, event.currentTarget as HTMLButtonElement);
            if (ok) dialog.close();
          })();
        }),
      );
    },
    opener,
  );
}

function openSendBack(ctx: JobCtx, item: LocalItem, opener: HTMLButtonElement): void {
  const number = itemNumberText(item);
  openDialog(
    `Send back item ${number}`,
    (dialog) => {
      const reason = labelledField('Reason');
      dialog.body.append(
        reason.wrap,
        button('Send back item', {}, (event) => {
          void (async () => {
            const ok = await runItemAction(
              ctx,
              item,
              'send_back',
              (reason.input as HTMLInputElement).value,
              event.currentTarget as HTMLButtonElement,
            );
            if (ok) dialog.close();
          })();
        }),
      );
    },
    opener,
  );
}

function openDeleteItem(ctx: JobCtx, item: LocalItem, opener: HTMLButtonElement): void {
  const number = itemNumberText(item);
  openDialog(
    `Delete item ${number}`,
    (dialog) => {
      dialog.body.append(
        el('p', {}, [`Item ${number} and its photos are removed.`]),
        button('Delete item', {}, (event) => {
          void (async () => {
            const after = nextRowAfter(ctx, item.id);
            const ok = await deleteItem(ctx, item, event.currentTarget as HTMLButtonElement);
            if (!ok) return;
            dialog.close();
            const target =
              after === null
                ? document.querySelector<HTMLElement>('[data-fk="quickadd"]')
                : document.querySelector<HTMLElement>(`[data-fk="row-${after}"]`);
            target?.focus();
          })();
        }),
      );
    },
    opener,
  );
}

export function statusLabelOf(status: ItemStatus): string {
  return STATUS_LABELS[status];
}

export function conflictCount(ctx: JobCtx): number {
  return (ctx.state.data?.items ?? []).reduce(
    (total, item) => total + (item.conflicts?.length ?? 0),
    0,
  );
}

export function describeFailure(error: unknown): string {
  return error instanceof RequestFailed ? error.body.message : messageOf(error);
}
