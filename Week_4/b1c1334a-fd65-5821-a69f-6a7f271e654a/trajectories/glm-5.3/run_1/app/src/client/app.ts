/**
 * The app shell: routing, the sign-in and documents screens, the workspace
 * chrome and its dialogs.
 */
import { api, ApiFailure, DocumentRead, TableRead, ShareRecord } from './api.js';
import { el, announce, openOverlay } from './ui.js';
import { state, COPY_TEXT, layout, roleWord } from './state.js';
import { renderTable, setActive, updateFormulaBar, wirePreview } from './grid.js';
import {
  startPipeline, sendAddRow, sendUndo, sendRedo, sendDeleteRow, sendExport,
  refreshExportsList, reloadTable, renderExportStatus,
} from './sends.js';

export const navigate = (path: string): void => {
  window.history.pushState(null, '', path);
  void route();
};

const safeNext = (next: string): string => {
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  return next;
};

export const route = async (): Promise<void> => {
  ensureLiveRegions();
  document.getElementById('overlay-layer')?.replaceChildren();
  const path = window.location.pathname;
  if (path === '/sign-in') return renderSignIn();
  if (path === '/' || path === '') return renderDocuments();
  const wsMatch = /^\/d\/([^/]+)(?:\/t\/([^/]+))?$/.exec(path);
  if (wsMatch) return openWorkspace(wsMatch[1]!, wsMatch[2] ?? null);
  navigate('/');
};

function ensureLiveRegions(): void {
  if (document.getElementById('grid-alerts')) return;
  document.body.append(
    el('div', { id: 'workspace-status', class: 'visually-hidden', role: 'status', 'aria-label': 'Workspace status' }),
    el('div', { id: 'grid-alerts', class: 'visually-hidden', role: 'alert', 'aria-label': 'Grid alerts' }),
    el('div', { id: 'recalc-announcements', class: 'visually-hidden', role: 'status', 'aria-label': 'Recalculation announcements' }),
    el('div', { id: 'formula-announcements', class: 'visually-hidden', role: 'status', 'aria-label': 'Formula announcements' }),
  );
}

// ---------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------

function renderSignIn(): void {
  const params = new URLSearchParams(window.location.search);
  const root = appRoot();
  const emailInput = el<HTMLInputElement>('input', { id: 'email', type: 'email', autocomplete: 'username' });
  const passwordInput = el<HTMLInputElement>('input', { id: 'password', type: 'password', autocomplete: 'current-password' });
  const submit = el<HTMLButtonElement>('button', { type: 'submit', text: 'Sign in' });
  const alertBox = el('div', { id: 'sign-in-alert', role: 'alert', class: 'sign-in-alert' });
  const form = el('form', { class: 'sign-in-form' },
    el('h1', { class: 'product-name serif', text: 'Sign in to Tallyframe' }),
    el('label', { for: 'email', text: 'Email' }),
    emailInput,
    el('label', { for: 'password', text: 'Password' }),
    passwordInput,
    submit,
    alertBox,
  );
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      await api('POST', '/api/auth/sign-in', {
        email: emailInput.value.trim(),
        password: passwordInput.value,
      });
      navigate(safeNext(params.get('next') ?? '/'));
    } catch (err) {
      alertBox.textContent = err instanceof ApiFailure ? err.error.message : COPY_TEXT.connectionLost;
      submit.disabled = false;
      emailInput.focus();
    }
  });
  root.replaceChildren(el('main', { class: 'sign-in-page' }, form));
  emailInput.focus();
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

function appRoot(): HTMLElement {
  let root = document.getElementById('app');
  if (!root) {
    root = el('div', { id: 'app' });
    document.body.append(root);
  }
  return root;
}

