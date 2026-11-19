/**
 * The grid and record cards: rendering, the keyboard model, cell editing,
 * the Reference picker, the column menu and error tooltips.
 */
import { TableRead, Row, Column, Cell, api } from './api.js';
import { el, announce, overlayLayer, placeFloating, openOverlay, TrapHandle } from './ui.js';
import { state, COPY_TEXT, layout, rowDisplayOf } from './state.js';
import { sendCellWrite, sendPaste, sendDeleteRow } from './sends.js';

export const tooltipHidden = new Set<string>();

export function renderTable(): void {
  const table = state.table;
  if (!table) return;
  const gridArea = document.getElementById('grid-area');
  const cardsArea = document.getElementById('cards-area');
  const heading = document.getElementById('table-heading');
  if (heading) heading.textContent = table.name;
  if (layout() === 'narrow') {
    if (cardsArea) renderCards(cardsArea, table);
    if (gridArea) gridArea.replaceChildren();
  } else {
    if (gridArea) renderGrid(gridArea, table);
    if (cardsArea) cardsArea.replaceChildren();
  }
  updateFormulaBar();
}

function readOnlyNow(): boolean {
  return state.readOnly;
}

function renderGrid(area: HTMLElement, table: TableRead): void {
  const cols = table.columns;
  const grid = el('div', {
    id: 'grid',
    role: 'grid',
    class: 'grid',
    'aria-label': table.name,
    'aria-rowcount': String(table.rows.length + 1),
    'aria-colcount': String(cols.length),
    'aria-multiselectable': 'true',
  });
  if (readOnlyNow()) grid.setAttribute('aria-readonly', 'true');
  grid.tabIndex = 0;
  const headerRow = el('div', { role: 'row', class: 'grid-row header-row', 'aria-rowindex': '1' });
  cols.forEach((c, ci) => {
    const header = el('div', { role: 'columnheader', class: 'grid-cell columnheader', 'aria-colindex': String(ci + 1) },
      el('button', {
        class: 'column-options',
        'aria-label': `${c.name} options`,
        text: `${c.name} options`,
        tabindex: '-1',
      }),
    );
    header.addEventListener('click', (event) => {
      event.stopPropagation();
      const active = setActive(-1, ci);
      void active;
      openColumnMenu(header, c);
    });
    headerRow.append(header);
  });
  grid.append(headerRow);
  table.rows.forEach((row, ri) => {
    const gridRow = el('div', { role: 'row', class: 'grid-row', 'aria-rowindex': String(ri + 2) });
    cols.forEach((c, ci) => {
      gridRow.append(makeGridCell(row, c, ri, ci));
    });
    grid.append(gridRow);
  });
  area.replaceChildren(grid);
  if (table.rows.length === 0) {
    area.append(el('p', { class: 'empty-copy', text: COPY_TEXT.emptyTable }));
  }
  grid.addEventListener('keydown', gridKeydown);
  grid.addEventListener('mousedown', (event) => {
    const cellNode = (event.target as HTMLElement).closest('[role="gridcell"]');
    if (!cellNode) return;
    const ri = Number(cellNode.getAttribute('data-row'));
    const ci = Number(cellNode.getAttribute('data-col'));
    if (event.shiftKey && state.anchor) {
      state.rangeEnd = { row: ri, col: ci };
      paintRange();
    } else {
      setActive(ri, ci, false);
    }
  });
  grid.addEventListener('copy', (event) => {
    void copySelection(event as ClipboardEvent);
  });
  grid.addEventListener('paste', (event) => {
    pasteFromClipboard(event as ClipboardEvent);
  });
  setActive(Math.min(state.activeRow, table.rows.length - 1), state.activeCol, false);
}

function makeGridCell(row: Row, column: Column, ri: number, ci: number): HTMLElement {
  const cellData: Cell = row.cells[column.id] ?? { value: null, display: '', kind: 'blank', revision: 1 };
  const cellNode = el('div', {
    role: 'gridcell',
    class: `grid-cell kind-${cellData.kind}${cellData.kind === 'error' ? ' error-cell' : ''}`,
    'aria-colindex': String(ci + 1),
    'aria-selected': 'false',
    tabindex: '-1',
    'aria-readonly': readOnlyNow() ? 'true' : null,
    dataset: { row: String(ri), col: String(ci), columnId: column.id, rowId: row.id, kind: cellData.kind },
  });
  const pending = state.pendingCells.get(`${row.id}:${column.id}`);
  if (pending) {
    cellNode.classList.add('pending');
    cellNode.setAttribute('aria-busy', 'true');
    paintDecimal(cellNode, pending.display, column.type);
  } else {
    paintDecimal(cellNode, cellData.display, column.type);
  }
  if (cellData.kind === 'error') {
    cellNode.setAttribute('aria-describedby', `tooltip-${row.id}-${column.id}`);
  }
  return cellNode;
}

