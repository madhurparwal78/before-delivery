/**
 * Sends and response application: one place commits edits, applies the
 * answers in send order, runs the Settle roll and switches read-only state.
 */
import { api, ApiFailure, Recalc, TableRead, ExportRecord } from './api.js';
import { Pipeline, PENDING_COPY, SendEntry } from './pipeline.js';
import { el, announce, overlayLayer, reducedMotion } from './ui.js';
import { state, COPY_TEXT, layout, rowDisplayOf } from './state.js';
import { renderTable, setActive, paintDecimal, updateFormulaBar, updateTooltip } from './grid.js';

let pipeline = new Pipeline(() => undefined as void);
export const startPipeline = (): void => {
  pipeline = new Pipeline((applied) => applyResponses(applied));
};

const docPath = (suffix: string): string => `/api/documents/${state.documentId}${suffix}`;

// ---------------------------------------------------------------------------
// Sends
// ---------------------------------------------------------------------------

export function sendCellWrite(rowId: string, columnId: string, value: string, revision: number): void {
  markPending(rowId, columnId, value);
  pipeline.send('commit', 'PUT', docPath(`/tables/${state.shownTableId}/rows/${rowId}/cells/${columnId}`), {
    value,
    revision,
  });
}

export function sendPaste(writes: { row_id: string; column_id: string; value: string; revision: number }[]): void {
  for (const w of writes) markPending(w.row_id, w.column_id, w.value);
  pipeline.send('commit', 'POST', docPath(`/tables/${state.shownTableId}/cells`), { writes });
}

export function sendAddRow(): void {
  pipeline.send('commit', 'POST', docPath(`/tables/${state.shownTableId}/rows`), { cells: {} });
}

export function sendDeleteRow(rowId?: string): void {
  const table = state.table!;
  const target = rowId ?? table.rows[state.activeRow]?.id;
  if (!target) return;
  const row = table.rows.find((r) => r.id === target);
  const display = row ? rowDisplayOf(row, table) : '(blank)';
  pipeline.send('commit', 'DELETE', docPath(`/tables/${state.shownTableId}/rows/${target}?revision=${row?.revision ?? 1}`));
  state.deletedStatus = { display, rowId: target, remainingMs: 8000, column: state.activeCol };
  showDeletedStatus();
}

export function sendUndo(): void {
  if (state.readOnly) return;
  pipeline.send('undo', 'POST', docPath('/undo'));
}

export function sendRedo(): void {
  if (state.readOnly) return;
  pipeline.send('redo', 'POST', docPath('/redo'));
}

export async function sendColumnFormula(column: { id: string; revision: number }, text: string): Promise<{ ok: boolean }> {
  try {
    const res = await api<{ recalc: Recalc }>('PATCH', docPath(`/tables/${state.shownTableId}/columns/${column.id}`), {
      revision: column.revision,
      formula: text,
    });
    void res;
    await reloadTable();
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiFailure && err.status === 409) {
      announce('grid-alerts', COPY_TEXT.columnConflict);
      await reloadTable();
    } else if (err instanceof ApiFailure && err.status === 422) {
      announce('grid-alerts', Object.values(err.error.fields ?? {})[0] ?? 'Invalid formula.');
    }
    return { ok: false };
  }
}

export async function sendColumnRename(column: { id: string; revision: number; name: string }, name: string): Promise<boolean> {
  try {
    await api('PATCH', docPath(`/tables/${state.shownTableId}/columns/${column.id}`), { revision: column.revision, name });
    await reloadTable();
    return true;
  } catch (err) {
    if (err instanceof ApiFailure && err.status === 409) {
      announce('grid-alerts', COPY_TEXT.columnConflict);
    } else if (err instanceof ApiFailure && err.status === 422) {
      announce('grid-alerts', Object.values(err.error.fields ?? {})[0] ?? 'Invalid name.');
    }
    return false;
  }
}

export async function sendColumnType(column: { id: string; revision: number }, type: string): Promise<void> {
  try {
    await api('PATCH', docPath(`/tables/${state.shownTableId}/columns/${column.id}`), { revision: column.revision, type });
    await reloadTable();
  } catch (err) {
    if (err instanceof ApiFailure && err.status === 409) announce('grid-alerts', COPY_TEXT.columnConflict);
  }
}