async function renderDocuments(): Promise<void> {
  let docs: { documents: { id: string; name: string; role: string }[] };
  let user: { display_name: string };
  try {
    const me = await api<{ user: { display_name: string } }>('GET', '/api/me');
    user = me.data.user;
    const res = await api<{ documents: { id: string; name: string; role: string }[] }>('GET', '/api/documents');
    docs = res.data;
  } catch (err) {
    if (err instanceof ApiFailure && err.status === 401) {
      return navigate(`/sign-in?next=${encodeURIComponent(window.location.pathname)}`);
    }
    return;
  }
  const root = appRoot();
  const list = el('ul', { class: 'documents-list' },
    ...docs.documents.map((d) =>
      el('li', { class: 'document-entry' },
        el('a', { href: `/d/${d.id}`, text: d.name, class: 'serif document-link' }),
        el('span', { class: 'document-role', text: roleWord(d.role) }),
      ),
    ),
  );
  const newButton = el('button', { text: 'New document', onclick: () => openNewDocument() });
  const page = el('main', { class: 'documents-page' },
    el('h1', { class: 'serif', text: 'Documents' }),
    docs.documents.length === 0 ? el('p', { class: 'muted', text: 'No documents yet.' }) : list,
    newButton,
    el('button', {
      text: 'Sign out',
      onclick: async () => {
        await api('POST', '/api/auth/sign-out');
        navigate('/sign-in');
      },
    }),
    el('p', { class: 'muted', text: user.display_name }),
  );
  root.replaceChildren(page);
  (page.querySelector('a') ?? newButton).focus();
}

function openNewDocument(): void {
  const input = el<HTMLInputElement>('input', { id: 'doc-name', 'aria-label': 'Document name' });
  const createButton = el<HTMLButtonElement>('button', { text: 'Create document' });
  const dialog = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'New document', class: 'dialog' },
    el('h2', { text: 'New document' }),
    el('label', { for: 'doc-name', text: 'Document name' }),
    input,
    createButton,
    el('button', { text: 'Cancel', onclick: () => trap.close() }),
  );
  const trap = openOverlay(dialog);
  createButton.addEventListener('click', async () => {
    createButton.disabled = true;
    try {
      const res = await api<{ document: { id: string; name: string } }>('POST', '/api/documents', { name: input.value });
      announce('workspace-status', COPY_TEXT.createdDoc(res.data.document.name));
      trap.close();
      navigate(`/d/${res.data.document.id}`);
    } catch (err) {
      createButton.disabled = false;
      fieldError(input, err);
    }
  });
}