/** Paint a display, using per-character spans for decimals. */
export function paintDecimal(cellNode: HTMLElement, display: string, type: string): void {
  cellNode.replaceChildren();
  if (type === 'decimal') {
    for (const ch of display) {
      cellNode.append(el('span', { class: 'dec-char', dataset: { char: ch }, text: ch }));
    }
  } else {
    cellNode.textContent = display;
  }
}

function renderCards(area: HTMLElement, table: TableRead): void {
  const list = el('ul', { id: 'records', role: 'list', 'aria-label': 'Records', class: 'record-list' });
  table.rows.forEach((row, ri) => {
    const card = el('li', { class: 'record-card', dataset: { rowId: row.id } });
    const heading = el('h3', { class: 'card-heading serif', tabindex: '-1', text: rowDisplayOf(row, table) });
    card.append(heading);
    for (const column of table.columns) {
      const cellData = row.cells[column.id]!;
      const field = el('div', {
        class: `card-field kind-${cellData.kind}${cellData.kind === 'error' ? ' error-cell' : ''}`,
        dataset: { columnId: column.id, rowId: row.id, kind: cellData.kind },
      },
        el('span', { class: 'field-label', text: column.name }),
        el('span', { class: `field-value${column.type === 'decimal' ? ' mono' : ''}`, text: cellData.display }),
      );
      const pending = state.pendingCells.get(`${row.id}:${column.id}`);
      if (pending) {
        field.classList.add('pending');
        field.setAttribute('aria-busy', 'true');
      }
      if (!readOnlyNow()) {
        const editButton = el('button', {
          class: 'edit-button',
          text: column.type === 'formula' ? `Edit ${column.name} formula` : `Edit ${column.name}`,
          onclick: () => {
            if (column.type === 'formula') {
              openEditFormulaSheet(column, heading);
            } else {
              openCardEditor(card, row, column);
            }
          },
        });
        field.append(editButton);
      }
      card.append(field);
    }
    if (!readOnlyNow()) {
      card.append(el('button', {
        class: 'delete-row-button',
        text: 'Delete row',
        onclick: () => sendDeleteRow(row.id),
      }));
      attachLongPress(heading, row, table);
    }
    list.append(card);
  });
  area.replaceChildren(list);
  if (table.rows.length === 0) {
    area.append(el('p', { class: 'empty-copy', text: COPY_TEXT.emptyTable }));
  }
}

function attachLongPress(heading: HTMLElement, row: Row, table: TableRead): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let startX = 0;
  let startY = 0;
  const cancel = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  heading.addEventListener('pointerdown', (event) => {
    startX = event.clientX;
    startY = event.clientY;
    cancel();
    timer = setTimeout(() => {
      timer = null;
      openRowActions(row, table, heading);
    }, 500);
  });
  heading.addEventListener('pointermove', (event) => {
    if (timer && (Math.abs(event.clientX - startX) > 10 || Math.abs(event.clientY - startY) > 10)) cancel();
  });
  heading.addEventListener('pointerup', cancel);
  heading.addEventListener('pointercancel', cancel);
}

function openRowActions(row: Row, table: TableRead, heading: HTMLElement): void {
  const display = rowDisplayOf(row, table);
  const dialog = el('div', {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': `Row actions for ${display}`,
    class: 'sheet' + (layout() === 'narrow' ? ' full-height' : ' dialog'),
  },
    el('h2', { text: `Row actions for ${display}` }),
    el('button', {
      text: 'Delete row',
      onclick: () => {
        trap.close();
        void sendDeleteRow(row.id);
        heading.focus();
      },
    }),
    el('button', { text: 'Cancel', onclick: () => trap.close() }),
  );
  const trap = openOverlay(dialog);
}

/** Editing one card field inline. */
function openCardEditor(card: HTMLElement, row: Row, column: Column): void {
  const field = card.querySelector<HTMLElement>(`.card-field[data-column-id="${column.id}"]`);
  if (!field || field.querySelector('.card-editor')) return;
  const cellData = row.cells[column.id]!;
  const editorWrap = el('div', { class: 'card-editor' });
  const input = el<HTMLInputElement>('input', {
    class: 'card-input',
    'aria-label': column.name,
    value: cellData.kind === 'bool' ? cellData.display.toLowerCase() : String(cellData.value ?? ''),
  });
  const save = el('button', { text: 'Save', onclick: () => commit() });
  const cancel = el('button', {
    text: 'Cancel',
    onclick: () => {
      editorWrap.remove();
      field.classList.remove('editing');
      (field.querySelector('.edit-button') as HTMLElement)?.focus();
    },
  });
  editorWrap.append(input, save, cancel);
  field.append(editorWrap);
  field.classList.add('editing');
  input.focus();
  const commit = (): void => {
    editorWrap.remove();
    field.classList.remove('editing');
    sendCellWrite(row.id, column.id, input.value, cellData.revision ?? 1);
    (field.querySelector('.edit-button') as HTMLElement)?.focus();
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancel.click();
    }
  });
  input.addEventListener('input', () => {
    field.querySelector('.field-value')?.setAttribute('data-draft', input.value);
  });
}

