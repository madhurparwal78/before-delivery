import { request } from './../api';
import { el, focusElement } from '../dom';
import { announce, heading, internalLink, type Screen, type ScreenContext } from '../shell';
import * as copy from '../copy';
import type { Me } from '../../shared/types';

export interface SignInHandlers {
  onSignedIn(user: Me, nextValue: string | null): void;
}

export async function mountSignIn(ctx: ScreenContext, handlers: SignInHandlers): Promise<Screen> {
  const title = el('p', { text: 'Stationhouse', className: 'product-name' });
  const level1 = heading('Sign in to Stationhouse');
  const form = el('form', { className: 'narrow-form', attrs: { 'aria-label': 'Sign in', novalidate: '' } });

  const emailLabel = el('label', { text: 'Email', attrs: { for: 'signin-email' }, className: 'field-label' });
  const email = el('input', {
    className: 'field-input',
    attrs: { id: 'signin-email', type: 'email', name: 'email', 'aria-label': 'Email', autocomplete: 'email' },
  });
  const passwordLabel = el('label', {
    text: 'Password',
    attrs: { for: 'signin-password' },
    className: 'field-label',
  });
  const password = el('input', {
    className: 'field-input',
    attrs: {
      id: 'signin-password',
      type: 'password',
      name: 'password',
      'aria-label': 'Password',
      autocomplete: 'current-password',
    },
  });
  const submit = el('button', { text: 'Sign in', className: 'button primary', attrs: { type: 'submit' } });
  const outcome = el('p', { className: 'outcome-copy' });
  const applyLink = internalLink('Apply for a station', '/apply');

  form.append(emailLabel, email, passwordLabel, password, submit, outcome);
  ctx.root.append(title, level1, form, applyLink);
  focusElement(email);

  let busy = false;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    submit.setAttribute('aria-disabled', 'true');
    outcome.textContent = copy.signin.pending;
    announce(copy.signin.pending);
    void (async () => {
      const result = await request<{ user: Me }>('POST', '/api/session', {
        body: { email: email.value, password: password.value },
      });
      busy = false;
      submit.removeAttribute('aria-disabled');
      if (result.kind === 'stale') return;
      if (result.kind === 'ok') {
        outcome.textContent = '';
        handlers.onSignedIn(result.body.user, ctx.query.get('next'));
        return;
      }
      const message =
        result.kind === 'network'
          ? copy.generic
          : result.status === 429
            ? copy.signin.limit
            : copy.signin.wrong;
      outcome.textContent = message;
      announce(message);
    })();
  });

  return { unmount: () => undefined };
}
