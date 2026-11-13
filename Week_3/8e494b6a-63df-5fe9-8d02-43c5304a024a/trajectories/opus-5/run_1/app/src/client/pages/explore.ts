import { barSettle, panelIn } from '../animate.js';
import { clear, el, highlighted } from '../dom.js';
import { displayTime, wallText } from '../format.js';
import {
  announce,
  ApiFailure,
  get,
  setLiveHandler,
  state,
  write,
  zone,
  type LiveMessage,
} from '../state.js';
import { buildTree, emptyBand, layoutBand, loadFailed, openDialog, showFormError } from '../widgets.js';

export type EventRecord = {
  _id: string;
  '@timestamp': string;
  _generation: number;
  _phase: string;
  _pipeline: string | null;
  _score: number | null;
  fields: Record<string, string | number | boolean | (string | number | boolean)[]>;
  highlights: Record<string, [number, number][]>;
  explanation?: ExplanationNode;
};

type ExplanationNode = {
  value: number;
  text: string;
  children?: { value: number; text: string }[];
};

type FilterPill = { field: string; value: string; include: boolean; enabled: boolean };

type FieldEntry = { field: string; type: string; conflict?: string };

type Bucket = { start: string; end: string; count: number; label: string };

const DEFAULT_COLUMNS = ['@timestamp', 'host', 'level', 'message'];
const DEFAULT_WIDTH = 160;
const MESSAGE_WIDTH = 480;
const ROW_HEIGHT = 34;
const MAX_ROWS_IN_PAGE = 60;

type View = {
  streams: string[];
  stream: string;
  q: string;
  fromMs: number;
  toMs: number;
  filters: FilterPill[];
  columns: string[];
  widths: Record<string, number>;
  sort: string | null;
  sortDirection: 'asc' | 'desc';
  snapshotId: string | null;
  total: number;
  events: EventRecord[];
  nextCursor: string | null;
  newEvents: number;
  fields: FieldEntry[];
  selectedField: string | null;
  interval: string;
  buckets: Bucket[];
  brushAnchor: number | null;
  brushCursor: number | null;
  brushSelection: Set<number>;
  focusRow: number;
  focusColumn: number;
  windowStart: number;
  documentFor: string | null;
  tailOn: boolean;
  scored: boolean;
};

const view: View = {
  streams: [],
  stream: '',
  q: '',
  fromMs: 0,
  toMs: 0,
  filters: [],
  columns: [...DEFAULT_COLUMNS],
  widths: {},
  sort: null,
  sortDirection: 'desc',
  snapshotId: null,
  total: 0,
  events: [],
  nextCursor: null,
  newEvents: 0,
  fields: [],
  selectedField: null,
  interval: '1m',
  buckets: [],
  brushAnchor: null,
  brushCursor: null,
  brushSelection: new Set(),
  focusRow: 0,
  focusColumn: 0,
  windowStart: 0,
  documentFor: null,
  tailOn: false,
  scored: false,
};

type Parts = {
  main: HTMLElement;
  queryInput: HTMLInputElement;
  suggestionList: HTMLElement;
  streamSelect: HTMLSelectElement;
  rangeText: HTMLElement;
  rangeButton: HTMLButtonElement;
  pillList: HTMLElement;
  intervalLabel: HTMLElement;
  histogram: HTMLElement;
  fieldList: HTMLElement;
  statistics: HTMLElement;
  gridHost: HTMLElement;
  messages: HTMLElement;
  documentHost: HTMLElement;
  filtersHost: HTMLElement | null;
};

let parts: Parts;
let suggestionIndex = -1;
let suggestions: { label: string; insert: string; count?: number }[] = [];
let tailSource: EventSource | null = null;

function enabledFilters(): { field: string; op: 'eq' | 'ne'; value: string }[] {
  return view.filters
    .filter((pill) => pill.enabled)
    .map((pill) => ({ field: pill.field, op: pill.include ? 'eq' : 'ne', value: pill.value }));
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function searchQuery(extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    stream: view.stream,
    q: view.q,
    from: iso(view.fromMs),
    to: iso(view.toMs),
    filters: JSON.stringify(enabledFilters()),
    ...extra,
  });
  return params.toString();
}

function writeAddress(): void {
  const params = new URLSearchParams({ stream: view.stream, from: iso(view.fromMs), to: iso(view.toMs) });
  if (view.q !== '') params.set('q', view.q);
  if (view.filters.length > 0) params.set('filters', JSON.stringify(view.filters));
  window.history.replaceState({}, '', `/explore?${params.toString()}`);
}

function readAddress(): void {
  const params = new URLSearchParams(window.location.search);
  const stream = params.get('stream');
  view.stream = stream && view.streams.includes(stream) ? stream : (view.streams[0] ?? '');
  view.q = params.get('q') ?? '';
  const to = params.get('to');
  const from = params.get('from');
  view.toMs = to ? Date.parse(to) : state.serverTimeMs;
  view.fromMs = from ? Date.parse(from) : view.toMs - 900000;
  const filters = params.get('filters');
  view.filters = [];
  if (filters) {
    try {
      const parsed = JSON.parse(filters) as FilterPill[];
      view.filters = parsed.map((pill) => ({
        field: pill.field,
        value: String(pill.value),
        include: pill.include !== false,
        enabled: pill.enabled !== false,
      }));
    } catch {
      view.filters = [];
    }
  }
}

function clearMessages(): void {
  clear(parts.messages);
}

function searchFailedBox(message: string): HTMLElement {
  const retry = el('button', { type: 'button', 'aria-label': 'Retry', text: 'Retry' });
  retry.addEventListener('click', () => {
    void runSearch();
  });
  return el('div', { role: 'alert', 'aria-label': 'Search failed', class: 'notice-box' }, [
    el('p', { text: message }),
    retry,
  ]);
}

function snapshotExpiredBox(message: string): HTMLElement {
  const again = el('button', {
    type: 'button',
    'aria-label': 'Start a new search',
    text: 'Start a new search',
  });
  again.addEventListener('click', () => {
    void runSearch();
  });
  return el('div', { role: 'alert', 'aria-label': 'Snapshot expired', class: 'notice-box' }, [
    el('p', { text: message }),
    again,
  ]);
}

function partialBox(skipped: number): HTMLElement {
  const text = `Partial results: ${skipped === 1 ? '1 archived generation' : `${skipped} archived generations`} skipped because storage is unavailable.`;
  return el('div', { role: 'status', 'aria-label': 'Partial results', class: 'notice-box info' }, [
    el('p', { text }),
  ]);
}

function queryErrorBox(message: string, position: number | undefined): HTMLElement {
  if (position !== undefined) {
    parts.queryInput.focus();
    const caret = Math.max(0, position - 1);
    parts.queryInput.setSelectionRange(caret, caret);
  }
  return el('div', { role: 'alert', 'aria-label': 'Query error', class: 'notice-box' }, [
    el('p', { text: message }),
  ]);
}

function newEventsButton(): HTMLElement | null {
  if (view.newEvents < 1) return null;
  const label = view.newEvents === 1 ? '1 new event since this search' : `${view.newEvents} new events since this search`;
  const node = el('button', { type: 'button', 'aria-label': 'Show new events', text: label });
  node.addEventListener('click', () => {
    void runSearch();
  });
  return node;
}

function setSearchState(value: 'loading' | 'done' | 'error'): void {
  const grid = parts.gridHost.querySelector('[role="grid"], [role="list"][aria-label="Events"]');
  grid?.setAttribute('data-search-state', value);
}