function openEditFormulaSheet(column: Column, opener: HTMLElement): void {
  const input = el<HTMLTextAreaElement>('textarea', { class: 'formula-input', 'aria-label': 'Formula' });
  input.value = column.formula ?? '';
  const preview = el('div', { role: 'status', 'aria-label': 'Formula preview', class: 'formula-preview' });
  const dialog = el('div', {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Edit formula',
    class: 'sheet full-height' + (layout() === 'narrow' ? '' : ' dialog'),
  },
    el('h2', { text: 'Edit formula' }),
    el('label', { text: 'Formula' }),
    input,
    preview,
    el('button', {
      text: 'Save formula',
      onclick: () => {
        void saveColumnFormula(column, input.value, () => trap.close(), opener);
      },
    }),
    el('button', { text: 'Cancel', onclick: () => trap.close() }),
  );
  const trap = openOverlay(dialog);
  wirePreview(input, preview, state.shownTableId ?? '');
}

async function saveColumnFormula(
  column: Column,
  text: string,
  close: () => void,
  opener: HTMLElement,
): Promise<void> {
  const { sendColumnFormula } = await import('./sends.js');
  const result = await sendColumnFormula(column, text);
  if (result.ok) {
    close();
    const focusTarget = layout() === 'narrow' ? opener : document.querySelector(`.column-options[aria-label="${column.name} options"]`) ?? opener;
    (focusTarget as HTMLElement).focus();
  }
}

// ---------------------------------------------------------------------------
// Keyboard model
// ---------------------------------------------------------------------------

export function setActive(row: number, col: number, focus = true): void {
  state.activeRow = row;
  state.activeCol = col;
  state.rangeEnd = null;
  state.anchor = null;
  paintSelection(focus);
  updateFormulaBar();
  updateTooltip();
}

function paintSelection(focus: boolean): void {
  const grid = document.getElementById('grid');
  if (!grid) return;
  grid.querySelectorAll('[role="gridcell"]').forEach((node) => {
    const ri = Number(node.getAttribute('data-row'));
    const ci = Number(node.getAttribute('data-col'));
    const active = ri === state.activeRow && ci === state.activeCol;
    node.setAttribute('aria-selected', String(active));
    node.setAttribute('tabindex', active ? '0' : '-1');
  });
  grid.querySelectorAll('.column-options').forEach((button) => {
    const ci = Number((button.parentElement as HTMLElement).getAttribute('aria-colindex')) - 1;
    button.setAttribute('tabindex', state.activeRow < 0 && ci === state.activeCol ? '0' : '-1');
  });
  if (focus) {
    if (state.activeRow < 0) {
      const header = grid.querySelectorAll<HTMLElement>('.columnheader')[state.activeCol];
      header?.querySelector<HTMLElement>('button')?.focus();
    } else {
      grid.querySelector<HTMLElement>(`[role="gridcell"][data-row="${state.activeRow}"][data-col="${state.activeCol}"]`)?.focus();
    }
  }
}

function paintRange(): void {
  const grid = document.getElementById('grid');
  if (!grid || !state.anchor || !state.rangeEnd) return;
  const r1 = Math.min(state.anchor.row, state.rangeEnd.row);
  const r2 = Math.max(state.anchor.row, state.rangeEnd.row);
  const c1 = Math.min(state.anchor.col, state.rangeEnd.col);
  const c2 = Math.max(state.anchor.col, state.rangeEnd.col);
  grid.querySelectorAll('[role="gridcell"]').forEach((node) => {
    const ri = Number(node.getAttribute('data-row'));
    const ci = Number(node.getAttribute('data-col'));
    node.setAttribute('aria-selected', String(ri >= r1 && ri <= r2 && ci >= c1 && ci <= c2));
  });
}

export function rangeRect(): { r1: number; r2: number; c1: number; c2: number } | null {
  if (!state.anchor || !state.rangeEnd) return null;
  return {
    r1: Math.min(state.anchor.row, state.rangeEnd.row),
    r2: Math.max(state.anchor.row, state.rangeEnd.row),
    c1: Math.min(state.anchor.col, state.rangeEnd.col),
    c2: Math.max(state.anchor.col, state.rangeEnd.col),
  };
}

export function selectedCells(): { row: number; col: number }[] {
  const rect = rangeRect();
  if (rect) {
    const out: { row: number; col: number }[] = [];
    for (let r = rect.r1; r <= rect.r2; r++) {
      for (let c = rect.c1; c <= rect.c2; c++) out.push({ row: r, col: c });
    }
    return out;
  }
  if (state.activeRow < 0) return [];
  return [{ row: state.activeRow, col: state.activeCol }];
}