export async function sendRowOwner(column: { id: string }): Promise<void> {
  try {
    await api('PUT', docPath(`/tables/${state.shownTableId}/access`), { owner_column_id: column.id });
    await reloadTable();
  } catch {
    /* nothing changes */
  }
}

export async function sendDeleteColumn(column: { id: string }): Promise<void> {
  try {
    await api('DELETE', docPath(`/tables/${state.shownTableId}/columns/${column.id}`));
    await reloadTable();
  } catch (err) {
    if (err instanceof ApiFailure && err.status === 409) {
      announce('grid-alerts', err.error.code === 'column_in_summary' ? 'This column is used by a summary.' : 'This column marks row owners.');
    }
  }
}

export function sendExport(): Promise<void> {
  const table = state.table!;
  state.exportStatus[state.table!.id] = COPY_TEXT.writing(`${table.name}.csv`);
  state.exportProgress[table.id] = true;
  renderExportStatus();
  void api<{ export: ExportRecord }>('POST', docPath(`/tables/${state.shownTableId}/exports`))
    .then((res) => {
      const record = res.data.export;
      state.exportProgress[table.id] = false;
      state.exportStatus[table.id] = record.status === 'ready'
        ? COPY_TEXT.ready(record.file_name)
        : COPY_TEXT.exportFailed;
      renderExportStatus();
      refreshExportsList();
    })
    .catch(() => {
      state.exportProgress[table.id] = false;
      state.exportStatus[table.id] = COPY_TEXT.exportFailed;
      renderExportStatus();
    });
  return Promise.resolve();
}

export async function downloadExport(exportId: string, fileName: string): Promise<void> {
  const tableId = state.shownTableId!;
  try {
    const res = await fetch(`/api/exports/${exportId}/download`);
    if (res.status === 200) {
      const blob = await res.blob();
      const link = el('a', { href: URL.createObjectURL(blob), download: fileName }) as HTMLAnchorElement;
      document.body.append(link);
      link.click();
      link.remove();
      state.exportStatus[tableId] = COPY_TEXT.downloaded(fileName);
    } else if (res.status === 409) {
      state.exportStatus[tableId] = COPY_TEXT.downloadNotReady;
    } else if (res.status === 503) {
      state.exportStatus[tableId] = COPY_TEXT.downloadUnreachable;
    } else if (res.status === 502) {
      state.exportStatus[tableId] = COPY_TEXT.downloadRefused;
    }
  } catch {
    state.exportStatus[tableId] = COPY_TEXT.downloadUnreachable;
  }
  renderExportStatus();
}

export async function refreshExportsList(): Promise<void> {
  try {
    const res = await api<{ exports: ExportRecord[] }>('GET', docPath('/exports'));
    const mine = res.data.exports.filter((e) => e.table_id === state.shownTableId);
    renderExportsList(mine);
  } catch {
    /* the list keeps its last content */
  }
}

export async function reloadTable(): Promise<void> {
  const tableId = state.shownTableId;
  if (!tableId) return;
  try {
    const res = await api<{ table: TableRead; access: { role: string; row_scope: string }; stacks: { undo_count: number; redo_count: number }; document_revision: number }>(
      'GET',
      docPath(`/tables/${tableId}`),
    );
    applyTableRead(res.data.table, res.data.access, res.data.stacks, res.data.document_revision);
  } catch {
    /* unreachable: keep the last render */
  }
}

function markPending(rowId: string, columnId: string, value: string): void {
  state.pendingCells.set(`${rowId}:${columnId}`, { display: value });
  paintPending(rowId, columnId, value);
  updateStatusPending();
}

function paintPending(rowId: string, columnId: string, value: string): void {
  const table = state.table;
  const column = table?.columns.find((c) => c.id === columnId);
  const cellNode = document.querySelector<HTMLElement>(`[role="gridcell"][data-row-id="${rowId}"][data-column-id="${columnId}"]`);
  if (cellNode && column) {
    cellNode.classList.add('pending');
    cellNode.setAttribute('aria-busy', 'true');
    paintDecimal(cellNode, value, column.type);
  }
  const field = document.querySelector<HTMLElement>(`.card-field[data-row-id="${rowId}"][data-column-id="${columnId}"]`);
  if (field) {
    field.classList.add('pending');
    field.setAttribute('aria-busy', 'true');
    const valueNode = field.querySelector('.field-value');
    if (valueNode) valueNode.textContent = value;
  }
}

