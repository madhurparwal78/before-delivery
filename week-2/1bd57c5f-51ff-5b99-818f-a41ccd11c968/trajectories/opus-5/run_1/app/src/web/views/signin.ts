import { COPY } from '../../shared/domain.js';
import { RequestFailed, sendJson } from '../lib/api.js';
import { el, labelledField, setFieldError } from '../lib/dom.js';
import { announce, errorSummary, showTopBar, view } from '../lib/shell.js';

export function renderSignIn(navigate: (path: string) => void, signedOut: boolean): void {
  showTopBar(false);
  const root = view();
  root.replaceChildren();

  const email = labelledField('Email', { type: 'email', autocomplete: 'username' });
  const password = labelledField('Password', { type: 'password', autocomplete: 'current-password' });
  const submit = el('button', { type: 'submit' }, ['Sign in']);
  const problem = el('div', { class: 'formproblem' });
  const catalogue = el('p', { class: 'formerror' });

  const form = el('form', { class: 'signin', novalidate: true }, [
    el('h1', {}, ['Sign in']),
    problem,
    catalogue,
    email.wrap,
    password.wrap,
    submit,
  ]);
  if (signedOut) root.append(el('p', { class: 'signedout' }, [COPY.signedOut]));
  root.append(form);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      problem.replaceChildren();
      catalogue.textContent = '';
      setFieldError(email.error, email.input, null);
      setFieldError(password.error, password.input, null);
      submit.disabled = true;
      submit.setAttribute('aria-busy', 'true');
      announce(COPY.saving);
      try {
        await sendJson('POST', '/api/session', {
          email: email.input.value,
          password: password.input.value,
        });
        announce('');
        navigate('/jobs');
      } catch (error) {
        if (error instanceof RequestFailed) {
          const fields = error.body.fields;
          if (fields !== undefined) {
            const entries: { field: string; message: string; focus: () => void }[] = [];
            if (fields.email !== undefined) {
              setFieldError(email.error, email.input, fields.email);
              entries.push({
                field: 'email',
                message: fields.email,
                focus: () => email.input.focus(),
              });
            }
            if (fields.password !== undefined) {
              setFieldError(password.error, password.input, fields.password);
              entries.push({
                field: 'password',
                message: fields.password,
                focus: () => password.input.focus(),
              });
            }
            const summary = errorSummary(entries);
            if (summary !== null) problem.append(summary);
          } else {
            catalogue.textContent = error.body.message;
          }
        } else {
          catalogue.textContent = COPY.offlineBanner;
        }
        announce('');
      } finally {
        submit.disabled = false;
        submit.removeAttribute('aria-busy');
      }
    })();
  });
  email.input.focus();
}
