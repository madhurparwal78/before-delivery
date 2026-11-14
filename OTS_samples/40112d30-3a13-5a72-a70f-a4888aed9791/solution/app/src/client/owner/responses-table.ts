import { h } from '../lib/dom.ts';
import { formatStamp } from './dates.ts';
import { openDeleteDialog } from './delete-response.ts';
import { lightOne } from './light.ts';

// The `Responses` table: reference, submitted and edition, one row per response, separated by space alone.
// Each row offers `Open response <reference>` and `Delete response <reference>`.

export interface ResponseLine { id: string; reference: string; submitted_at: string; edition: number }

export function responsesTable(formId: string, responses: ResponseLine[], afterEmptied: () => void): HTMLElement {
  const body = h('tbody', {});
  const rows = responses.map((response) => responseRow(formId, response, body, afterEmptied));
  body.append(...rows);
  lightOne(rows);
  return h('table', { 'aria-label': 'Responses', class: 'records figures' },
    h('thead', {}, h('tr', {}, ['Reference', 'Submitted', 'Edition'].map((heading) => h('th', { scope: 'col' }, heading)))),
    body);
}

function responseRow(formId: string, response: ResponseLine, body: HTMLElement, afterEmptied: () => void): HTMLTableRowElement {
  const open = h('a', { href: `/forms/${formId}/responses/${response.id}`, 'aria-label': `Open response ${response.reference}` }, response.reference);
  const del = h('button', { type: 'button', 'aria-label': `Delete response ${response.reference}` }, 'Delete');
  const row = h('tr', {}, h('td', {}, open, del), h('td', {}, formatStamp(response.submitted_at)), h('td', {}, response.edition));
  del.addEventListener('click', () => {
    openDeleteDialog({ formId, id: response.id, reference: response.reference }, del, () => {
      const next = row.nextElementSibling ?? row.previousElementSibling;
      row.remove();
      if (body.children.length === 0) afterEmptied();
      else next?.querySelector('a')?.focus();
    });
  });
  return row;
}