function updateStatusPending(): void {
  const text = document.getElementById('status-text');
  if (text && pipeline.pending.length > 0) text.textContent = PENDING_COPY;
  const workspace = document.getElementById('workspace');
  if (workspace) workspace.setAttribute('data-settled', 'false');
}

// ---------------------------------------------------------------------------
// Applying responses in send order
// ---------------------------------------------------------------------------

export function applyResponses(applied: { entry: SendEntry; data?: unknown; error?: ApiFailure }[]): void {
  let newestAlert: string | null = null;
  const successes: { entry: SendEntry; recalc: Recalc }[] = [];
  for (const { entry, data, error } of applied) {
    if (entry.kind === 'read') {
      const read = data as { table: TableRead; access: { role: string; row_scope: string }; stacks: { undo_count: number; redo_count: number }; document_revision: number } | undefined;
      if (read) {
        applyTableRead(read.table, read.access, read.stacks, read.document_revision);
      }
      continue;
    }
    const recalc = (data as { recalc?: Recalc } | undefined)?.recalc;
    if (error) {
      if (entry.kind === 'commit' || entry.kind === 'undo' || entry.kind === 'redo') {
        const alertText = applyError(error, entry);
        if (alertText !== null) newestAlert = alertText;
      }
      continue;
    }
    if (!recalc) continue;
    applyOutcomeToState(entry, data as Record<string, unknown>);
    applyRecalcValues(recalc);
    successes.push({ entry, recalc });
    if (entry.kind === 'undo' || entry.kind === 'redo') {
      void reloadTable();
    }
    if (entry.method !== 'PUT' && entry.method !== 'POST') {
      void reloadTable();
    }
  }
  // only the newest-sent success in the batch plays the roll
  if (successes.length > 0) {
    const newest = successes[successes.length - 1]!;
    playSettleRoll(newest.recalc);
    announce('recalc-announcements', newest.recalc.sentence);
  }
  if (newestAlert) {
    announce('grid-alerts', newestAlert);
  }
  if (pipeline.pending.length === 0 && !state.rollPlaying) {
    document.getElementById('workspace')?.setAttribute('data-settled', 'true');
  }
}

/** Apply an edit's own answer to the shown table's state and DOM. */
function applyOutcomeToState(entry: SendEntry, data: Record<string, unknown>): void {
  const table = state.table;
  if (!table) return;
  const cellFor = (rowId: string, columnId: string, cell: { value?: unknown; display?: string; kind?: string; revision?: number | null }): void => {
    const row = table.rows.find((r) => r.id === rowId);
    const column = table.columns.find((c) => c.id === columnId);
    if (!row || !column) return;
    row.cells[column.id] = {
      value: cell.value ?? null,
      display: cell.display ?? '',
      kind: (cell.kind ?? 'blank') as 'decimal',
      revision: cell.revision ?? row.cells[column.id]?.revision ?? null,
    };
    state.pendingCells.delete(`${rowId}:${columnId}`);
    paintCellFromData(rowId, columnId, cell.display ?? '');
  };
  if (entry.method === 'PUT' && entry.path.includes('/cells/') && data.cell) {
    const match = /\/rows\/([^/]+)\/cells\/([^/]+)/.exec(entry.path);
    if (match) cellFor(match[1]!, match[2]!, data.cell as Record<string, unknown>);
  }
  if (entry.method === 'POST' && entry.path.endsWith('/cells') && Array.isArray(data.cells)) {
    for (const one of data.cells as { row_id: string; column_id: string; cell: Record<string, unknown> }[]) {
      cellFor(one.row_id, one.column_id, one.cell);
    }
  }
  if (entry.method === 'POST' && entry.path.endsWith('/rows') && data.row) {
    const row = data.row as TableRead['rows'][number];
    table.rows.push(row);
    renderTable();
    const rowIndex = table.rows.length - 1;
    if (layout() === 'narrow') {
      const heading = document.querySelectorAll<HTMLElement>('.card-heading')[rowIndex];
      heading?.focus();
    } else {
      setActive(rowIndex, 0);
    }
  }
  if (entry.method === 'DELETE' && entry.path.includes('/rows/')) {
    const match = /\/rows\/([^/]+)/.exec(entry.path);
    if (match) {
      const index = table.rows.findIndex((r) => r.id === match[1]);
      if (index >= 0) table.rows.splice(index, 1);
      renderTable();
      const nextRow = Math.min(state.activeRow, table.rows.length - 1);
      if (layout() === 'narrow') {
        const heading = document.querySelectorAll<HTMLElement>('.card-heading')[Math.max(0, nextRow)];
        heading?.focus();
      } else if (table.rows.length === 0) {
        document.getElementById('add-row')?.focus();
      } else {
        setActive(Math.max(0, nextRow), state.activeCol);
      }
    }
  }
  renderRail();
}

