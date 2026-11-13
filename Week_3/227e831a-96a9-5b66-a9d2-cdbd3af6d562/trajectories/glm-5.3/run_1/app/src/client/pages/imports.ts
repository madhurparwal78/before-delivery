import { el, announce } from '../dom.js';
import { api } from '../api.js';
import { openDialog } from '../dialogs.js';
import type { ImportRun } from '../apiTypes.js';

/**
 * The Imports page: the import history table and the Import gear list dialog,
 * with its per-row preview of matched, new and rejected rows.
 */

const REASONS: Record<string, string> = {
  missing_name: 'Name is blank',
  unknown_category: 'Unknown category',
  invalid_weight: 'Invalid weight',
  unknown_unit: 'Unknown unit',
  invalid_qty: 'Invalid quantity',
};

export async function renderImports(page: HTMLElement, openDialogNow: boolean): Promise<void> {
  page.textContent = '';
  page.append(el('h1', { text: 'Imports' }));
  const actions = el('div', { class: 'page-head' });
  const importButton = el('button', { type: 'button', text: 'Import gear list', id: 'import-gear-button' });
  importButton.addEventListener('click', () => openImportDialog(importButton));
  actions.append(importButton);
  page.append(actions);

  const history = await api.get<{ imports: ImportRun[] }>('/api/imports');
  const table = el('table', { class: 'ledger', 'aria-label': 'Import history' });
  const body = el('tbody');
  if (history.ok) {
    for (const run of history.body.imports) {
      const row = el('tr');
      row.append(el('td', { text: run.filename }), el('td', { text: new Date(run.uploadedAt).toLocaleString() }), el('td', { text: run.status === 'committed' ? 'Imported' : 'Not imported' }), el('td', { text: `${run.counts.matched} matched, ${run.counts.created} new, ${run.counts.rejected} rejected` }));
      const download = el('a', { href: `/api/imports/${run.id}/original`, text: `Download original ${run.filename}` });
      row.append(el('td', {}, [download]));
      body.append(row);
    }
  }
  table.append(body);
  page.append(table);

  // The Closet page's Import gear list button opens this dialog here.
  window.addEventListener('skinout:open-import', () => openImportDialog(document.getElementById('import-gear-button') as HTMLElement), { once: true });
  if (openDialogNow) openImportDialog(importButton);
}

function openImportDialog(opener: HTMLElement): void {
  openDialog('Import gear list', (dialog) => {
    const fileError = el('div', { class: 'field-error', id: 'import-file-error', hidden: 'hidden' });
    const file = el('input', { type: 'file', id: 'import-file', accept: '.csv,text/csv' }) as HTMLInputElement;
    let currentPreview: ImportRun | null = null;
    const previewHost = el('div', { id: 'import-preview-host' });
    const confirmButton = el('button', { type: 'button', text: 'Confirm import', hidden: 'hidden' });
    const previewButton = el('button', { type: 'button', text: 'Preview import' });
    const cancelButton = el('button', { type: 'button', text: 'Cancel' });

    const clearError = (): void => {
      file.removeAttribute('aria-invalid');
      file.removeAttribute('aria-describedby');
      fileError.setAttribute('hidden', 'hidden');
      fileError.textContent = '';
      previewHost.textContent = '';
      confirmButton.setAttribute('hidden', 'hidden');
      currentPreview = null;
    };
    file.addEventListener('change', clearError);

    const showError = (message: string): void => {
      file.setAttribute('aria-invalid', 'true');
      file.setAttribute('aria-describedby', 'import-file-error');
      fileError.textContent = message;
      fileError.removeAttribute('hidden');
      announce('Import', message);
      file.focus();
    };

    previewButton.addEventListener('click', () => {
      const chosen = file.files?.[0];
      if (chosen === undefined) {
        showError('Choose a CSV file.');
        return;
      }
      announce('Import', 'Reading file...');
      void (async () => {
        const answer = await api.upload<{ import: ImportRun }>('/api/imports', chosen, 'file');
        if (!answer.ok) {
          const fieldMessage = answer.failure.fields?.['file'];
          if (fieldMessage !== undefined) showError(fieldMessage);
          else if (answer.failure.code === 'storage_unavailable') showError('File storage is unavailable, so nothing was imported. Try again later.');
          else showError(answer.failure.message);
          return;
        }
        currentPreview = answer.body.import;
        previewHost.textContent = '';
        const preview = el('table', { class: 'ledger', 'aria-label': 'Import preview' });
        const body = el('tbody');
        for (const row of answer.body.import.rows) {
          const tr = el('tr');
          const outcome = row.outcome === 'matched' ? 'Matched' : row.outcome === 'created' ? 'New' : `Rejected: ${REASONS[row.reason ?? ''] ?? row.reason}`;
          tr.append(el('td', { text: String(row.row) }), el('td', { text: row.name }), el('td', { text: row.category }), el('td', { class: `import-preview-cell${row.outcome === 'rejected' ? ' rejected' : ''}`, text: outcome }));
          body.append(tr);
        }
        preview.append(body);
        previewHost.append(preview);
        const counts = answer.body.import.counts;
        announce('Import', `Import ready: ${counts.matched} matched, ${counts.created} new, ${counts.rejected} rejected. Nothing is saved until you confirm.`);
        confirmButton.removeAttribute('hidden');
      })();
    });

    confirmButton.addEventListener('click', () => {
      if (currentPreview === null) return;
      void (async () => {
        const answer = await api.post<{ import: ImportRun }>(`/api/imports/${currentPreview!.id}/commit`, {});
        if (!answer.ok) {
          announce('Import', answer.failure.message);
          return;
        }
        const counts = answer.body.import.counts;
        announce('Import', `Imported: ${counts.matched} matched, ${counts.created} new, ${counts.rejected} rejected.`);
        dialog.remove();
        const button = document.getElementById('import-gear-button');
        if (button !== null) button.focus();
        await renderImports(document.getElementById('page') as HTMLElement, false);
      })();
    });

    cancelButton.addEventListener('click', () => {
      dialog.remove();
      opener.focus();
    });

    dialog.append(
      el('div', { class: 'field' }, [el('label', { class: 'field-label', for: 'import-file', text: 'CSV file' }), file, fileError]),
      previewHost,
      el('div', { class: 'actions' }, [previewButton, confirmButton, cancelButton]),
    );
  }, opener);
}
