import { el, announce } from '../dom.js';
import { api } from '../api.js';
import { openDialog } from '../dialogs.js';
import { state, currentUnit, currentGoalGrams, loadList } from '../main.js';
import type { Item, ListSummary, PackSheet, Share, TripList } from '../apiTypes.js';
import { CATEGORIES } from '../../domain/types.js';
import { formatWeight, goalDeltaText } from '../../domain/format.js';
import { renderStrata, type StrataData } from './strata.js';
import { deriveLocal, packAnnouncement, collapsedSummary, type LocalLine } from '../offline.js';
import { enqueue, lastQueuedQuantity } from '../queue.js';
import { syncNow } from './sync.js';

/**
 * The trip workspace. Its zones are the available-gear ledger, the pack list
 * and Pack Strata. Focus follows the row, updates land in place, and offline
 * changes queue on the device until the hiker reconnects.
 */

export interface WorkspaceRefs {
  page: HTMLElement;
  list: TripList;
  lines: LocalLine[];
  items: Item[];
  provisionalPack: { itemId: string; held: { kind: 'set_quantity'; quantity: number; fromQuantity: number }[] } | null;
  pendingStateChange: boolean;
  sheet: PackSheet | null;
  sheetCurrent: boolean;
}

export async function renderWorkspaceContent(page: HTMLElement, list: TripList): Promise<void> {
  const unit = currentUnit();
  const goal = currentGoalGrams();
  const refs: WorkspaceRefs = {
    page,
    list,
    lines: list.lines.map((line) => ({ id: line.id, itemId: line.itemId, name: line.name, category: line.category, quantity: line.quantity, mode: line.mode, unitWeightGrams: line.unitWeightGrams })),
    items: state.items,
    provisionalPack: null,
    pendingStateChange: false,
    sheet: null,
    sheetCurrent: true,
  };

  // Read the newest pack sheet for the out-of-date notice.
  const sheets = await api.get<{ sheets: PackSheet[] }>(`/api/lists/${list.id}/pack-sheets`);
  if (sheets.ok && sheets.body.sheets.length > 0) {
    refs.sheet = sheets.body.sheets[0] ?? null;
    refs.sheetCurrent = refs.sheet?.current ?? true;
  }

  paintWorkspace(refs, unit, goal);
}