/** The rail counts follow the response's row_counts. */
function renderRail(): void {
  const doc = state.document;
  if (!doc) return;
  for (const t of doc.tables) {
    const link = document.querySelector<HTMLElement>(`.rail-link[data-table-id="${t.id}"] .rail-count`);
    if (link) link.textContent = t.row_count === 1 ? '1 row' : `${t.row_count} rows`;
  }
}

function applyError(error: ApiFailure, entry: SendEntry): string | null {
  if (error.status === 403) {
    state.readOnly = true;
    void reloadTable();
    renderReadOnly();
    return COPY_TEXT.permissionLost;
  }
  if (error.status === 404) {
    void reloadTable();
    return COPY_TEXT.rowGone;
  }
  if (error.status === 409) {
    if (error.error.code === 'stale_revision') {
      const current = error.error.current as { display?: string } | undefined;
      if (entry.path.includes('/cells') && error.error.conflicts) {
        for (const conflict of error.error.conflicts) {
          state.pendingCells.delete(`${conflict.row_id}:${conflict.column_id}`);
          paintCellFromData(conflict.row_id, conflict.column_id, (conflict.current as { display?: string })?.display ?? '');
        }
      } else {
        const match = /\/rows\/([^/]+)\/cells\/([^/]+)/.exec(entry.path);
        if (match) {
          state.pendingCells.delete(`${match[1]}:${match[2]}`);
          paintCellFromData(match[1]!, match[2]!, current?.display ?? '');
          showConflictNotice(match[1]!, match[2]!, current?.display ?? '');
        } else if (entry.path.includes('/rows/') && error.error.current) {
          const rowCurrent = (error.error.current as { row?: TableRead['rows'][number] }).row;
          announce('grid-alerts', COPY_TEXT.rowConflict);
          if (rowCurrent) {
            const table = state.table!;
            const idx = table.rows.findIndex((r) => r.id === rowCurrent.id);
            if (idx >= 0) {
              table.rows[idx] = rowCurrent;
              renderTable();
              setActive(idx, state.activeCol, false);
            }
          }
          return null;
        }
      }
      return COPY_TEXT.cellConflict(current?.display ?? '');
    }
    if (error.error.code === 'nothing_to_undo') return COPY_TEXT.nothingToUndo;
    if (error.error.code === 'nothing_to_redo') return COPY_TEXT.nothingToRedo;
    if (error.error.code === 'undo_conflict') return COPY_TEXT.undoConflict;
    return null;
  }
  if (error.status === 422) {
    const first = Object.values(error.error.fields ?? {})[0];
    return first ?? null;
  }
  if (error.status === 0 || error.status >= 500) {
    return COPY_TEXT.connectionLost;
  }
  return null;
}

function paintCellFromData(rowId: string, columnId: string, display: string): void {
  const cellNode = document.querySelector<HTMLElement>(`[role="gridcell"][data-row-id="${rowId}"][data-column-id="${columnId}"]`);
  const column = state.table?.columns.find((c) => c.id === columnId);
  if (cellNode && column) {
    cellNode.classList.remove('pending');
    cellNode.removeAttribute('aria-busy');
    paintDecimal(cellNode, display, column.type);
  }
  const field = document.querySelector<HTMLElement>(`.card-field[data-row-id="${rowId}"][data-column-id="${columnId}"]`);
  if (field) {
    field.classList.remove('pending');
    field.removeAttribute('aria-busy');
    const valueNode = field.querySelector('.field-value');
    if (valueNode) valueNode.textContent = display;
  }
}

