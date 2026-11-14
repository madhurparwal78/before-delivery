import { M84 } from '../../shared/messages.ts';
import { api } from '../lib/api.ts';
import { h } from '../lib/dom.ts';
import { ready } from '../lib/shell.ts';
import { csvExport } from '../owner/csv-export.ts';
import { openFormScreen, orNotFound } from '../owner/form-screen.ts';
import { responsesTable, type ResponseLine } from '../owner/responses-table.ts';

export async function render(params: Record<string, string>): Promise<void> {
  const id = params['id'] ?? '';
  const screen = await openFormScreen(id, 'responses');
  if (!screen) return;
  const listed = await orNotFound(api<{ responses: ResponseLine[] }>('GET', `/api/forms/${id}/responses`));
  if (!listed) return;
  const title = h('h1', {}, 'Responses');
  const exporter = csvExport(id);
  const list = h('div', { class: 'records-list' });
  const showEmpty = (): void => {
    list.replaceChildren(h('p', { class: 'empty' }, M84));
    exporter.querySelector('button')?.focus();
  };
  list.append(listed.responses.length === 0 ? h('p', { class: 'empty' }, M84) : responsesTable(id, listed.responses, showEmpty));
  ready(screen.main, 'Responses - Nightform');
  screen.main.append(title, exporter, list);
}
