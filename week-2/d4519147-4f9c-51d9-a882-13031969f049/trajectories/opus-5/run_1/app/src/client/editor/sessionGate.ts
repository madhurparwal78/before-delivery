import { ApiFailure, api, sessionState, setSession } from '../api';
import { COPY } from '../../shared/copy';
import { el, field, openPanel, type Panel } from '../dom';
import type { SessionBody } from '../../shared/types';

type Kept = () => void;

let panel: Panel | null = null;
let kept: Kept[] = [];

export function isGateOpen(): boolean {
  return panel !== null;
}

/**
 * Keeps an editor request that met an expired session, opens Sign in to
 * continue, and resends that exact request once after a successful sign-in.
 */
export async function keepForSignIn<T>(make: () => Promise<T>): Promise<T> {
  try {
    return await make();
  } catch (error) {
    if (!(error instanceof ApiFailure) || error.code !== 'session_expired') throw error;
    return new Promise<T>((resolve, reject) => {
      kept.push(() => {
        make().then(resolve, reject);
      });
      openGate();
    });
  }
}

function openGate(): void {
  if (panel) return;
  const emailInput = el('input', { type: 'email', readonly: 'readonly', value: sessionState.user?.email ?? '' });
  const passwordInput = el('input', { type: 'password', autocomplete: 'current-password' });
  const submit = el('button', { type: 'button', class: 'primary', text: 'Sign in' });
  const alertHost = el('div');
  const content = el('div', {}, [
    el('h2', { text: 'Sign in to continue' }),
    el('p', { text: COPY.sessionDialogText }),
    alertHost,
    field('Email', emailInput, { id: 'gate-email' }),
    field('Password', passwordInput, { id: 'gate-password' }),
    el('div', { class: 'dialog-actions' }, [submit]),
  ]);
  panel = openPanel(content, {
    labelledBy: 'Sign in to continue',
    initialFocus: () => passwordInput,
    closeOnEscape: false,
    closeOnScrim: false,
  });

  const attempt = (): void => {
    submit.disabled = true;
    void api
      .post<SessionBody>('/api/session', { email: emailInput.value, password: passwordInput.value })
      .then((body) => {
        setSession(body.user, body.csrfToken);
        const pending = kept;
        kept = [];
        panel?.close();
        panel = null;
        for (const resend of pending) resend();
      })
      .catch((error: unknown) => {
        submit.disabled = false;
        const message =
          error instanceof ApiFailure && error.code === 'signin_locked' ? COPY.signInLocked : COPY.signInFailed;
        alertHost.replaceChildren(el('div', { class: 'alert', role: 'alert', text: message }));
        passwordInput.focus();
      });
  };

  submit.addEventListener('click', attempt);
  passwordInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      attempt();
    }
  });
}