function showConflictNotice(rowId: string, columnId: string, current: string): void {
  const cellNode = document.querySelector<HTMLElement>(`[role="gridcell"][data-row-id="${rowId}"][data-column-id="${columnId}"]`);
  if (!cellNode) return;
  const notice = el('div', { class: 'cell-conflict', id: `conflict-${rowId}-${columnId}`, role: 'alert', text: COPY_TEXT.cellConflict(current === '' ? 'blank' : current) });
  cellNode.setAttribute('aria-describedby', notice.id);
  const rect = cellNode.getBoundingClientRect();
  const layer = overlayLayer();
  layer.append(notice);
  notice.style.position = 'fixed';
  notice.style.left = `${rect.left}px`;
  notice.style.top = `${rect.bottom + 2}px`;
  window.setTimeout(() => {
    notice.remove();
    cellNode.removeAttribute('aria-describedby');
  }, 8000);
}

// ---------------------------------------------------------------------------
// Applying values, the Settle roll, badges, tally
// ---------------------------------------------------------------------------

function applyRecalcValues(recalc: Recalc): void {
  for (const cellChange of recalc.cells) {
    state.pendingCells.delete(`${cellChange.row_id}:${cellChange.column_id}`);
    const table = state.table;
    if (table && table.id === cellChange.table_id) {
      const row = table.rows.find((r) => r.id === cellChange.row_id);
      const column = table.columns.find((c) => c.id === cellChange.column_id);
      if (row && column) {
        row.cells[column.id] = {
          value: null,
          display: cellChange.new_display ?? '',
          kind: (cellChange.new_kind ?? 'blank') as 'decimal',
          revision: row.cells[column.id]?.revision ?? null,
        };
      }
    }
  }
  // row counts and stack state follow the response
  if (state.document) {
    for (const [tableId, count] of Object.entries(recalc.row_counts)) {
      const t = state.document.tables.find((x) => x.id === tableId);
      if (t) t.row_count = count;
    }
  }
  state.stacks = recalc.stacks;
  updateUndoRedoButtons();
  state.docRevision = Math.max(state.docRevision, recalc.document_revision);
  const workspace = document.getElementById('workspace');
  workspace?.setAttribute('data-doc-revision', String(state.docRevision));
  const previousAccess = state.appliedAccess;
  state.appliedAccess = { role: recalc.access.role, row_scope: recalc.access.row_scope };
  if (previousAccess && (previousAccess.role !== recalc.access.role || previousAccess.row_scope !== recalc.access.row_scope)) {
    void reloadTable();
  }
}

function applyTableRead(table: TableRead, access: { role: string; row_scope: string }, stacks: { undo_count: number; redo_count: number }, documentRevision: number): void {
  const previousRows = state.table?.rows.length ?? 0;
  const previousAccess = state.appliedAccess;
  state.table = table;
  state.tableAccess = access;
  state.stacks = stacks;
  state.appliedAccess = { role: access.role, row_scope: access.row_scope };
  state.docRevision = Math.max(state.docRevision, documentRevision);
  const wasReadOnly = state.readOnly;
  state.readOnly = access.role === 'viewer';
  if (state.document) {
    const t = state.document.tables.find((x) => x.id === table.id);
    if (t) t.row_count = table.rows.length;
  }
  renderTable();
  updateUndoRedoButtons();
  const workspace = document.getElementById('workspace');
  workspace?.setAttribute('data-doc-revision', String(state.docRevision));
  if (wasReadOnly !== state.readOnly) renderReadOnly();
  if (previousAccess && (previousAccess.row_scope !== access.row_scope || previousAccess.role !== access.role)) {
    const hidden = previousRows - table.rows.length;
    if (hidden > 0) {
      announce('grid-alerts', COPY_TEXT.rowsHidden(hidden));
    }
  }
  state.lastRowCount = table.rows.length;
}

function updateUndoRedoButtons(): void {
  const undoButton = document.getElementById('undo-button') as HTMLButtonElement | null;
  const redoButton = document.getElementById('redo-button') as HTMLButtonElement | null;
  if (undoButton) undoButton.disabled = state.stacks.undo_count === 0;
  if (redoButton) redoButton.disabled = state.stacks.redo_count === 0;
}

