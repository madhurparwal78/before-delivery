import { ACCOUNT_COPY, GLOBAL_COPY } from '../../shared/messages.js';
import { api, type ValidationBody } from '../api.js';
import { publicPage } from '../chrome.js';
import { el, labelledField, setStatus } from '../dom.js';
import { broadcast, reloadJournal } from '../journal.js';
import { prefetchAccount, resetPrefetch } from '../prefetch.js';
import {
  landingAfterSignIn,
  navigate,
  setDeviceSignedOut,
  type ScreenContext,
} from '../router.js';
import { loadCopy, rememberAccount, setAccount, setSignedOutWithWork } from '../state.js';
import { sendSoon } from '../sync.js';
import { regions } from '../regions.js';
import type { Account } from '../../shared/types.js';

function textbox(name: string, type: 'text' | 'password' | 'email'): HTMLInputElement {
  const node = el('input', {
    class: 'input',
    attrs: {
      type,
      'aria-label': name,
      autocomplete: type === 'password' ? 'current-password' : 'off',
      // A password field must still answer to the published textbox role.
      ...(type === 'password' ? { role: 'textbox' } : {}),
    },
  });
  return node;
}

interface FormParts {
  form: HTMLFormElement;
  alert: HTMLElement;
  submit: HTMLButtonElement;
}

function accountForm(submitLabel: string, fields: HTMLElement[]): FormParts {
  const alert = el('div', {
    class: 'account-problem',
    attrs: { role: 'alert', 'aria-label': 'Account problem' },
  });
  const submit = el('button', {
    class: 'button accent',
    text: submitLabel,
    attrs: { type: 'submit' },
  });
  const form = el('form', { class: 'form' }, [...fields, alert, submit]);
  regions.accountProblem = alert;
  return { form, alert, submit };
}

async function afterSignedIn(account: Account, landing: string): Promise<void> {
  setAccount(account);
  await rememberAccount(account);
  setDeviceSignedOut(false);
  setSignedOutWithWork(false);
  resetPrefetch();
  await loadCopy(account.id);
  await reloadJournal();
  broadcast({ type: 'account', account_id: account.id });
  navigate(landing, { replace: true });
  sendSoon();
  void prefetchAccount();
}

export async function renderSignUp(): Promise<HTMLElement> {
  const email = textbox('Email', 'email');
  const password = textbox('Password', 'password');
  const name = textbox('Your name', 'text');
  password.setAttribute('autocomplete', 'new-password');
  const { form, alert } = accountForm('Create account', [
    labelledField('Email', email),
    labelledField('Password', password),
    labelledField('Your name', name),
  ]);

  let inFlight = false;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (inFlight) return;
    inFlight = true;
    void (async () => {
      const answer = await api.post<{ account: Account } & ValidationBody>('/api/auth/signup', {
        email: email.value,
        password: password.value,
        display_name: name.value,
      });
      inFlight = false;
      if (answer.offline) {
        setStatus(alert, GLOBAL_COPY.needs_signal);
        return;
      }
      if (answer.status === 201 && answer.body?.account) {
        setStatus(alert, '');
        await afterSignedIn(answer.body.account, '/kit');
        return;
      }
      if (answer.status === 409) {
        setStatus(alert, ACCOUNT_COPY.email_taken);
        return;
      }
      if (answer.status === 422) {
        const problems = answer.body?.fields ?? {};
        const first = Object.keys(problems)[0];
        setStatus(alert, first ? (problems[first] as string) : '');
        const target =
          first === 'email' ? email : first === 'password' ? password : first ? name : null;
        target?.focus();
        return;
      }
      setStatus(alert, GLOBAL_COPY.internal);
    })();
  });

  return publicPage([
    el('h1', { class: 'heading', text: 'Sign up' }),
    form,
    el('p', { class: 'muted' }, [
      'Already have an account? ',
      el('a', {
        class: 'link',
        text: 'Sign in',
        attrs: { href: '/signin' },
        on: {
          click: (event) => {
            event.preventDefault();
            navigate('/signin');
          },
        },
      }),
    ]),
  ]);
}

export async function renderSignIn(context: ScreenContext): Promise<HTMLElement> {
  const email = textbox('Email', 'email');
  const password = textbox('Password', 'password');
  const { form, alert } = accountForm('Sign in', [
    labelledField('Email', email),
    labelledField('Password', password),
  ]);

  let inFlight = false;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (inFlight) return;
    inFlight = true;
    void (async () => {
      const answer = await api.post<{ account: Account } & ValidationBody>('/api/auth/signin', {
        email: email.value,
        password: password.value,
      });
      inFlight = false;
      if (answer.offline) {
        setStatus(alert, GLOBAL_COPY.needs_signal);
        return;
      }
      if (answer.status === 200 && answer.body?.account) {
        setStatus(alert, '');
        await afterSignedIn(answer.body.account, landingAfterSignIn(context.query));
        return;
      }
      if (answer.status === 429) {
        setStatus(alert, ACCOUNT_COPY.too_many_attempts);
        return;
      }
      if (answer.status === 401) {
        setStatus(alert, ACCOUNT_COPY.bad_credentials);
        return;
      }
      if (answer.status === 422) {
        const problems = answer.body?.fields ?? {};
        const first = Object.keys(problems)[0];
        setStatus(alert, first ? (problems[first] as string) : '');
        (first === 'password' ? password : email).focus();
        return;
      }
      setStatus(alert, GLOBAL_COPY.internal);
    })();
  });

  return publicPage([
    el('h1', { class: 'heading', text: 'Sign in' }),
    form,
    el('p', { class: 'muted' }, [
      'New here? ',
      el('a', {
        class: 'link',
        text: 'Sign up',
        attrs: { href: '/signup' },
        on: {
          click: (event) => {
            event.preventDefault();
            navigate('/signup');
          },
        },
      }),
    ]),
  ]);
}