function fieldError(input: HTMLElement, err: unknown): void {
  const message = err instanceof ApiFailure
    ? Object.values(err.error.fields ?? {})[0] ?? err.error.message
    : COPY_TEXT.connectionLost;
  let feedback = input.parentElement?.querySelector<HTMLElement>('.field-error');
  if (!feedback) {
    feedback = el('div', { class: 'field-error', role: 'alert' });
    input.after(feedback);
  }
  feedback.textContent = message;
  input.setAttribute('aria-invalid', 'true');
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

async function openWorkspace(documentId: string, tableId: string | null): Promise<void> {
  state.documentId = documentId;
  startPipeline();
  let document: DocumentRead;
  try {
    const res = await api<DocumentRead>('GET', `/api/documents/${documentId}`);
    document = res.data;
  } catch (err) {
    if (err instanceof ApiFailure && err.status === 401) {
      return navigate(`/sign-in?next=${encodeURIComponent(window.location.pathname)}`);
    }
    if (err instanceof ApiFailure && err.status === 404) return navigate('/');
    return;
  }
  state.document = document;
  state.tables = document.tables;
  state.stacks = { undo_count: document.document.undo_count, redo_count: document.document.redo_count };
  state.readOnly = document.document.role === 'viewer';
  state.appliedAccess = { role: document.document.role, row_scope: document.document.row_scope };
  state.shownTableId = tableId ?? document.tables[0]?.id ?? null;
  renderWorkspace();
  if (!state.shownTableId) return;
  await reloadTable();
  refreshExportsList();
  focusInitial();
}

function focusInitial(): void {
  const table = state.table;
  if (!table) return;
  if (layout() === 'narrow') {
    const heading = document.querySelector<HTMLElement>('.card-heading');
    if (heading) {
      heading.focus();
      return;
    }
    const addRow = document.getElementById('add-row') as HTMLElement | null;
    if (addRow) {
      addRow.focus();
      return;
    }
    document.getElementById('table-heading')?.focus();
    return;
  }
  if (table.rows.length === 0) {
    const addRow = document.getElementById('add-row') as HTMLElement | null;
    if (addRow) {
      addRow.focus();
      return;
    }
    document.getElementById('table-heading')?.focus();
    return;
  }
  setActive(0, 0);
}

function renderWorkspace(): void {
  const doc = state.document!;
  const currentLayout = layout();
  const isOwner = doc.document.role === 'owner';
  const heading = el('h1', { class: 'doc-name serif', text: doc.document.name });
  const shareButton = el('button', { text: 'Share', onclick: () => openShareDialog() });
  if (!isOwner) shareButton.classList.add('hidden');
  const undoButton = el('button', { id: 'undo-button', text: 'Undo', disabled: state.stacks.undo_count === 0, onclick: () => sendUndo() });
  const redoButton = el('button', { id: 'redo-button', text: 'Redo', disabled: state.stacks.redo_count === 0, onclick: () => sendRedo() });
  if (state.readOnly) {
    undoButton.classList.add('hidden');
    redoButton.classList.add('hidden');
  }
  const signOutButton = el('button', {
    text: 'Sign out',
    onclick: async () => {
      await api('POST', '/api/auth/sign-out');
      navigate('/sign-in');
    },
  });
  const topBar = el('header', { class: 'top-bar' },
    heading, shareButton, undoButton, redoButton, signOutButton,
    state.readOnly ? el('p', { class: 'read-only-note', id: 'read-only-note', text: COPY_TEXT.readOnly }) : null,
  );

  const rail = el('nav', { id: 'table-rail', class: 'table-rail', 'aria-label': 'Tables' },
    ...state.tables.map((t) => makeRailLink(t)),
  );
  if (isOwner) {
    const newTable = el('button', { text: 'New table', onclick: () => openNewTable() });
    const newSummary = el('button', { text: 'New summary', onclick: () => openNewSummary() });
    rail.append(newTable, newSummary);
  }

  const tableHeading = el('h2', { id: 'table-heading', class: 'serif table-name', text: state.table?.name ?? '' });
  const canWrite = !state.readOnly;
  const renameButton = el('button', { text: 'Rename table', onclick: () => openRenameTable() });
  if (!isOwner) renameButton.classList.add('hidden');
  const addRowButton = el('button', { id: 'add-row', text: 'Add row', onclick: () => sendAddRow(), class: 'write-control' });
  const deleteRowButton = el('button', { id: 'delete-row', text: 'Delete row', onclick: () => sendDeleteRow(), class: 'write-control' });
  if (!canWrite) {
    addRowButton.classList.add('hidden');
    deleteRowButton.classList.add('hidden');
  }
  const exportButton = el('button', { text: 'Export CSV', onclick: () => void sendExport() });
  const addColumnButton = el('button', { text: 'Add column', onclick: () => openAddColumn() });
  if (!isOwner) addColumnButton.classList.add('hidden');
  const switchButton = el('button', { text: 'Switch table', onclick: () => openTablesDrawer() });
  const tablesToggle = el('button', { text: 'Tables', 'aria-expanded': 'false' });

  const exportsRegion = el('div', { id: 'exports-region', role: 'region', 'aria-label': 'Exports' },
    el('div', { id: 'export-status', role: 'status', class: 'export-status', 'aria-label': 'Export status' }),
    el('ul', { id: 'exports-list', class: 'exports-list' }),
  );

  const toolbar = el('div', { class: 'table-toolbar' },
    tableHeading,
    el('div', { class: 'toolbar-actions' },
      currentLayout === 'narrow' ? null : renameButton,
      addRowButton,
      currentLayout === 'narrow' ? null : deleteRowButton,
      exportButton,
      isOwner && currentLayout === 'narrow' ? addColumnButton : null,
      currentLayout === 'narrow' ? el('button', { text: 'Exports', onclick: () => openExportsSheet() }) : null,
      currentLayout === 'narrow' ? switchButton : null,
    ),
    currentLayout === 'narrow'
      ? el('div', { id: 'export-status-narrow', role: 'status', class: 'export-status', 'aria-label': 'Export status' })
      : exportsRegion,
  );

  const formulaInput = el<HTMLInputElement>('input', { id: 'formula-input', 'aria-label': 'Formula', type: 'text' });
  if (state.readOnly) formulaInput.setAttribute('readonly', 'true');
  const formulaPreview = el('div', { id: 'formula-preview', role: 'status', 'aria-label': 'Formula preview', class: 'formula-preview' });
  const formulaBar = el('div', { id: 'formula-bar', class: 'formula-bar' }, formulaInput, formulaPreview);
  formulaInput.addEventListener('keydown', (event) => {
    const table = state.table;
    if (!table) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      const column = table.columns[state.activeCol];
      const row = table.rows[state.activeRow];
      if (!column || !row || state.readOnly) return;
      if (column.type === 'formula') {
        void import('./sends.js').then(({ sendColumnFormula }) => sendColumnFormula(column, formulaInput.value));
      } else {
        void import('./sends.js').then(({ sendCellWrite }) => sendCellWrite(row.id, column.id, formulaInput.value, row.cells[column.id]?.revision ?? 1));
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      updateFormulaBar();
      setActive(state.activeRow, state.activeCol);
    }
  });

  const gridArea = el('div', { id: 'grid-area', class: 'grid-area' });
  const cardsArea = el('div', { id: 'cards-area', class: 'cards-area' });
  const statusBar = el('div', { id: 'status-bar', class: 'status-bar' },
    el('span', { id: 'status-text', class: 'tally', text: '' }),
    el('div', { id: 'deleted-row-status', class: 'deleted-row-status', role: 'status', 'aria-label': 'Deleted row', style: 'display: none' }),
  );

  const workspace = el('main', {
    id: 'workspace',
    class: `workspace layout-${currentLayout}`,
    'aria-label': 'Workspace',
    'data-doc-revision': String(state.docRevision),
    'data-settled': 'true',
  },
    topBar,
    currentLayout === 'medium' ? tablesToggle : null,
    el('div', { class: 'workspace-body' },
      currentLayout === 'narrow' ? null : rail,
      el('div', { class: 'workspace-main' },
        toolbar,
        currentLayout === 'wide' ? formulaBar : null,
        currentLayout === 'narrow' ? cardsArea : gridArea,
      ),
    ),
    statusBar,
  );
  appRoot().replaceChildren(workspace);
  document.title = doc.document.name;
  if (currentLayout === 'medium') {
    tablesToggle.addEventListener('click', () => {
      const open = rail.classList.toggle('rail-visible');
      tablesToggle.setAttribute('aria-expanded', String(open));
    });
  }
  if (!state.table) {
    gridArea.replaceChildren(el('p', { class: 'empty-copy', text: COPY_TEXT.emptyDocument }));
    if (isOwner) {
      const firstTable = el('button', { text: 'Create first table', onclick: () => openNewTable() });
      gridArea.append(firstTable);
    }
  } else {
    renderTable();
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onGlobalKeys);
}

let lastLayout = layout();
function onResize(): void {
  if (layout() !== lastLayout) {
    lastLayout = layout();
    renderWorkspace();
    renderTable();
    renderExportStatus();
  }
}

function onGlobalKeys(event: KeyboardEvent): void {
  const meta = event.ctrlKey || event.metaKey;
  if (!(meta && (event.key === 'z' || event.key === 'Z'))) {
    if (!(meta && event.key === 'y')) return;
  }
  const target = event.target as HTMLElement;
  const inTextField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
  if (inTextField) return;
  if (document.querySelector('.overlay-layer')?.children.length) return;
  event.preventDefault();
  if (meta && event.key === 'y') {
    sendRedo();
  } else if (event.shiftKey) {
    sendRedo();
  } else {
    sendUndo();
  }
}

function makeRailLink(t: { id: string; name: string; row_count: number }): HTMLElement {
  const count = t.row_count;
  return el('a', {
    href: `/d/${state.documentId}/t/${t.id}`,
    class: 'rail-link',
    dataset: { tableId: t.id },
  },
    el('span', { class: 'serif rail-name', text: t.name }),
    el('span', { class: 'mono rail-count', text: count === 1 ? '1 row' : `${count} rows` }),
    el('span', { class: 'rail-badge', style: 'display: none' }),
  );
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

function openNewTable(): void {
  const input = el<HTMLInputElement>('input', { 'aria-label': 'Table name' });
  const createButton = el<HTMLButtonElement>('button', { text: 'Create table' });
  const dialog = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'New table', class: 'dialog' + (layout() === 'narrow' ? ' sheet full-height' : '') },
    el('h2', { text: 'New table' }),
    el('label', { text: 'Table name' }),
    input,
    createButton,
    el('button', { text: 'Cancel', onclick: () => trap.close() }),
  );
  const trap = openOverlay(dialog);
  createButton.addEventListener('click', async () => {
    createButton.disabled = true;
    try {
      const res = await api<{ table: { id: string; name: string }; recalc: unknown }>(
        'POST',
        `/api/documents/${state.documentId}/tables`,
        { name: input.value },
      );
      announce('workspace-status', COPY_TEXT.createdTable(res.data.table.name));
      trap.close();
      navigate(`/d/${state.documentId}/t/${res.data.table.id}`);
    } catch (err) {
      createButton.disabled = false;
      fieldError(input, err);
    }
  });
}

