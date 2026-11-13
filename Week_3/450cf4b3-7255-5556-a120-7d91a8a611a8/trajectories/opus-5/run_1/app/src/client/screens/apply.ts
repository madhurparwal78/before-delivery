import { request } from '../api';
import { el, focusElement } from '../dom';
import { announce, heading, type Screen, type ScreenContext } from '../shell';
import * as copy from '../copy';
import type { Me } from '../../shared/types';

interface Field {
  name: string;
  label: string;
  input: HTMLInputElement;
  error: HTMLParagraphElement;
}

export interface ApplyHandlers {
  onApplied(user: Me): void;
}

export async function mountApply(ctx: ScreenContext, handlers: ApplyHandlers): Promise<Screen> {
  const level1 = heading('Apply for a station');
  const errorGroup = el('div', {
    className: 'field-group hidden',
    attrs: { role: 'group', 'aria-label': 'Check these fields', tabindex: '-1', hidden: '' },
  });
  const form = el('form', { className: 'narrow-form', attrs: { 'aria-label': 'Apply', novalidate: '' } });

  const definitions: ReadonlyArray<{ name: string; label: string; type: string }> = [
    { name: 'businessName', label: 'Business name', type: 'text' },
    { name: 'contactName', label: 'Contact name', type: 'text' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'password', label: 'Password', type: 'password' },
  ];

  const fields: Field[] = definitions.map((definition) => {
    const id = `apply-${definition.name}`;
    const label = el('label', {
      text: definition.label,
      className: 'field-label',
      attrs: { for: id },
    });
    const input = el('input', {
      className: 'field-input',
      attrs: { id, type: definition.type, name: definition.name, 'aria-label': definition.label },
    });
    const error = el('p', { className: 'field-error', attrs: { id: `${id}-error` } });
    form.append(label, input, error);
    return { name: definition.name, label: definition.label, input, error };
  });

  const submit = el('button', {
    text: 'Send application',
    className: 'button primary',
    attrs: { type: 'submit' },
  });
  const outcome = el('p', { className: 'outcome-copy' });
  form.append(submit, outcome);
  ctx.root.append(level1, errorGroup, form);
  focusElement(level1);

  const clearErrors = (): void => {
    errorGroup.textContent = '';
    errorGroup.setAttribute('hidden', '');
    errorGroup.classList.add('hidden');
    for (const field of fields) {
      field.error.textContent = '';
      field.input.removeAttribute('aria-describedby');
    }
  };

  const showErrors = (messages: Record<string, string>): void => {
    errorGroup.textContent = '';
    errorGroup.removeAttribute('hidden');
    errorGroup.classList.remove('hidden');
    let count = 0;
    for (const field of fields) {
      const message = messages[field.name];
      if (message === undefined) continue;
      count += 1;
      field.error.textContent = message;
      field.input.setAttribute('aria-describedby', `${field.input.id}-error`);
      const link = el('a', {
        text: `${field.label}: ${message}`,
        className: 'link',
        attrs: { href: `#${field.input.id}` },
      });
      link.addEventListener('click', (event) => {
        event.preventDefault();
        field.input.focus();
      });
      errorGroup.append(link);
    }
    focusElement(errorGroup);
    announce(copy.applyCount(count));
  };

  let busy = false;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    clearErrors();
    submit.setAttribute('aria-disabled', 'true');
    outcome.textContent = copy.apply.pending;
    announce(copy.apply.pending);
    const body: Record<string, string> = {};
    for (const field of fields) body[field.name] = field.input.value;

    void (async () => {
      const result = await request<{ user: Me }>('POST', '/api/tenants/apply', { body });
      busy = false;
      submit.removeAttribute('aria-disabled');
      if (result.kind === 'stale') return;
      if (result.kind === 'ok') {
        outcome.textContent = '';
        handlers.onApplied(result.body.user);
        announce(copy.apply.success);
        return;
      }
      if (result.kind === 'network') {
        outcome.textContent = copy.generic;
        announce(copy.generic);
        return;
      }
      if (result.status === 422) {
        outcome.textContent = '';
        showErrors(result.fields);
        return;
      }
      if (result.status === 409 && result.error === 'email_taken') {
        outcome.textContent = '';
        showErrors({ email: result.message });
        return;
      }
      outcome.textContent = copy.generic;
      announce(copy.generic);
    })();
  });

  return { unmount: () => undefined };
}
