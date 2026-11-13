import { ApiCallError, send } from '../api';
import { el, find, on } from '../dom';
import { fieldError, labelledField } from '../ui';

export function mountAuth(host: HTMLElement, route: 'signin' | 'signup'): void {
  const url = new URL(window.location.href);
  const next = url.searchParams.get('next');
  const email = labelledField('Email', { type: 'email', autocomplete: 'email' });
  const password = labelledField('Password', { type: 'password', autocomplete: 'current-password' });
  const note = el('p', { class: 'field-error', 'data-ui': 'auth-note' });

  if (route === 'signin') {
    const submit = el('button', { type: 'button', class: 'button-primary' }, ['Sign in']);
    host.append(
      el('div', { class: 'auth-form' }, [
        email.row,
        password.row,
        submit,
        el('a', { href: `/signup${next ? `?next=${encodeURIComponent(next)}` : ''}` }, [
          'Create an account',
        ]),
        note,
      ]),
    );
    if (url.searchParams.get('expired') === '1') {
      note.textContent = 'This link has expired or was already used.';
    }
    on(submit, 'click', async () => {
      try {
        const answer = await send<{ landing: string }>('/api/auth/signin', {
          method: 'POST',
          body: { email: email.input.value, password: password.input.value, next },
        });
        window.location.assign(answer.data.landing);
      } catch (error) {
        if (error instanceof ApiCallError) note.textContent = error.failure.message;
      }
    });
    return;
  }

  const displayName = labelledField('Display name');
  const submit = el('button', { type: 'button', class: 'button-primary' }, ['Create account']);
  const sent = el('p', { 'data-ui': 'signup-sent' });
  host.append(
    el('div', { class: 'auth-form' }, [
      email.row,
      displayName.row,
      password.row,
      submit,
      el('a', { href: `/signin${next ? `?next=${encodeURIComponent(next)}` : ''}` }, ['Sign in']),
      note,
      sent,
    ]),
  );
  on(submit, 'click', async () => {
    fieldError(email.row, null);
    fieldError(displayName.row, null);
    fieldError(password.row, null);
    try {
      await send('/api/auth/signup', {
        method: 'POST',
        body: {
          email: email.input.value,
          displayName: displayName.input.value,
          password: password.input.value,
          next: next ?? '/dashboard',
        },
      });
      sent.textContent = `Check your inbox: we sent a link to ${email.input.value}. It brings you back to this exact configuration.`;
    } catch (error) {
      if (!(error instanceof ApiCallError)) return;
      fieldError(email.row, error.failure.errors?.email ?? null);
      fieldError(displayName.row, error.failure.errors?.displayName ?? null);
      fieldError(password.row, error.failure.errors?.password ?? null);
      if (!error.failure.errors) note.textContent = error.failure.message;
    }
  });
  void find;
}
