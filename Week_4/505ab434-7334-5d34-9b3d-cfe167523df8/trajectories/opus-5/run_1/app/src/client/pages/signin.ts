import { ApiCallError, getJson, sendJson } from '../api.js';
import { el } from '../dom.js';
import { emptyGlyph } from '../marks.js';
import type { Principal } from '../../shared/types.js';
import { setPrincipal } from '../shell.js';

export function renderSignIn(main: HTMLElement, navigate: (path: string) => void): void {
  const alert = el('p', { class: 'alert', role: 'alert' });
  const email = el('input', { type: 'email', id: 'signin-email', name: 'email', autocomplete: 'username' }) as HTMLInputElement;
  const password = el('input', {
    type: 'password',
    id: 'signin-password',
    name: 'password',
    autocomplete: 'current-password',
  }) as HTMLInputElement;
  const submit = el('button', { type: 'submit', class: 'pill' }, 'Sign in') as HTMLButtonElement;

  const form = el(
    'form',
    {
      class: 'cell sign-in-cell',
      onsubmit: (event: Event) => {
        event.preventDefault();
        alert.textContent = '';
        submit.disabled = true;
        submit.textContent = 'Signing in';
        void sendJson<{ principal: Principal }>('POST', '/api/session', {
          email: email.value,
          password: password.value,
        })
          .then((response) => {
            setPrincipal(response.principal);
            navigate('/library');
          })
          .catch((error: unknown) => {
            alert.textContent = error instanceof ApiCallError ? error.message : 'Email or password is incorrect.';
            submit.disabled = false;
            submit.textContent = 'Sign in';
          });
      },
    },
    el('h1', {}, 'Sign in'),
    el('label', { for: 'signin-email' }, 'Email'),
    email,
    el('label', { for: 'signin-password' }, 'Password'),
    password,
    alert,
    submit,
  );

  email.setAttribute('aria-label', 'Email');
  main.appendChild(form);
}

export async function renderActivate(
  main: HTMLElement,
  token: string,
  navigate: (path: string) => void,
): Promise<void> {
  try {
    await getJson<{ email: string; displayName: string }>(`/api/invitations/${encodeURIComponent(token)}`);
  } catch {
    main.appendChild(
      el(
        'div',
        { class: 'cell field field-ember empty-state' },
        emptyGlyph(),
        el('h1', {}, 'This invitation link is no longer valid.'),
      ),
    );
    return;
  }

  const alert = el('p', { class: 'alert', role: 'alert' });
  const password = el('input', {
    type: 'password',
    id: 'activate-password',
    name: 'password',
    autocomplete: 'new-password',
  }) as HTMLInputElement;
  const submit = el('button', { type: 'submit', class: 'pill' }, 'Activate account') as HTMLButtonElement;

  main.appendChild(
    el(
      'form',
      {
        class: 'cell sign-in-cell',
        onsubmit: (event: Event) => {
          event.preventDefault();
          alert.textContent = '';
          submit.disabled = true;
          submit.textContent = 'Saving';
          void sendJson<{ principal: Principal }>('POST', `/api/invitations/${encodeURIComponent(token)}/activate`, {
            password: password.value,
          })
            .then((response) => {
              setPrincipal(response.principal);
              navigate('/library');
            })
            .catch((error: unknown) => {
              alert.textContent = error instanceof ApiCallError ? error.message : 'Something went wrong.';
              submit.disabled = false;
              submit.textContent = 'Activate account';
            });
        },
      },
      el('h1', {}, 'Activate your account'),
      el('label', { for: 'activate-password' }, 'Password'),
      password,
      alert,
      submit,
    ),
  );
}
