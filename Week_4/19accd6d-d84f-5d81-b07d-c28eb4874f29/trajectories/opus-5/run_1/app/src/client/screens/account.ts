import { api, ApiCallError } from '../api.js';
import { h } from '../dom.js';
import { fieldError, primaryButton, showFieldErrors, withBusy } from '../dialogs.js';
import type { Screen, Shell } from '../main.js';

function accountPane(title: string): {
  pane: HTMLElement;
  heading: HTMLElement;
  rows: HTMLElement;
  status: HTMLElement;
  actions: HTMLElement;
} {
  const rows = h('div', { class: 'field-rows' });
  const actions = h('div', { class: 'dialog-actions' });
  const status = h('div', {
    class: 'account-status',
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Account status',
  });
  const heading = h('h1', { class: 'pane-title-text library-heading', text: title });
  const pane = h('section', { class: 'pane centred-pane' }, [
    h('div', { class: 'pane-title' }, [heading]),
    h('div', { class: 'pane-body' }, [rows, actions, status]),
  ]);
  return { pane, heading, rows, status, actions };
}

function field(label: string, type: string, key: string): { row: HTMLElement; input: HTMLInputElement } {
  const input = h('input', { type, class: 'text-input', 'aria-label': label, autocomplete: 'off' });
  const row = h('div', { class: 'field-row' }, [
    h('span', { class: 'field-label', text: label }),
    input,
    fieldError(key),
  ]);
  return { row, input };
}

export function renderSignUp(host: HTMLElement, shell: Shell): Screen {
  const { pane, rows, status, actions } = accountPane('Create your account');
  const name = field('Display name', 'text', 'displayName');
  const email = field('Email', 'email', 'email');
  const password = field('Password', 'password', 'password');
  rows.append(name.row, email.row, password.row);
  const submit = primaryButton('Create account', () => undefined);
  submit.addEventListener(
    'click',
    withBusy(submit, async () => {
      showFieldErrors(rows, {});
      try {
        const created = await api.signup({
          displayName: name.input.value.trim(),
          email: email.input.value.trim(),
          password: password.input.value,
        });
        status.textContent = `Check your inbox. We sent a confirmation link to ${created.user.email}.`;
      } catch (cause) {
        if (!(cause instanceof ApiCallError)) throw cause;
        if (cause.failure.code === 'validation_failed') showFieldErrors(rows, cause.fields());
        status.textContent = cause.failure.message;
      }
    }),
  );
  actions.append(submit);
  const signIn = h('a', { class: 'text-link', href: '/signin', text: 'Sign in' });
  signIn.addEventListener('click', (event) => {
    event.preventDefault();
    shell.navigate('/signin');
  });
  actions.append(signIn);
  host.append(pane);
  name.input.focus();
  return {};
}

export function renderSignIn(host: HTMLElement, shell: Shell): Screen {
  const { pane, rows, status, actions } = accountPane('Sign in');
  const email = field('Email', 'email', 'email');
  const password = field('Password', 'password', 'password');
  rows.append(email.row, password.row);
  const submit = primaryButton('Sign in', () => undefined);
  submit.addEventListener(
    'click',
    withBusy(submit, async () => {
      showFieldErrors(rows, {});
      try {
        await api.signin({ email: email.input.value.trim(), password: password.input.value });
        await shell.reloadSession();
        shell.navigate('/');
      } catch (cause) {
        if (!(cause instanceof ApiCallError)) throw cause;
        if (cause.failure.code === 'validation_failed') showFieldErrors(rows, cause.fields());
        status.textContent = cause.failure.message;
      }
    }),
  );
  actions.append(submit);
  const signUp = h('a', { class: 'text-link', href: '/signup', text: 'Create account' });
  signUp.addEventListener('click', (event) => {
    event.preventDefault();
    shell.navigate('/signup');
  });
  actions.append(signUp);
  host.append(pane);
  email.input.focus();
  return {};
}

export function renderVerify(host: HTMLElement, shell: Shell, token: string): Screen {
  const { pane, status, actions } = accountPane('Confirm your account');
  const signIn = h('a', { class: 'text-link', href: '/signin', text: 'Sign in' });
  signIn.addEventListener('click', (event) => {
    event.preventDefault();
    shell.navigate('/signin');
  });
  actions.append(signIn);
  host.append(pane);
  void (async () => {
    try {
      await api.verify(token);
      status.textContent = 'Your account is confirmed. You can sign in now.';
    } catch (cause) {
      if (!(cause instanceof ApiCallError)) throw cause;
      status.textContent = 'This link is no longer valid.';
    }
  })();
  return {};
}

export function renderInvite(host: HTMLElement, shell: Shell, token: string): Screen {
  const { pane, heading, rows, status, actions } = accountPane('Join a team');
  host.append(pane);
  void (async () => {
    try {
      const read = await api.inviteDetails(token);
      const teamName = read.invite.teamName;
      heading.textContent = `Join ${teamName}`;
      rows.append(
        h('p', { class: 'muted-note', text: `${read.invite.inviterName} invited ${read.invite.email}.` }),
      );
      if (shell.session === null) {
        status.textContent = `Sign in or create an account with ${read.invite.email} to join ${teamName}.`;
        const signIn = h('a', { class: 'text-link', href: '/signin', text: 'Sign in' });
        signIn.addEventListener('click', (event) => {
          event.preventDefault();
          shell.navigate('/signin');
        });
        actions.append(signIn);
        return;
      }
      const join = primaryButton(`Join ${teamName}`, () => undefined);
      join.addEventListener(
        'click',
        withBusy(join, async () => {
          try {
            await api.acceptInvite(token);
            await shell.reloadSession();
            status.textContent = `${shell.session?.user.displayName ?? ''} joined ${teamName}.`;
            join.remove();
          } catch (cause) {
            if (!(cause instanceof ApiCallError)) throw cause;
            status.textContent =
              cause.failure.status === 404 ? 'This link is no longer valid.' : cause.failure.message;
          }
        }),
      );
      actions.append(join);
    } catch (cause) {
      if (!(cause instanceof ApiCallError)) throw cause;
      status.textContent = 'This link is no longer valid.';
    }
  })();
  return {};
}