function renderReadOnly(): void {
  const workspace = document.getElementById('workspace');
  if (!workspace) return;
  const grid = document.getElementById('grid');
  if (grid && state.readOnly) grid.setAttribute('aria-readonly', 'true');
  else grid?.removeAttribute('aria-readonly');
  const note = document.getElementById('read-only-note');
  if (state.readOnly) {
    if (!note) {
      const topBar = workspace.querySelector('.top-bar');
      topBar?.append(el('p', { class: 'read-only-note', id: 'read-only-note', text: COPY_TEXT.readOnly }));
    }
  } else {
    note?.remove();
  }
  // writing controls follow the workspace's read-only state without a reload
  document.querySelectorAll('.write-control').forEach((node) => {
    node.classList.toggle('hidden', state.readOnly);
  });
  document.querySelectorAll('.edit-button, .delete-row-button, .edit-formula-button').forEach((node) => {
    node.classList.toggle('hidden', state.readOnly);
  });
}

/** The Settle roll: cells animate in dependency order, then the tally ends. */
function playSettleRoll(recalc: Recalc): void {
  const workspace = document.getElementById('workspace');
  if (!workspace) return;
  workspace.setAttribute('data-settled', 'false');
  state.rollPlaying = true;
  clearRollMarkers();
  const reduce = reducedMotion();
  const cells = recalc.cells;
  const maxDepth = cells.reduce((m, c) => Math.max(m, c.depth), 0);
  const lastStart = maxDepth * 60;
  for (const cellChange of cells) {
    paintCellFromData(cellChange.row_id, cellChange.column_id, cellChange.new_display ?? '');
    const cellNode = document.querySelector<HTMLElement>(`[role="gridcell"][data-row-id="${cellChange.row_id}"][data-column-id="${cellChange.column_id}"]`);
    const fieldNode = document.querySelector<HTMLElement>(`.card-field[data-row-id="${cellChange.row_id}"][data-column-id="${cellChange.column_id}"]`);
    for (const node of [cellNode, fieldNode]) {
      if (!node) continue;
      node.setAttribute('data-recalc-depth', String(cellChange.depth));
      if (reduce) {
        node.setAttribute('data-roll', 'settled');
        node.classList.add(cellChange.new_kind === 'error' ? 'static-error-bar' : 'static-bar');
      } else {
        node.setAttribute('data-roll', 'waiting');
        const start = cellChange.depth * 60;
        const duration = cellChange.new_kind === 'error' ? 120 : 220;
        window.setTimeout(() => {
          if (node.getAttribute('data-recalc-depth') !== String(cellChange.depth)) return;
          node.setAttribute('data-roll', 'rolling');
          if (cellChange.new_kind === 'error') node.classList.add('error-stamp');
        }, start);
        window.setTimeout(() => {
          if (!document.contains(node)) return;
          node.setAttribute('data-roll', 'settled');
          node.classList.remove('error-stamp');
        }, start + duration + 20);
      }
    }
  }
  // badges for tables not on screen
  const badgeCounts = new Map<string, number>();
  for (const cellChange of cells) {
    if (cellChange.table_id === state.shownTableId) continue;
    badgeCounts.set(cellChange.table_id, (badgeCounts.get(cellChange.table_id) ?? 0) + 1);
  }
  for (const [tableId, count] of badgeCounts) {
    const link = document.querySelector<HTMLElement>(`.rail-link[data-table-id="${tableId}"] .rail-badge`);
    if (link) {
      link.style.display = '';
      link.textContent = `, ${count} changed`;
    }
  }
  // the tally counts up to the list length, then ends on the sentence
  const statusText = document.getElementById('status-text');
  if (statusText) {
    if (reduce || cells.length === 0) {
      statusText.textContent = recalc.sentence;
    } else {
      const duration = Math.min(600, lastStart + 220);
      const started = performance.now();
      const step = (): void => {
        if (!document.getElementById('status-text')) return;
        const t = (performance.now() - started) / duration;
        if (t >= 1) {
          statusText.textContent = recalc.sentence;
          return;
        }
        statusText.textContent = `${Math.floor(t * cells.length)} ${PENDING_COPY}`;
        window.requestAnimationFrame(step);
      };
      window.requestAnimationFrame(step);
    }
  }
  const settleDelay = reduce ? 0 : Math.min(600, lastStart + 220) + 40;
  window.setTimeout(() => {
    state.rollPlaying = false;
    if (pipeline.pending.length === 0) {
      workspace.setAttribute('data-settled', 'true');
    }
  }, settleDelay);
}