/** One full repaint of the workspace. The live regions are never rebuilt. */
export function paintWorkspace(refs: WorkspaceRefs, unit: 'g' | 'oz' | 'lb', goal: number): void {
  const { page, list } = refs;
  page.textContent = '';
  const phone = window.innerWidth < 768;

  const heading = el('h1', { id: 'list-heading', tabindex: '-1' });
  heading.append(document.createTextNode(`${list.name} — ${list.state}`));

  const totalsStrip = el('div', { class: 'totals-strip', role: 'region', 'aria-label': 'Pack totals' });
  const derived = deriveLocal(refs.lines, list.state, refs.items, goal, unit);
  const totals = derived.totals;
  const addTotal = (label: string, value: string, extraClass?: string): void => {
    const wrap = el('div', { class: `total${extraClass === undefined ? '' : ` ${extraClass}`}` });
    wrap.append(el('span', { class: 'label', text: label }), el('span', { class: 'value', text: value }));
    totalsStrip.append(wrap);
  };
  addTotal('Base', totals.display.base);
  addTotal('Worn', totals.display.worn);
  addTotal('Consumable', totals.display.consumable);
  addTotal('Skin-out', totals.display.skinOut);
  addTotal('Goal', totals.display.goal);
  const deltaWrap = el('div', { class: `total delta${totals.baseGrams > goal ? ' over' : ''}` });
  deltaWrap.append(el('span', { class: 'label', text: 'Goal delta' }), el('span', { class: 'value', id: 'delta-value', text: goalDeltaText(goal, totals.baseGrams, unit) }));
  totalsStrip.append(deltaWrap);

  const actions = el('div', { class: 'workspace-actions' });
  if (list.state === 'planning') {
    actions.append(stateButton(refs, 'Mark packed', 'packed'));
  }
  if (list.state === 'packed') {
    actions.append(stateButton(refs, 'Return to planning', 'planning'));
    actions.append(stateButton(refs, 'Mark walked', 'walked'));
  }
  const print = el('button', { type: 'button', text: 'Print pack sheet' });
  print.addEventListener('click', () => void printPackSheet(refs, print));
  actions.append(print);
  const share = el('button', { type: 'button', text: 'Share list' });
  share.addEventListener('click', () => void openShareDialog(refs, share));
  actions.append(share);

  if (refs.sheet !== null) {
    const link = el('a', { class: 'button', href: refs.sheet.url, text: 'Download pack sheet', id: 'download-sheet' });
    link.addEventListener('click', (event) => {
      event.preventDefault();
      void downloadSheet(refs.sheet as PackSheet);
    });
    actions.append(link);
    if (!refs.sheetCurrent) {
      actions.append(el('span', { class: 'banner', id: 'sheet-out-of-date', text: 'This pack sheet is out of date. Print again to include your latest changes.' }));
    }
  }

  page.append(heading, totalsStrip, actions);
  if (list.state === 'packed') {
    page.append(el('div', { class: 'banner', text: 'Packed — weights are frozen. Return to planning to change this list.' }));
  }
  if (list.state === 'walked') {
    page.append(el('div', { class: 'banner', text: 'Walked — this list is kept for history and can\'t be changed.' }));
  }

  const grid = el('div', { class: 'workspace-grid' });
  const closetZone = el('section', { class: 'zone', 'aria-label': 'Closet', role: 'region', id: 'closet-zone', tabindex: '-1' });
  const packZone = el('section', { class: 'zone', 'aria-label': 'Pack list', role: 'region', id: 'pack-zone', tabindex: '-1' });
  const strataZone = el('section', { class: 'zone zone-strata', 'aria-label': 'Pack Strata', role: 'region', id: 'strata-zone' });

  closetZone.append(el('h2', { class: 'zone-heading', text: 'Closet' }));
  const available = availableItems(refs);
  const closetTable = el('table', { class: 'ledger', 'aria-label': 'Available gear' });
  const closetBody = el('tbody');
  for (const category of CATEGORIES) {
    const rows = available.filter((item) => item.category === category);
    if (rows.length === 0) continue;
    for (const item of rows) {
      closetBody.append(availableRow(refs, item, unit, goal));
    }
  }
  closetTable.append(closetBody);
  closetZone.append(closetTable);

  packZone.append(el('h2', { class: 'zone-heading', text: 'Pack list' }));
  const packTable = el('table', { class: 'ledger', 'aria-label': 'Pack list' });
  const packBody = el('tbody');
  const grouped = groupByCategory(refs.lines, refs.items);
  for (const [category, lines] of grouped) {
    const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitWeightGrams, 0);
    packBody.append(el('tr', { class: 'group-heading-row' }, [el('td', { colspan: '5' }, [el('h3', { text: `${category} ${formatWeight(subtotal, unit)}` })])]));
    for (const line of lines) {
      packBody.append(packRow(refs, line, unit, goal));
    }
  }
  packTable.append(packBody);
  packZone.append(packTable);

  const strataData: StrataData = {
    categories: derived.categories.map((entry) => ({ category: entry.category, baseGrams: entry.baseGrams })),
    baseGrams: totals.baseGrams,
    wornGrams: totals.wornGrams,
    consumableGrams: totals.consumableGrams,
    goalGrams: goal,
  };

  if (phone) {
    const strip = el('div', { class: 'strata-strip' });
    const toggle = el('button', { type: 'button', id: 'strata-toggle', 'aria-expanded': 'false', text: 'Pack Strata' });
    const summary = el('span', { class: 'summary', id: 'strata-summary', text: collapsedSummary(totals, goal, unit) });
    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      const column = document.getElementById('strata-column-host');
      if (column !== null) column.remove();
      if (!expanded) {
        const host = el('div', { id: 'strata-column-host' });
        host.append(renderStrata(strataData, unit, true, true));
        strip.append(host);
      }
    });
    strip.append(toggle, summary);
    strataZone.append(strip);
  } else {
    strataZone.append(renderStrata(strataData, unit, false, true));
  }

  grid.append(closetZone, packZone, strataZone);
  page.append(grid);
}