function gridKeydown(event: KeyboardEvent): void {
  if ((event.target as HTMLElement).closest?.('.cell-editor')) return;
  const table = state.table;
  if (!table) return;
  const rows = table.rows.length;
  const cols = table.columns.length;
  const meta = event.ctrlKey || event.metaKey;
  const key = event.key;
  const editorOpen = Boolean(document.querySelector('.cell-editor'));
  if (editorOpen) return;
  const move = (r: number, c: number): void => {
    event.preventDefault();
    setActive(r, c);
  };
  if (key === 'ArrowDown' && event.shiftKey) {
    event.preventDefault();
    extendRange(1, 0, rows, cols);
  } else if (key === 'ArrowUp' && event.shiftKey) {
    event.preventDefault();
    extendRange(-1, 0, rows, cols);
  } else if (key === 'ArrowLeft' && event.shiftKey) {
    event.preventDefault();
    extendRange(0, -1, rows, cols);
  } else if (key === 'ArrowRight' && event.shiftKey) {
    event.preventDefault();
    extendRange(0, 1, rows, cols);
  } else if (key === 'ArrowDown' && !event.shiftKey) {
    if (state.activeRow < 0) move(0, state.activeCol);
    else if (state.activeRow < rows - 1) move(state.activeRow + 1, state.activeCol);
    else event.preventDefault();
  } else if (key === 'ArrowUp' && !event.shiftKey) {
    if (state.activeRow === 0) move(-1, state.activeCol);
    else if (state.activeRow > 0) move(state.activeRow - 1, state.activeCol);
    else event.preventDefault();
  } else if (key === 'ArrowLeft' && !event.shiftKey) {
    if (state.activeCol > 0) move(state.activeRow, state.activeCol - 1);
    else event.preventDefault();
  } else if (key === 'ArrowRight' && !event.shiftKey) {
    if (state.activeCol < cols - 1) move(state.activeRow, state.activeCol + 1);
    else event.preventDefault();
  } else if (key === 'Home' && !meta) {
    move(state.activeRow, 0);
  } else if (key === 'End' && !meta) {
    move(state.activeRow, cols - 1);
  } else if (meta && key === 'Home') {
    move(0, 0);
  } else if (meta && key === 'End') {
    move(rows - 1, cols - 1);
  } else if (key === 'Enter' || key === 'F2') {
    event.preventDefault();
    if (readOnlyNow()) {
      announce('grid-alerts', COPY_TEXT.readOnly);
      return;
    }
    openCellEditor('');
  } else if (key === 'Tab') {
    return;
  } else if (key === 'Escape') {
    if (state.rangeEnd) {
      state.rangeEnd = null;
      state.anchor = null;
      paintSelection(false);
    } else {
      hideTooltip();
    }
  } else if (key === 'Delete' || key === 'Backspace') {
    event.preventDefault();
    if (readOnlyNow()) {
      announce('grid-alerts', COPY_TEXT.readOnly);
      return;
    }
    void clearSelection();
  } else if (meta && (key === 'z' || key === 'Z')) {
    return;
  } else if (meta && key === 'y') {
    return;
  } else if (key === 'F10' && event.shiftKey) {
    event.preventDefault();
    const column = table.columns[state.activeCol];
    if (column) {
      const headers = document.querySelectorAll('.columnheader');
      openColumnMenu(headers[state.activeCol] as HTMLElement, column);
    }
  } else if (key.length === 1 && !meta && !event.altKey) {
    const column = table.columns[state.activeCol];
    if (readOnlyNow()) {
      event.preventDefault();
      announce('grid-alerts', COPY_TEXT.readOnly);
      return;
    }
    if (column?.type === 'reference') {
      event.preventDefault();
      openReferencePicker(key);
    } else if (column?.type === 'formula') {
      event.preventDefault();
    } else {
      event.preventDefault();
      openCellEditor(key);
    }
  }
}

function extendRange(dr: number, dc: number, rows: number, cols: number): void {
  if (!state.anchor) state.anchor = { row: state.activeRow, col: state.activeCol };
  const current = state.rangeEnd ?? { row: state.activeRow, col: state.activeCol };
  state.rangeEnd = {
    row: Math.max(0, Math.min(rows - 1, current.row + dr)),
    col: Math.max(0, Math.min(cols - 1, current.col + dc)),
  };
  paintRange();
}

async function copySelection(event: ClipboardEvent): Promise<void> {
  const cells = selectedCells();
  if (cells.length === 0) return;
  event.preventDefault();
  const table = state.table!;
  const rows = Math.max(...cells.map((c) => c.row));
  const cols = Math.max(...cells.map((c) => c.col));
  const lines: string[] = [];
  for (let r = 0; r <= rows; r++) {
    const parts: string[] = [];
    for (let c = 0; c <= cols; c++) {
      if (!cells.some((cell) => cell.row === r && cell.col === c)) continue;
      const column = table.columns[c];
      parts.push(table.rows[r]?.cells[column.id]?.display ?? '');
    }
    if (parts.length > 0) lines.push(parts.join('\t'));
  }
  const text = lines.join('\r\n');
  if (event.clipboardData) {
    event.clipboardData.setData('text/plain', text);
    announce('workspace-status', COPY_TEXT.copied(cells.length));
  } else {
    try {
      await navigator.clipboard.writeText(text);
      announce('workspace-status', COPY_TEXT.copied(cells.length));
    } catch {
      /* nothing to do without clipboard access */
    }
  }
}

