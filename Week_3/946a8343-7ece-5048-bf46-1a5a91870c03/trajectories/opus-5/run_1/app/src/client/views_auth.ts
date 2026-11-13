import { RequestFailed, api } from './api';
import { el } from './dom';
import type { ViewContext } from './main';
import { navigate } from './main';
import { Me, announce, state } from './state';

export async function renderSignIn(ctx: ViewContext, mode: 'in' | 'up'): Promise<void> {
  const heading = mode === 'in' ? 'Sign in' : 'Create account';
  const summary = el('div', { role: 'alert', class: 'error-summary', hidden: true });
  const username = el('input', { type: 'text', role: 'textbox', 'aria-label': 'Username', id: 'username', name: 'username' });
  const password = el('input', { type: 'password', 'aria-label': 'Password', id: 'password', name: 'password' });
  const usernameError = el('p', { class: 'field-error', id: 'username-error' });
  const passwordError = el('p', { class: 'field-error', id: 'password-error' });
  username.setAttribute('aria-describedby', 'username-error');
  password.setAttribute('aria-describedby', 'password-error');
  const submit = el('button', { type: 'submit', 'aria-label': heading }, [heading]);
  const form = el('form', { class: 'card form' }, [
    el('h1', { text: mode === 'in' ? 'Sign in to Spurline' : 'Create your account' }),
    summary,
    el('label', { for: 'username', text: 'Username' }),
    username,
    usernameError,
    el('label', { for: 'password', text: 'Password' }),
    password,
    passwordError,
    submit,
    mode === 'in'
      ? el('a', { href: '/sign-up', text: 'Create account' })
      : el('a', { href: '/sign-in', text: 'Sign in' }),
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      usernameError.textContent = '';
      passwordError.textContent = '';
      summary.hidden = true;
      try {
        const path = mode === 'in' ? '/api/session' : '/api/users';
        const body = { username: username.value, password: password.value };
        const result = await api.post<{ user: Me }>(path, body, submit as HTMLButtonElement);
        state.me = result.user;
        navigate('/');
      } catch (error) {
        if (!(error instanceof RequestFailed)) throw error;
        const fields = (error.body.details?.fields ?? {}) as Record<string, string>;
        const items: HTMLElement[] = [];
        for (const [field, text] of Object.entries(fields)) {
          if (field === 'username') usernameError.textContent = text;
          if (field === 'password') passwordError.textContent = text;
          items.push(el('li', {}, [el('a', { href: `#${field}`, text })]));
        }
        if (items.length === 0) {
          usernameError.textContent = error.body.message;
          items.push(el('li', {}, [el('a', { href: '#username', text: error.body.message })]));
        }
        summary.replaceChildren(el('h2', { text: 'Fix these problems:' }), el('ul', {}, items));
        summary.hidden = false;
        announce(error.body.message);
      }
    })();
  });
  ctx.main.append(form);
  username.focus();
}