function clearRollMarkers(): void {
  document.querySelectorAll('[data-recalc-depth]').forEach((node) => {
    node.removeAttribute('data-recalc-depth');
    node.removeAttribute('data-roll');
    node.classList.remove('static-bar', 'static-error-bar', 'error-stamp');
  });
  document.querySelectorAll('.rail-badge').forEach((badge) => {
    badge.textContent = '';
    (badge as HTMLElement).style.display = 'none';
  });
}

// ---------------------------------------------------------------------------
// Exports region
// ---------------------------------------------------------------------------

export function renderExportStatus(): void {
  const tableId = state.shownTableId;
  if (!tableId) return;
  const status = state.exportStatus[tableId] ?? '';
  for (const id of ['export-status', 'export-status-narrow']) {
    const node = document.getElementById(id);
    if (node) node.textContent = status;
  }
  let progress = document.getElementById('export-progress');
  const busy = state.exportProgress[tableId] ?? false;
  if (busy && !progress) {
    progress = el('div', {
      id: 'export-progress',
      class: 'export-progress',
      role: 'progressbar',
      'aria-label': 'Export progress',
      dataset: { motion: reducedMotion() ? 'static' : 'sweep' },
    });
    document.getElementById('exports-region')?.append(progress);
  } else if (!busy && progress) {
    progress.remove();
  } else if (progress) {
    progress.setAttribute('data-motion', reducedMotion() ? 'static' : 'sweep');
  }
}

function renderExportsList(exports: ExportRecord[]): void {
  for (const containerId of ['exports-list', 'exports-list-sheet']) {
    const container = document.getElementById(containerId);
    if (!container) continue;
    container.replaceChildren();
    for (const record of exports) {
      if (record.status !== 'ready') continue;
      const link = el('a', {
        href: record.download_url ?? '#',
        class: 'download-link',
        text: `Download ${record.file_name}`,
        onclick: (event: Event) => {
          event.preventDefault();
          void downloadExport(record.id, record.file_name);
        },
      });
      container.append(el('li', {}, link));
    }
  }
}

// ---------------------------------------------------------------------------
// Deleted-row status
// ---------------------------------------------------------------------------

export function showDeletedStatus(): void {
  const statusNode = document.getElementById('deleted-row-status') as HTMLDivElement | null;
  if (!statusNode || !state.deletedStatus) return;
  statusNode.replaceChildren(
    el('span', { text: COPY_TEXT.deletedRow(state.deletedStatus.display) }),
    el('button', {
      text: 'Undo delete',
      onclick: () => {
        sendUndo();
        closeDeletedStatus();
      },
    }),
  );
  statusNode.style.display = '';
  if (deletedRowTimer) clearTimeout(deletedRowTimer);
  const tick = (): void => {
    // the timer pauses while focus or the pointer rests inside the status
    if (!paused) {
      state.deletedStatus!.remainingMs -= 100;
      if (state.deletedStatus!.remainingMs <= 0) {
        closeDeletedStatus();
        return;
      }
    }
    deletedRowTimer = setTimeout(tick, 100);
  };
  deletedRowTimer = setTimeout(tick, 100);
  statusNode.addEventListener('focusin', pauseDeletedTimer);
  statusNode.addEventListener('focusout', resumeDeletedTimer);
  statusNode.addEventListener('mouseenter', pauseDeletedTimer);
  statusNode.addEventListener('mouseleave', resumeDeletedTimer);
}

let deletedRowTimer: ReturnType<typeof setTimeout> | null = null;
let paused = false;
function pauseDeletedTimer(): void {
  paused = true;
}
function resumeDeletedTimer(): void {
  paused = false;
}

export function closeDeletedStatus(): void {
  const statusNode = document.getElementById('deleted-row-status');
  if (statusNode) statusNode.style.display = 'none';
  if (deletedRowTimer) clearTimeout(deletedRowTimer);
  state.deletedStatus = null;
}