function stateButton(refs: WorkspaceRefs, label: string, to: 'planning' | 'packed' | 'walked'): HTMLElement {
  const button = el('button', { type: 'button', text: label });
  button.addEventListener('click', () => {
    if (refs.pendingStateChange) return;
    refs.pendingStateChange = true;
    void (async () => {
      const answer = await api.post<{ list: TripList }>(`/api/lists/${refs.list.id}/state`, { to });
      refs.pendingStateChange = false;
      if (answer.ok) {
        announce('List state', to === 'packed' ? 'List marked packed.' : to === 'planning' ? 'List returned to planning.' : 'List marked walked.');
        const updated = answer.body.list;
        refs.list = updated;
        refs.lines = updated.lines.map(lineOf);
        await reloadSheetStatus(refs);
        paintWorkspace(refs, currentUnit(), currentGoalGrams());
        document.getElementById('list-heading')?.focus();
        return;
      }
      if (answer.failure.status === 401) {
        // A held state change waits for sign-in.
        announce('List state', answer.failure.message);
        return;
      }
      announce('List state', answer.failure.message);
      await reread(refs);
      paintWorkspace(refs, currentUnit(), currentGoalGrams());
      document.getElementById('list-heading')?.focus();
    })();
  });
  return button;
}

async function reread(refs: WorkspaceRefs): Promise<void> {
  const fresh = await loadList(refs.list.id);
  if (fresh !== null) {
    refs.list = fresh;
    refs.lines = fresh.lines.map(lineOf);
  }
}

function lineOf(line: TripList['lines'][number]): LocalLine {
  return { id: line.id, itemId: line.itemId, name: line.name, category: line.category, quantity: line.quantity, mode: line.mode, unitWeightGrams: line.unitWeightGrams };
}

/** Active items that still have at least one unpacked unit for this list. */
function availableItems(refs: WorkspaceRefs): Item[] {
  return state.items.filter((item) => {
    if (item.status !== 'active') return false;
    const packed = refs.lines.filter((line) => line.itemId === item.id).reduce((sum, line) => sum + line.quantity, 0);
    return packed < item.unitsOwned;
  });
}

function availableRow(refs: WorkspaceRefs, item: Item, unit: 'g' | 'oz' | 'lb', goal: number): HTMLElement {
  const row = el('tr');
  const packed = refs.lines.filter((line) => line.itemId === item.id).reduce((sum, line) => sum + line.quantity, 0);
  const left = item.unitsOwned - packed;
  row.append(el('td', { class: 'name-cell', text: item.name }));
  row.append(el('td', { class: 'mono', text: formatWeight(item.weightGrams, unit) }));
  row.append(el('td', { class: 'left-count', text: left > 0 && left < item.unitsOwned ? `${left} left` : '' }));
  const actionsCell = el('td', { class: 'row-controls' });
  const pack = el('button', { type: 'button', text: `Pack ${item.name}` });
  pack.addEventListener('click', () => void packItem(refs, item, pack, unit, goal));
  actionsCell.append(pack);
  row.append(actionsCell);
  row.addEventListener('keydown', (event) => {
    if (isShortcut(event)) return;
    if (event.key === 'p' || event.key === 'P') {
      event.preventDefault();
      void packItem(refs, item, pack, unit, goal);
    }
  });
  return row;
}