export async function runSearch(options: { announcement?: 'range' | 'count' } = {}): Promise<void> {
  clearMessages();
  renderGrid(true);
  try {
    const time = await get<{ now_ms: number }>('/api/time');
    state.serverTimeMs = time.now_ms;
  } catch {
    /* the last known server time stays in place */
  }
  try {
    const snapshot = await write<{
      id: string;
      total: number;
      partial: boolean;
      skipped_generations: number;
    }>('POST', '/api/snapshots', {
      stream: view.stream,
      from: iso(view.fromMs),
      to: iso(view.toMs),
      q: view.q,
      filters: enabledFilters(),
      sort: view.sort,
    });
    view.snapshotId = snapshot.id;
    view.total = snapshot.total;
    view.events = [];
    view.nextCursor = null;
    view.windowStart = 0;
    view.focusRow = 0;
    await loadPage(null);
    if (snapshot.partial) parts.messages.append(partialBox(snapshot.skipped_generations));
    await Promise.all([loadHistogram(), loadFields()]);
    renderPills();
    renderGrid(false);
    await loadStatistics();
    writeAddress();
    const found = view.total === 1 ? '1 event found' : `${view.total} events found`;
    announce(options.announcement === 'range' ? `Time range set: ${found}` : found);
  } catch (cause) {
    setSearchState('error');
    if (cause instanceof ApiFailure) {
      if (cause.code === 'query_syntax') {
        parts.messages.append(queryErrorBox(cause.message, cause.position));
        return;
      }
      if (cause.code === 'snapshot_expired') {
        parts.messages.append(snapshotExpiredBox(cause.message));
        return;
      }
      parts.messages.append(searchFailedBox(cause.message));
      return;
    }
    parts.messages.append(
      searchFailedBox("Spoorline can't reach the server. Retry when your connection is back."),
    );
  }
}

async function loadPage(after: string | null): Promise<void> {
  if (!view.snapshotId) return;
  const suffix = after === null ? '' : `?after=${encodeURIComponent(after)}`;
  const page = await get<{
    events: EventRecord[];
    next: string | null;
    total: number;
    new_events: number;
  }>(`/api/snapshots/${view.snapshotId}${suffix}`);
  view.events = after === null ? page.events : [...view.events, ...page.events];
  view.nextCursor = page.next;
  view.total = page.total;
  view.newEvents = page.new_events;
}

async function loadMore(): Promise<void> {
  if (view.nextCursor === null) return;
  try {
    await loadPage(view.nextCursor);
    renderGrid(false);
  } catch (cause) {
    if (cause instanceof ApiFailure && cause.code === 'snapshot_expired') {
      clearMessages();
      parts.messages.append(snapshotExpiredBox(cause.message));
    }
  }
}

async function loadHistogram(): Promise<void> {
  const previous = view.buckets.map((bucket) => bucket.count);
  const maximumBefore = Math.max(1, ...previous);
  const data = await get<{ interval: string; buckets: Bucket[]; total: number }>(
    `/api/histogram?${searchQuery({ tz: zone() })}`,
  );
  view.interval = data.interval;
  view.buckets = data.buckets;
  renderHistogram(previous, maximumBefore);
}

async function loadFields(): Promise<void> {
  const data = await get<{ fields: FieldEntry[] }>(
    `/api/fields?stream=${encodeURIComponent(view.stream)}&from=${iso(view.fromMs)}&to=${iso(view.toMs)}`,
  );
  view.fields = data.fields;
  if (view.selectedField && !view.fields.some((field) => field.field === view.selectedField)) {
    view.selectedField = null;
  }
  renderFieldList();
}

async function loadStatistics(): Promise<void> {
  if (!view.selectedField) {
    clear(parts.statistics);
    return;
  }
  try {
    const data = await get<{
      field: string;
      present: number;
      total: number;
      top: { value: string; count: number; share: string }[];
    }>(`/api/fields/stats?field=${encodeURIComponent(view.selectedField)}&${searchQuery()}`);
    renderStatistics(data);
  } catch (cause) {
    clear(parts.statistics);
    if (cause instanceof ApiFailure) {
      parts.statistics.append(el('p', { class: 'conflict', text: cause.message }));
    }
  }
}

function renderPills(): void {
  clear(parts.pillList);
  for (const pill of view.filters) {
    const label = `Filter ${pill.field}: ${pill.value}, ${pill.include ? 'include' : 'exclude'}, ${pill.enabled ? 'enabled' : 'disabled'}`;
    const node = el('button', {
      type: 'button',
      'aria-label': label,
      class: pill.enabled ? 'pill' : 'pill off',
      text: `${pill.field}: ${pill.value}`,
    });
    node.addEventListener('click', () => openPillMenu(node, pill));
    parts.pillList.append(el('li', {}, [node]));
  }
}

function openPillMenu(opener: HTMLButtonElement, pill: FilterPill): void {
  opener.parentElement?.querySelector('[role="menu"]')?.remove();
  const menu = el('div', { role: 'menu', 'aria-label': 'Filter actions', class: 'menu' });
  const add = (label: string, action: () => void): void => {
    const item = el('button', { type: 'button', role: 'menuitem', 'aria-label': label, text: label });
    item.addEventListener('click', () => {
      menu.remove();
      action();
      renderPills();
      void runSearch();
    });
    menu.append(item);
  };
  add('Invert', () => {
    pill.include = !pill.include;
  });
  add(pill.enabled ? 'Disable' : 'Enable', () => {
    pill.enabled = !pill.enabled;
  });
  add('Remove', () => {
    view.filters = view.filters.filter((item) => item !== pill);
  });
  menu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      menu.remove();
      opener.focus();
    }
  });
  opener.after(menu);
  menu.querySelector<HTMLElement>('button')?.focus();
}

function addPill(field: string, value: string, include: boolean): void {
  view.filters.push({ field, value, include, enabled: true });
  renderPills();
  void runSearch();
}

function renderFieldList(): void {
  clear(parts.fieldList);
  for (const entry of view.fields) {
    const typeText = entry.conflict ? 'conflict' : entry.type;
    const node = el('button', {
      type: 'button',
      'aria-label': `Field ${entry.field}, ${typeText}`,
      class: entry.field === view.selectedField ? 'field-item selected' : 'field-item',
    });
    node.append(el('span', { class: 'mono', text: entry.field }), el('span', { class: 'field-type', text: typeText }));
    if (entry.conflict) {
      node.append(el('span', { class: 'conflict-flag', text: 'Conflict' }), el('span', { class: 'conflict', text: entry.conflict }));
    }
    node.addEventListener('click', () => {
      view.selectedField = entry.field;
      renderFieldList();
      void loadStatistics();
    });
    parts.fieldList.append(el('li', {}, [node]));
  }
}

function renderStatistics(data: {
  field: string;
  present: number;
  total: number;
  top: { value: string; count: number; share: string }[];
}): void {
  clear(parts.statistics);
  parts.statistics.append(
    el('p', { text: `In ${data.present} of ${data.total} events` }),
    el('table', { 'aria-label': 'Top values', class: 'data-table' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Value' }),
          el('th', { scope: 'col', text: 'Count' }),
          el('th', { scope: 'col', text: 'Share' }),
        ]),
      ]),
      el(
        'tbody',
        {},
        data.top.map((row) => {
          const include = el('button', {
            type: 'button',
            'aria-label': `Include ${row.value}`,
            text: 'Include',
          });
          include.addEventListener('click', () => addPill(data.field, row.value, true));
          const exclude = el('button', {
            type: 'button',
            'aria-label': `Exclude ${row.value}`,
            text: 'Exclude',
          });
          exclude.addEventListener('click', () => addPill(data.field, row.value, false));
          return el('tr', {}, [
            el('td', { class: 'mono', text: row.value }),
            el('td', { class: 'mono', text: String(row.count) }),
            el('td', { class: 'mono', text: `${row.share}%` }),
            el('td', {}, [include, exclude]),
          ]);
        }),
      ),
    ]),
  );
}

