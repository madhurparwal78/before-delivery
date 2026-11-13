import {
  finish as finishDef,
  hub as hubDef,
  model as modelDef,
  type FinishId,
  type HubId,
  type ModelId,
} from '../shared/catalogue.js';
import { COPY, FIELD_TEXT, STATUS } from '../shared/strings.js';
import type { DaySheetRow, HeldUnitRow, StockRow } from '../shared/types.js';
import {
  announce,
  ApiError,
  apiGet,
  apiPost,
  currentSelection,
  identityChanged,
  liveArrived,
  setSelection,
  user,
} from './core.js';
import { openSignIn } from './signin.js';

interface DaySheetReply {
  hub: HubId;
  date: string;
  dayLabel: string;
  dates: { date: string; dayLabel: string }[];
  rows: DaySheetRow[];
}

interface StockReply {
  hub: HubId;
  counting: boolean;
  stockAsOf: string;
  stockAsOfLabel: string;
  units: StockRow[];
}

let chosenDate: string | null = null;
let sheet: DaySheetReply | null = null;
let held: HeldUnitRow[] = [];
let stock: StockReply | null = null;
let typedCounts = new Map<string, string>();
let token = 0;

let dateSelect: HTMLSelectElement | null = null;
let todayButton: HTMLButtonElement | null = null;
let sheetTable: HTMLTableElement | null = null;
let sheetEmpty: HTMLElement | null = null;
let heldTable: HTMLTableElement | null = null;
let heldEmpty: HTMLElement | null = null;
let stockTable: HTMLTableElement | null = null;
let startCountButton: HTMLButtonElement | null = null;
let finishCountButton: HTMLButtonElement | null = null;
let countNote: HTMLElement | null = null;
let statement: HTMLElement | null = null;

export function startHubConsole(): void {
  const host = document.querySelector<HTMLElement>('[data-hub-console]');
  if (!host) return;
  statement = document.querySelector<HTMLElement>('[data-statement]');
  const params = new URLSearchParams(window.location.search);
  chosenDate = params.get('date');
  const me = user();
  if (me?.hub) setSelection({ ...currentSelection(), hub: me.hub });
  build(host);
  liveArrived.on(() => {
    void reload();
  });
  identityChanged.on(() => {
    typedCounts = new Map();
    void reload();
  });
  if (!user()) openSignIn();
  void reload();
}

function build(host: HTMLElement): void {
  const controls = document.createElement('div');
  controls.className = 'fields';
  const dateLabel = document.createElement('label');
  const dateSpan = document.createElement('span');
  dateSpan.textContent = 'Sheet date';
  dateSelect = document.createElement('select');
  dateSelect.setAttribute('aria-label', 'Sheet date');
  dateSelect.addEventListener('change', () => {
    chosenDate = dateSelect?.value ?? null;
    writeUrl();
    void reload();
  });
  dateLabel.append(dateSpan, dateSelect);
  todayButton = document.createElement('button');
  todayButton.type = 'button';
  todayButton.textContent = COPY.goToToday;
  todayButton.addEventListener('click', () => {
    chosenDate = null;
    writeUrl();
    void reload();
  });
  controls.append(dateLabel, todayButton);

  sheetTable = table('Day sheet', ['Time', 'Rider', 'Machine', 'Licence', 'State', 'Action']);
  sheetEmpty = document.createElement('p');
  sheetEmpty.className = 'statement';
  sheetEmpty.textContent = COPY.daySheetEmpty;
  sheetEmpty.hidden = true;

  heldTable = table('Held units', ['Rider', 'Machine', 'Finish', 'Ends', 'State', 'Action']);
  heldEmpty = document.createElement('p');
  heldEmpty.className = 'statement';
  heldEmpty.textContent = COPY.heldUnitsEmpty;
  heldEmpty.hidden = true;

  stockTable = table('Stock', ['Machine', 'Finish', 'On hand', 'Held', 'Units left']);
  const countActions = document.createElement('div');
  countActions.className = 'band-actions';
  startCountButton = document.createElement('button');
  startCountButton.type = 'button';
  startCountButton.textContent = 'Start stock count';
  startCountButton.addEventListener('click', () => void startCount());
  finishCountButton = document.createElement('button');
  finishCountButton.type = 'button';
  finishCountButton.textContent = 'Finish stock count';
  finishCountButton.addEventListener('click', () => void finishCount());
  countNote = document.createElement('p');
  countNote.className = 'field-note';
  countNote.textContent = FIELD_TEXT.stockCount;
  countNote.hidden = true;
  countActions.append(startCountButton, finishCountButton);

  host.replaceChildren(
    controls,
    sheetTable,
    sheetEmpty,
    heldTable,
    heldEmpty,
    stockTable,
    countNote,
    countActions,
  );
}

