import { api, ApiCallError } from '../api.ts';
import { announce, clear, h, replace, statusRegion } from '../dom.ts';
import { subscribe, type LiveSubscription } from '../live.ts';
import { navigate } from '../router.ts';
import {
  ANNOUNCE,
  FILTER_TAB_LABEL,
  GENERIC_ERROR,
  PENDING,
  STATUS_WORD,
  UPLOAD_REFUSAL,
} from '../../shared/copy.ts';
import type { DocumentFilter, DocumentRowJson, Role } from '../../shared/types.ts';
import type { Frame } from '../frame.ts';

export interface Screen {
  root: HTMLElement;
  destroy: () => void;
}

const stamp = (iso: string): string => iso.replace('T', ' ').slice(0, 16);

export const documentsScreen = (frame: Frame, initialRole: Role): Screen => {
  let role: Role = initialRole;
  let filter: DocumentFilter = 'all';
  let rows: DocumentRowJson[] = [];
  let live: LiveSubscription | null = null;
  const shownStatus = new Map<string, string>();

  const updates = statusRegion('Document updates');
  const uploadError = h('p', { class: 'field-error', role: 'alert' });

  const fileInput = h('input', {
    type: 'file',
    accept: 'application/pdf',
    class: 'visually-hidden',
    tabindex: '-1',
    'aria-hidden': 'true',
  });
  const uploadButton = h('button', { type: 'button', class: 'button' }, 'Upload PDF');
  const titleInput = h('input', { type: 'text', id: 'upload-title' });
  const titleLabel = h('label', { for: 'upload-title' }, 'Title');
  const uploadRow = h(
    'div',
    { class: 'upload-row' },
    uploadButton,
    fileInput,
    h('div', { class: 'field' }, titleLabel, titleInput),
  );

  uploadButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const base = file.name.toLowerCase().endsWith('.pdf') ? file.name.slice(0, -4) : file.name;
    if (titleInput.value.trim() === '') titleInput.value = base;
    void upload(file, titleInput.value);
  });

  const upload = async (file: File, title: string): Promise<void> => {
    uploadError.textContent = '';
    uploadButton.disabled = true;
    uploadButton.setAttribute('aria-busy', 'true');
    announce(updates, PENDING.upload(file.name));
    try {
      const created = await api.upload(file, title);
      navigate(`/documents/${created.id}`);
    } catch (failure) {
      const code = failure instanceof ApiCallError ? failure.failure.error : 'unknown';
      uploadError.textContent = UPLOAD_REFUSAL[code] ?? GENERIC_ERROR;
      uploadButton.disabled = false;
      uploadButton.removeAttribute('aria-busy');
      fileInput.value = '';
      uploadButton.focus();
    }
  };

  const tabs = FILTER_TAB_LABEL.map(({ id, label }) =>
    h(
      'button',
      {
        type: 'button',
        role: 'tab',
        class: 'tab',
        'aria-selected': id === filter ? 'true' : 'false',
        tabindex: id === filter ? '0' : '-1',
      },
      label,
    ),
  );
  const tabList = h('div', { role: 'tablist', 'aria-label': 'Status filter', class: 'tabs' }, ...tabs);

  const selectTab = (index: number, moveFocus: boolean): void => {
    const chosen = FILTER_TAB_LABEL[index];
    if (!chosen) return;
    filter = chosen.id;
    tabs.forEach((tab, position) => {
      const selected = position === index;
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.setAttribute('tabindex', selected ? '0' : '-1');
    });
    if (moveFocus) tabs[index]?.focus();
    restart();
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(index, true));
    tab.addEventListener('keydown', (event: KeyboardEvent) => {
      const step =
        event.key === 'ArrowRight' || event.key === 'ArrowDown'
          ? 1
          : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
            ? -1
            : 0;
      if (step === 0) return;
      event.preventDefault();
      selectTab((index + step + tabs.length) % tabs.length, true);
    });
  });

  const tableBody = h('tbody');
  const table = h(
    'table',
    { 'aria-label': 'Documents', class: 'documents-table' },
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('th', { scope: 'col' }, 'Title'),
        h('th', { scope: 'col' }, 'Status'),
        h('th', { scope: 'col' }, 'Next step'),
        h('th', { scope: 'col' }, 'Updated'),
      ),
    ),
    tableBody,
  );
  const cards = h('ul', { 'aria-label': 'Documents', class: 'documents-cards' });

  const renderRows = (): void => {
    clear(tableBody);
    clear(cards);
    for (const row of rows) {
      const link = h('a', { href: `/documents/${row.id}` }, row.title);
      tableBody.appendChild(
        h(
          'tr',
          {},
          h('td', {}, link),
          h('td', {}, STATUS_WORD[row.status]),
          h('td', {}, row.nextStep),
          h('td', { class: 'mono' }, stamp(row.updatedAt)),
        ),
      );
      cards.appendChild(
        h(
          'li',
          { class: 'document-card' },
          h('span', { class: 'card-title' }, h('a', { href: `/documents/${row.id}` }, row.title)),
          h('span', {}, STATUS_WORD[row.status]),
          h('span', {}, row.nextStep),
          h('span', { class: 'mono' }, stamp(row.updatedAt)),
        ),
      );
    }
  };

  const applyRole = (): void => {
    uploadRow.style.display = role === 'viewer' ? 'none' : '';
    uploadButton.disabled = role === 'viewer';
  };

  const applyRows = (next: DocumentRowJson[]): void => {
    for (const row of next) {
      const previous = shownStatus.get(row.id);
      if (previous !== undefined && previous !== row.status) {
        announce(updates, ANNOUNCE.documentUpdate(row.title, STATUS_WORD[row.status]));
      }
      shownStatus.set(row.id, row.status);
    }
    rows = next;
    renderRows();
  };

  const restart = (): void => {
    live?.close();
    live = subscribe({ scope: 'documents', filter }, (payload) => {
      if (payload.role !== undefined && payload.role !== role) {
        role = payload.role;
        frame.setRole(role);
        applyRole();
      }
      if (payload.notice !== undefined) frame.setNotice(payload.notice);
      if (payload.documents !== undefined) applyRows(payload.documents);
    });
  };

  const root = h(
    'div',
    { class: 'documents-screen' },
    h('h1', { class: 'page-heading' }, 'Documents'),
    uploadRow,
    uploadError,
    tabList,
    updates,
    h('div', { class: 'documents-list' }, table, cards),
  );

  applyRole();
  void (async () => {
    try {
      applyRows(await api.documents(filter));
    } catch {
      replace(uploadError, GENERIC_ERROR);
    }
  })();
  restart();

  return { root, destroy: () => live?.close() };
};