function packRow(refs: WorkspaceRefs, line: LocalLine, unit: 'g' | 'oz' | 'lb', goal: number): HTMLElement {
  const item = state.items.find((candidate) => candidate.id === line.itemId);
  const row = el('tr');
  row.dataset.itemId = line.itemId;
  const quantityCell = el('td');
  const modeCell = el('td');
  const inCloset = refs.list.state === 'walked' ? true : item !== undefined && line.quantity <= item.unitsOwned;

  if (refs.list.state === 'planning') {
    const controls = el('div', { class: 'row-controls' });
    const decrease = el('button', { type: 'button', text: `Decrease ${line.name}`, 'aria-label': `Decrease ${line.name}` });
    const quantity = el('input', { type: 'number', class: 'qty-field', min: '1', max: String(item?.unitsOwned ?? 99), value: String(line.quantity), 'aria-label': `Quantity of ${line.name}`, role: 'spinbutton' }) as HTMLInputElement;
    const increase = el('button', { type: 'button', text: `Increase ${line.name}`, 'aria-label': `Increase ${line.name}` });
    decrease.addEventListener('click', () => void changeQuantity(refs, line, Math.max(1, shownQuantity(refs, line) - 1), decrease, shownQuantity(refs, line), unit, goal));
    increase.addEventListener('click', () => void changeQuantity(refs, line, Math.min(item?.unitsOwned ?? 99, shownQuantity(refs, line) + 1), increase, shownQuantity(refs, line), unit, goal));
    quantity.addEventListener('change', () => {
      const value = Number(quantity.value);
      if (Number.isFinite(value) && value >= 1) void changeQuantity(refs, line, value, quantity, shownQuantity(refs, line), unit, goal);
    });
    controls.append(decrease, quantity, increase);
    quantityCell.append(controls);

    const mode = el('div', { class: 'mode-group', role: 'radiogroup', 'aria-label': `Carry mode for ${line.name}` });
    for (const candidate of ['base', 'worn', 'consumable'] as const) {
      const radioId = `mode-${line.id}-${candidate}`;
      const input = el('input', { type: 'radio', id: radioId, name: `mode-${line.id}`, value: candidate }) as HTMLInputElement;
      if (line.mode === candidate) input.setAttribute('checked', 'checked');
      input.addEventListener('change', () => {
        if (input.checked) void changeMode(refs, line, candidate, input, unit, goal);
      });
      mode.append(input, el('label', { for: radioId, text: candidate === 'base' ? 'Base' : candidate === 'worn' ? 'Worn' : 'Consumable' }));
    }
    modeCell.append(mode);

    const unpackCell = el('td', { class: 'row-controls' });
    const unpack = el('button', { type: 'button', text: `Unpack ${line.name}`, 'aria-label': `Unpack ${line.name}` });
    unpack.addEventListener('click', () => void unpackItem(refs, line, unpack, unit, goal));
    unpackCell.append(unpack);
    row.append(quantityCell, nameCellFor(refs, line, inCloset), modeCell, weightCell(refs, line, unit), unpackCell);
  } else {
    row.append(el('td', { text: String(line.quantity) }), nameCellFor(refs, line, inCloset), modeCell, weightCell(refs, line, unit), el('td'));
  }
  row.addEventListener('keydown', (event) => {
    if (refs.list.state !== 'planning' || isShortcut(event)) return;
    const key = event.key.toLowerCase();
    if (key === 'w') void changeMode(refs, line, line.mode === 'worn' ? 'base' : 'worn', event.target as HTMLElement, unit, goal);
    else if (key === 'c') void changeMode(refs, line, line.mode === 'consumable' ? 'base' : 'consumable', event.target as HTMLElement, unit, goal);
    else if (key === 'b') void changeMode(refs, line, 'base', event.target as HTMLElement, unit, goal);
    else if (key === 'u') void unpackItem(refs, line, event.target as HTMLElement, unit, goal);
    else if (event.key === '+' || event.key === '=') void changeQuantity(refs, line, Math.min(item?.unitsOwned ?? 99, shownQuantity(refs, line) + 1), event.target as HTMLElement, shownQuantity(refs, line), unit, goal);
    else if (event.key === '-') void changeQuantity(refs, line, Math.max(1, shownQuantity(refs, line) - 1), event.target as HTMLElement, shownQuantity(refs, line), unit, goal);
  });
  return row;
}