function openRenameTable(): void {
  const table = state.table!;
  const input = el<HTMLInputElement>('input', { 'aria-label': 'Table name', value: table.name });
  const saveButton = el<HTMLButtonElement>('button', { text: 'Save name' });
  const dialog = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Rename table', class: 'dialog' },
    el('h2', { text: 'Rename table' }),
    el('label', { text: 'Table name' }),
    input,
    saveButton,
    el('button', { text: 'Cancel', onclick: () => trap.close() }),
  );
  const trap = openOverlay(dialog);
  saveButton.addEventListener('click', async () => {
    try {
      await api('PATCH', `/api/documents/${state.documentId}/tables/${table.id}`, { name: input.value, revision: table.revision });
      trap.close();
      document.getElementById('table-heading')?.focus();
      await reloadTable();
      renderWorkspaceChrome();
    } catch (err) {
      if (err instanceof ApiFailure && err.status === 409) {
        input.value = (err.error.current as { table?: { name?: string } })?.table?.name ?? table.name;
        fieldError(input, new ApiFailure(409, { code: 'stale_revision', message: COPY_TEXT.tableConflict }, false));
        announce('grid-alerts', COPY_TEXT.tableConflict);
      } else {
        fieldError(input, err);
      }
    }
  });
}

function renderWorkspaceChrome(): void {
  const doc = state.document!;
  const rail = document.getElementById('table-rail');
  if (rail) {
    rail.replaceChildren(...state.tables.map((t) => makeRailLink(t)));
    if (doc.document.role === 'owner') {
      rail.append(
        el('button', { text: 'New table', onclick: () => openNewTable() }),
        el('button', { text: 'New summary', onclick: () => openNewSummary() }),
      );
    }
  }
}

