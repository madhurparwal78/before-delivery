import { api, RequestFailed } from '../api.js';
import { button, field, h, region } from '../dom.js';
import { PENDING_COPY, SUCCESS_COPY, feedback } from '../feedback.js';
import type { Account, Shell } from '../shell.js';

interface Draft {
  email: string;
  playerName: string;
  password: string;
}

const draft: Draft = { email: '', playerName: '', password: '' };

export function renderAccount(shell: Shell): void {
  const emailField = field('Email', 'email', draft.email, (value) => {
    draft.email = value;
  });
  const nameField = field('Player name', 'text', draft.playerName, (value) => {
    draft.playerName = value;
  });
  const passwordField = field('Password', 'password', draft.password, (value) => {
    draft.password = value;
  });

  const showFieldErrors = (fields: Record<string, string>): void => {
    for (const [path, element] of [
      ['email', emailField.error],
      ['playerName', nameField.error],
      ['password', passwordField.error],
    ] as [string, HTMLElement][]) {
      const message = fields[path];
      element.hidden = message === undefined;
      element.textContent = message === undefined ? '' : `${path}: ${message}`;
    }
  };

  const createButton = button('Create account', async () => {
    createButton.disabled = true;
    feedback.pending(PENDING_COPY.createAccount);
    try {
      const response = await api.post<{ account: Account }>('/api/accounts', {
        email: draft.email,
        password: draft.password,
        playerName: draft.playerName,
      });
      shell.state.account = response.account;
      feedback.succeed(SUCCESS_COPY.createAccount);
      showFieldErrors({});
      shell.navigate('Campaign');
    } catch (error) {
      showFieldErrors(feedback.fail(error));
      createButton.disabled = false;
    }
  });

  const signInButton = button('Sign in', async () => {
    signInButton.disabled = true;
    feedback.pending(PENDING_COPY.signIn);
    try {
      const response = await api.post<{ account: Account }>('/api/session', {
        email: draft.email,
        password: draft.password,
      });
      shell.state.account = response.account;
      feedback.succeed(SUCCESS_COPY.signIn);
      showFieldErrors({});
      shell.navigate('Campaign');
    } catch (error) {
      showFieldErrors(feedback.fail(error));
      signInButton.disabled = false;
    }
  });

  const signOutButton = button('Sign out', async () => {
    signOutButton.disabled = true;
    feedback.pending(PENDING_COPY.signOut);
    try {
      await api.remove('/api/session');
      shell.state.account = null;
      shell.state.campaign = null;
      shell.state.progress = null;
      feedback.succeed(SUCCESS_COPY.signOut);
      shell.render();
    } catch (error) {
      feedback.fail(error);
      signOutButton.disabled = false;
    }
  });
  signOutButton.disabled = shell.state.account === null;

  shell.main.append(
    region('Account access', 'panel paper', [
      h('h2', {}, ['Account']),
      h('p', {}, ['Create a keeper account or sign back in to reach verified harbour records.']),
      emailField.wrapper,
      nameField.wrapper,
      passwordField.wrapper,
      h('div', { class: 'actions-row' }, [createButton, signInButton, signOutButton]),
    ]),
  );
}

export async function restoreSession(shell: Shell): Promise<void> {
  try {
    const response = await api.get<{ account: Account }>('/api/session');
    shell.state.account = response.account;
  } catch (error) {
    if (!(error instanceof RequestFailed)) throw error;
    shell.state.account = null;
  }
}