function bucketLabelOf(bucket: Bucket): string {
  return `Bucket ${bucket.label}, ${bucket.count === 1 ? '1 event' : `${bucket.count} events`}`;
}

function renderHistogram(previousCounts: number[], previousMaximum: number): void {
  parts.intervalLabel.textContent = `Interval: ${view.interval}`;
  clear(parts.histogram);
  const maximum = Math.max(1, ...view.buckets.map((bucket) => bucket.count));
  view.buckets.forEach((bucket, index) => {
    const height = `${Math.round((bucket.count / maximum) * 100)}%`;
    const bar = el('span', { class: 'bar' });
    bar.style.height = height;
    const node = el('button', {
      type: 'button',
      'aria-label': bucketLabelOf(bucket),
      class: 'bucket',
      tabindex: index === (view.brushCursor ?? 0) ? '0' : '-1',
      'data-selected': view.brushSelection.has(index) ? 'true' : 'false',
      'data-index': String(index),
    });
    node.append(bar, el('span', { class: 'bucket-label mono', text: bucket.label }));
    parts.histogram.append(node);
    const before = previousCounts[index];
    if (before !== undefined && before !== bucket.count) {
      barSettle(bar, `${Math.round((before / previousMaximum) * 100)}%`, height);
    } else if (before === undefined && bucket.count > 0) {
      barSettle(bar, '0%', height);
    }
  });
}

function applyBrush(): void {
  const indexes = [...view.brushSelection].sort((left, right) => left - right);
  if (indexes.length === 0) return;
  const first = view.buckets[indexes[0]];
  const last = view.buckets[indexes[indexes.length - 1]];
  if (!first || !last) return;
  view.fromMs = Date.parse(first.start);
  view.toMs = Date.parse(last.end);
  view.brushSelection = new Set();
  view.brushAnchor = null;
  view.brushCursor = 0;
  parts.rangeText.textContent = `Showing ${displayTime(zone(), view.fromMs)} to ${displayTime(zone(), view.toMs)}`;
  void runSearch({ announcement: 'range' }).then(() => {
    parts.histogram.querySelector<HTMLElement>('.bucket')?.focus();
  });
}

function setBrush(from: number, to: number): void {
  const low = Math.min(from, to);
  const high = Math.max(from, to);
  view.brushSelection = new Set();
  for (let index = low; index <= high; index += 1) view.brushSelection.add(index);
  for (const node of parts.histogram.querySelectorAll<HTMLElement>('.bucket')) {
    const index = Number(node.dataset.index);
    node.dataset.selected = view.brushSelection.has(index) ? 'true' : 'false';
  }
}

function focusBucket(index: number): void {
  const nodes = [...parts.histogram.querySelectorAll<HTMLElement>('.bucket')];
  if (nodes.length === 0) return;
  const clamped = Math.max(0, Math.min(index, nodes.length - 1));
  view.brushCursor = clamped;
  for (const node of nodes) node.tabIndex = Number(node.dataset.index) === clamped ? 0 : -1;
  nodes[clamped].focus();
}

function wireHistogram(): void {
  let dragging = false;
  parts.histogram.addEventListener('pointerdown', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('.bucket');
    if (!target) return;
    dragging = true;
    const index = Number(target.dataset.index);
    view.brushAnchor = index;
    setBrush(index, index);
    focusBucket(index);
  });
  parts.histogram.addEventListener('pointermove', (event) => {
    if (!dragging || view.brushAnchor === null) return;
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('.bucket');
    if (!target) return;
    setBrush(view.brushAnchor, Number(target.dataset.index));
  });
  window.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    applyBrush();
  });
  parts.histogram.addEventListener('keydown', (event) => {
    const cursor = view.brushCursor ?? 0;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const next = cursor + (event.key === 'ArrowLeft' ? -1 : 1);
      if (event.shiftKey) {
        if (view.brushAnchor === null) view.brushAnchor = cursor;
        focusBucket(next);
        setBrush(view.brushAnchor, view.brushCursor ?? next);
        return;
      }
      view.brushAnchor = null;
      focusBucket(next);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (view.brushSelection.size === 0) setBrush(cursor, cursor);
      applyBrush();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      view.brushSelection = new Set();
      view.brushAnchor = null;
      for (const node of parts.histogram.querySelectorAll<HTMLElement>('.bucket')) {
        node.dataset.selected = 'false';
      }
    }
  });
}

function valueText(event: EventRecord, column: string): string {
  if (column === '@timestamp') return displayTime(zone(), Date.parse(event['@timestamp']));
  const value = event.fields[column];
  if (value === undefined) return '';
  return Array.isArray(value) ? value.map((item) => String(item)).join(', ') : String(value);
}

function rowLabel(event: EventRecord, index: number): string {
  const host = event.fields.host === undefined ? 'none' : String(event.fields.host);
  const level = event.fields.level === undefined ? 'none' : String(event.fields.level);
  return `Event ${index + 1} of ${view.total}, ${displayTime(zone(), Date.parse(event['@timestamp']))}, ${host}, ${level}`;
}

function cellContent(event: EventRecord, column: string): Node {
  const text = valueText(event, column);
  const ranges = event.highlights[column];
  if (ranges && ranges.length > 0 && column !== '@timestamp') return highlighted(text, ranges);
  return document.createTextNode(text);
}

function widthOf(column: string): number {
  return view.widths[column] ?? (column === 'message' ? MESSAGE_WIDTH : DEFAULT_WIDTH);
}

function setWidth(column: string, width: number): void {
  view.widths[column] = Math.max(60, Math.round(width));
  const header = parts.gridHost.querySelector<HTMLElement>(`[role="columnheader"][data-column="${column}"]`);
  if (header) {
    header.dataset.width = String(view.widths[column]);
    header.style.width = `${view.widths[column]}px`;
  }
  for (const cell of parts.gridHost.querySelectorAll<HTMLElement>(`[role="gridcell"][data-column="${column}"]`)) {
    cell.style.width = `${view.widths[column]}px`;
  }
}

function toolbar(): HTMLElement {
  const tail = el('button', { type: 'button', 'aria-label': 'Live tail', text: 'Live tail' });
  tail.addEventListener('click', () => {
    void startTail();
  });
  const save = el('button', { type: 'button', 'aria-label': 'Save search', text: 'Save search' });
  save.addEventListener('click', () => openSaveSearch(save));
  const columns = el('button', { type: 'button', 'aria-label': 'Columns', text: 'Columns' });
  columns.addEventListener('click', () => openColumns(columns));
  const nodes: Node[] = [tail, save, columns];
  const newEvents = newEventsButton();
  if (newEvents) nodes.push(newEvents);
  if (view.nextCursor !== null) {
    const more = el('button', { type: 'button', 'aria-label': 'Load more events', text: 'Load more events' });
    more.addEventListener('click', () => {
      void loadMore();
    });
    nodes.push(more);
  }
  return el('div', { class: 'grid-toolbar' }, nodes);
}