function openNewSummary(): void {
  const tables = state.tables.filter((t) => t.kind !== 'summary');
  if (tables.length === 0) return;
  const sourceSelect = el<HTMLSelectElement>('select', { 'aria-label': 'Source table' },
    ...tables.map((t, i) => el('option', { value: t.id, selected: i === 0 ? true : null, text: t.name })),
  );
  const groupSelects: HTMLSelectElement[] = [];
  const sumBoxes: HTMLInputElement[] = [];
  const buildGroup = (index: number, label: string): HTMLElement => {
    const select = el<HTMLSelectElement>('select', { 'aria-label': label });
    groupSelects[index] = select;
    return el('div', { class: 'dialog-row' }, el('label', { text: label }), select);
  };
  const groupWrap = el('div', { role: 'group', 'aria-label': 'Group by' },
    buildGroup(0, 'Group by column 1'),
    buildGroup(1, 'Group by column 2'),
    buildGroup(2, 'Group by column 3'),
  );
  const sumWrap = el('div', { role: 'group', 'aria-label': 'Sum columns' });
  const fillColumns = async (): Promise<void> => {
    const sourceId = sourceSelect.value;
    let source: TableRead;
    try {
      const res = await api<{ table: TableRead }>('GET', `/api/documents/${state.documentId}/tables/${sourceId}`);
      source = res.data.table;
    } catch {
      return;
    }
    groupSelects.forEach((select, index) => {
      select.replaceChildren(
        ...(index > 0 ? [el('option', { value: '', text: 'None', selected: true })] : []),
        ...source.columns.map((c, i) =>
          el('option', { value: c.id, selected: index === 0 && i === 0 ? true : null, text: c.name }),
        ),
      );
    });
    sumBoxes.length = 0;
    sumWrap.replaceChildren();
    for (const column of source.columns) {
      if (column.type !== 'decimal' && column.type !== 'formula') continue;
      const box = el<HTMLInputElement>('input', { type: 'checkbox', value: column.id });
      sumBoxes.push(box);
      sumWrap.append(el('div', { class: 'dialog-row' }, box, el('label', { text: column.name })));
    }
  };
  sourceSelect.addEventListener('change', () => {
    void fillColumns();
  });
  const createButton = el<HTMLButtonElement>('button', { text: 'Create summary' });
  const dialog = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'New summary', class: 'dialog' + (layout() === 'narrow' ? ' sheet full-height' : '') },
    el('h2', { text: 'New summary' }),
    el('label', { text: 'Source table' }),
    sourceSelect,
    groupWrap,
    sumWrap,
    createButton,
    el('button', { text: 'Cancel', onclick: () => trap.close() }),
  );
  const trap = openOverlay(dialog);
  void fillColumns();
  createButton.addEventListener('click', async () => {
    createButton.disabled = true;
    const groupBy = groupSelects.map((s) => s.value).filter((v) => v !== '');
    try {
      const res = await api<{ table: { id: string; name: string } }>(
        'POST',
        `/api/documents/${state.documentId}/summaries`,
        { source_table_id: sourceSelect.value, group_by: groupBy, sum_columns: sumBoxes.filter((b) => b.checked).map((b) => b.value) },
      );
      announce('workspace-status', COPY_TEXT.createdSummary(res.data.table.name));
      trap.close();
      navigate(`/d/${state.documentId}/t/${res.data.table.id}`);
    } catch (err) {
      createButton.disabled = false;
      announce('grid-alerts', err instanceof ApiFailure ? Object.values(err.error.fields ?? {})[0] ?? err.error.message : COPY_TEXT.connectionLost);
    }
  });
}