function isShortcut(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement;
  if (target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return true;
  return event.ctrlKey || event.altKey || event.metaKey;
}

function nameCellFor(refs: WorkspaceRefs, line: LocalLine, inCloset: boolean): HTMLElement {
  const cell = el('td', { class: 'name-cell' });
  cell.append(el('strong', { text: line.name }));
  const note = noteOf(line);
  if (note !== '') cell.append(el('span', { class: 'carry-note', text: ` ${note}` }));
  if (!inCloset && refs.list.state !== 'walked') cell.append(el('span', { class: 'not-in-closet', text: 'Not in closet' }));
  return cell;
}

function noteOf(line: LocalLine): string {
  if (line.mode === 'worn') return line.quantity > 1 ? `worn 1, ${line.quantity - 1} in pack` : 'worn';
  if (line.mode === 'consumable') return 'consumable';
  return '';
}

function weightCell(refs: WorkspaceRefs, line: LocalLine, unit: 'g' | 'oz' | 'lb'): HTMLElement {
  return el('td', { class: 'mono', text: formatWeight(line.quantity * line.unitWeightGrams, unit) });
}

function shownQuantity(refs: WorkspaceRefs, line: LocalLine): number {
  const current = refs.lines.find((candidate) => candidate.id === line.id);
  return current?.quantity ?? line.quantity;
}

async function packItem(refs: WorkspaceRefs, item: Item, fromButton: HTMLElement, unit: 'g' | 'oz' | 'lb', goal: number): Promise<void> {
  const existing = refs.lines.find((line) => line.itemId === item.id);
  if (existing !== undefined) {
    await changeQuantity(refs, existing, existing.quantity + 1, fromButton, existing.quantity, unit, goal);
    return;
  }
  if (!state.online) {
    enqueue({ listId: refs.list.id, itemId: item.id, type: 'pack', mode: 'base' });
    refs.lines = [...refs.lines, { id: `provisional-${item.id}`, itemId: item.id, name: item.name, category: item.category, quantity: 1, mode: 'base', unitWeightGrams: item.weightGrams }];
    repaintWithAnnouncement(refs, unit, goal);
    focusLine(refs, item.id, 'quantity');
    return;
  }
  // A provisional line shows at once, before the server answers.
  const provisionalId = `provisional-${item.id}`;
  refs.lines = [...refs.lines, { id: provisionalId, itemId: item.id, name: item.name, category: item.category, quantity: 1, mode: 'base', unitWeightGrams: item.weightGrams }];
  refs.provisionalPack = { itemId: item.id, held: [] };
  repaintWithAnnouncement(refs, unit, goal);
  focusLine(refs, item.id, 'quantity');

  const answer = await api.post<{ list: TripList }>(`/api/lists/${refs.list.id}/lines`, { itemId: item.id, quantity: 1, mode: 'base' });
  if (answer.ok) {
    const created = answer.body.list;
    refs.list = created;
    refs.lines = created.lines.map(lineOf);
    // Held inputs made on the provisional line are sent in order.
    const held = refs.provisionalPack?.held ?? [];
    refs.provisionalPack = null;
    let latest = refs.lines.find((line) => line.itemId === item.id);
    for (const input of held) {
      const target = refs.lines.find((line) => line.itemId === item.id);
      if (target === undefined) break;
      const next = await api.patch<{ list: TripList }>(`/api/lists/${refs.list.id}/lines/${target.id}`, { quantity: input.quantity });
      if (next.ok) {
        refs.list = next.body.list;
        refs.lines = next.body.list.lines.map(lineOf);
        latest = refs.lines.find((line) => line.itemId === item.id);
      }
    }
    void latest;
    await reloadSheetStatus(refs);
    // The final announcement carries the totals for the hiker's last input.
    const settled = deriveLocal(refs.lines, refs.list.state, refs.items, goal, unit);
    announce('Pack updates', packAnnouncement(settled.totals, goal, unit));
    paintWorkspace(refs, unit, goal);
    focusLine(refs, item.id, 'quantity');
    return;
  }
  // The pack was refused: the provisional line and its held inputs are dropped.
  refs.provisionalPack = null;
  refs.lines = refs.lines.filter((line) => line.itemId !== item.id);
  announce('Pack updates', `${item.name} is no longer in your closet.`);
  await reread(refs);
  await reloadSheetStatus(refs);
  paintWorkspace(refs, unit, goal);
  document.getElementById('closet-zone')?.focus();
}

async function changeQuantity(refs: WorkspaceRefs, line: LocalLine, quantity: number, control: HTMLElement, fromQuantity: number, unit: 'g' | 'oz' | 'lb', goal: number): Promise<void> {
  const item = state.items.find((candidate) => candidate.id === line.itemId);
  if (quantity < 1) return;
  if (item !== undefined && quantity > item.unitsOwned) return;
  const current = refs.lines.find((candidate) => candidate.id === line.id);
  if (current !== undefined) current.quantity = quantity;
  const provisional = refs.provisionalPack?.itemId === line.itemId;
  if (provisional) {
    refs.provisionalPack?.held.push({ kind: 'set_quantity', quantity, fromQuantity });
  }
  repaintWithAnnouncement(refs, unit, goal);
  if (!state.online) {
    const chained = lastQueuedQuantity(refs.list.id, line.itemId) ?? fromQuantity;
    enqueue({ listId: refs.list.id, itemId: line.itemId, type: 'set_quantity', quantity, fromQuantity: chained });
    return;
  }
  const target = refs.lines.find((candidate) => candidate.id === line.id);
  if (target === undefined || target.id.startsWith('provisional-')) return;
  const answer = await api.patch<{ list: TripList }>(`/api/lists/${refs.list.id}/lines/${target.id}`, { quantity });
  await applyLineAnswer(refs, answer, unit, goal, control, item?.name ?? line.name);
}

async function changeMode(refs: WorkspaceRefs, line: LocalLine, mode: 'base' | 'worn' | 'consumable', control: HTMLElement, unit: 'g' | 'oz' | 'lb', goal: number): Promise<void> {
  const current = refs.lines.find((candidate) => candidate.id === line.id);
  if (current !== undefined) current.mode = mode;
  repaintWithAnnouncement(refs, unit, goal);
  if (!state.online) {
    enqueue({ listId: refs.list.id, itemId: line.itemId, type: 'set_mode', mode });
    return;
  }
  const target = refs.lines.find((candidate) => candidate.id === line.id);
  if (target === undefined || target.id.startsWith('provisional-')) return;
  const answer = await api.patch<{ list: TripList }>(`/api/lists/${refs.list.id}/lines/${target.id}`, { mode });
  await applyLineAnswer(refs, answer, unit, goal, control, line.name);
}

async function unpackItem(refs: WorkspaceRefs, line: LocalLine, control: HTMLElement, unit: 'g' | 'oz' | 'lb', goal: number): Promise<void> {
  const index = refs.lines.findIndex((candidate) => candidate.id === line.id);
  const removed = index >= 0 ? refs.lines[index]! : null;
  refs.lines = refs.lines.filter((candidate) => candidate.id !== line.id);
  repaintWithAnnouncement(refs, unit, goal);
  if (!state.online) {
    enqueue({ listId: refs.list.id, itemId: line.itemId, type: 'unpack' });
    focusAfterUnpack(refs, index, removed);
    return;
  }
  const answer = await api.delete<{ list: TripList }>(`/api/lists/${refs.list.id}/lines/${line.id}`);
  if (answer.ok) {
    refs.list = answer.body.list;
    refs.lines = answer.body.list.lines.map(lineOf);
    await reloadSheetStatus(refs);
    paintWorkspace(refs, unit, goal);
    focusAfterUnpack(refs, index, removed);
    return;
  }
  if (answer.failure.status === 401) {
    await holdForSignIn(refs, unit, goal);
    return;
  }
  announce('Pack updates', `${refs.list.name} is ${answer.failure.code === 'list_not_editable' ? '' : ''}${refs.list.name} is ${refs.list.state} on another device and can't be edited.`);
  await reread(refs);
  paintWorkspace(refs, unit, goal);
  document.getElementById('list-heading')?.focus();
}

function focusAfterUnpack(refs: WorkspaceRefs, index: number, removed: LocalLine | null): void {
  if (removed === null) return;
  const item = state.items.find((candidate) => candidate.id === removed.itemId);
  if (item !== undefined && item.status === 'active') {
    const packButton = document.querySelector(`button[aria-label="Pack ${item.name}"]`) as HTMLElement | null;
    if (packButton !== null) {
      packButton.focus();
      return;
    }
  }
  const remaining = refs.lines;
  const target = remaining[Math.min(index, remaining.length - 1)];
  if (target === undefined) {
    document.getElementById('pack-zone')?.focus();
    return;
  }
  const row = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.startsWith('Unpack'));
  if (row !== undefined) row.focus();
  else document.getElementById('pack-zone')?.focus();
}