function table(label: string, columns: readonly string[]): HTMLTableElement {
  const element = document.createElement('table');
  element.setAttribute('aria-label', label);
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const column of columns) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = column;
    headRow.append(cell);
  }
  head.append(headRow);
  element.append(head, document.createElement('tbody'));
  return element;
}

function writeUrl(): void {
  const params = new URLSearchParams();
  if (chosenDate) params.set('date', chosenDate);
  const query = params.toString();
  window.history.replaceState(window.history.state, '', query ? `/hub?${query}` : '/hub');
}

async function reload(): Promise<void> {
  if (user()?.role !== 'hub_host') return;
  const mine = (token += 1);
  try {
    const query = chosenDate ? `?date=${chosenDate}` : '';
    const [sheetReply, heldReply, stockReply] = await Promise.all([
      apiGet<DaySheetReply>(`/api/hub/day-sheet${query}`),
      apiGet<{ rows: HeldUnitRow[] }>('/api/hub/held-units'),
      apiGet<StockReply>('/api/hub/stock'),
    ]);
    if (mine !== token) return;
    sheet = sheetReply;
    held = heldReply.rows;
    stock = stockReply;
  } catch (error) {
    if (error instanceof ApiError && error.failure.status === 401) openSignIn();
    return;
  }
  paint();
}

function paint(): void {
  paintStatement();
  paintDates();
  paintSheet();
  paintHeld();
  paintStock();
}

function paintStatement(): void {
  if (!statement || !sheet) return;
  statement.textContent = `${hubDef(sheet.hub).name}, ${sheet.dayLabel}.`;
}

function paintDates(): void {
  if (!dateSelect || !sheet) return;
  const dates = [...sheet.dates];
  if (chosenDate && !dates.some((entry) => entry.date === chosenDate)) {
    dates.push({ date: chosenDate, dayLabel: chosenDate });
  }
  const existing = [...dateSelect.options];
  dates.forEach((entry, index) => {
    let option = existing[index];
    if (!option) {
      option = document.createElement('option');
      dateSelect?.append(option);
    }
    option.value = entry.date;
    option.textContent = entry.dayLabel;
  });
  for (let index = dates.length; index < existing.length; index += 1) existing[index]?.remove();
  dateSelect.value = chosenDate ?? sheet.date;
  if (todayButton) todayButton.hidden = chosenDate === null && sheet.rows.length > 0;
}

function paintSheet(): void {
  if (!sheetTable || !sheet) return;
  const body = sheetTable.tBodies[0] as HTMLTableSectionElement;
  const keep = new Set(sheet.rows.map((row) => `${row.kind}:${row.id}`));
  for (const existing of [...body.rows]) {
    if (!keep.has(existing.dataset.key ?? '')) existing.remove();
  }
  sheet.rows.forEach((row, index) => {
    const key = `${row.kind}:${row.id}`;
    let element = [...body.rows].find((candidate) => candidate.dataset.key === key);
    if (!element) {
      element = body.insertRow(index);
      element.dataset.key = key;
      for (let cell = 0; cell < 6; cell += 1) element.insertCell();
    }
    const cells = element.cells;
    setText(cells[0], row.label);
    setText(cells[1], row.riderName);
    setText(cells[2], modelDef(row.model).name);
    setText(cells[3], row.licenceLast4 ?? '');
    setText(cells[4], stateWord(row.state));
    paintActions(cells[5] as HTMLTableCellElement, row);
  });
  sheetTable.hidden = sheet.rows.length === 0;
  if (sheetEmpty) sheetEmpty.hidden = sheet.rows.length > 0;
}

