// Sign in with email and password.

import { DeskError, User, api } from './api';
import { el } from './dom';
import { announce, clearProblem, failureCopy, problem, showFieldErrors } from './feedback';
import { navigate } from './router';
import { desk } from './shell';

export function renderSignIn(screen: HTMLElement, nextPath: string | null): void {
  const email = el('input', { type: 'email', name: 'email', 'data-field': 'email', autocomplete: 'username' });
  const password = el('input', {
    type: 'password',
    name: 'password',
    'data-field': 'password',
    autocomplete: 'current-password',
  });
  const submit = el('button', { type: 'submit', class: 'button primary', text: 'Sign in' });

  const form = el('form', {
    class: 'card sign-in-card',
    onsubmit: async (event: Event) => {
      event.preventDefault();
      clearProblem();
      submit.disabled = true;
      announce('Signing you in.');
      try {
        const answer = await api.post<{ user: User }>('/api/session', {
          email: email.value,
          password: password.value,
        });
        desk.user = answer.user;
        announce('');
        navigate(nextPath ?? (answer.user.role === 'owner' ? '/desk' : '/review'));
      } catch (error) {
        announce('');
        submit.disabled = false;
        if (error instanceof DeskError) {
          problem(failureCopy(error));
          showFieldErrors(form, error.info.fields);
        }
      }
    },
  }, [
    el('h1', { text: 'Sign in' }),
    labelled('Email', email),
    labelled('Password', password),
    submit,
  ]);

  screen.append(el('div', { class: 'centred-screen' }, [form]));
  email.focus();
}

function labelled(label: string, control: HTMLElement): HTMLElement {
  const id = `sign-in-${label.toLowerCase()}`;
  control.setAttribute('id', id);
  return el('div', { class: 'field' }, [el('label', { for: id, text: label }), control]);
}
