import { api } from '../api.js';
import { element, labelledInput } from '../dom.js';
import { internalLink, navigate, pageShell, pending } from '../shell.js';

interface Account {
  id: string;
}

export function signUpPage(): HTMLElement {
  const shell = pageShell('narrow');
  const email = labelledInput('Email', { type: 'email', autocomplete: 'email' });
  const password = labelledInput('Password', { type: 'password', role: 'textbox', autocomplete: 'new-password' });
  const name = labelledInput('Your name', { autocomplete: 'name' });
  const submit = element('button', { type: 'submit', class: 'primary' }, ['Create account']);

  const form = element('form', { class: 'stack', novalidate: true }, [email.field, password.field, name.field, submit]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      shell.showError(null);
      pending(submit, true);
      shell.setStatus('Saving...');
      const answer = await api.post<Account>('/api/teachers', {
        email: email.input.value,
        password: password.input.value,
        displayName: name.input.value
      });
      pending(submit, false);
      shell.setStatus('');
      if (answer.error !== null) {
        shell.showError(answer.error);
        return;
      }
      navigate('/classes');
    })();
  });

  shell.body.append(
    element('h1', {}, ['Create your teacher account']),
    form,
    element('p', {}, [internalLink('Sign in', '/sign-in')])
  );
  return shell.root;
}

export function signInPage(): HTMLElement {
  const shell = pageShell('narrow');
  const email = labelledInput('Email', { type: 'email', autocomplete: 'email' });
  const password = labelledInput('Password', { type: 'password', role: 'textbox', autocomplete: 'current-password' });
  const submit = element('button', { type: 'submit', class: 'primary' }, ['Sign in']);

  const form = element('form', { class: 'stack', novalidate: true }, [email.field, password.field, submit]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      shell.showError(null);
      pending(submit, true);
      shell.setStatus('Saving...');
      const answer = await api.post<Account>('/api/sign-in', {
        email: email.input.value,
        password: password.input.value
      });
      pending(submit, false);
      shell.setStatus('');
      if (answer.error !== null) {
        shell.showError(answer.error);
        return;
      }
      navigate('/classes');
    })();
  });

  shell.body.append(
    element('h1', {}, ['Sign in']),
    form,
    element('p', {}, [internalLink('Create an account', '/sign-up')])
  );
  return shell.root;
}