function focusCell(rowIndex: number, columnIndex: number): void {
  view.focusRow = Math.max(0, Math.min(rowIndex, view.events.length - 1));
  view.focusColumn = Math.max(0, Math.min(columnIndex, view.columns.length - 1));
  if (view.focusRow < view.windowStart || view.focusRow >= view.windowStart + MAX_ROWS_IN_PAGE) {
    view.windowStart = Math.max(0, view.focusRow - Math.floor(MAX_ROWS_IN_PAGE / 2));
    renderGrid(false);
  }
  const cell = parts.gridHost.querySelector<HTMLElement>(
    `[role="gridcell"][data-row="${view.focusRow}"][data-cell="${view.focusColumn}"]`,
  );
  for (const node of parts.gridHost.querySelectorAll<HTMLElement>('[role="gridcell"]')) {
    node.tabIndex = -1;
  }
  if (cell) {
    cell.tabIndex = 0;
    cell.focus();
  }
}

function gridKeys(event: KeyboardEvent): void {
  const key = event.key;
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    event.preventDefault();
    const next = view.focusRow + (key === 'ArrowDown' ? 1 : -1);
    if (next >= view.events.length && view.nextCursor !== null) {
      void loadMore().then(() => focusCell(next, view.focusColumn));
      return;
    }
    focusCell(next, view.focusColumn);
    return;
  }
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    if (event.altKey) {
      event.preventDefault();
      const column = view.columns[view.focusColumn];
      setWidth(column, widthOf(column) + (key === 'ArrowLeft' ? -16 : 16));
      return;
    }
    event.preventDefault();
    focusCell(view.focusRow, view.focusColumn + (key === 'ArrowLeft' ? -1 : 1));
    return;
  }
  if (key === 'Home') {
    event.preventDefault();
    focusCell(0, view.focusColumn);
    return;
  }
  if (key === 'End') {
    event.preventDefault();
    if (view.nextCursor !== null) {
      void loadAll().then(() => focusCell(view.events.length - 1, view.focusColumn));
      return;
    }
    focusCell(view.events.length - 1, view.focusColumn);
    return;
  }
  if (key === 'PageDown' || key === 'PageUp') {
    event.preventDefault();
    const next = view.focusRow + (key === 'PageDown' ? 20 : -20);
    if (next >= view.events.length && view.nextCursor !== null) {
      void loadMore().then(() => focusCell(next, view.focusColumn));
      return;
    }
    focusCell(next, view.focusColumn);
    return;
  }
  if (key === 'Enter') {
    event.preventDefault();
    const record = view.events[view.focusRow];
    if (record) openDocument(record);
  }
}

async function loadAll(): Promise<void> {
  while (view.nextCursor !== null) {
    await loadPage(view.nextCursor);
  }
  renderGrid(false);
}

function renderGrid(loading: boolean): void {
  clear(parts.gridHost);
  if (view.tailOn) {
    renderTail();
    return;
  }
  parts.gridHost.append(toolbar());
  if (loading) {
    const skeleton = el('div', {
      role: 'grid',
      'aria-label': 'Events',
      'aria-rowcount': String(view.total + 1),
      'data-search-state': 'loading',
      class: 'events-grid',
    });
    for (let index = 0; index < 8; index += 1) {
      skeleton.append(el('div', { role: 'presentation', class: 'skeleton-row', 'aria-hidden': 'true' }));
    }
    parts.gridHost.append(skeleton);
    return;
  }
  if (view.total === 0) {
    const widen = el('button', {
      type: 'button',
      'aria-label': 'Widen to last 7 days',
      text: 'Widen to last 7 days',
    });
    widen.addEventListener('click', () => {
      view.toMs = state.serverTimeMs;
      view.fromMs = view.toMs - 604800000;
      void runSearch();
    });
    const host = el('div', {
      role: layoutBand() === 'phone' ? 'list' : 'grid',
      'aria-label': 'Events',
      'aria-rowcount': '1',
      'data-search-state': 'done',
      class: 'events-grid',
    });
    parts.gridHost.append(host, emptyBand('No events in this range.', widen));
    return;
  }
  if (layoutBand() === 'phone') {
    const list = el('div', {
      role: 'list',
      'aria-label': 'Events',
      'data-search-state': 'done',
      class: 'events-cards',
    });
    const windowEnd = Math.min(view.events.length, view.windowStart + MAX_ROWS_IN_PAGE);
    for (let index = view.windowStart; index < windowEnd; index += 1) {
      const record = view.events[index];
      const card = el('article', {
        role: 'listitem',
        'aria-label': rowLabel(record, index),
        class: 'event-card',
        tabindex: '0',
        'data-source': record._phase === 'archive' ? 'archive' : null,
      });
      for (const column of view.columns) {
        card.append(el('p', { class: 'mono' }, [cellContent(record, column)]));
      }
      if (record._phase === 'archive') card.append(el('p', { class: 'archive-flag', text: 'From archive' }));
      card.addEventListener('click', () => openDocument(record));
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') openDocument(record);
      });
      list.append(card);
    }
    parts.gridHost.append(list);
    return;
  }
  const grid = el('div', {
    role: 'grid',
    'aria-label': 'Events',
    'aria-rowcount': String(view.total + 1),
    'data-search-state': 'done',
    class: 'events-grid',
  });
  const header = el('div', { role: 'row', 'aria-rowindex': '1', class: 'grid-head' });
  for (const column of view.columns) {
    const sortButton = el('button', {
      type: 'button',
      'aria-label': `Sort by ${column}`,
      text: column,
      tabindex: '-1',
    });
    sortButton.addEventListener('click', () => {
      const same = view.sort?.startsWith(`${column}:`) ?? false;
      view.sortDirection = same && view.sortDirection === 'desc' ? 'asc' : 'desc';
      view.sort = `${column}:${view.sortDirection}`;
      void runSearch();
    });
    const separator = el('span', {
      role: 'separator',
      'aria-label': `Resize ${column}`,
      class: 'resize-handle',
      tabindex: '-1',
    });
    let startX = 0;
    let startWidth = 0;
    separator.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      startX = event.clientX;
      startWidth = widthOf(column);
      const move = (moveEvent: PointerEvent): void => {
        setWidth(column, startWidth + (moveEvent.clientX - startX));
      };
      const up = (): void => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    const cell = el('div', {
      role: 'columnheader',
      'data-column': column,
      'data-width': String(widthOf(column)),
      class: 'grid-cell head',
    }, [sortButton, separator]);
    cell.style.width = `${widthOf(column)}px`;
    header.append(cell);
  }
  grid.append(header);
  const windowEnd = Math.min(view.events.length, view.windowStart + MAX_ROWS_IN_PAGE);
  if (view.windowStart > 0) {
    const spacer = el('div', { role: 'presentation', 'aria-hidden': 'true', class: 'row-spacer' });
    spacer.style.height = `${view.windowStart * ROW_HEIGHT}px`;
    grid.append(spacer);
  }
  for (let index = view.windowStart; index < windowEnd; index += 1) {
    const record = view.events[index];
    const row = el('div', {
      role: 'row',
      'aria-rowindex': String(index + 2),
      'aria-label': rowLabel(record, index),
      class: 'grid-row',
      'data-source': record._phase === 'archive' ? 'archive' : null,
    });
    view.columns.forEach((column, columnIndex) => {
      const cell = el('div', {
        role: 'gridcell',
        class: 'grid-cell',
        tabindex: index === view.focusRow && columnIndex === view.focusColumn ? '0' : '-1',
        'data-row': String(index),
        'data-cell': String(columnIndex),
        'data-column': column,
      }, [cellContent(record, column)]);
      cell.style.width = `${widthOf(column)}px`;
      cell.addEventListener('click', () => {
        view.focusRow = index;
        view.focusColumn = columnIndex;
        openDocument(record);
      });
      cell.addEventListener('focus', () => {
        view.focusRow = index;
        view.focusColumn = columnIndex;
      });
      row.append(cell);
    });
    if (record._phase === 'archive') {
      row.append(el('span', { class: 'archive-flag', text: 'From archive' }));
    }
    grid.append(row);
  }
  const tailRows = view.events.length - windowEnd;
  if (tailRows > 0) {
    const spacer = el('div', { role: 'presentation', 'aria-hidden': 'true', class: 'row-spacer' });
    spacer.style.height = `${tailRows * ROW_HEIGHT}px`;
    grid.append(spacer);
  }
  grid.addEventListener('keydown', gridKeys);
  grid.addEventListener('scroll', () => {
    const start = Math.max(0, Math.floor(grid.scrollTop / ROW_HEIGHT) - 5);
    if (Math.abs(start - view.windowStart) > 10) {
      view.windowStart = Math.min(start, Math.max(0, view.events.length - MAX_ROWS_IN_PAGE));
      renderGrid(false);
    }
    if (grid.scrollTop + grid.clientHeight > grid.scrollHeight - ROW_HEIGHT * 3) {
      void loadMore();
    }
  });
  parts.gridHost.append(grid);
}

