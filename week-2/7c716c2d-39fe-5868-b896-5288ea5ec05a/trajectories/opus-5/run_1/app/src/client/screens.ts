import { api, ApiCallError } from './api.js';
import { copy } from './copy.js';
import { clear, el } from './dom.js';
import { state } from './store.js';
import type { Invite, Person, Workspace } from '../shared/types.js';

const root = document.getElementById('app') as HTMLElement;

export type SignedIn = { person: Person; workspace: Workspace | null };

let signedOutNotice = '';

export function setSignedOutNotice(text: string): void {
  signedOutNotice = text;
}

function screenFrame(children: HTMLElement[]): HTMLElement {
  return el('main', { class: 'public-screen' }, children);
}

/** Public and outcome screens live outside the workspace shell. */
export function renderScreen(children: HTMLElement[]): void {
  clear(root);
  const notices = el('div', { id: 'service-notices', class: 'notices', role: 'region', 'aria-label': 'Service notices' });
  const announcements = el('div', {
    class: 'announcements',
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Announcements',
  });
  root.append(notices, announcements, screenFrame(children));
}

export function renderSignIn(next: string | null, onSignedIn: (result: SignedIn, next: string | null) => void): void {
  const status = el('p', { class: 'form-status', role: 'status', 'aria-live': 'polite' });
  const email = el('input', { type: 'email', id: 'sign-in-email', autocomplete: 'email' });
  const password = el('input', { type: 'password', id: 'sign-in-password', autocomplete: 'current-password' });
  const form = el('form', { class: 'sheet-form', 'aria-label': 'Sign in' }, [
    el('h1', { class: 'display', text: 'Sign in' }),
    el('label', { for: 'sign-in-email', text: 'Email' }),
    email,
    el('label', { for: 'sign-in-password', text: 'Password' }),
    password,
    el('button', { type: 'submit', text: 'Sign in' }),
    status,
    el('a', { href: '/create-account', text: 'Create an account' }),
  ]);
  if (signedOutNotice !== '') {
    status.textContent = signedOutNotice;
    signedOutNotice = '';
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    status.textContent = copy.signingIn;
    void api<SignedIn>('POST', '/api/session', {
      body: { email: email.value, password: password.value },
    })
      .then((result) => {
        onSignedIn(result, next);
      })
      .catch((error: unknown) => {
        status.textContent =
          error instanceof ApiCallError && error.code === 'invalid_credentials'
            ? copy.badCredentials
            : error instanceof ApiCallError && error.code === 'database_unavailable'
              ? ''
              : copy.badCredentials;
      });
  });
  renderScreen([form]);
  email.focus();
}

export function renderCreateAccount(onCreated: (result: SignedIn) => void): void {
  const status = el('p', { class: 'form-status', role: 'status', 'aria-live': 'polite' });
  const name = el('input', { type: 'text', id: 'account-name', autocomplete: 'name' });
  const email = el('input', { type: 'email', id: 'account-email', autocomplete: 'email' });
  const password = el('input', { type: 'password', id: 'account-password', autocomplete: 'new-password' });
  const nameError = el('p', { class: 'field-error', id: 'account-name-error' });
  const emailError = el('p', { class: 'field-error', id: 'account-email-error' });
  const passwordError = el('p', { class: 'field-error', id: 'account-password-error' });
  const form = el('form', { class: 'sheet-form', 'aria-label': 'Create account' }, [
    el('h1', { class: 'display', text: 'Create account' }),
    el('label', { for: 'account-name', text: 'Name' }),
    name,
    nameError,
    el('label', { for: 'account-email', text: 'Email' }),
    email,
    emailError,
    el('label', { for: 'account-password', text: 'Password' }),
    password,
    passwordError,
    el('button', { type: 'submit', text: 'Create account' }),
    status,
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    nameError.textContent = '';
    emailError.textContent = '';
    passwordError.textContent = '';
    status.textContent = copy.creatingAccount;
    void api<{ person: Person }>('POST', '/api/accounts', {
      body: { name: name.value, email: email.value, password: password.value },
    })
      .then((result) => {
        onCreated({ person: result.person, workspace: null });
      })
      .catch((error: unknown) => {
        if (!(error instanceof ApiCallError)) return;
        status.textContent = '';
        if (error.code === 'email_taken') {
          status.textContent = copy.emailTaken;
          return;
        }
        if (error.code === 'validation') {
          if (error.fields.name !== undefined) nameError.textContent = error.fields.name;
          if (error.fields.email !== undefined) emailError.textContent = error.fields.email;
          if (error.fields.password !== undefined) passwordError.textContent = error.fields.password;
        }
      });
  });
  renderScreen([form]);
  name.focus();
}

