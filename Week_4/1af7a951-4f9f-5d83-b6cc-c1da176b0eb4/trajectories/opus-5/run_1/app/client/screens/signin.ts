import { api, type Session } from '../api.js';
import { COPY } from '../copy.js';
import { h } from '../dom.js';
import { announce, statusRegion } from '../live.js';

export interface SignInOptions {
  readonly next: string | null;
  readonly onSignedIn: (session: Session) => void;
}

export function signInScreen(options: SignInOptions): Node {
  const code = h('input', { type: 'text', 'aria-label': 'Access code', id: 'access-code' });
  const submit = h('button', { type: 'submit', class: 'primary', text: COPY.signIn });
  const status = statusRegion('Sign in');
  const form = h('form', { class: 'stack' }, [
    h('h1', { text: COPY.signIn }),
    h('label', { for: 'access-code', text: 'Access code' }),
    code,
    submit,
    status,
  ]);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      if (!navigator.onLine) {
        announce(status, COPY.offlineSignIn);
        return;
      }
      submit.disabled = true;
      const result = await api.signIn(code.value);
      submit.disabled = false;
      if (result.ok && result.body !== null) {
        options.onSignedIn(result.body);
        const landing = await api.landing(options.next);
        location.assign(landing.body?.landing ?? (result.body.role === 'coach' ? '/coach' : '/logbook'));
        return;
      }
      if (result.errorCode === 'enrollment_not_active') {
        const status_ = result.extra?.['status'];
        announce(status, status_ === 'refunded' ? COPY.refundedCode : COPY.pendingCode);
        return;
      }
      announce(status, COPY.invalidCode);
    })();
  });

  return h('section', { class: 'screen narrow' }, [form]);
}