function focusLine(refs: WorkspaceRefs, itemId: string, target: 'quantity' | 'pack'): void {
  const field = document.querySelector(`input[aria-label="Quantity of ${nameFor(refs, itemId)}"]`) as HTMLElement | null;
  if (field !== null) {
    field.focus();
    return;
  }
  void target;
}

function nameFor(refs: WorkspaceRefs, itemId: string): string {
  const item = state.items.find((candidate) => candidate.id === itemId);
  if (item !== undefined) return item.name;
  return refs.lines.find((line) => line.itemId === itemId)?.name ?? '';
}

async function applyLineAnswer(refs: WorkspaceRefs, answer: { ok: boolean; body?: { list: TripList } } | { ok: boolean; failure?: { status: number; code: string; message: string } }, unit: 'g' | 'oz' | 'lb', goal: number, control: HTMLElement, name: string): Promise<void> {
  if (answer.ok && 'body' in answer && answer.body !== undefined) {
    const updated = answer.body.list;
    refs.list = updated;
    refs.lines = updated.lines.map(lineOf);
    await reloadSheetStatus(refs);
    paintWorkspace(refs, unit, goal);
    control.focus();
    return;
  }
  const failure = 'failure' in answer ? answer.failure : undefined;
  if (failure === undefined) return;
  if (failure.status === 401) {
    await holdForSignIn(refs, unit, goal);
    return;
  }
  if (failure.code === 'list_not_editable') {
    announce('Pack updates', `${refs.list.name} is ${refs.list.state} on another device and can't be edited.`);
  } else {
    announce('Pack updates', `${name} is no longer in your closet.`);
  }
  await reread(refs);
  await reloadSheetStatus(refs);
  paintWorkspace(refs, unit, goal);
  if (failure.code === 'list_not_editable') document.getElementById('list-heading')?.focus();
  else document.getElementById('closet-zone')?.focus();
}