function openAddColumn(): void {
  const nameInput = el<HTMLInputElement>('input', { 'aria-label': 'Column name' });
  const typeGroup = el('div', { role: 'radiogroup', 'aria-label': 'Type' });
  const targetSelect = el<HTMLSelectElement>('select', { 'aria-label': 'Target table' });
  const formulaInput = el<HTMLTextAreaElement>('textarea', { 'aria-label': 'Formula', class: 'formula-input' });
  const preview = el('div', { role: 'status', 'aria-label': 'Formula preview', class: 'formula-preview' });
  const targetWrap = el('div', { class: 'dialog-row hidden' }, el('label', { text: 'Target table' }), targetSelect);
  const formulaWrap = el('div', { class: 'dialog-block hidden' }, el('label', { text: 'Formula' }), formulaInput, preview);
  let chosenType = 'text';
  const types: [string, string][] = [['text', 'Text'], ['decimal', 'Decimal'], ['date', 'Date'], ['bool', 'Bool'], ['reference', 'Reference'], ['formula', 'Formula']];
  for (const [value, label] of types) {
    const box = el('input', { type: 'radio', name: 'column-type', value, checked: value === 'text' ? true : null });
    box.addEventListener('change', () => {
      chosenType = value;
      targetWrap.classList.toggle('hidden', value !== 'reference');
      formulaWrap.classList.toggle('hidden', value !== 'formula');
    });
    typeGroup.append(el('label', { class: 'radio-row' }, box, el('span', { text: label })));
  }
  const tables = state.tables.filter((t) => t.kind !== 'summary');
  targetSelect.replaceChildren(...tables.map((t) => el('option', { value: t.id, text: t.name })));
  const createButton = el<HTMLButtonElement>('button', { text: 'Create column' });
  const dialog = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Add column', class: 'dialog' + (layout() === 'narrow' ? ' sheet full-height' : '') },
    el('h2', { text: 'Add column' }),
    el('label', { text: 'Column name' }),
    nameInput,
    typeGroup,
    targetWrap,
    formulaWrap,
    createButton,
    el('button', { text: 'Cancel', onclick: () => trap.close() }),
  );
  const trap = openOverlay(dialog);
  wirePreview(formulaInput, preview, state.shownTableId ?? '');
  createButton.addEventListener('click', async () => {
    createButton.disabled = true;
    const body: Record<string, unknown> = { name: nameInput.value, type: chosenType };
    if (chosenType === 'reference') body.target_table_id = targetSelect.value;
    if (chosenType === 'formula') body.formula = formulaInput.value;
    try {
      const res = await api<{ column: { name: string } }>(
        'POST',
        `/api/documents/${state.documentId}/tables/${state.shownTableId}/columns`,
        body,
      );
      announce('workspace-status', COPY_TEXT.addedColumn(res.data.column.name));
      trap.close();
      await reloadTable();
    } catch (err) {
      createButton.disabled = false;
      fieldError(nameInput, err);
    }
  });
}

