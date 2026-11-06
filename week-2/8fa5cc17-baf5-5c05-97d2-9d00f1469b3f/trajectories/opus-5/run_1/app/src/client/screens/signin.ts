import { api, setCsrfToken, SessionInfo } from '../api';
import { clear, el } from '../dom';
import { COPY } from '../../shared/copy';
import { safeReturnAddress } from '../../shared/rules';

export type SignInOptions = { returnPath: string | null; message?: string };

export function showSignIn(host: HTMLElement, options: SignInOptions, onSignedIn: (session: SessionInfo) => void): void {
  clear(host);
  const alertRegion = el('div', { className: 'alert sign-in-alert', attrs: { role: 'alert' } });
  if (options.message !== undefined) alertRegion.textContent = options.message;

  const email = el('input', { attrs: { type: 'email', id: 'sign-in-email', autocomplete: 'username' } });
  const password = el('input', {
    attrs: { type: 'password', id: 'sign-in-password', autocomplete: 'current-password' },
  });
  const button = el('button', { className: 'primary', text: 'Sign in', attrs: { type: 'submit' } });
  const form = el('form', {
    className: 'sign-in-form',
    children: [
      el('label', { text: 'Email', attrs: { for: 'sign-in-email' } }),
      email,
      el('label', { text: 'Password', attrs: { for: 'sign-in-password' } }),
      password,
      button,
    ],
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit();
  });

  async function submit(): Promise<void> {
    const result = await api.post<{ user: SessionInfo['user']; csrf_token: string }>('/api/auth/sign-in', {
      email: email.value,
      password: password.value,
    });
    if (result.ok) {
      alertRegion.textContent = '';
      setCsrfToken(result.data.csrf_token);
      const session = await api.get<SessionInfo>('/api/session');
      if (session.ok) {
        const safe = safeReturnAddress(options.returnPath);
        window.history.replaceState({}, '', safe ?? '/today');
        onSignedIn(session.data);
      }
      return;
    }
    if (result.status === 429) {
      alertRegion.textContent = COPY.signInLocked;
      return;
    }
    if (result.status === 401) {
      alertRegion.textContent = COPY.signInWrong;
      return;
    }
    if (result.status === 422 && result.errors !== undefined) {
      alertRegion.textContent = Object.values(result.errors)[0] ?? COPY.signInWrong;
      return;
    }
    alertRegion.textContent = COPY.signInWrong;
  }

  host.append(
    el('div', {
      className: 'sign-in-page',
      children: [
        el('div', {
          className: 'sign-in-card',
          children: [
            el('p', { className: 'wordmark', text: 'Quire' }),
            el('h1', { text: 'Sign in to Quire' }),
            alertRegion,
            form,
          ],
        }),
      ],
    }),
  );
  email.focus();
}
