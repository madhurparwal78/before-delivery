import { append, clear, h } from './dom.js';
import { bus } from './bus.js';
import { canEdit, state } from './state.js';
import { openTaskDetails } from './dialogs.js';
import {
  ActionFailure,
  addItem,
  moveItem,
  renameItem,
  reorderItem,
  savePredecessors,
  setDuration,
  setItemGroup,
  setPercent,
} from './actions.js';
import { ALERTS } from '../shared/copy.js';
import { canonicalFor, canonicalPredecessors } from '../shared/predecessors.js';
import { longDate } from '../shared/dates.js';
import { formatHours } from '../shared/hours.js';
import type { Item, LinkType } from '../shared/types.js';

const COLUMNS = [
  'Row',
  'Name',
  'Start',
  'End',
  'Duration',
  'Predecessors',
  'Assignees',
  '% complete',
  'Variance',
] as const;

const EDITABLE = new Set([2, 3, 5, 6, 8]);
const ENTRY = /^(\d+)(FS|SS|FF|SF)?([+-]\d+)?$/;

function items(): Item[] {
  return state.project?.items ?? [];
}

/** The `Add task` row sits after the last item. */
function addRowIndex(): number {
  return items().length + 1;
}

function rowIndexOf(itemId: string | null): number {
  if (itemId === null) return addRowIndex();
  const index = items().findIndex((item) => item.id === itemId);
  return index === -1 ? addRowIndex() : index + 1;
}

export function listFocusKey(): string {
  return `cell:${rowIndexOf(state.activeCell.itemId)}:${state.activeCell.column}`;
}

function assigneesText(item: Item): string {
  return [...item.assignees]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((assignee) => `${assignee.name} (${formatHours(assignee.hours)})`)
    .join('; ');
}

function varianceCell(item: Item): string {
  if (item.kind === 'group' || !item.baseline) return '';
  const variance = item.baseline.variance;
  return variance > 0 ? `+${variance}` : String(variance);
}

function predecessorsText(item: Item): string {
  const rowOf = new Map(items().map((entry) => [entry.id, entry.row]));
  return canonicalFor(item.id, state.project!.links, rowOf);
}

function cellText(item: Item, column: number): string {
  switch (column) {
    case 1:
      return String(item.row);
    case 2:
      return item.name;
    case 3:
      return item.start ? longDate(item.start) : '';
    case 4:
      return item.end ? longDate(item.end) : '';
    case 5:
      return String(item.duration);
    case 6:
      return item.kind === 'group' ? '' : predecessorsText(item);
    case 7:
      return assigneesText(item);
    case 8:
      return `${item.percent}%`;
    default:
      return varianceCell(item);
  }
}

function editableHere(item: Item | null, column: number): boolean {
  if (!canEdit()) return false;
  if (item === null) return column === 2;
  if (item.kind === 'group') return column === 2;
  return EDITABLE.has(column);
}

function editValue(item: Item, column: number): string {
  switch (column) {
    case 2:
      return item.name;
    case 3:
      return item.chosenStart ?? '';
    case 5:
      return String(item.duration);
    case 6:
      return predecessorsText(item);
    default:
      return String(item.percent);
  }
}

/** The canonical text the announcement uses, read back from the entries the person typed. */
function canonicalOf(text: string): string {
  const trimmed = text.replace(/\s+/g, '');
  if (trimmed === '') return '';
  const entries = [];
  for (const raw of trimmed.split(',')) {
    const match = ENTRY.exec(raw.toUpperCase());
    if (!match) return text;
    entries.push({
      row: Number(match[1]),
      type: (match[2] ?? 'FS') as LinkType,
      lag: match[3] ? Number(match[3]) : 0,
    });
  }
  return canonicalPredecessors(entries);
}

async function saveCell(item: Item, column: number, text: string): Promise<void> {
  if (column === 2) return renameItem(item, text);
  if (column === 3) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text.trim())) throw new ActionFailure(ALERTS.itemStart, 'start');
    return moveItem(item, text.trim());
  }
  if (column === 5) {
    const duration = Number(text.trim());
    if (!Number.isInteger(duration) || duration < 0 || duration > 999) {
      throw new ActionFailure(ALERTS.itemDuration, 'duration');
    }
    return setDuration(item, duration);
  }
  if (column === 6) return savePredecessors(item, text, canonicalOf(text));
  const percent = Number(text.trim());
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    throw new ActionFailure(
      item.kind === 'milestone' ? ALERTS.milestonePercent : ALERTS.itemPercent,
      'percent',
    );
  }
  return setPercent(item, percent);
}

/** The cells a person can move between: every item row, then the `Add task` row. */
function rowKeys(): (string | null)[] {
  return [...items().map((item) => item.id), null];
}

function moveActive(rowDelta: number, columnDelta: number): void {
  state.editing = null;
  const keys = rowKeys();
  const at = keys.indexOf(state.activeCell.itemId);
  const next = Math.min(Math.max((at === -1 ? keys.length - 1 : at) + rowDelta, 0), keys.length - 1);
  state.activeCell = {
    itemId: keys[next],
    column: Math.min(Math.max(state.activeCell.column + columnDelta, 1), COLUMNS.length),
  };
  bus.update();
}

function commitEditor(after: 'down' | 'right' | 'left', asGroup = false): void {
  const editing = state.editing;
  if (!editing) return;
  const item = editing.itemId === null ? null : items().find((entry) => entry.id === editing.itemId);
  const text = editing.value;

  if (!item) {
    state.editing = null;
    bus.update();
    if (text.trim() === '') return;
    void addItem(text.trim(), asGroup ? 'group' : 'task').catch((error: ActionFailure) => {
      bus.setAlert(error.text);
      bus.update();
    });
    return;
  }

  state.editing = null;
  void saveCell(item, editing.column, text)
    .then(() => {
      if (after === 'down') moveActive(1, 0);
      else moveActive(0, after === 'right' ? 1 : -1);
    })
    .catch((error: ActionFailure) => {
      bus.setAlert(error.text);
      state.editing = { ...editing, value: text, invalid: true };
      bus.update();
    });
}