function restoreGridFocus(): void {
  if (layoutBand() === 'phone') {
    const cards = parts.gridHost.querySelectorAll<HTMLElement>('.event-card');
    cards[view.focusRow - view.windowStart]?.focus();
    return;
  }
  focusCell(view.focusRow, view.focusColumn);
}

export function closeDocument(): void {
  view.documentFor = null;
  clear(parts.documentHost);
  parts.documentHost.hidden = true;
  document.body.dataset.documentOpen = 'false';
  restoreGridFocus();
}

function openDocument(record: EventRecord): void {
  view.documentFor = record._id;
  clear(parts.documentHost);
  parts.documentHost.hidden = false;
  document.body.dataset.documentOpen = 'true';
  const close = el('button', { type: 'button', 'aria-label': 'Close document', text: 'Close document' });
  close.addEventListener('click', () => closeDocument());
  const surrounding = el('button', {
    type: 'button',
    'aria-label': 'Surrounding events',
    text: 'Surrounding events',
  });
  const body = el('div', { class: 'document-body' });
  surrounding.addEventListener('click', () => {
    void showSurrounding(record, body);
  });
  const edit = el('button', { type: 'button', 'aria-label': 'Edit event', text: 'Edit event' });
  edit.addEventListener('click', () => openEditEvent(record, edit));
  const actions = [close, surrounding];
  if (record._score !== null) {
    const explain = el('button', { type: 'button', 'aria-label': 'Explain score', text: 'Explain score' });
    explain.addEventListener('click', () => {
      void showExplanation(record, body);
    });
    actions.push(explain);
  }
  actions.push(edit);
  parts.documentHost.append(
    el('div', { class: 'document-actions' }, actions),
    el('pre', { class: 'mono document-json', text: JSON.stringify(record, null, 2) }),
    body,
  );
  parts.documentHost.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeDocument();
    }
  });
  panelIn(parts.documentHost);
  close.focus();
}

async function showSurrounding(record: EventRecord, host: HTMLElement): Promise<void> {
  const data = await get<{ before: EventRecord[]; event: EventRecord; after: EventRecord[] }>(
    `/api/streams/${encodeURIComponent(view.stream)}/events/${encodeURIComponent(record._id)}/surrounding`,
  );
  const rows = [...data.before, data.event, ...data.after];
  clear(host);
  host.append(
    el('table', { 'aria-label': 'Surrounding events', class: 'data-table' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Time' }),
          el('th', { scope: 'col', text: 'Host' }),
          el('th', { scope: 'col', text: 'Message' }),
        ]),
      ]),
      el(
        'tbody',
        {},
        rows.map((row) =>
          el('tr', { 'aria-current': row._id === record._id ? 'true' : null }, [
            el('td', { class: 'mono', text: displayTime(zone(), Date.parse(row['@timestamp'])) }),
            el('td', { class: 'mono', text: row.fields.host === undefined ? 'none' : String(row.fields.host) }),
            el('td', { class: 'mono', text: String(row.fields.message ?? '') }),
          ]),
        ),
      ),
    ]),
  );
}

async function showExplanation(record: EventRecord, host: HTMLElement): Promise<void> {
  const data = await get<{ events: EventRecord[] }>(
    `/api/search?${searchQuery({ explain: 'true', id: record._id })}`,
  );
  const explanation = data.events[0]?.explanation;
  clear(host);
  if (!explanation) return;
  host.append(
    buildTree('Score explanation', [
      {
        label: explanation.text,
        text: explanation.text,
        children: (explanation.children ?? []).map((child) => ({
          label: child.text,
          text: child.text,
          children: [],
        })),
      },
    ]),
  );
}

function openEditEvent(record: EventRecord, opener: HTMLButtonElement): void {
  openDialog({
    label: 'Edit event',
    opener,
    content: (dialog) => {
      const area = el('textarea', {
        'aria-label': 'Fields JSON',
        'data-field': 'fields',
        rows: '10',
        text: JSON.stringify(record.fields, null, 2),
      });
      const save = el('button', { type: 'button', 'aria-label': 'Save event', text: 'Save event' });
      const host = el('div', {});
      save.addEventListener('click', () => {
        void (async () => {
          try {
            const fields = JSON.parse(area.value) as Record<string, unknown>;
            await write(
              'PATCH',
              `/api/streams/${encodeURIComponent(view.stream)}/events/${encodeURIComponent(record._id)}`,
              { fields },
            );
            dialog.close();
            announce('Event saved.');
            await runSearch();
          } catch (cause) {
            if (cause instanceof ApiFailure) showFormError(host, cause);
            else showFormError(host, new ApiFailure(422, 'invalid', 'Check the highlighted fields.'));
          }
        })();
      });
      return [el('h2', { text: 'Edit event' }), host, area, save];
    },
  });
}

function openColumns(opener: HTMLButtonElement): void {
  openDialog({
    label: 'Columns',
    opener,
    content: (dialog) => {
      const boxes = view.fields.map((entry) => {
        const box = el('input', {
          type: 'checkbox',
          'aria-label': entry.field,
          checked: view.columns.includes(entry.field),
        });
        box.addEventListener('change', () => {
          view.columns = box.checked
            ? [...view.columns, entry.field]
            : view.columns.filter((column) => column !== entry.field);
        });
        return el('label', { class: 'checkbox' }, [box, entry.field]);
      });
      const done = el('button', { type: 'button', 'aria-label': 'Done', text: 'Done' });
      done.addEventListener('click', () => {
        dialog.close();
        renderGrid(false);
      });
      return [el('h2', { text: 'Columns' }), el('div', { class: 'checkbox-list' }, boxes), done];
    },
  });
}

