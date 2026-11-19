import { api, ApiCallError } from '../api.js';
import { clear, h } from '../dom.js';
import { plainButton, primaryButton, withBusy } from '../dialogs.js';
import type { Screen, Shell } from '../main.js';

/** Wring Line v1 import at /import. */
export function renderImporter(host: HTMLElement, shell: Shell): Screen {
  const textArea = h('textarea', { class: 'editor mono import-text', 'aria-label': 'Wring Line text', rows: '12' });
  const filePicker = h('input', { type: 'file', class: 'sr-only', tabindex: '-1', accept: '.txt,.wringline,text/plain' });
  const chooseButton = plainButton('Choose file', () => filePicker.click());
  filePicker.addEventListener('change', () => {
    const file = filePicker.files?.[0];
    if (file === undefined) return;
    void file.text().then((text) => {
      textArea.value = text;
    });
    filePicker.value = '';
  });
  const ownerSelect = h('select', { class: 'select', 'aria-label': 'Save to' });
  ownerSelect.append(h('option', { value: 'user', text: 'Personal' }));
  for (const team of shell.session?.teams ?? []) {
    ownerSelect.append(h('option', { value: `team:${team.id}`, text: team.name }));
  }
  const report = h('div', { class: 'import-report', role: 'region', 'aria-label': 'Import report' });
  const importButton = primaryButton('Import', () => undefined);

  const pane = h('section', { class: 'pane single-pane' }, [
    h('div', { class: 'pane-title' }, [h('h1', { class: 'pane-title-text library-heading', text: 'Import recipes' })]),
    h('div', { class: 'pane-body' }, [
      h('div', { class: 'field-rows' }, [
        h('div', { class: 'field-row' }, [
          h('span', { class: 'field-label', text: 'Wring Line text' }),
          textArea,
        ]),
        h('div', { class: 'field-row' }, [chooseButton, filePicker]),
        h('div', { class: 'field-row' }, [h('span', { class: 'field-label', text: 'Save to' }), ownerSelect]),
        h('div', { class: 'field-row' }, [importButton]),
      ]),
      report,
    ]),
  ]);
  host.append(pane);

  if (shell.session === null) {
    report.append(h('p', { class: 'muted-note', text: 'Sign in to import recipes.' }));
  }

  importButton.addEventListener(
    'click',
    withBusy(importButton, async () => {
      clear(report);
      const choice = ownerSelect.value;
      const owner =
        choice === 'user'
          ? { type: 'user', id: shell.session?.user.id ?? '' }
          : { type: 'team', id: choice.slice('team:'.length) };
      try {
        const done = await api.importText({ text: textArea.value, owner });
        if (done.import.status === 'already_imported') {
          report.append(h('p', { class: 'report-line', text: done.import.message ?? '' }));
          return;
        }
        const count = done.import.lineCount ?? 0;
        const line = h('p', { class: 'report-line' }, [
          document.createTextNode(
            `Created ${done.import.recipe.name} (version 1) from ${count} ${count === 1 ? 'line' : 'lines'}.`,
          ),
        ]);
        const link = h('a', {
          class: 'text-link',
          href: `/w?recipe=${done.import.recipe.id}`,
          text: 'Open in workbench',
        });
        link.addEventListener('click', (event) => {
          event.preventDefault();
          shell.navigate(`/w?recipe=${done.import.recipe.id}`);
        });
        report.append(line, link);
      } catch (cause) {
        if (!(cause instanceof ApiCallError)) throw cause;
        report.append(h('p', { class: 'report-line', text: cause.failure.message }));
        const lines = cause.failure.details?.['lines'];
        if (Array.isArray(lines)) {
          const list = h('ul', { class: 'report-list' });
          for (const entry of lines) list.append(h('li', { class: 'mono', text: String(entry) }));
          report.append(list);
        }
      }
    }),
  );

  return {};
}