function openTablesDrawer(): void {
  const drawer = el('div', {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Tables',
    class: 'drawer',
  },
    el('h2', { text: 'Tables' }),
    el('nav', { 'aria-label': 'Tables' },
      ...state.tables.map((t) =>
        el('button', {
          class: 'drawer-link',
          text: `${t.name}, ${t.row_count === 1 ? '1 row' : `${t.row_count} rows`}`,
          onclick: () => {
            trap.close();
            navigate(`/d/${state.documentId}/t/${t.id}`);
          },
        }),
      ),
    ),
    state.document?.document.role === 'owner'
      ? el('button', { text: 'New table', onclick: () => { trap.close(); openNewTable(); } })
      : null,
    state.document?.document.role === 'owner'
      ? el('button', { text: 'New summary', onclick: () => { trap.close(); openNewSummary(); } })
      : null,
  );
  const trap = openOverlay(drawer);
}

function openExportsSheet(): void {
  const list = el('ul', { id: 'exports-list-sheet', class: 'exports-list', role: 'list', 'aria-label': 'Exports' });
  const dialog = el('div', {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Exports',
    class: 'sheet full-height',
  },
    el('h2', { text: 'Exports' }),
    list,
    el('button', { text: 'Close', onclick: () => trap.close() }),
  );
  const trap = openOverlay(dialog);
  void refreshExportsList();
}

