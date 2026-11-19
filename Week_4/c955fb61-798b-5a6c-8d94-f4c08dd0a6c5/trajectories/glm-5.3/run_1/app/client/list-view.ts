// The List view: the Task list grid with its active cell and keyboard editing.

import type { IsoDate, Item, Project } from './api-types.ts';
import { longDate, predecessorsText } from './api-types.ts';

export interface ListCallbacks {
  createItem: (name: string, kind: 'task' | 'group') => Promise<{ item: Item; moved: unknown[]; finish: IsoDate | null }>;
  patchItem: (item: Item, body: Record<string, unknown>) => Promise<{ moved: number; finish: IsoDate | null }>;
  setPredecessors: (item: Item, text: string) => Promise<{ item: Item; moved: unknown[]; finish: IsoDate | null }>;
  reorder: (item: Item, direction: 'up' | 'down') => Promise<{ changed: boolean; rows: { id: string; row: number; group: string | null }[] }>;
  openDetails: (itemId: string) => void;
  onAnnounce: (message: string) => void;
  onPageAlert: (message: string) => void;
  viewer: boolean;
  project: () => Project;
}

export interface ListView {
  update(project: Project): void;
  focusItem(itemId: string): void;
}

const COLUMNS = ['Row', 'Name', 'Start', 'End', 'Duration', 'Predecessors', 'Assignees', '% complete', 'Variance'] as const;
type Column = (typeof COLUMNS)[number];

interface CellRef {
  rowIndex: number; // -1 is the Add task row
  column: Column;
}

