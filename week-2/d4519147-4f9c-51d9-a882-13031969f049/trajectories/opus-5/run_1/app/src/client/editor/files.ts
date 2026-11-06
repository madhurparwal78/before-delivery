import { ApiFailure, api } from '../api';
import { COPY } from '../../shared/copy';
import { announce, el, openPanel, type Panel } from '../dom';
import type { ExportRecord, ImportRecord, Role } from '../../shared/types';
import { keepForSignIn } from './sessionGate';

const STATUS_TEXT: Record<ExportRecord['status'], string> = {
  pending: 'Preparing',
  ready: 'Ready',
  failed: 'Failed',
};

function randomKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The Files dialog: exports with sizes and checksums, and imported originals. */
export function openFilesDialog(options: {
  diagramId: string;
  role: Role;
  onStorageError(): void;
}): Panel {
  const createButton = el('button', { type: 'button', class: 'primary', text: 'Create export' });
  const exportBody = el('tbody');
  const importBody = el('tbody');
  const exportTable = el('table', { 'aria-label': 'Exports' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Created' }),
        el('th', { text: 'Status' }),
        el('th', { text: 'Files' }),
      ]),
    ]),
    exportBody,
  ]);
  const importTable = el('table', { 'aria-label': 'Imported originals' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'File' }),
        el('th', { text: 'Size' }),
        el('th', { text: 'Checksum' }),
        el('th', { text: 'Original' }),
      ]),
    ]),
    importBody,
  ]);

  const children: HTMLElement[] = [el('h2', { text: 'Diagram files' })];
  if (options.role !== 'viewer') children.push(createButton);
  children.push(el('h3', { text: 'Exports' }), exportTable, el('h3', { text: 'Imported originals' }), importTable);
  const content = el('div', {}, children);
  const panel = openPanel(content, {
    labelledBy: 'Diagram files',
    initialFocus: () => (options.role === 'viewer' ? null : createButton),
  });

  function exportRow(record: ExportRecord): HTMLTableRowElement {
    const files = el('td');
    if (record.status === 'ready') {
      for (const format of ['png', 'svg', 'json'] as const) {
        const file = record.files.find((entry) => entry.format === format);
        const link = el('a', {
          href: `/api/diagrams/${options.diagramId}/exports/${record.id}/files/${format}`,
          text: `Download ${format.toUpperCase()}`,
        });
        files.append(
          el('div', {}, [
            link,
            el('span', {
              class: 'mono',
              text: file ? ` ${file.sizeBytes} bytes ${file.sha256}` : '',
            }),
          ]),
        );
      }
    } else if (record.status === 'failed') {
      files.append(el('span', { text: COPY.exportFailedRow }));
    }
    return el('tr', { 'data-export': record.id }, [
      el('td', { class: 'num', text: record.createdAt.slice(0, 19).replace('T', ' ') }),
      el('td', { text: STATUS_TEXT[record.status] }),
      files,
    ]);
  }

  function importRow(record: ImportRecord): HTMLTableRowElement {
    const link = el('a', {
      href: `/api/diagrams/${options.diagramId}/imports/${record.id}/original`,
      text: `Download original ${record.fileName}`,
    });
    return el('tr', {}, [
      el('td', { text: record.fileName }),
      el('td', { class: 'num', text: String(record.sizeBytes) }),
      el('td', { class: 'num', text: record.sha256 }),
      el('td', {}, [link]),
    ]);
  }

  async function load(): Promise<void> {
    const [exports, imports] = await Promise.all([
      api.get<{ exports: ExportRecord[] }>(`/api/diagrams/${options.diagramId}/exports`),
      api.get<{ imports: ImportRecord[] }>(`/api/diagrams/${options.diagramId}/imports`),
    ]);
    exportBody.replaceChildren(...exports.exports.map(exportRow));
    importBody.replaceChildren(...imports.imports.map(importRow));
  }

  createButton.addEventListener('click', () => {
    createButton.disabled = true;
    const pending = el('tr', { 'data-pending': 'true' }, [
      el('td', { text: '' }),
      el('td', { text: STATUS_TEXT.pending }),
      el('td', {}),
    ]);
    exportBody.prepend(pending);
    const key = randomKey();
    void keepForSignIn(() =>
      api.post<{ export: ExportRecord }>(`/api/diagrams/${options.diagramId}/exports`, {}, { 'Idempotency-Key': key }),
    )
      .then((body) => {
        pending.replaceWith(exportRow(body.export));
        if (body.export.status === 'ready') announce(COPY.exportReady);
      })
      .catch((error: unknown) => {
        pending.remove();
        if (error instanceof ApiFailure && error.code === 'storage_unavailable') {
          options.onStorageError();
          void load();
          return;
        }
        announce(COPY.genericFailure);
        void load();
      })
      .finally(() => {
        createButton.disabled = false;
      });
  });

  void load();
  return panel;
}