type Outcome = 'full' | 'expired' | 'withdrawn' | 'billing' | null;

export function renderInvitations(
  onJoined: (workspace: Workspace, person: Person) => void,
  outcome: Outcome = null,
  ownerName = '',
): void {
  const status = el('p', { class: 'form-status', role: 'status', 'aria-live': 'polite' });
  const list = el('div', { class: 'invite-cards' });
  const heading = el('h1', { class: 'display', text: copy.yourInvitations });

  if (outcome !== null) {
    const headings: Record<Exclude<Outcome, null>, { heading: string; body: string }> = {
      full: { heading: copy.joinFullHeading, body: copy.joinFullBody(ownerName) },
      expired: { heading: copy.joinExpiredHeading, body: copy.joinExpiredBody(ownerName) },
      withdrawn: { heading: copy.joinWithdrawnHeading, body: '' },
      billing: { heading: copy.joinBillingHeading, body: copy.joinBillingBody },
    };
    const chosen = headings[outcome];
    renderScreen([
      el('div', { class: 'outcome' }, [
        el('h1', { class: 'display', text: chosen.heading }),
        el('p', { text: chosen.body }),
        el('a', { href: '/invitations', text: copy.backToInvitations }),
      ]),
    ]);
    return;
  }

  renderScreen([el('div', { class: 'invitations' }, [heading, list, status])]);
  void api<{ invites: Invite[] }>('GET', '/api/invites/mine')
    .then((result) => {
      clear(list);
      const pending = result.invites.filter((invite) => invite.status === 'pending');
      if (result.invites.length === 0) {
        list.append(el('p', { text: copy.noInvitations(state.person?.email ?? '') }));
        return;
      }
      for (const invite of result.invites) {
        const card = el('div', { class: 'invite-card' }, [
          el('span', { class: 'invite-workspace', text: invite.workspace_name }),
          el('span', { class: 'invite-email mono', text: invite.email }),
          el('span', { class: 'invite-status', text: invite.status }),
        ]);
        if (invite.status === 'pending') {
          const join = el('button', { type: 'button', text: copy.joinWorkspace(invite.workspace_name) });
          join.addEventListener('click', () => {
            status.textContent = copy.joining;
            void api<{ person: Person; workspace: Workspace }>('POST', `/api/invites/${invite.id}/accept`, {
              body: {},
            })
              .then((joined) => {
                onJoined(joined.workspace, joined.person);
              })
              .catch((error: unknown) => {
                if (!(error instanceof ApiCallError)) return;
                status.textContent = '';
                const map: Record<string, Outcome> = {
                  workspace_full: 'full',
                  invite_expired: 'expired',
                  invite_revoked: 'withdrawn',
                  billing_unavailable: 'billing',
                };
                const next = map[error.code] ?? null;
                if (next !== null) renderInvitations(onJoined, next, ownerName);
              });
          });
          card.append(join);
        }
        list.append(card);
      }
      if (pending.length === 0 && result.invites.length > 0) {
        list.append(el('p', { text: copy.noInvitations(state.person?.email ?? '') }));
      }
    })
    .catch(() => undefined);
}

export function renderWelcome(): void {
  renderScreen([
    el('div', { class: 'welcome' }, [
      el('h1', { class: 'display', text: copy.welcomeHeading(state.workspace?.name ?? '') }),
      el('a', { href: '/issues', text: copy.goToIssues }),
    ]),
  ]);
}
