// The translation memory screen: import form, report, imports and entries.

import { DeskError, ImportReport, Operation, Project, TMEntry, TMImport, api } from './api';
import { openModal } from './dialog';
import { clear, el, localTime } from './dom';
import { announce, clearProblem, failureCopy, problem, showFieldErrors } from './feedback';
import { emptyPanel } from './illustrations';

export async function renderTM(screen: HTMLElement, project: Project): Promise<void> {
  const reportRegion = el('section', { class: 'card', role: 'region', 'aria-label': 'Import report' });
  const importsHost = el('div', { class: 'card' });
  const entriesHost = el('div', { class: 'card' });

  const file = el('input', { type: 'file', 'data-field': 'file', accept: '.tmx,.csv,.xml,text/csv' });
  const format = el('select', { 'data-field': 'format', 'aria-label': 'Format', role: 'combobox' }, [
    el('option', { value: 'tmx', text: 'TMX' }),
    el('option', { value: 'csv', text: 'CSV' }),
  ]);
  const submit = el('button', { type: 'submit', class: 'button primary', text: 'Import' });

  const form = el('form', {
    class: 'card import-form',
    role: 'form',
    'aria-label': 'Import translation memory',
    onsubmit: async (event: Event) => {
      event.preventDefault();
      clearProblem();
      if (!file.files?.length) {
        showFieldErrors(form, { file: 'Choose a file to upload.' });
        return;
      }
      submit.disabled = true;
      announce('Importing translation memory.');
      const body = new FormData();
      body.append('file', file.files[0]);
      body.append('format', format.value);
      try {
        const report = await api.upload<ImportReport>(`/api/projects/${project.slug}/tm/imports`, body);
        announce(
          `Imported ${report.added} new entries, merged ${report.duplicates} duplicates and reused ${report.applied} exact matches.` +
            (report.rows.length > 0 ? ` ${report.rows.length} rows need attention.` : ''),
        );
        paintReport(report);
        await paintImports();
        await paintEntries('');
      } catch (error) {
        if (error instanceof DeskError) {
          const message = failureCopy(error);
          problem(message);
          showFieldErrors(form, error.info.fields ?? { file: message });
        }
      } finally {
        submit.disabled = false;
      }
    },
  }, [
    el('h2', { text: 'Import translation memory' }),
    labelled('Import file', file),
    labelled('Format', format),
    submit,
  ]);

  const search = el('input', {
    type: 'search',
    role: 'searchbox',
    'aria-label': 'Search translation memory',
    oninput: () => void paintEntries(search.value),
  });

  function paintReport(report: ImportReport | TMImport | null): void {
    clear(reportRegion);
    reportRegion.append(el('h2', { text: 'Import report' }));
    if (!report) {
      reportRegion.append(el('p', { text: 'No imports yet.' }));
      return;
    }
    reportRegion.append(
      el('p', {
        text: `Imported ${report.added} new entries, merged ${report.duplicates} duplicates and reused ${report.applied} exact matches.`,
      }),
    );
    if (report.rows.length === 0) {
      reportRegion.append(el('p', { text: 'No rows need attention.' }));
      return;
    }
    reportRegion.append(el('p', { text: `${report.rows.length} rows need attention.` }));
    reportRegion.append(
      el('table', { class: 'plain-table' }, [
        el('thead', {}, [el('tr', {}, [el('th', { text: 'Line' }), el('th', { text: 'Reason' })])]),
        el('tbody', {}, report.rows.map((row) =>
          el('tr', {}, [
            el('td', { class: 'tabular', text: String(row.line) }),
            el('td', { text: row.reason }),
          ]),
        )),
      ]),
    );
  }

  async function paintImports(): Promise<void> {
    const [answer, operations] = await Promise.all([
      api.get<{ imports: TMImport[] }>(`/api/projects/${project.slug}/tm/imports`),
      api.get<{ operations: Operation[] }>(`/api/projects/${project.slug}/operations`),
    ]);
    clear(importsHost);
    importsHost.append(el('h2', { text: 'Imports' }));
    if (answer.imports.length === 0) {
      importsHost.append(el('p', { text: 'No imports yet.' }));
      return;
    }
    for (const record of answer.imports) {
      const operation = operations.operations.find((item) => item.id === record.import_id);
      importsHost.append(
        el('div', { class: 'import-row' }, [
          el('span', { text: `${record.filename} at ${localTime(record.at)}` }),
          el('a', {
            href: `/api/projects/${project.slug}/tm/imports/${record.import_id}/original`,
            download: record.filename,
            text: 'Download original',
          }),
          el('button', {
            type: 'button',
            class: 'button outline',
            text: 'Restore',
            disabled: !operation?.restorable,
            onclick: (event: Event) =>
              openRestore(project, record.import_id, 'import', event.currentTarget as HTMLElement, () =>
                paintImports(),
              ),
          }),
        ]),
      );
    }
  }

  async function paintEntries(query: string): Promise<void> {
    const answer = await api.get<{ entries: TMEntry[]; total: number }>(
      `/api/projects/${project.slug}/tm${query ? `?q=${encodeURIComponent(query)}` : ''}`,
    );
    clear(entriesHost);
    if (answer.total === 0 && query === '') {
      entriesHost.append(
        el('div', { class: 'empty-state' }, [
          emptyPanel(),
          el('h2', { text: 'No translation memory yet' }),
          el('p', { text: 'Import a TMX file or a spreadsheet to start reusing exact matches.' }),
          el('button', {
            type: 'button',
            class: 'button primary',
            text: 'Import translation memory',
            onclick: () => file.focus(),
          }),
        ]),
      );
      return;
    }
    entriesHost.append(
      el('p', { class: 'muted', text: `${answer.total} entries` }),
      el('table', { class: 'plain-table' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { text: 'Source' }),
            el('th', { text: 'Target' }),
            el('th', { text: 'Language' }),
          ]),
        ]),
        el('tbody', {}, answer.entries.map((entry) =>
          el('tr', {}, [
            el('td', { text: entry.source }),
            el('td', { text: entry.target }),
            el('td', { text: entry.target_language }),
          ]),
        )),
      ]),
    );
  }

  screen.append(
    el('div', { class: 'content-column' }, [
      el('h1', { text: 'Translation memory' }),
      form,
      reportRegion,
      importsHost,
      el('div', { class: 'card' }, [labelled('Search translation memory', search)]),
      entriesHost,
    ]),
  );

  const imports = await api.get<{ imports: TMImport[] }>(`/api/projects/${project.slug}/tm/imports`);
  paintReport(imports.imports[0] ?? null);
  await paintImports();
  await paintEntries('');
}