async function clearSelection(): Promise<void> {
  const cells = selectedCells();
  const table = state.table!;
  const writes: { row_id: string; column_id: string; value: string; revision: number }[] = [];
  for (const c of cells) {
    const column = table.columns[c.col];
    const row = table.rows[c.row];
    if (!column || !row || column.type === 'formula') continue;
    const cellData = row.cells[column.id];
    if (!cellData || cellData.kind === 'blank') continue;
    writes.push({ row_id: row.id, column_id: column.id, value: '', revision: cellData.revision ?? 1 });
  }
  if (writes.length === 0) return;
  sendPaste(writes);
}

function pasteFromClipboard(event: ClipboardEvent): void {
  if (readOnlyNow()) {
    announce('grid-alerts', COPY_TEXT.readOnly);
    return;
  }
  const text = event.clipboardData?.getData('text/plain') ?? '';
  if (text === '') return;
  event.preventDefault();
  const table = state.table!;
  const lines = text.replace(/(\r\n|\n)$/, '').split(/\r\n|\n/);
  const block = lines.map((line) => line.split('\t'));
  const widths = new Set(block.map((b) => b.length));
  if (widths.size > 1) {
    announce('grid-alerts', COPY_TEXT.pasteNoFit);
    return;
  }
  const rect = rangeRect();
  let topRow: number;
  let leftCol: number;
  let rowsWanted: number;
  let colsWanted: number;
  if (rect) {
    topRow = rect.r1;
    leftCol = rect.c1;
    rowsWanted = rect.r2 - rect.r1 + 1;
    colsWanted = rect.c2 - rect.c1 + 1;
    if (block.length === 1 && block[0]!.length === 1) {
      rowsWanted = rect.r2 - rect.r1 + 1;
      colsWanted = rect.c2 - rect.c1 + 1;
    } else if (block.length !== rowsWanted || block[0]!.length !== colsWanted) {
      announce('grid-alerts', COPY_TEXT.pasteNoFit);
      return;
    }
  } else {
    topRow = state.activeRow;
    leftCol = state.activeCol;
    rowsWanted = block.length;
    colsWanted = block[0]!.length;
  }
  if (topRow < 0 || topRow + rowsWanted > table.rows.length || leftCol + colsWanted > table.columns.length) {
    announce('grid-alerts', COPY_TEXT.pasteNoFit);
    return;
  }
  const writes: { row_id: string; column_id: string; value: string; revision: number }[] = [];
  for (let r = 0; r < rowsWanted; r++) {
    for (let c = 0; c < colsWanted; c++) {
      const column = table.columns[leftCol + c]!;
      if (column.type === 'reference' || column.type === 'formula') {
        announce('grid-alerts', COPY_TEXT.pasteNoFit);
        return;
      }
      const row = table.rows[topRow + r]!;
      const value = block[r]![c] ?? '';
      const cellData = row.cells[column.id]!;
      writes.push({ row_id: row.id, column_id: column.id, value, revision: cellData.revision ?? 1 });
    }
  }
  if (rect) {
    setActive(rect.r1, rect.c1, false);
    state.anchor = { row: rect.r1, col: rect.c1 };
    state.rangeEnd = { row: rect.r2, col: rect.c2 };
    paintRange();
  } else {
    setActive(topRow, leftCol, false);
  }
  sendPaste(writes);
}

// ---------------------------------------------------------------------------
// Cell editor
// ---------------------------------------------------------------------------

let editorState: { row: number; col: number; input: HTMLInputElement; before: string; revision: number } | null = null;

function openCellEditor(initialChar: string): void {
  const table = state.table!;
  const row = table.rows[state.activeRow];
  const column = table.columns[state.activeCol];
  if (!row || !column) return;
  if (column.type === 'reference') {
    openReferencePicker('');
    return;
  }
  if (column.type === 'formula') {
    if (layout() === 'wide') {
      const bar = document.getElementById('formula-input') as HTMLInputElement | null;
      if (bar) {
        bar.focus();
        bar.setSelectionRange(bar.value.length, bar.value.length);
        return;
      }
    }
    void openEditFormulaDialog(column);
    return;
  }
  const cellNode = document.querySelector<HTMLElement>(`[role="gridcell"][data-row="${state.activeRow}"][data-col="${state.activeCol}"]`);
  if (!cellNode) return;
  const cellData = row.cells[column.id]!;
  const input = el<HTMLInputElement>('input', { class: 'cell-editor', 'aria-label': column.name });
  const before = initialChar !== '' ? '' : cellData.kind === 'bool' ? cellData.display.toLowerCase() : String(cellData.value ?? '');
  input.value = initialChar !== '' ? initialChar : before;
  cellNode.append(input);
  cellNode.classList.add('editing');
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  editorState = { row: state.activeRow, col: state.activeCol, input, before: cellData.display, revision: cellData.revision ?? 1 };
  const changed = (): boolean => input.value !== before || (input.value === '' && cellData.kind !== 'blank');
  let sent = false;
  const send = (): void => {
    if (!sent && changed()) {
      sent = true;
      sendCellWrite(row.id, column.id, input.value, cellData.revision ?? 1);
    }
  };
  const commitAndMove = (keyEvent: KeyboardEvent, dr: number, dc: number): void => {
    keyEvent.preventDefault();
    keyEvent.stopPropagation();
    send();
    closeEditor();
    const rows = table.rows.length;
    const cols = table.columns.length;
    let nr = state.activeRow + dr;
    let nc = state.activeCol + dc;
    if (nc >= cols) {
      nc = 0;
      nr += 1;
    }
    if (nc < 0) {
      nc = cols - 1;
      nr -= 1;
    }
    if (nr >= rows) nr = rows - 1;
    if (nr < 0) nr = 0;
    setActive(nr, nc);
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      commitAndMove(event, 1, 0);
    } else if (event.key === 'Tab') {
      commitAndMove(event, 0, event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeEditor();
      setActive(state.activeRow, state.activeCol);
    }
  });
  input.addEventListener('blur', () => {
    // clicking another cell commits the edit
    if (editorState && editorState.input === input && input.parentElement) {
      send();
      closeEditor();
    }
  });
}