function openSaveSearch(opener: HTMLButtonElement): void {
  openDialog({
    label: 'Save search',
    opener,
    content: (dialog) => {
      const name = el('input', { type: 'text', 'aria-label': 'Search name', 'data-field': 'name' });
      const save = el('button', { type: 'button', 'aria-label': 'Save', text: 'Save' });
      const host = el('div', {});
      save.addEventListener('click', () => {
        void (async () => {
          try {
            await write('POST', '/api/saved-searches', {
              name: name.value,
              stream: view.stream,
              q: view.q,
              filters: enabledFilters(),
              from: iso(view.fromMs),
              to: iso(view.toMs),
            });
            dialog.close();
            announce(`Search ${name.value} saved.`);
          } catch (cause) {
            if (cause instanceof ApiFailure) showFormError(host, cause);
          }
        })();
      });
      return [el('h2', { text: 'Save search' }), host, name, save];
    },
  });
}

function openTimeRange(opener: HTMLButtonElement): void {
  openDialog({
    label: 'Time range',
    opener,
    sheet: true,
    content: (dialog) => {
      const host = el('div', {});
      const panels: Record<string, HTMLElement> = {
        Quick: el('div', { class: 'range-panel' }),
        Relative: el('div', { class: 'range-panel', hidden: true }),
        Absolute: el('div', { class: 'range-panel', hidden: true }),
      };
      let kind: 'Quick' | 'Relative' | 'Absolute' = 'Quick';
      const quickChoices: [string, number][] = [
        ['Last 15 minutes', 900000],
        ['Last 1 hour', 3600000],
        ['Last 24 hours', 86400000],
        ['Last 7 days', 604800000],
      ];
      let quickMs = 900000;
      for (const [label, span] of quickChoices) {
        const radio = el('input', { type: 'radio', name: 'quick', 'aria-label': label, checked: span === 900000 });
        radio.addEventListener('change', () => {
          quickMs = span;
        });
        panels.Quick.append(el('label', { class: 'checkbox' }, [radio, label]));
      }
      const amount = el('input', { type: 'text', 'aria-label': 'Amount', 'data-field': 'amount', value: '15' });
      const unit = el(
        'select',
        { 'aria-label': 'Unit' },
        ['seconds', 'minutes', 'hours', 'days', 'weeks'].map((name) =>
          el('option', { value: name, text: name, selected: name === 'minutes' }),
        ),
      );
      panels.Relative.append(amount, unit);
      const fromBox = el('input', {
        type: 'text',
        'aria-label': 'From',
        'data-field': 'from',
        value: wallText(zone(), view.fromMs),
      });
      const toBox = el('input', {
        type: 'text',
        'aria-label': 'To',
        'data-field': 'to',
        value: wallText(zone(), view.toMs),
      });
      panels.Absolute.append(fromBox, toBox);
      const tablist = el('div', { role: 'tablist', 'aria-label': 'Range kind', class: 'tablist' });
      const tabs = (['Quick', 'Relative', 'Absolute'] as const).map((name) => {
        const tab = el('button', {
          type: 'button',
          role: 'tab',
          'aria-label': name,
          'aria-selected': String(name === 'Quick'),
          tabindex: name === 'Quick' ? '0' : '-1',
          text: name,
        });
        tab.addEventListener('click', () => {
          kind = name;
          for (const [other, panel] of Object.entries(panels)) panel.hidden = other !== name;
          for (const node of tablist.querySelectorAll<HTMLElement>('[role="tab"]')) {
            const selected = node.getAttribute('aria-label') === name;
            node.setAttribute('aria-selected', String(selected));
            node.tabIndex = selected ? 0 : -1;
          }
        });
        return tab;
      });
      tablist.append(...tabs);
      tablist.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const index = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
        const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        tabs[next].click();
        tabs[next].focus();
      });
      const apply = el('button', { type: 'button', 'aria-label': 'Apply', text: 'Apply' });
      const cancel = el('button', { type: 'button', 'aria-label': 'Cancel', text: 'Cancel' });
      cancel.addEventListener('click', () => dialog.close());
      apply.addEventListener('click', () => {
        void (async () => {
          const unitMs: Record<string, number> = {
            seconds: 1000,
            minutes: 60000,
            hours: 3600000,
            days: 86400000,
            weeks: 604800000,
          };
          if (kind === 'Quick') {
            view.toMs = state.serverTimeMs;
            view.fromMs = view.toMs - quickMs;
          } else if (kind === 'Relative') {
            const value = Number(amount.value);
            if (!Number.isFinite(value) || value <= 0) {
              showFormError(host, new ApiFailure(422, 'invalid', 'Check the highlighted fields.', {
                amount: 'Enter a whole number.',
              }));
              return;
            }
            view.toMs = state.serverTimeMs;
            view.fromMs = view.toMs - value * unitMs[unit.value];
          } else {
            const parsed = await parseAbsolute(fromBox.value, toBox.value, host);
            if (!parsed) return;
            view.fromMs = parsed.fromMs;
            view.toMs = parsed.toMs;
          }
          dialog.close();
          parts.rangeText.textContent = `Showing ${displayTime(zone(), view.fromMs)} to ${displayTime(zone(), view.toMs)}`;
          await runSearch();
        })();
      });
      return [el('h2', { text: 'Time range' }), host, tablist, panels.Quick, panels.Relative, panels.Absolute, apply, cancel];
    },
  });
}

const WALL = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

async function parseAbsolute(
  fromText: string,
  toText: string,
  host: HTMLElement,
): Promise<{ fromMs: number; toMs: number } | null> {
  const fields: Record<string, string> = {};
  const resolve = (text: string, name: string): number | null => {
    const match = WALL.exec(text.trim());
    if (!match) {
      fields[name] = 'Enter a time as YYYY-MM-DD HH:MM:SS.';
      return null;
    }
    const wallUtc = Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
    );
    const offsets = new Set(
      [-86400000, 0, 86400000].map((shift) => zoneOffset(zone(), wallUtc + shift)),
    );
    const candidates = [...offsets]
      .map((offset) => wallUtc - offset)
      .filter((candidate) => wallText(zone(), candidate) === text.trim().replace('T', ' '))
      .sort((left, right) => left - right);
    if (candidates.length === 0) {
      fields[name] = `That time doesn't exist in ${zone()}.`;
      return null;
    }
    return candidates[0];
  };
  const fromMs = resolve(fromText, 'from');
  const toMs = resolve(toText, 'to');
  if (fromMs === null || toMs === null) {
    showFormError(host, new ApiFailure(422, 'invalid', 'Check the highlighted fields.', fields));
    return null;
  }
  if (fromMs >= toMs) {
    showFormError(
      host,
      new ApiFailure(422, 'invalid', 'Check the highlighted fields.', { from: 'From must be before To.' }),
    );
    return null;
  }
  return { fromMs, toMs };
}

function zoneOffset(name: string, utcMs: number): number {
  const text = wallText(name, utcMs);
  const match = WALL.exec(text);
  if (!match) return 0;
  const wallUtc = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
  return wallUtc - Math.floor(utcMs / 1000) * 1000;
}

let tailPaused = false;
let tailLines: string[] = [];
let tailBuffered: string[] = [];
let tailArrived = 0;
let tailDiscarded = 0;
let tailRateLimited = false;

function tailLineOf(record: EventRecord): string {
  const host = record.fields.host === undefined ? 'none' : String(record.fields.host);
  const level = record.fields.level === undefined ? 'none' : String(record.fields.level);
  return `${displayTime(zone(), Date.parse(record['@timestamp']))} ${host} ${level} ${String(record.fields.message ?? '')}`;
}

