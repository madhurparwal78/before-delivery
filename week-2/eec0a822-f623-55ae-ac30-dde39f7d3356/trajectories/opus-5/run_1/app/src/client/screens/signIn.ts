import { api, failure } from '../lib/api.js';
import { el } from '../lib/dom.js';
import { createMessageBox, FieldSet, withPending } from '../lib/forms.js';
import { navigate } from '../lib/router.js';
import { forgetMember } from '../lib/session.js';
import { publicPage } from '../lib/chrome.js';
import { MESSAGES } from '../../shared/copy.js';
import { textbox } from '../lib/views.js';
import type { RouteContext } from '../lib/router.js';

export async function signInScreen(host: HTMLElement, context: RouteContext): Promise<void> {
  const page = publicPage(host, 'Sign in to Tidewright');
  const fields = new FieldSet();
  const messages = createMessageBox();
  const email = textbox('Email', '', 'email');
  const password = textbox('Password', '', 'password');
  const submit = el('button', { type: 'submit', class: 'button' }, 'Sign in') as HTMLButtonElement;

  const form = el(
    'form',
    { class: 'narrow-form', novalidate: true },
    fields.problems,
    fields.field('email', 'Email', email),
    fields.field('password', 'Password', password),
    messages.node,
    submit,
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void withPending(submit, 'Signing in', async () => {
      const result = await api.post<{ homePath: string }>('/api/session', {
        email: email.value,
        password: password.value,
      });
      if (!result.ok) {
        const body = failure(result);
        if (body.errors !== undefined) {
          fields.showErrors(body.errors)?.focus();
          return;
        }
        messages.show(MESSAGES.signInRefused, 'problem');
        return;
      }
      forgetMember();
      const next = context.query.get('next');
      navigate(next === null || next === '' ? result.data.homePath : next, { replace: true });
    });
  });
  page.main.appendChild(form);
}
