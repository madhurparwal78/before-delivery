import { M55_56, M83 } from '../../shared/messages.ts';
import { h } from '../lib/dom.ts';
import { stateText } from '../lib/shell.ts';
import { lightOne } from './light.ts';

// One line per form: its title link, its state and its response count.

export interface FormLine { id: string; title: string; state: string; responses: number }

export function formList(forms: FormLine[]): HTMLElement {
  if (forms.length === 0) return h('p', { class: 'empty' }, M83);
  const lines = forms.map((form) => h('li', { class: 'form-line' },
    h('a', { href: `/forms/${form.id}/edit` }, form.title),
    h('span', {}, stateText(form.state)),
    h('span', { class: 'figures' }, M55_56(form.responses))));
  lightOne(lines);
  return h('ul', { class: 'form-lines' }, lines);
}