function openShareDialog(): void {
  const emailInput = el<HTMLInputElement>('input', { 'aria-label': 'Email' });
  const roleGroup = el('div', { role: 'radiogroup', 'aria-label': 'Role' });
  for (const [value, label] of [['editor', 'Editor'], ['viewer', 'Viewer']] as [string, string][]) {
    roleGroup.append(el('label', { class: 'radio-row' },
      el('input', { type: 'radio', name: 'share-role', value, checked: value === 'editor' ? true : null }),
      el('span', { text: label })));
  }
  const rowsGroup = el('div', { role: 'radiogroup', 'aria-label': 'Rows' });
  for (const [value, label] of [['all', 'All rows'], ['own', 'Only their own rows']] as [string, string][]) {
    rowsGroup.append(el('label', { class: 'radio-row' },
      el('input', { type: 'radio', name: 'share-rows', value, checked: value === 'all' ? true : null }),
      el('span', { text: label })));
  }
  const status = el('div', { id: 'share-status', role: 'status', class: 'share-status' });
  const outage = el('div', { id: 'mail-outage', role: 'alert', class: 'mail-outage' });
  const people = el('ul', { id: 'share-people', role: 'list', 'aria-label': 'People', class: 'share-people' });
  const sendButton = el<HTMLButtonElement>('button', { text: 'Send invite' });
  const dialog = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Share document', class: 'dialog' + (layout() === 'narrow' ? ' sheet full-height' : '') },
    el('h2', { text: 'Share document' }),
    el('label', { text: 'Email' }),
    emailInput,
    roleGroup,
    rowsGroup,
    sendButton,
    status,
    outage,
    people,
    el('button', { text: 'Close', onclick: () => trap.close() }),
  );
  const trap = openOverlay(dialog);
  const refreshPeople = async (): Promise<void> => {
    try {
      const res = await api<{ shares: ShareRecord[] }>('GET', `/api/documents/${state.documentId}/shares`);
      people.replaceChildren();
      let anyNotSent = false;
      for (const share of res.data.shares) {
        const item = el('li', { class: 'share-item' },
          el('span', { text: share.email }),
          el('span', { text: roleWord(share.role) }),
          el('span', { text: share.invite_status === 'sent' ? 'Sent' : 'Not sent' }));
        if (share.invite_status !== 'sent') {
          anyNotSent = true;
          item.append(el('button', {
            text: `Resend invite to ${share.email}`,
            onclick: async () => {
              try {
                await api('POST', `/api/documents/${state.documentId}/shares/${share.id}/resend`);
                status.textContent = COPY_TEXT.inviteSent(share.email);
                await refreshPeople();
              } catch (err) {
                if (err instanceof ApiFailure && err.status === 503) {
                  outage.textContent = COPY_TEXT.resendFailing;
                } else if (err instanceof ApiFailure && err.status === 409) {
                  status.textContent = COPY_TEXT.alreadySent;
                }
              }
            },
          }));
        }
        people.append(item);
      }
      outage.textContent = anyNotSent ? COPY_TEXT.mailOutage : '';
    } catch {
      /* keep the last list */
    }
  };
  void refreshPeople();
  sendButton.addEventListener('click', async () => {
    sendButton.disabled = true;
    const role = (dialog.querySelector<HTMLInputElement>('input[name="share-role"]:checked')?.value ?? 'editor');
    const rowScope = (dialog.querySelector<HTMLInputElement>('input[name="share-rows"]:checked')?.value ?? 'all');
    try {
      const res = await api<{ share: ShareRecord }>('POST', `/api/documents/${state.documentId}/shares`, {
        email: emailInput.value,
        role,
        row_scope: rowScope,
      });
      status.textContent = COPY_TEXT.inviteSent(res.data.share.email);
      emailInput.value = '';
      emailInput.focus();
      await refreshPeople();
    } catch (err) {
      if (err instanceof ApiFailure && err.status === 422) {
        fieldError(emailInput, err);
      }
    } finally {
      sendButton.disabled = false;
    }
  });
}