function closeEditor(): void {
  editorState = null;
  const editor = document.querySelector('.cell-editor');
  if (editor?.parentElement) editor.remove();
  document.querySelector('.grid-cell.editing')?.classList.remove('editing');
}

export async function openEditFormulaDialog(column: Column): Promise<void> {
  const input = el<HTMLTextAreaElement>('textarea', { class: 'formula-input', 'aria-label': 'Formula' });
  input.value = column.formula ?? '';
  const preview = el('div', { role: 'status', 'aria-label': 'Formula preview', class: 'formula-preview' });
  const dialog = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Edit formula', class: 'dialog' },
    el('h2', { text: 'Edit formula' }),
    el('label', { text: 'Formula' }),
    input,
    preview,
    el('button', {
      text: 'Save formula',
      onclick: () => {
        void saveColumnFormula(column, input.value, () => trap.close(), dialog);
      },
    }),
    el('button', { text: 'Cancel', onclick: () => trap.close() }),
  );
  const trap = openOverlay(dialog);
  wirePreview(input, preview, state.shownTableId ?? '');
}

// ---------------------------------------------------------------------------
// Reference picker
// ---------------------------------------------------------------------------

export async function openReferencePicker(filter: string): Promise<void> {
  const table = state.table!;
  const row = table.rows[state.activeRow];
  const column = table.columns[state.activeCol];
  if (!row || !column || !column.target_table_id) return;
  const cellNode = document.querySelector<HTMLElement>(`[role="gridcell"][data-row="${state.activeRow}"][data-col="${state.activeCol}"]`);
  if (!cellNode) return;
  let target: TableRead;
  try {
    const res = await api<{ table: TableRead }>('GET', `/api/documents/${state.documentId}/tables/${column.target_table_id}`);
    target = res.data.table;
  } catch {
    return;
  }
  const firstCol = target.columns[0];
  const current = row.cells[column.id]?.value;
  const combo = el<HTMLInputElement>('input', { class: 'picker-filter', 'aria-label': column.name, role: 'combobox', 'aria-expanded': 'true' });
  combo.setAttribute('aria-controls', `${column.name} choices`);
  const listbox = el('div', { id: `${column.name} choices`, role: 'listbox', class: 'picker-listbox', 'aria-label': `${column.name} choices` });
  const wrap = el('div', { class: 'reference-picker' }, combo, listbox);
  const options: { id: string | null; display: string }[] = [];
  if (filter === '') options.push({ id: null, display: 'Blank' });
  for (const targetRow of target.rows) {
    const display = firstCol ? targetRow.cells[firstCol.id]?.display ?? '' : '';
    options.push({ id: targetRow.id, display });
  }
  let highlighted = 0;
  if (filter === '' && current) {
    const idx = options.findIndex((o) => o.id === current);
    if (idx >= 0) highlighted = idx;
  }
  const paint = (): void => {
    const f = combo.value.toLowerCase();
    const visible = options.filter((o) => o.id === null || o.display.toLowerCase().includes(f));
    listbox.replaceChildren();
    visible.forEach((option, i) => {
      const optionEl = el('div', { role: 'option', class: `picker-option${i === highlighted ? ' highlighted' : ''}`, 'aria-selected': String(i === highlighted), text: option.display });
      optionEl.id = `${column.name}-option-${i}`;
      listbox.append(optionEl);
    });
    if (visible.length === 0) {
      listbox.append(el('div', { class: 'picker-nomatch', text: COPY_TEXT.pickerNoMatch }));
      combo.removeAttribute('aria-activedescendant');
    } else {
      combo.setAttribute('aria-activedescendant', `${column.name}-option-${highlighted}`);
    }
    const highlightedEl = listbox.children[highlighted] as HTMLElement | undefined;
    combo.setAttribute('aria-activedescendant', highlightedEl?.id ?? '');
  };
  const choose = (): void => {
    const f = combo.value.toLowerCase();
    const visible = options.filter((o) => o.id === null || o.display.toLowerCase().includes(f));
    const option = visible[highlighted];
    if (!option) return;
    wrap.remove();
    cellNode.classList.remove('picker-open');
    if (option.id === null) {
      if (row.cells[column.id]?.kind !== 'blank') {
        sendCellWrite(row.id, column.id, '', row.cells[column.id]?.revision ?? 1);
      }
    } else {
      sendCellWrite(row.id, column.id, option.id, row.cells[column.id]?.revision ?? 1);
    }
    moveAfterPicker();
  };
  const moveAfterPicker = (): void => {
    const rows = table.rows.length;
    setActive(Math.min(state.activeRow + 1, rows - 1), state.activeCol);
  };
  combo.addEventListener('input', () => {
    highlighted = 0;
    paint();
  });
  combo.addEventListener('keydown', (event) => {
    const f = combo.value.toLowerCase();
    const visible = options.filter((o) => o.id === null || o.display.toLowerCase().includes(f));
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      highlighted = Math.min(highlighted + 1, visible.length - 1);
      paint();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      highlighted = Math.max(highlighted - 1, 0);
      paint();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      choose();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      wrap.remove();
      cellNode.classList.remove('picker-open');
      setActive(state.activeRow, state.activeCol);
    }
  });
  combo.value = filter;
  cellNode.classList.add('picker-open');
  const rect = cellNode.getBoundingClientRect();
  placeFloating(wrap, rect, { viewportWidth: window.innerWidth, statusBarTop: statusBarTop() });
  paint();
  combo.focus();
}