async function holdForSignIn(refs: WorkspaceRefs, unit: 'g' | 'oz' | 'lb', goal: number): Promise<void> {
  const heading = document.getElementById('list-heading');
  openDialog('Sign in again', (dialog) => {
    const copy = el('p', { text: 'Your session ended. Sign in to finish this change.' });
    const input = el('input', { id: 'signin-again-pass', type: 'password' }) as HTMLInputElement;
    const error = el('div', { class: 'field-error', hidden: 'hidden' });
    const signIn = el('button', { type: 'button', text: 'Sign in' });
    const cancel = el('button', { type: 'button', text: 'Cancel' });
    dialog.append(copy, el('div', { class: 'field' }, [el('label', { class: 'field-label', for: 'signin-again-pass', text: 'Passphrase' }), input, error]), el('div', { class: 'actions' }, [signIn, cancel]));
    signIn.addEventListener('click', () => {
      void (async () => {
        const answer = await api.post('/api/session', { passphrase: input.value });
        if (!answer.ok) {
          error.textContent = "That passphrase didn't match.";
          error.removeAttribute('hidden');
          input.focus();
          return;
        }
        dialog.remove();
        const sync = await syncNow();
        void sync;
        const fresh = await loadList(refs.list.id);
        if (fresh !== null) {
          refs.list = fresh;
          refs.lines = fresh.lines.map(lineOf);
        }
        paintWorkspace(refs, unit, goal);
        heading?.focus();
      })();
    });
    cancel.addEventListener('click', () => {
      dialog.remove();
      announce('Pack updates', 'Change not saved. Sign in to keep packing.');
      paintWorkspace(refs, unit, goal);
      heading?.focus();
    });
  }, heading, { returnFocus: false });
}

async function printPackSheet(refs: WorkspaceRefs, opener: HTMLElement): Promise<void> {
  announce('Pack sheet', 'Rendering pack sheet...');
  const answer = await api.post<{ sheet: PackSheet }>(`/api/lists/${refs.list.id}/pack-sheets`, {});
  if (answer.ok) {
    refs.sheet = answer.body.sheet;
    refs.sheetCurrent = true;
    announce('Pack sheet', 'Pack sheet ready.');
    await downloadSheet(answer.body.sheet);
    paintWorkspace(refs, currentUnit(), currentGoalGrams());
    opener.focus();
    return;
  }
  if (answer.failure.status === 503) {
    announce('Pack sheet', "Pack sheets can't be printed right now. Your list is unchanged; try again later.");
    return;
  }
  announce('Pack sheet', answer.failure.message);
}

async function downloadSheet(sheet: PackSheet): Promise<void> {
  const blob = await api.download(sheet.url);
  if (blob === null) return;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'pack-sheet.pdf';
  anchor.click();
  URL.revokeObjectURL(url);
}