function cellEditor(rowIndex: number, column: number): HTMLInputElement {
  const editing = state.editing!;
  const input = h('input', {
    type: 'text',
    'aria-label': COLUMNS[column - 1],
    class: 'cell-editor',
    'data-focus-key': `cell:${rowIndex}:${column}`,
    'aria-invalid': editing.invalid ? 'true' : null,
  }) as HTMLInputElement;
  input.value = editing.value;
  input.addEventListener('input', () => {
    editing.value = input.value;
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      state.editing = null;
      bus.update();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      editing.value = input.value;
      commitEditor('down', event.shiftKey && editing.itemId === null);
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      editing.value = input.value;
      commitEditor(event.shiftKey ? 'left' : 'right');
    }
  });
  return input;
}

function openEditor(item: Item | null, column: number, initial: string | null): void {
  state.editing = {
    itemId: item?.id ?? null,
    column,
    value: initial ?? (item ? editValue(item, column) : ''),
    invalid: false,
  };
  bus.update();
}

export function renderList(container: HTMLElement): void {
  clear(container);
  const project = state.project!;
  const active = state.activeCell;
  if (state.editing && (state.editing.itemId !== active.itemId || state.editing.column !== active.column)) {
    state.editing = null;
  }
  const activeRow = rowIndexOf(active.itemId);

  const grid = h('div', { role: 'grid', 'aria-label': 'Task list', class: 'grid' });
  grid.appendChild(
    h(
      'div',
      { role: 'row', class: 'grid-head' },
      COLUMNS.map((name) => h('div', { role: 'columnheader', text: name })),
    ),
  );

  const buildRow = (item: Item | null, rowIndex: number): HTMLElement => {
    const row = h('div', {
      role: 'row',
      class: item ? 'grid-row' : 'grid-row add-row',
      'data-item-id': item?.id ?? null,
      'data-critical': item ? (item.critical ? 'true' : 'false') : null,
      'data-late': item ? (item.late ? 'true' : 'false') : null,
      'aria-busy': item && state.busy.has(item.id) ? 'true' : null,
    });
    for (let column = 1; column <= COLUMNS.length; column += 1) {
      const isActive = activeRow === rowIndex && active.column === column;
      const cell = h('div', {
        role: 'gridcell',
        class: `cell col-${column}`,
        tabindex: isActive && !state.editing ? '0' : '-1',
        'data-focus-key': `cell:${rowIndex}:${column}`,
        'data-column': String(column),
        'data-cell-item': item?.id ?? null,
      });
      if (isActive && state.editing) cell.appendChild(cellEditor(rowIndex, column));
      else cell.textContent = item ? cellText(item, column) : column === 1 ? 'Add task' : '';
      row.appendChild(cell);
    }
    return row;
  };

  project.items.forEach((item, index) => grid.appendChild(buildRow(item, index + 1)));
  grid.appendChild(buildRow(null, addRowIndex()));

  grid.addEventListener('keydown', (event) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>('[role="gridcell"]');
    if (!cell || (event.target as HTMLElement).tagName === 'INPUT') return;
    const column = Number(cell.dataset.column);
    const itemId = cell.dataset.cellItem ?? null;
    const item = itemId === null ? null : (items().find((entry) => entry.id === itemId) ?? null);

    if (event.altKey && item && item.kind !== 'group') {
      event.preventDefault();
      bus.setAlert(null);
      if (!canEdit()) {
        bus.announceSchedule(ALERTS.readOnly);
        return;
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        void reorderItem(item, event.key === 'ArrowUp' ? 'up' : 'down').catch((error: ActionFailure) =>
          bus.setAlert(error.text),
        );
        return;
      }
      if (event.key === 'ArrowRight' && item.group === null) {
        const above = items()
          .slice(0, item.row - 1)
          .filter((entry) => entry.kind === 'group')
          .pop();
        if (above) {
          void setItemGroup(item, above.id).catch((error: ActionFailure) => bus.setAlert(error.text));
        }
        return;
      }
      if (event.key === 'ArrowLeft' && item.group !== null) {
        void setItemGroup(item, null).catch((error: ActionFailure) => bus.setAlert(error.text));
      }
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      moveActive(0, 1);
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      moveActive(0, -1);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(1, 0);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1, 0);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      state.activeCell = { itemId, column: event.key === 'Home' ? 1 : COLUMNS.length };
      bus.update();
      return;
    }
    if (column === 7 && item) {
      if (event.key === 'Enter') {
        event.preventDefault();
        openTaskDetails(item, cell);
      }
      return;
    }
    if (!editableHere(item, column)) {
      if (event.key === 'Enter' && !canEdit()) bus.announceSchedule(ALERTS.readOnly);
      return;
    }
    if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault();
      bus.setAlert(null);
      openEditor(item, column, null);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      bus.setAlert(null);
      openEditor(item, column, event.key);
    }
  });

  grid.addEventListener('click', (event) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>('[role="gridcell"]');
    if (!cell || cell.querySelector('input')) return;
    state.editing = null;
    state.activeCell = { itemId: cell.dataset.cellItem ?? null, column: Number(cell.dataset.column) };
    bus.update();
    document.querySelector<HTMLElement>(`[data-focus-key="${listFocusKey()}"]`)?.focus();
  });

  append(container, [h('div', { class: 'grid-region', 'data-scroll': '' }, [grid])]);
}