function stateWord(state: string): string {
  if (state === 'booked') return 'Booked';
  if (state === 'ridden') return 'Ridden';
  if (state === 'no_show') return 'No-show';
  if (state === 'delivery_set') return 'Held for handover';
  return 'Delivered';
}

function setText(cell: HTMLTableCellElement | undefined, text: string): void {
  if (cell && cell.textContent !== text) cell.textContent = text;
}

function paintActions(cell: HTMLTableCellElement, row: DaySheetRow): void {
  const wanted = row.actions.map((action) => {
    if (action === 'ridden') return { key: 'ridden', label: `Mark ridden ${row.riderName}` };
    if (action === 'no_show') return { key: 'no_show', label: `Mark no-show ${row.riderName}` };
    return { key: 'delivered', label: `Mark delivered ${row.riderName}` };
  });
  const existing = [...cell.querySelectorAll<HTMLButtonElement>('button')];
  for (const button of existing) {
    if (!wanted.some((entry) => entry.key === button.dataset.action)) button.remove();
  }
  for (const entry of wanted) {
    let button = cell.querySelector<HTMLButtonElement>(`button[data-action="${entry.key}"]`);
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.dataset.action = entry.key;
      button.addEventListener('click', () => {
        void mark(row, entry.key as 'ridden' | 'no_show' | 'delivered');
      });
      cell.append(button);
    }
    if (button.textContent !== entry.label) button.textContent = entry.label;
  }
}

async function mark(
  row: DaySheetRow,
  outcome: 'ridden' | 'no_show' | 'delivered',
): Promise<void> {
  try {
    if (outcome === 'delivered') {
      await apiPost(`/api/hub/locks/${row.id}/delivered`);
      announce(STATUS.markedDelivered(row.riderName), 'other');
    } else {
      await apiPost(`/api/hub/rides/${row.id}/mark`, { outcome });
      announce(
        outcome === 'ridden'
          ? STATUS.markedRidden(row.riderName)
          : STATUS.markedNoShow(row.riderName),
        'other',
      );
    }
    await reload();
  } catch (error) {
    hostFailure(error);
  }
}

function paintHeld(): void {
  if (!heldTable) return;
  const body = heldTable.tBodies[0] as HTMLTableSectionElement;
  const keep = new Set(held.map((row) => row.id));
  for (const existing of [...body.rows]) {
    if (!keep.has(existing.dataset.key ?? '')) existing.remove();
  }
  held.forEach((row, index) => {
    let element = [...body.rows].find((candidate) => candidate.dataset.key === row.id);
    if (!element) {
      element = body.insertRow(index);
      element.dataset.key = row.id;
      for (let cell = 0; cell < 6; cell += 1) element.insertCell();
    }
    const cells = element.cells;
    setText(cells[0], row.riderName);
    setText(cells[1], modelDef(row.model as ModelId).name);
    setText(cells[2], finishDef(row.finish as FinishId).name);
    setText(cells[3], row.expiresLabel ?? 'No expiry');
    setText(cells[4], row.state === 'requested' ? 'Being checked' : stateWord(row.state));
    paintHeldActions(cells[5] as HTMLTableCellElement, row);
  });
  heldTable.hidden = held.length === 0;
  if (heldEmpty) heldEmpty.hidden = held.length > 0;
}

function paintHeldActions(cell: HTMLTableCellElement, row: HeldUnitRow): void {
  const wanted = row.actions.map((action) => ({
    key: action,
    label:
      action === 'confirm'
        ? `Confirm unit ${row.riderName}`
        : action === 'refuse'
          ? `Refuse unit ${row.riderName}`
          : `Withdraw unit ${row.riderName}`,
  }));
  for (const button of [...cell.querySelectorAll<HTMLButtonElement>('button')]) {
    if (!wanted.some((entry) => entry.key === button.dataset.action)) button.remove();
  }
  for (const entry of wanted) {
    let button = cell.querySelector<HTMLButtonElement>(`button[data-action="${entry.key}"]`);
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.dataset.action = entry.key;
      button.addEventListener('click', () => void heldAction(row, entry.key));
      cell.append(button);
    }
    if (button.textContent !== entry.label) button.textContent = entry.label;
  }
}