export function renderListView(panel: HTMLElement, initialProject: Project, callbacks: ListCallbacks): ListView {
  let project = initialProject;
  let active: CellRef = initialProject.items.length === 0 ? { rowIndex: -1, column: 'Name' } : { rowIndex: 0, column: 'Name' };
  let editing: CellRef | null = null;

  const region = document.createElement('div');
  region.className = 'grid-region';
  const table = document.createElement('table');
  table.className = 'grid';
  table.setAttribute('role', 'grid');
  table.setAttribute('aria-label', 'Task list');
  region.append(table);
  panel.append(region);

  const itemRows = (): Item[] => project.items;

  function cellText(item: Item, column: Column): string {
    switch (column) {
      case 'Row':
        return String(item.row);
      case 'Name':
        return item.name;
      case 'Start':
        return item.start === null ? '' : longDate(item.start);
      case 'End':
        return item.end === null ? '' : longDate(item.end);
      case 'Duration':
        return String(item.duration);
      case 'Predecessors':
        return predecessorsText(project, item.id);
      case 'Assignees':
        return item.assignees
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((a) => `${a.name} (${a.hours})`)
          .join('; ');
      case '% complete':
        return `${item.percent}%`;
      case 'Variance':
        return item.baseline === null || item.kind === 'group' ? '' : String(item.baseline.variance);
    }
  }

  function editableColumn(item: Item, column: Column): boolean {
    if (callbacks.viewer) return false;
    if (item.kind === 'group') return column === 'Name';
    switch (column) {
      case 'Name':
      case 'Start':
      case 'Duration':
      case 'Predecessors':
      case '% complete':
        return true;
      default:
        return false;
    }
  }

  function draw(): void {
    table.replaceChildren();
    const headRow = document.createElement('tr');
    headRow.setAttribute('role', 'row');
    for (const column of COLUMNS) {
      const th = document.createElement('th');
      th.setAttribute('role', 'columnheader');
      th.textContent = column;
      th.scope = 'col';
      headRow.append(th);
    }
    table.append(headRow);

    for (const [index, item] of itemRows().entries()) {
      const tr = document.createElement('tr');
      tr.setAttribute('role', 'row');
      tr.dataset.itemId = item.id;
      tr.dataset.critical = String(item.critical);
      tr.dataset.late = String(item.late);
      for (const column of COLUMNS) {
        const td = document.createElement('td');
        td.setAttribute('role', 'gridcell');
        td.dataset.rowIndex = String(index);
        td.dataset.column = column;
        td.textContent = cellText(item, column);
        if (active.rowIndex === index && active.column === column) td.classList.add('active');
        td.tabIndex = -1;
        td.addEventListener('keydown', (event) => cellKeydown(event, { rowIndex: index, column }, item));
        td.addEventListener('click', () => {
          setActive({ rowIndex: index, column });
        });
        tr.append(td);
      }
      table.append(tr);
    }

    const addRow = document.createElement('tr');
    addRow.setAttribute('role', 'row');
    addRow.dataset.addRow = 'true';
    for (const column of COLUMNS) {
      const td = document.createElement('td');
      td.setAttribute('role', 'gridcell');
      td.dataset.rowIndex = '-1';
      td.dataset.column = column;
      if (column === 'Name') td.textContent = 'Add task';
      if (active.rowIndex === -1 && active.column === column) td.classList.add('active');
      td.tabIndex = -1;
      td.addEventListener('keydown', (event) => cellKeydown(event, { rowIndex: -1, column }, null));
      td.addEventListener('click', () => {
        setActive({ rowIndex: -1, column });
      });
      addRow.append(td);
    }
    table.append(addRow);
  }

  function setActive(next: CellRef): void {
    active = next;
    // Keep focus where the person had it, but the active cell follows the move.
    const focused = document.activeElement !== null && document.activeElement !== document.body;
    draw();
    if (focused) focusActive();
  }

  function focusActive(): void {
    const selector = `td[data-row-index="${active.rowIndex}"][data-column="${active.column}"]`;
    const cell = table.querySelector<HTMLElement>(selector);
    if (cell !== null) cell.focus();
  }

  function cellKeydown(event: KeyboardEvent, ref: CellRef, item: Item | null): void {
    if (editing !== null) return;
    const columns: Column[] = [...COLUMNS];
    const at = columns.indexOf(ref.column);
    const rowCount = itemRows().length + 1;

    if (event.key === 'ArrowRight' && !event.altKey) {
      event.preventDefault();
      setActive({ ...ref, column: columns[Math.min(at + 1, columns.length - 1)] });
      return;
    }
    if (event.key === 'ArrowLeft' && !event.altKey) {
      event.preventDefault();
      setActive({ ...ref, column: columns[Math.max(at - 1, 0)] });
      return;
    }
    if (event.key === 'ArrowDown' && !event.altKey) {
      event.preventDefault();
      setActive({ ...ref, rowIndex: Math.min(ref.rowIndex + 1, rowCount - 1) });
      return;
    }
    if (event.key === 'ArrowUp' && !event.altKey) {
      event.preventDefault();
      setActive({ ...ref, rowIndex: Math.max(ref.rowIndex - 1, -1) });
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setActive({ ...ref, column: columns[0] });
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      setActive({ ...ref, column: columns[columns.length - 1] });
      return;
    }
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      event.preventDefault();
      if (item === null || item.kind === 'group') return;
      if (event.key === 'ArrowUp') void doReorder(item, 'up');
      else if (event.key === 'ArrowDown') void doReorder(item, 'down');
      else if (event.key === 'ArrowRight') void doGroupChange(item, 'in');
      else void doGroupChange(item, 'out');
      return;
    }
    if (item !== null && ref.column === 'Assignees' && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      callbacks.openDetails(item.id);
      return;
    }
    if (item === null) {
      if (ref.column === 'Name' && (event.key === 'Enter' || event.key === 'F2' || (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey))) {
        event.preventDefault();
        openAddTask(event.key);
      }
      return;
    }
    if (!editableColumn(item, ref.column)) return;
    if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault();
      openEditor(ref, item, '');
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      openEditor(ref, item, event.key);
    }
  }

  function openEditor(ref: CellRef, item: Item, initialKey: string): void {
    const selector = `td[data-row-index="${ref.rowIndex}"][data-column="${ref.column}"]`;
    const cell = table.querySelector<HTMLElement>(selector);
    if (cell === null) return;
    const input = document.createElement('input');
    input.setAttribute('role', 'textbox');
    input.setAttribute('aria-label', ref.column);
    input.className = 'cell-editor';
    let start = initialKey;
    if (initialKey === '') {
      if (ref.column === 'Start') start = item.chosenStart ?? '';
      else if (ref.column === 'Duration') start = String(item.duration);
      else if (ref.column === '% complete') start = String(item.percent);
      else if (ref.column === 'Predecessors') start = predecessorsText(project, item.id);
      else start = item.name;
    }
    input.value = start;
    cell.append(input);
    input.focus();
    if (initialKey === '') input.select();
    editing = ref;

    const finish = async (save: boolean, move: 'down' | 'right' | null): Promise<void> => {
      const value = input.value;
      if (editing !== null) {
        editing = null;
        input.remove();
      }
      if (save) {
        try {
          await applyCellEdit(item, ref.column, value);
        } catch {
          // The alert has been shown by the edit path; the old value stays.
        }
      }
      if (move === 'down') setActive({ ...ref, rowIndex: Math.min(ref.rowIndex + 1, itemRows().length) });
      else if (move === 'right') setActive({ ...ref, column: nextColumn(ref.column) });
      else setActive(ref);
    };

    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        input.blur();
        void finish(true, 'down');
      } else if (event.key === 'Tab') {
        event.preventDefault();
        input.blur();
        void finish(true, 'right');
      } else if (event.key === 'Escape') {
        event.preventDefault();
        input.blur();
        void finish(false, null);
      }
    });
    input.addEventListener('blur', () => {
      if (editing !== null) void finish(false, null);
    });
  }

  function nextColumn(column: Column): Column {
    const columns: Column[] = [...COLUMNS];
    const at = columns.indexOf(column);
    return at === columns.length - 1 ? column : columns[at + 1];
  }

  async function applyCellEdit(item: Item, column: Column, value: string): Promise<void> {
    const trimmed = value.trim();
    if (column === 'Name') {
      if (trimmed.length < 1 || trimmed.length > 120) {
        callbacks.onPageAlert('Name must be 1 to 120 characters.');
        return;
      }
      await callbacks.patchItem(item, { name: trimmed });
      callbacks.onAnnounce(`${trimmed} saved.`);
      return;
    }
    if (column === 'Start') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        callbacks.onPageAlert('Enter a date as YYYY-MM-DD.');
        return;
      }
      await callbacks.patchItem(item, { start: trimmed });
      const updated = callbacks.project().items.find((entry) => entry.id === item.id);
      if (updated !== undefined && updated.start !== null && trimmed < updated.start) {
        const predecessor = project.links
          .filter((link) => link.to === item.id)
          .map((link) => project.items.find((entry) => entry.id === link.from))
          .filter((entry): entry is Item => entry !== undefined)
          .sort((a, b) => a.row - b.row)[0];
        callbacks.onAnnounce(`${item.name} can start no earlier than ${longDate(updated.start)} because of ${predecessor?.name ?? ''}.`);
      } else {
        callbacks.onAnnounce(startSentence(updated ?? item));
      }
      return;
    }
    if (column === 'Duration') {
      const duration = Number.parseInt(trimmed, 10);
      if (!Number.isInteger(duration) || duration < 0 || duration > 999) {
        callbacks.onPageAlert('Duration must be a whole number from 0 to 999.');
        return;
      }
      await callbacks.patchItem(item, { duration });
      const updated = callbacks.project().items.find((entry) => entry.id === item.id);
      callbacks.onAnnounce(`${item.name} now lasts ${duration === 1 ? '1 working day' : `${duration} working days`} and ends ${longDate(updated?.end ?? '')}.`);
      return;
    }
    if (column === '% complete') {
      const percent = Number.parseInt(trimmed, 10);
      if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
        callbacks.onPageAlert('Percent complete must be a whole number from 0 to 100.');
        return;
      }
      if (item.kind === 'milestone' && percent !== 0 && percent !== 100) {
        callbacks.onPageAlert('A milestone is either 0% or 100% complete.');
        return;
      }
      await callbacks.patchItem(item, { percent });
      callbacks.onAnnounce(`${item.name} is ${percent}% complete.`);
      return;
    }
    if (column === 'Predecessors') {
      await submitPredecessors(item, value);
      return;
    }
  }

  async function submitPredecessors(item: Item, text: string): Promise<void> {
    await callbacks.setPredecessors(item, text);
    const canonical = predecessorsText(callbacks.project(), item.id);
    callbacks.onAnnounce(canonical === '' ? `Predecessors of ${item.name} cleared.` : `Predecessors of ${item.name} set to ${canonical}.`);
  }

  function startSentence(item: Item): string {
    if (item.kind === 'milestone') return `${item.name} is now on ${longDate(item.start ?? '')}.`;
    return `${item.name} now starts ${longDate(item.start ?? '')} and ends ${longDate(item.end ?? '')}.`;
  }

  function openAddTask(initialKey: string): void {
    const cell = table.querySelector<HTMLElement>(`td[data-row-index="-1"][data-column="Name"]`);
    if (cell === null) return;
    const input = document.createElement('input');
    input.setAttribute('role', 'textbox');
    input.setAttribute('aria-label', 'Name');
    input.value = initialKey;
    cell.append(input);
    input.focus();
    editing = { rowIndex: -1, column: 'Name' };

    const finish = async (save: boolean, asGroup: boolean): Promise<void> => {
      const name = input.value.trim();
      if (editing !== null) {
        editing = null;
        input.remove();
      }
      if (!save || name === '') {
        setActive({ rowIndex: -1, column: 'Name' });
        return;
      }
      await callbacks.createItem(name, asGroup ? 'group' : 'task');
      const rows = callbacks.project().items;
      callbacks.onAnnounce(`${name} added as row ${rows[rows.length - 1]?.row ?? 1}.`);
      setActive({ rowIndex: -1, column: 'Name' });
    };

    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        input.blur();
        void finish(true, event.shiftKey);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        input.blur();
        void finish(false, false);
      }
    });
    input.addEventListener('blur', () => {
      if (editing !== null) void finish(false, false);
    });
  }

  async function doReorder(item: Item, direction: 'up' | 'down'): Promise<void> {
    // The grid holds the only tab stop, so its focus must survive the redraw.
    const gridFocused = table.contains(document.activeElement);
    const result = await callbacks.reorder(item, direction);
    if (result.changed) {
      const updated = callbacks.project().items.find((entry) => entry.id === item.id);
      if (updated !== undefined) {
        const wasGroup = item.group !== null;
        const nowGroup = updated.group !== null;
        if (wasGroup !== nowGroup) {
          const groupName = callbacks.project().items.find((entry) => entry.id === updated.group)?.name ?? '';
          callbacks.onAnnounce(nowGroup ? `${item.name} is now in ${groupName}.` : `${item.name} is no longer in a group.`);
        } else {
          callbacks.onAnnounce(`${item.name} moved to row ${updated.row}.`);
        }
      }
    }
    // The active cell follows the moved item.
    const index = callbacks.project().items.findIndex((entry) => entry.id === item.id);
    if (index !== -1) {
      active = { rowIndex: index, column: active.column };
      draw();
      if (gridFocused) focusActive();
    }
  }

  async function doGroupChange(item: Item, direction: 'in' | 'out'): Promise<void> {
    const gridFocused = table.contains(document.activeElement);
    if (direction === 'in') {
      if (item.group !== null) return;
      const items = callbacks.project().items;
      const index = items.findIndex((entry) => entry.id === item.id);
      let group: Item | null = null;
      for (let i = index - 1; i >= 0; i -= 1) {
        if (items[i].kind === 'group') {
          group = items[i];
          break;
        }
      }
      if (group === null) return;
      await callbacks.patchItem(item, { group: group.id });
      callbacks.onAnnounce(`${item.name} is now in ${group.name}.`);
    } else {
      if (item.group === null) return;
      await callbacks.patchItem(item, { group: null });
      callbacks.onAnnounce(`${item.name} is no longer in a group.`);
    }
    // The active cell follows the item's new place.
    const index = callbacks.project().items.findIndex((entry) => entry.id === item.id);
    if (index !== -1) {
      active = { rowIndex: index, column: active.column };
      draw();
      if (gridFocused) focusActive();
    }
  }

  draw();

  return {
    update(next: Project): void {
      project = next;
      const rowCount = project.items.length;
      if (active.rowIndex >= rowCount) active = { rowIndex: -1, column: 'Name' };
      draw();
    },
    focusItem(itemId: string): void {
      const index = project.items.findIndex((entry) => entry.id === itemId);
      if (index !== -1) setActive({ rowIndex: index, column: active.column });
    },
  };
}
