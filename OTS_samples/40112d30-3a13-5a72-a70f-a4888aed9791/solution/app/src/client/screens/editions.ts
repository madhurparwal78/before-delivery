import { M73 } from '../../shared/messages.ts';
import { api } from '../lib/api.ts';
import { h } from '../lib/dom.ts';
import { ready } from '../lib/shell.ts';
import { formatStamp } from '../owner/dates.ts';
import { openFormScreen, orNotFound } from '../owner/form-screen.ts';
import { lightOne } from '../owner/light.ts';

interface EditionLine { number: number; published_at: string }

export async function render(params: Record<string, string>): Promise<void> {
  const id = params['id'] ?? '';
  const screen = await openFormScreen(id, 'editions');
  if (!screen) return;
  const listed = await orNotFound(api<{ editions: EditionLine[] }>('GET', `/api/forms/${id}/editions`));
  if (!listed) return;
  const title = h('h1', {}, 'Editions');
  const lines = listed.editions.reverse().map((edition) => h('li', { class: 'form-line' },
    h('a', { href: `/forms/${id}/editions/${edition.number}` }, `Edition ${edition.number}`),
    h('span', { class: 'figures' }, `Published ${formatStamp(edition.published_at)}`)));
  lightOne(lines);
  ready(screen.main, 'Editions - Nightform');
  screen.main.append(title, lines.length === 0 ? h('p', { class: 'empty' }, M73) : h('ul', { class: 'form-lines' }, lines));
}