export const statusBarTop = (): number => {
  const bar = document.getElementById('status-bar');
  return bar ? bar.getBoundingClientRect().top : window.innerHeight - 40;
};

// ---------------------------------------------------------------------------
// Column menu
// ---------------------------------------------------------------------------

export function openColumnMenu(header: HTMLElement, column: Column): void {
  const role = state.document?.document.role ?? 'viewer';
  const menu = el('div', { role: 'menu', class: 'column-menu', 'aria-label': `Column options for ${column.name}` });
  const close = (): void => {
    menu.remove();
    (header.querySelector('button') as HTMLElement)?.focus();
  };
  const addItem = (label: string, run: () => void, opts: { disabled?: boolean; checked?: boolean; role?: string } = {}): void => {
    const item = el('div', { role: opts.role ?? 'menuitem', class: `menu-item${opts.disabled ? ' disabled' : ''}`, tabindex: '-1', text: label });
    if (opts.checked !== undefined) item.setAttribute('aria-checked', String(opts.checked));
    item.addEventListener('click', () => {
      if (opts.disabled) return;
      run();
    });
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (!opts.disabled) run();
      }
    });
    menu.append(item);
  };
  const runTypeChange = (type: string): void => {
    close();
    void import('./sends.js').then(({ sendColumnType }) => sendColumnType(column, type));
  };
  const isEditor = role === 'editor';
  if (['text', 'decimal', 'date', 'bool'].includes(column.type)) {
    for (const t of ['text', 'decimal', 'date', 'bool']) {
      if (t === column.type) continue;
      addItem(t[0]!.toUpperCase() + t.slice(1), () => runTypeChange(t), { role: 'menuitemradio', disabled: isEditor || state.readOnly });
    }
  }
  if (column.type === 'formula') {
    addItem('Edit formula', () => {
      close();
      void openEditFormulaDialog(column);
    });
  }
  if (column.type === 'text' && role === 'owner') {
    addItem('Use as row owner', () => {
      close();
      void import('./sends.js').then(({ sendRowOwner }) => sendRowOwner(column));
    }, { role: 'menuitemcheckbox', checked: state.table?.owner_column_id === column.id });
  }
  if (role === 'owner') {
    addItem('Rename column', () => {
      close();
      openRenameColumnDialog(column);
    });
    addItem('Delete column', () => {
      close();
      void import('./sends.js').then(({ sendDeleteColumn }) => sendDeleteColumn(column));
    });
  }
  menu.addEventListener('keydown', (event) => {
    const items = Array.from(menu.querySelectorAll<HTMLElement>('.menu-item'));
    const active = document.activeElement as HTMLElement;
    const idx = items.indexOf(active);
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(idx + 1) % items.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(idx - 1 + items.length) % items.length]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1]?.focus();
    }
  });
  const rect = header.getBoundingClientRect();
  placeFloating(menu, rect, { viewportWidth: window.innerWidth, statusBarTop: statusBarTop() });
  const firstEnabled = menu.querySelector<HTMLElement>('.menu-item:not(.disabled)');
  (firstEnabled ?? menu).focus();
}