function labelled(label: string, control: HTMLElement): HTMLElement {
  const id = `tm-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  control.setAttribute('id', id);
  control.setAttribute('aria-label', label);
  return el('div', { class: 'field' }, [el('label', { for: id, text: label }), control]);
}

// openRestore asks before bringing main and the memory back to a snapshot.
export function openRestore(
  project: Project,
  operationID: string,
  kind: 'import' | 'merge',
  opener: HTMLElement,
  after: () => void | Promise<void>,
): void {
  openModal({
    name: 'Restore',
    opener,
    body: (handle) => [
      el('h2', { text: 'Restore' }),
      el('p', {
        text: `This brings main and the translation memory back to the state before this ${kind}.`,
      }),
      el('div', { class: 'dialog-actions' }, [
        el('button', {
          type: 'button',
          class: 'button primary',
          text: 'Restore now',
          onclick: async () => {
            clearProblem();
            announce('Restoring.');
            try {
              await api.post(`/api/projects/${project.slug}/operations/${operationID}/restore`);
              announce(`Restored the state before this ${kind}.`);
              handle.close();
              await after();
            } catch (error) {
              announce('');
              if (error instanceof DeskError) problem(failureCopy(error));
              handle.close();
            }
          },
        }),
        el('button', { type: 'button', class: 'button quiet', text: 'Cancel', onclick: () => handle.close() }),
      ]),
    ],
  });
}
