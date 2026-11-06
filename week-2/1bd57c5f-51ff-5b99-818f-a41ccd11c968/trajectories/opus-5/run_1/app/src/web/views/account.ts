import { COPY } from '../../shared/domain.js';
import { RequestFailed, sendJson } from '../lib/api.js';
import { el, labelledField, setFieldError } from '../lib/dom.js';
import { announce, errorSummary, showTopBar, view } from '../lib/shell.js';

export function renderAccount(): void {
  showTopBar(true);
  const root = view();
  root.replaceChildren();

  const current = labelledField('Current password', {
    type: 'password',
    autocomplete: 'current-password',
  });
  const next = labelledField('New password', { type: 'password', autocomplete: 'new-password' });
  const problem = el('div', { class: 'formproblem' });
  const submit = el('button', { type: 'submit' }, ['Change password']);
  const form = el('form', { class: 'account', novalidate: true }, [
    problem,
    current.wrap,
    next.wrap,
    submit,
  ]);
  root.append(el('h1', {}, ['Account']), form);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      problem.replaceChildren();
      for (const field of [current, next]) setFieldError(field.error, field.input, null);
      submit.disabled = true;
      submit.setAttribute('aria-busy', 'true');
      announce(COPY.saving);
      try {
        await sendJson('POST', '/api/me/password', {
          current_password: current.input.value,
          new_password: next.input.value,
        });
        announce('Password changed. Every other session is signed out.');
        form.reset();
      } catch (error) {
        if (error instanceof RequestFailed) {
          const fields = error.body.fields ?? {};
          const entries: { field: string; message: string; focus: () => void }[] = [];
          for (const [key, field] of [
            ['current_password', current],
            ['new_password', next],
          ] as const) {
            const message = fields[key];
            if (message !== undefined) {
              setFieldError(field.error, field.input, message);
              entries.push({ field: key, message, focus: () => field.input.focus() });
            }
          }
          const summary = errorSummary(entries);
          if (summary !== null) problem.append(summary);
        }
        announce('');
      } finally {
        submit.disabled = false;
        submit.removeAttribute('aria-busy');
      }
    })();
  });
}

export function renderNotFound(): void {
  showTopBar(true);
  const root = view();
  root.replaceChildren(
    el('div', { class: 'notfound' }, [
      el('h1', {}, [COPY.notFoundHeading]),
      el('a', { href: '/jobs', 'data-link': 'true' }, [COPY.backToJobs]),
    ]),
  );
}

export function renderRoleEnded(): void {
  showTopBar(true);
  const root = view();
  root.replaceChildren(
    el('div', { class: 'notfound' }, [
      el('p', {}, ['Your access to this job has ended.']),
      el('a', { href: '/jobs', 'data-link': 'true' }, [COPY.backToJobs]),
    ]),
  );
}