export function openRenameColumnDialog(column: Column): void {
  const input = el<HTMLInputElement>('input', { class: 'dialog-input', 'aria-label': 'Column name', value: column.name });
  const dialog = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Rename column', class: 'dialog' },
    el('h2', { text: 'Rename column' }),
    el('label', { text: 'Column name' }),
    input,
    el('button', {
      text: 'Save name',
      onclick: async () => {
        const { sendColumnRename } = await import('./sends.js');
        const ok = await sendColumnRename(column, input.value);
        if (ok) trap.close();
      },
    }),
    el('button', { text: 'Cancel', onclick: () => trap.close() }),
  );
  const trap = openOverlay(dialog);
}

// ---------------------------------------------------------------------------
// Formula bar, tooltips
// ---------------------------------------------------------------------------

export function updateFormulaBar(): void {
  const bar = document.getElementById('formula-input') as HTMLInputElement | null;
  if (!bar) return;
  const table = state.table;
  if (!table || state.activeRow < 0 || state.activeRow >= table.rows.length) {
    bar.value = '';
    return;
  }
  const row = table.rows[state.activeRow];
  const column = table.columns[state.activeCol];
  if (!row || !column) {
    bar.value = '';
    return;
  }
  if (column.type === 'formula') {
    bar.value = `=${column.formula ?? ''}`;
  } else {
    const cellData = row.cells[column.id];
    bar.value = cellData ? String(cellData.value ?? '') : '';
  }
}

export function updateTooltip(): void {
  const layer = overlayLayer();
  layer.querySelectorAll('.error-tooltip').forEach((t) => t.remove());
  const table = state.table;
  if (!table) return;
  const column = table.columns[state.activeCol];
  const row = state.activeRow >= 0 ? table.rows[state.activeRow] : undefined;
  if (!column || !row) return;
  const cellData = row.cells[column.id];
  if (!cellData || cellData.kind !== 'error') return;
  const key = `${row.id}:${column.id}`;
  if (tooltipHidden.has(key)) return;
  const tooltip = el('div', { class: 'error-tooltip', role: 'tooltip', id: `tooltip-${row.id}-${column.id}`, text: tooltipCopy(cellData.display) });
  const cellNode = document.querySelector<HTMLElement>(`[role="gridcell"][data-row="${state.activeRow}"][data-col="${state.activeCol}"]`);
  if (cellNode) {
    cellNode.setAttribute('aria-describedby', tooltip.id);
    placeFloating(tooltip, cellNode.getBoundingClientRect(), { viewportWidth: window.innerWidth, statusBarTop: statusBarTop() });
  }
}

export function hideTooltip(): void {
  const table = state.table;
  if (!table) return;
  const column = table.columns[state.activeCol];
  const row = state.activeRow >= 0 ? table.rows[state.activeRow] : undefined;
  if (column && row) tooltipHidden.add(`${row.id}:${column.id}`);
  overlayLayer().querySelectorAll('.error-tooltip').forEach((t) => t.remove());
}

export function tooltipCopy(display: string): string {
  switch (display) {
    case '#DIV/0!':
      return '#DIV/0! Division by zero.';
    case '#TYPE!':
      return '#TYPE! A value has the wrong type for this operation.';
    case '#NAME?':
      return '#NAME? This formula uses a name that does not exist.';
    case '#REF!':
      return '#REF! This formula points at a row that was deleted.';
    case '#CIRC!':
      return '#CIRC! This formula depends on itself.';
    default:
      return display;
  }
}

// ---------------------------------------------------------------------------
// Formula preview
// ---------------------------------------------------------------------------

export function wirePreview(input: HTMLElement, preview: HTMLElement, tableId: string): void {
  let lastText = '';
  let counter = 0;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  const fetchPreview = async (): Promise<void> => {
    const text = (input as HTMLInputElement | HTMLTextAreaElement).value;
    const token = ++counter;
    if (text === '') {
      preview.textContent = '';
      return;
    }
    const table = state.table;
    if (!table || table.rows.length === 0) {
      preview.textContent = COPY_TEXT.noRowsPreview;
      return;
    }
    const activeRow = tableId === state.shownTableId ? table.rows[Math.max(0, state.activeRow)] : table.rows[0];
    if (!activeRow) {
      preview.textContent = COPY_TEXT.noRowsPreview;
      return;
    }
    try {
      const res = await api<{ display: string | null; kind: string | null; diagnosis: string | null }>(
        'POST',
        `/api/documents/${state.documentId}/tables/${tableId}/formula-preview`,
        { formula: text, row_id: activeRow.id },
      );
      if (token !== counter) return;
      const currentText = (input as HTMLInputElement | HTMLTextAreaElement).value;
      if (currentText !== text) return;
      if (res.data.diagnosis !== null) {
        preview.textContent = res.data.diagnosis;
      } else {
        preview.textContent = res.data.kind === 'error' ? tooltipCopy(res.data.display ?? '') : `Result: ${res.data.display ?? ''}`;
      }
    } catch {
      /* the preview keeps its last text */
    }
  };
  input.addEventListener('input', () => {
    void fetchPreview();
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      announce('formula-announcements', preview.textContent ?? '');
    }, 500);
  });
  void fetchPreview();
}

