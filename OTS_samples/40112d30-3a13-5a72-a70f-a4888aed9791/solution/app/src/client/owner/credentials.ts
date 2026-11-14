import { api, ApiFailure } from '../lib/api.ts';
import { h } from '../lib/dom.ts';
import { frame, ready } from '../lib/shell.ts';
import { textField, type Field, type FieldOptions } from './fields.ts';
import { clearFailure, showFailure } from './failure.ts';
import { arrive } from './arrive.ts';
import { keepingRequest } from './next-path.ts';

// Sign in and sign up are one screen: a centred column of fields, one primary action and a link to the other.

interface Credentials {
  heading: string;
  endpoint: string;
  fields: FieldOptions[];
  other: { text: string; path: string };
}

export function showCredentials({ heading, endpoint, fields: options, other }: Credentials): void {
  const main = frame();
  main.classList.add('centred');
  const fields: Field[] = options.map(textField);
  const form = h('form', { novalidate: true },
    ...fields.map((field) => field.row),
    h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'primary' }, heading)));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit(form, fields, endpoint);
  });
  const title = h('h1', {}, heading);
  ready(main, `${heading} - Nightform`);
  main.append(h('div', { class: 'column' }, title, form, h('p', {}, h('a', { href: keepingRequest(other.path) }, other.text))));
}

async function submit(form: HTMLFormElement, fields: Field[], endpoint: string): Promise<void> {
  clearFailure(form, fields);
  const body = Object.fromEntries(fields.map((field) => [field.name, field.input.value]));
  try {
    await api('POST', endpoint, body);
  } catch (failure) {
    if (failure instanceof ApiFailure) return showFailure(form, fields, failure);
    throw failure;
  }
  await arrive();
}