function pausedSentence(): string {
  return `Live tail paused: ${tailArrived === 1 ? '1 new event' : `${tailArrived} new events`}`;
}

function renderTail(): void {
  clear(parts.gridHost);
  const region = el('div', { role: 'region', 'aria-label': 'Live tail', class: 'tail-region' });
  const toggle = el('button', {
    type: 'button',
    'aria-label': tailPaused ? 'Resume' : 'Pause',
    text: tailPaused ? 'Resume' : 'Pause',
  });
  toggle.addEventListener('click', () => {
    if (tailPaused) resumeTail();
    else pauseTail();
  });
  const leave = el('button', { type: 'button', 'aria-label': 'Live tail', text: 'Live tail' });
  leave.addEventListener('click', () => {
    stopTail();
    void runSearch();
  });
  region.append(el('div', { class: 'grid-toolbar' }, [toggle, leave]));
  if (tailPaused) {
    region.append(el('p', { class: 'tail-state', text: pausedSentence() }));
    if (tailDiscarded > 0) {
      region.append(
        el('p', {
          class: 'tail-state',
          text: `Buffer full: oldest ${tailDiscarded === 1 ? '1 event' : `${tailDiscarded} events`} discarded.`,
        }),
      );
    }
  }
  if (tailRateLimited) {
    region.append(el('p', { class: 'tail-state', text: 'Live tail slowed: rate limit reached.' }));
  }
  const lines = el('div', { class: 'tail-lines' });
  for (const line of tailLines.slice(-200)) lines.append(el('p', { class: 'mono', text: line }));
  region.append(lines);
  lines.addEventListener('wheel', (event) => {
    if (event.deltaY < 0 && !tailPaused) pauseTail();
  });
  parts.gridHost.append(region);
}

function pauseTail(): void {
  tailPaused = true;
  tailArrived = 0;
  tailDiscarded = 0;
  tailBuffered = [];
  renderTail();
  announce(pausedSentence());
}

function resumeTail(): void {
  tailPaused = false;
  tailLines = [...tailLines, ...tailBuffered];
  tailBuffered = [];
  tailArrived = 0;
  tailDiscarded = 0;
  renderTail();
}

async function startTail(): Promise<void> {
  view.tailOn = true;
  tailPaused = false;
  tailLines = [];
  tailBuffered = [];
  tailArrived = 0;
  tailDiscarded = 0;
  tailRateLimited = false;
  renderTail();
  tailSource?.close();
  tailSource = new EventSource(`/api/tail?stream=${encodeURIComponent(view.stream)}`);
  tailSource.addEventListener('line', (event) => {
    const record = JSON.parse((event as MessageEvent<string>).data) as EventRecord;
    const line = tailLineOf(record);
    if (tailPaused) {
      tailArrived += 1;
      tailBuffered.push(line);
      const limit = state.config?.settings.tail_buffer ?? 1000;
      while (tailBuffered.length > limit) {
        tailBuffered.shift();
        tailDiscarded += 1;
      }
      renderTail();
      announce(pausedSentence());
      return;
    }
    tailLines.push(line);
    renderTail();
  });
  tailSource.addEventListener('slowed', () => {
    tailRateLimited = true;
    renderTail();
  });
}

function stopTail(): void {
  view.tailOn = false;
  tailSource?.close();
  tailSource = null;
}

function fragmentStart(text: string, cursor: number, kind: string): number {
  const chars = Array.from(text);
  let start = cursor;
  while (start > 0 && !/[\s()}{]/.test(chars[start - 1])) start -= 1;
  const fragment = chars.slice(start, cursor).join('');
  const match = /^([^:<>]*)(>=|<=|:|>|<)([\s\S]*)$/.exec(fragment);
  if (!match) return start;
  if (kind === 'operator') return start + match[1].length;
  const quoted = match[3].startsWith('"') ? 1 : 0;
  return start + match[1].length + match[2].length + quoted;
}

function renderSuggestions(): void {
  clear(parts.suggestionList);
  suggestions.forEach((item, index) => {
    const option = el('div', {
      role: 'option',
      id: `suggestion-${index}`,
      'aria-label': item.label,
      'aria-selected': String(index === suggestionIndex),
      class: index === suggestionIndex ? 'option selected' : 'option',
      text: item.count === undefined ? item.label : `${item.label} (${item.count})`,
    });
    option.addEventListener('mousedown', (event) => {
      event.preventDefault();
      acceptSuggestion(index);
    });
    parts.suggestionList.append(option);
  });
  const open = suggestions.length > 0;
  parts.suggestionList.hidden = !open;
  parts.queryInput.setAttribute('aria-expanded', String(open));
  if (suggestionIndex >= 0 && suggestions.length > 0) {
    parts.queryInput.setAttribute('aria-activedescendant', `suggestion-${suggestionIndex}`);
  } else {
    parts.queryInput.removeAttribute('aria-activedescendant');
  }
}

let suggestKind = 'none';

async function refreshSuggestions(): Promise<void> {
  const cursor = parts.queryInput.selectionStart ?? parts.queryInput.value.length;
  try {
    const data = await get<{ kind: string; items: { label: string; insert: string; count?: number }[] }>(
      `/api/suggest?stream=${encodeURIComponent(view.stream)}&q=${encodeURIComponent(parts.queryInput.value)}&cursor=${cursor}&from=${iso(view.fromMs)}&to=${iso(view.toMs)}`,
    );
    suggestKind = data.kind;
    suggestions = data.items;
    suggestionIndex = -1;
    renderSuggestions();
  } catch {
    suggestions = [];
    renderSuggestions();
  }
}

function acceptSuggestion(index: number): void {
  const item = suggestions[index];
  if (!item) return;
  const input = parts.queryInput;
  const cursor = input.selectionStart ?? input.value.length;
  const start = fragmentStart(input.value, cursor, suggestKind);
  const next = input.value.slice(0, start) + item.insert + input.value.slice(cursor);
  input.value = next;
  const caret = start + item.insert.length;
  input.setSelectionRange(caret, caret);
  input.focus();
  suggestions = [];
  suggestionIndex = -1;
  renderSuggestions();
  void refreshSuggestions();
}

function closeSuggestions(): void {
  suggestions = [];
  suggestionIndex = -1;
  renderSuggestions();
}

function wireQueryBar(): void {
  const input = parts.queryInput;
  input.addEventListener('input', () => {
    void refreshSuggestions();
  });
  input.addEventListener('click', () => {
    void refreshSuggestions();
  });
  input.addEventListener('keyup', (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') {
      void refreshSuggestions();
    }
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (suggestions.length === 0) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      suggestionIndex = (suggestionIndex + step + suggestions.length) % suggestions.length;
      renderSuggestions();
      return;
    }
    if (event.key === 'Tab') {
      if (suggestionIndex >= 0) {
        event.preventDefault();
        acceptSuggestion(suggestionIndex);
      }
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      closeSuggestions();
      view.q = input.value;
      void runSearch();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSuggestions();
    }
  });
}

/** On a phone the pills, field list and statistics move into the sheet and back. */
function openFiltersSheet(opener: HTMLButtonElement): void {
  const moved = [parts.pillList, parts.fieldList, parts.statistics];
  const homes = moved.map((node) => ({ node, parent: node.parentElement, next: node.nextSibling }));
  const dialog = openDialog({
    label: 'Filters',
    opener,
    sheet: true,
    content: (sheet) => {
      const done = el('button', { type: 'button', 'aria-label': 'Done', text: 'Done' });
      done.addEventListener('click', () => sheet.close());
      return [el('h2', { text: 'Filters' }), ...moved, done];
    },
  });
  const close = dialog.close;
  dialog.close = (): void => {
    for (const home of homes) {
      if (home.parent) home.parent.insertBefore(home.node, home.next);
    }
    close();
  };
}

