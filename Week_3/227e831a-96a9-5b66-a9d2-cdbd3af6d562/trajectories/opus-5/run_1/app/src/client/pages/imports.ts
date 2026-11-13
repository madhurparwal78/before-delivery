import { REJECTION_WORDS } from '../../shared/csv.js';
import type { ImportRow, ImportRun } from '../../shared/types.js';
import { api, upload } from '../api.js';
import type { AppContext } from '../app.js';
import { button, el, focusFirstField, openDialog } from '../dom.js';

function outcomeText(row: ImportRow): string {
  if (row.outcome === 'matched') return 'Matched';
  if (row.outcome === 'created') return 'New';
  return `Rejected: ${row.reason === null ? '' : REJECTION_WORDS[row.reason]}`;
}

export function mountImports(root: HTMLElement, context: AppContext, openNow: boolean): void {
  const live = el('div', { class: 'live', role: 'status', 'aria-label': 'Import' });
  const history = el('tbody');
  const importButton = button('Import gear list', { class: 'primary' }, () => {
    importDialog();
  });
  root.append(
    el('div', { class: 'sheet' }, [
      el('h1', { tabindex: '-1' }, ['Imports']),
      el('div', { class: 'row-actions' }, [importButton]),
      live,
      el('table', { class: 'ledger' }, [el('caption', {}, ['Import history']), history]),
    ]),
  );

  function paint(runs: ImportRun[]): void {
    history.replaceChildren(
      ...runs.map((run) =>
        el('tr', { class: 'ledger-row' }, [
          el('td', {}, [run.filename]),
          el('td', {}, [new Date(run.uploadedAt).toLocaleString()]),
          el('td', {}, [run.status === 'committed' ? 'Imported' : 'Not imported']),
          el('td', {}, [
            `${run.counts.matched} matched, ${run.counts.created} new, ${run.counts.rejected} rejected`,
          ]),
          el('td', {}, [
            el(
              'a',
              {
                href: `/api/imports/${run.id}/original`,
                download: run.filename,
                'aria-label': `Download original ${run.filename}`,
              },
              ['Download original'],
            ),
          ]),
        ]),
      ),
    );
  }

  function load(): void {
    void api<{ imports: ImportRun[] }>('GET', '/api/imports').then((result) => {
      if (result.ok) paint(result.data.imports);
      else if (result.status === 401) context.signedOut();
    });
  }

  function importDialog(): void {
    const handle = openDialog({ name: 'Import gear list', opener: importButton });
    const file = el('input', { type: 'file', id: 'csv-file', class: 'field', accept: '.csv,text/csv' });
    const fileError = el('p', { class: 'field-error', id: 'csv-file-error' });
    const previewBody = el('tbody');
    const preview = el('table', { class: 'ledger' }, [
      el('caption', {}, ['Import preview']),
      previewBody,
    ]);
    const confirm = button('Confirm import', { class: 'primary' }, () => {
      if (runId === null) return;
      void api<{ import: ImportRun }>('POST', `/api/imports/${runId}/commit`, { body: {} }).then(
        (result) => {
          if (!result.ok) {
            live.textContent = result.message;
            return;
          }
          const counts = result.data.import.counts;
          handle.close({ restoreFocus: false });
          live.textContent = `Imported: ${counts.matched} matched, ${counts.created} new, ${counts.rejected} rejected.`;
          load();
          importButton.focus();
        },
      );
    });
    let runId: string | null = null;

    const clearFileError = (): void => {
      file.removeAttribute('aria-invalid');
      file.removeAttribute('aria-describedby');
      fileError.textContent = '';
    };

    const showFileError = (message: string): void => {
      file.setAttribute('aria-invalid', 'true');
      file.setAttribute('aria-describedby', 'csv-file-error');
      fileError.textContent = message;
      live.textContent = message;
      file.focus();
    };

    file.addEventListener('change', () => {
      clearFileError();
      previewBody.replaceChildren();
      runId = null;
    });

    const previewButton = button('Preview import', { class: 'primary' }, () => {
      const chosen = file.files?.[0];
      if (chosen === undefined) {
        showFileError('Choose a CSV file.');
        return;
      }
      live.textContent = 'Reading file...';
      void upload<{ import: ImportRun }>('/api/imports', 'file', chosen).then((result) => {
        if (!result.ok) {
          if (result.code === 'storage_unavailable') {
            live.textContent = 'File storage is unavailable, so nothing was imported. Try again later.';
            return;
          }
          if (result.status === 401) {
            context.signedOut();
            return;
          }
          showFileError(result.fields['file'] ?? result.message);
          return;
        }
        const run = result.data.import;
        runId = run.id;
        previewBody.replaceChildren(
          ...(run.rows ?? []).map((row) =>
            el('tr', { class: 'ledger-row' }, [
              el('td', {}, [String(row.row)]),
              el('td', {}, [row.name]),
              el('td', {}, [row.category]),
              el('td', { class: 'outcome' }, [outcomeText(row)]),
            ]),
          ),
        );
        live.textContent = `Import ready: ${run.counts.matched} matched, ${run.counts.created} new, ${run.counts.rejected} rejected. Nothing is saved until you confirm.`;
        load();
      });
    });

    handle.body.append(
      el('div', { class: 'gear-form' }, [
        el('div', { class: 'form-row' }, [
          el('label', { for: 'csv-file' }, ['CSV file']),
          file,
          fileError,
        ]),
        el('div', { class: 'form-actions' }, [
          previewButton,
          confirm,
          button('Cancel', { class: 'secondary' }, () => {
            handle.close({ restoreFocus: false });
            importButton.focus();
            load();
          }),
        ]),
        preview,
      ]),
    );
    focusFirstField(handle);
  }

  load();
  if (openNow) importDialog();
}