async function heldAction(
  row: HeldUnitRow,
  action: 'confirm' | 'refuse' | 'withdraw',
): Promise<void> {
  try {
    await apiPost(`/api/hub/locks/${row.id}/${action}`);
    announce(
      action === 'confirm'
        ? STATUS.unitConfirmed(row.riderName)
        : action === 'refuse'
          ? STATUS.unitRefused(row.riderName)
          : STATUS.unitWithdrawn(row.riderName),
      'other',
    );
    await reload();
  } catch (error) {
    hostFailure(error);
  }
}

function paintStock(): void {
  if (!stockTable || !stock) return;
  const body = stockTable.tBodies[0] as HTMLTableSectionElement;
  const counting = stock.counting;
  stock.units.forEach((row, index) => {
    const key = `${row.model}:${row.finish}`;
    let element = [...body.rows].find((candidate) => candidate.dataset.key === key);
    if (!element) {
      element = body.insertRow(index);
      element.dataset.key = key;
      for (let cell = 0; cell < 5; cell += 1) element.insertCell();
    }
    const cells = element.cells;
    setText(cells[0], modelDef(row.model).name);
    setText(cells[1], finishDef(row.finish).name);
    const onHandCell = cells[2] as HTMLTableCellElement;
    if (counting) {
      let input = onHandCell.querySelector<HTMLInputElement>('input');
      if (!input) {
        onHandCell.textContent = '';
        input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.step = '1';
        input.setAttribute(
          'aria-label',
          `${modelDef(row.model).name} ${finishDef(row.finish).name} on hand`,
        );
        input.value = typedCounts.get(key) ?? String(row.onHand);
        input.addEventListener('input', () => {
          typedCounts.set(key, input?.value ?? '');
        });
        onHandCell.append(input);
      } else if (typedCounts.has(key) && input.value !== typedCounts.get(key)) {
        input.value = typedCounts.get(key) as string;
      }
    } else {
      const input = onHandCell.querySelector('input');
      if (input) input.remove();
      setText(onHandCell, String(row.onHand));
    }
    setText(cells[3], String(row.held));
    setText(cells[4], String(row.unitsLeft));
  });
  if (startCountButton) startCountButton.hidden = counting;
  if (finishCountButton) finishCountButton.hidden = !counting;
  if (countNote) countNote.hidden = !counting;
}

async function startCount(): Promise<void> {
  try {
    await apiPost('/api/hub/stock-count/start');
    announce(STATUS.countStarted, 'other');
    await reload();
  } catch (error) {
    hostFailure(error);
  }
}

async function finishCount(): Promise<void> {
  if (!stock) return;
  const units = stock.units.map((row) => {
    const key = `${row.model}:${row.finish}`;
    const typed = typedCounts.get(key);
    return {
      model: row.model,
      finish: row.finish,
      onHand: typed === undefined || typed === '' ? row.onHand : Number(typed),
    };
  });
  try {
    await apiPost('/api/hub/stock-count/finish', { units });
    typedCounts = new Map();
    announce(STATUS.countSaved, 'other');
    await reload();
  } catch (error) {
    if (error instanceof ApiError && error.failure.code === 'invalid_body') {
      if (countNote) {
        countNote.hidden = false;
        countNote.textContent = FIELD_TEXT.stockCount;
      }
      return;
    }
    hostFailure(error);
  }
}

function hostFailure(error: unknown): void {
  if (!(error instanceof ApiError)) throw error;
  if (error.failure.status === 401) {
    openSignIn();
    return;
  }
  const code = error.failure.code;
  if (code === 'hub_unreachable') announce(STATUS.hostRefused, 'stale');
  else if (code === 'illegal_state' || code === 'too_early' || code === 'lock_expired') {
    announce(STATUS.alreadyMarked, 'other');
  }
  void reload();
}