function wireRegionCycle(): void {
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'F6') return;
    if (!window.location.pathname.startsWith('/explore')) return;
    event.preventDefault();
    const targets: (HTMLElement | null)[] = [
      parts.queryInput,
      parts.histogram.querySelector<HTMLElement>('.bucket[tabindex="0"]') ??
        parts.histogram.querySelector<HTMLElement>('.bucket'),
      parts.fieldList.querySelector<HTMLElement>('button'),
      parts.gridHost.querySelector<HTMLElement>('[role="gridcell"][tabindex="0"]') ??
        parts.gridHost.querySelector<HTMLElement>('[role="gridcell"], .event-card'),
    ];
    if (!parts.documentHost.hidden) {
      targets.push(parts.documentHost.querySelector<HTMLElement>('button'));
    }
    const list = targets.filter((node): node is HTMLElement => node !== null);
    if (list.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    let index = list.findIndex((node) => node === active || node.contains(active));
    if (index < 0) index = event.shiftKey ? 0 : -1;
    const next = (index + (event.shiftKey ? -1 : 1) + list.length) % list.length;
    list[next].focus();
  });
}

function buildLayout(main: HTMLElement): void {
  const streamSelect = el(
    'select',
    { 'aria-label': 'Stream', class: 'stream-select' },
    view.streams.map((name) => el('option', { value: name, text: name, selected: name === view.stream })),
  );
  streamSelect.addEventListener('change', () => {
    view.stream = streamSelect.value;
    view.selectedField = null;
    void runSearch();
  });
  const queryInput = el('input', {
    type: 'text',
    role: 'combobox',
    'aria-label': 'Query',
    'aria-expanded': 'false',
    'aria-autocomplete': 'list',
    'aria-controls': 'query-suggestions',
    class: 'query-input mono',
    value: view.q,
  });
  const suggestionList = el('div', {
    role: 'listbox',
    id: 'query-suggestions',
    'aria-label': 'Suggestions',
    class: 'suggestions',
    hidden: true,
  });
  const rangeButton = el('button', { type: 'button', 'aria-label': 'Time range', text: 'Time range' });
  rangeButton.addEventListener('click', () => openTimeRange(rangeButton));
  const rangeText = el('span', {
    class: 'mono range-text',
    text: `Showing ${displayTime(zone(), view.fromMs)} to ${displayTime(zone(), view.toMs)}`,
  });
  const filtersButton = el('button', { type: 'button', 'aria-label': 'Filters', text: 'Filters' });
  const pillList = el('ul', { role: 'list', 'aria-label': 'Filters', class: 'pill-list' });
  const intervalLabel = el('p', { class: 'mono interval-label', text: 'Interval: 1m' });
  const histogram = el('div', { role: 'group', 'aria-label': 'Histogram', class: 'histogram' });
  const fieldList = el('ul', { role: 'list', 'aria-label': 'Fields', class: 'field-list' });
  const statistics = el('div', {
    role: 'region',
    'aria-label': 'Field statistics',
    class: 'field-statistics',
  });
  const gridHost = el('div', { class: 'grid-host' });
  const messages = el('div', { class: 'messages' });
  const documentHost = el('div', {
    role: 'region',
    'aria-label': 'Document',
    class: 'document-panel',
    hidden: true,
  });

  parts = {
    main,
    queryInput,
    suggestionList,
    streamSelect,
    rangeText,
    rangeButton,
    pillList,
    intervalLabel,
    histogram,
    fieldList,
    statistics,
    gridHost,
    messages,
    documentHost,
    filtersHost: null,
  };
  filtersButton.addEventListener('click', () => openFiltersSheet(filtersButton));

  const rangeControls = el('div', { class: 'range-controls' }, [rangeButton, rangeText]);
  const onPhone = layoutBand() === 'phone';
  const queryRow = el('div', { class: 'query-row' }, [
    streamSelect,
    el('div', { class: 'query-pill' }, [queryInput, suggestionList]),
    onPhone ? null : rangeControls,
  ]);
  const phoneControls = el('div', { class: 'phone-controls' }, onPhone ? [rangeControls, filtersButton] : [filtersButton]);
  const fieldColumn = el('div', { class: 'field-column' }, [fieldList, statistics]);
  const body = el('div', { class: 'explore-body' }, [fieldColumn, gridHost, documentHost]);
  main.append(
    el('h1', { class: 'view-title sr-only', text: 'Explore' }),
    el('div', { class: 'explore' }, [
      queryRow,
      phoneControls,
      pillList,
      messages,
      intervalLabel,
      histogram,
      body,
    ]),
  );
}

export async function renderExplore(main: HTMLElement): Promise<void> {
  let streams: { streams: { name: string }[] };
  try {
    streams = await get<{ streams: { name: string }[] }>('/api/streams');
  } catch {
    main.append(
      loadFailed(() => {
        void renderExplore(main);
      }),
    );
    return;
  }
  view.streams = streams.streams.map((stream) => stream.name).sort();
  if (view.streams.length === 0) {
    const widen = el('button', {
      type: 'button',
      'aria-label': 'Widen to last 7 days',
      text: 'Widen to last 7 days',
    });
    widen.addEventListener('click', () => {
      window.location.assign('/streams');
    });
    main.append(emptyBand('No events in this range.', widen));
    return;
  }
  readAddress();
  const savedId = new URLSearchParams(window.location.search).get('saved');
  let savedProblem: string | null = null;
  if (savedId !== null) {
    const saved = await get<{
      stream: string;
      q: string;
      filters: FilterPill[];
      from: string;
      to: string;
      problem?: string;
    }>(`/api/saved-searches/${encodeURIComponent(savedId)}`);
    savedProblem = saved.problem ?? null;
    if (savedProblem === null) {
      view.stream = saved.stream;
      view.q = saved.q;
      view.fromMs = Date.parse(saved.from);
      view.toMs = Date.parse(saved.to);
      view.filters = (saved.filters ?? []).map((pill) => ({
        field: pill.field,
        value: String(pill.value),
        include: pill.include !== false,
        enabled: true,
      }));
    }
  }
  view.columns = [...DEFAULT_COLUMNS];
  view.widths = {};
  view.documentFor = null;
  stopTail();
  buildLayout(main);
  wireQueryBar();
  wireHistogram();
  wireRegionCycle();
  renderPills();
  if (savedProblem !== null) {
    parts.messages.append(
      el('div', { role: 'alert', 'aria-label': 'Saved search error', class: 'notice-box' }, [
        el('p', { text: savedProblem }),
      ]),
    );
  }
  setLiveHandler((message: LiveMessage) => {
    if (message.type === 'upload' || message.type === 'lifecycle') {
      void refreshNewEvents();
    }
  });
  await runSearch();
}

async function refreshNewEvents(): Promise<void> {
  if (!view.snapshotId || view.tailOn) return;
  try {
    const page = await get<{ new_events: number }>(`/api/snapshots/${view.snapshotId}`);
    view.newEvents = page.new_events;
    const toolbarNode = parts.gridHost.querySelector('.grid-toolbar');
    if (toolbarNode) toolbarNode.replaceWith(toolbar());
  } catch {
    /* an expired snapshot is reported on the next page request */
  }
}