async function reloadSheetStatus(refs: WorkspaceRefs): Promise<void> {
  const answer = await api.get<{ sheets: PackSheet[] }>(`/api/lists/${refs.list.id}/pack-sheets`);
  if (answer.ok && answer.body.sheets.length > 0) {
    refs.sheet = answer.body.sheets[0] ?? null;
    refs.sheetCurrent = refs.sheet?.current ?? true;
  }
}

/** Re-announces and repaints after any packing change. */
function repaintWithAnnouncement(refs: WorkspaceRefs, unit: 'g' | 'oz' | 'lb', goal: number): void {
  const derived = deriveLocal(refs.lines, refs.list.state, refs.items, goal, unit);
  announce('Pack updates', packAnnouncement(derived.totals, goal, unit));
  paintWorkspace(refs, unit, goal);
  const summary = document.getElementById('strata-summary');
  if (summary !== null) summary.textContent = collapsedSummary(derived.totals, goal, unit);
}

function groupByCategory(lines: readonly LocalLine[], items: readonly Item[]): [string, LocalLine[]][] {
  const groups = new Map<string, LocalLine[]>();
  for (const line of lines) {
    const category = items.find((item) => item.id === line.itemId)?.category ?? line.category;
    const group = groups.get(category) ?? [];
    group.push(line);
    groups.set(category, group);
  }
  return [...groups.entries()].sort((a, b) => CATEGORIES.indexOf(a[0] as (typeof CATEGORIES)[number]) - CATEGORIES.indexOf(b[0] as (typeof CATEGORIES)[number]));
}

async function openShareDialog(refs: WorkspaceRefs, opener: HTMLElement): Promise<void> {
  const shareAnswer = await api.get<{ share: Share | null }>(`/api/lists/${refs.list.id}/share`);
  let share: Share | null = shareAnswer.ok ? shareAnswer.body.share : null;
  openDialog('Share list', (dialog) => {
    const expiredNotice = el('div', { class: 'field-error', hidden: 'hidden' });
    const expires = el('input', { id: 'share-expires', type: 'date' }) as HTMLInputElement;
    const linkField = el('input', { id: 'share-link', type: 'text', readonly: 'readonly' }) as HTMLInputElement;
    if (share !== null) linkField.value = `${window.location.origin}${share.url}`;
    const create = el('button', { type: 'button', text: share === null ? 'Create link' : 'Create new link' });
    const copy = el('button', { type: 'button', text: 'Copy link' });
    const revoke = el('button', { type: 'button', text: 'Revoke link' });
    const close = el('button', { type: 'button', text: 'Close' });
    const actions = el('div', { class: 'actions' }, [create, copy, revoke, close]);
    dialog.append(expiredNotice, el('div', { class: 'field' }, [el('label', { class: 'field-label', for: 'share-expires', text: 'Expires on' }), expires]), el('div', { class: 'field' }, [el('label', { class: 'field-label', for: 'share-link', text: 'Share link' }), linkField]), actions);
    if (share !== null && share.expired) {
      expiredNotice.textContent = `This link expired on ${share.expiresOn}. Create a new link to share again.`;
      expiredNotice.removeAttribute('hidden');
    }
    create.addEventListener('click', () => {
      void (async () => {
        const answer = await api.post<{ share: Share }>(`/api/lists/${refs.list.id}/share`, expires.value === '' ? {} : { expiresOn: expires.value });
        if (!answer.ok) {
          announce('Sharing', answer.failure.fields?.['expiresOn'] ?? answer.failure.message);
          return;
        }
        share = answer.body.share;
        linkField.value = `${window.location.origin}${share.url}`;
        create.textContent = 'Create new link';
        expiredNotice.setAttribute('hidden', 'hidden');
        announce('Sharing', 'Share link created.');
      })();
    });
    copy.addEventListener('click', () => {
      void navigator.clipboard.writeText(linkField.value);
    });
    revoke.addEventListener('click', () => {
      void (async () => {
        const answer = await api.delete(`/api/lists/${refs.list.id}/share`);
        if (answer.ok) {
          share = null;
          linkField.value = '';
          announce('Sharing', 'Share link revoked.');
        }
      })();
    });
    close.addEventListener('click', () => {
      dialog.remove();
      opener.focus();
    });
  }, opener);
}

