import type { InviteView } from '../../shared/types.js';
import {
  ApiFailure,
  announce,
  api,
  busy,
  clear,
  el,
  failureMessage,
  navigate,
  showAlert,
  state,
} from '../core.js';
import { clearFieldErrors, fieldError, labelledField } from '../dialogs.js';
import { fernPrint, lampPrint, mothPrint } from '../prints.js';
import type { RouteContext, View } from '../view.js';

export function landingView({ main }: RouteContext): View {
  main.className = 'landing';
  clear(main);
  const hero = el('div', { class: 'hero' });
  const bar = el('div', { class: 'hero-bar' });
  bar.append(el('p', { class: 'wordmark', text: 'MOTHLIGHT' }));
  bar.append(
    el(
      'div',
      { class: 'hero-links' },
      el('a', { href: '/signin', text: 'Sign in' }),
      el('a', { href: '/signup', text: 'Sign up' }),
    ),
  );
  bar.append(el('a', { class: 'hero-cta', href: '/signin', text: 'Save a pin' }));
  const heading = el('h1', { class: 'hero-heading' });
  heading.append(
    document.createTextNode('Keep what you find.'),
    el('br'),
    document.createTextNode('Leave the rest in the dark.'),
  );
  const prints = el('div', { class: 'hero-prints' });
  const large = el('div', { class: 'hero-print-large' });
  large.append(mothPrint());
  const small = el('div', { class: 'hero-print-small' });
  small.append(fernPrint());
  prints.append(large, small);
  hero.append(
    bar,
    prints,
    heading,
    el('p', {
      class: 'hero-sentence',
      text: 'Every pin keeps its source, its alt text and its credit.',
    }),
    el('p', { class: 'hero-closing', text: 'KEEP THE SOURCE. KEEP THE CREDIT.' }),
  );
  main.append(hero);
  return {};
}

export function signUpView({ main }: RouteContext): View {
  main.className = 'single-column';
  clear(main);
  const form = el('form', { class: 'auth-form', novalidate: true });
  const name = el('input', { type: 'text', 'aria-label': 'Name', autocomplete: 'name' });
  const email = el('input', { type: 'email', 'aria-label': 'Email', autocomplete: 'email' });
  const handle = el('input', { type: 'text', 'aria-label': 'Handle' });
  const password = el('input', {
    type: 'password',
    'aria-label': 'Password',
    autocomplete: 'new-password',
  });
  const submit = el('button', { type: 'submit', class: 'primary', text: 'Create account' });
  form.append(
    el('h1', { text: 'Sign up' }),
    labelledField('Name', name),
    labelledField('Email', email),
    labelledField('Handle', handle),
    labelledField('Password', password),
    submit,
  );

  const codeStep = (address: string): void => {
    clear(main);
    const panel = el('div', { class: 'auth-form' });
    const code = el('input', { type: 'text', 'aria-label': 'Code', inputmode: 'numeric' });
    const confirm = el('button', { type: 'button', class: 'primary', text: 'Confirm' });
    confirm.addEventListener('click', () => {
      clearFieldErrors(panel);
      void busy(confirm, 'Confirming', async () => {
        try {
          const result = await api.post<{ user: { id: number; name: string; handle: string } }>(
            '/api/accounts/confirm',
            { email: address, code: code.value },
          );
          state.user = { ...result.user, email: address };
          navigate('/');
        } catch (error) {
          if (error instanceof ApiFailure && error.field === 'code') {
            fieldError(code, "That code doesn't match.");
          } else {
            showAlert(failureMessage(error));
          }
        }
      });
    });
    panel.append(
      el('h1', { text: 'Check your email' }),
      el('p', { text: `We sent a code to ${address}.` }),
      labelledField('Code', code),
      confirm,
    );
    main.append(panel);
    code.focus();
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    void busy(submit, 'Creating account', async () => {
      try {
        await api.post('/api/accounts', {
          email: email.value,
          password: password.value,
          name: name.value,
          handle: handle.value,
        });
        codeStep(email.value.trim());
      } catch (error) {
        if (error instanceof ApiFailure && error.code === 'handle_taken') {
          fieldError(handle, 'That handle is taken.');
        } else if (error instanceof ApiFailure && error.field === 'email') {
          fieldError(email, 'Enter a valid email address.');
        } else if (error instanceof ApiFailure && error.field === 'password') {
          fieldError(password, 'Use at least 8 characters.');
        } else if (error instanceof ApiFailure && error.field === 'handle') {
          fieldError(handle, 'Use 3 to 20 lowercase letters, digits or underscores.');
        } else if (error instanceof ApiFailure && error.field === 'name') {
          fieldError(name, 'Add your name.');
        } else {
          showAlert(failureMessage(error));
        }
      }
    });
  });

  main.append(form);
  name.focus();
  return {};
}

export function signInView({ main, url }: RouteContext): View {
  main.className = 'single-column';
  clear(main);
  const form = el('form', { class: 'auth-form', novalidate: true });
  const email = el('input', { type: 'email', 'aria-label': 'Email', autocomplete: 'email' });
  const password = el('input', {
    type: 'password',
    'aria-label': 'Password',
    autocomplete: 'current-password',
  });
  const submit = el('button', { type: 'submit', class: 'primary', text: 'Sign in' });
  form.append(
    el('h1', { text: 'Sign in' }),
    labelledField('Email', email),
    labelledField('Password', password),
    submit,
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    void busy(submit, 'Signing in', async () => {
      try {
        const result = await api.post<{
          user: { id: number; name: string; handle: string; email: string };
        }>('/api/session', { email: email.value, password: password.value });
        state.user = result.user;
        navigate(url.searchParams.get('next') ?? '/');
      } catch {
        showAlert("That email and password don't match.");
      }
    });
  });
  main.append(form);
  email.focus();
  return {};
}

export function inviteView({ main, params }: RouteContext): View {
  main.className = 'single-column';
  clear(main);
  const panel = el('div', { class: 'auth-form' });
  main.append(panel);
  const token = params.token;

  const show = async (): Promise<void> => {
    clear(panel);
    let invite: InviteView;
    try {
      invite = await api.get<InviteView>(`/api/invites/${encodeURIComponent(token)}`);
    } catch {
      panel.append(el('h1', { text: 'Invite' }), el('p', { text: "This invite link isn't valid." }));
      panel.append(lampPrint());
      return;
    }
    panel.append(el('h1', { text: `Join ${invite.board.name}` }));
    panel.append(
      el('p', {
        text: `${invite.inviter.name} invited you as ${invite.role === 'editor' ? 'Editor' : 'Viewer'}.`,
      }),
    );
    if (invite.status === 'expired') {
      panel.append(el('p', { text: 'This invite has expired.' }));
      return;
    }
    if (invite.status === 'accepted') {
      panel.append(el('p', { text: 'This invite has already been used.' }));
      return;
    }
    if (invite.status === 'revoked') {
      panel.append(el('p', { text: 'This invite was withdrawn.' }));
      return;
    }
    if (!state.user) {
      const next = `/invites/${encodeURIComponent(token)}`;
      panel.append(
        el(
          'div',
          { class: 'row' },
          el('a', { href: `/signin?next=${encodeURIComponent(next)}`, text: 'Sign in' }),
          el('a', { href: `/signup?next=${encodeURIComponent(next)}`, text: 'Sign up' }),
        ),
      );
      return;
    }
    const join = el('button', { type: 'button', class: 'primary', text: 'Join board' });
    join.addEventListener('click', () => {
      void busy(join, 'Joining', async () => {
        try {
          const result = await api.post<{ board_id: number }>(
            `/api/invites/${encodeURIComponent(token)}/accept`,
          );
          announce(`You joined ${invite.board.name}`);
          navigate(`/b/${result.board_id}`);
        } catch (error) {
          if (error instanceof ApiFailure && error.code === 'invite_expired') {
            showAlert('This invite has expired.');
          } else if (error instanceof ApiFailure && error.code === 'invite_used') {
            showAlert('This invite has already been used.');
          } else if (error instanceof ApiFailure && error.code === 'invite_revoked') {
            showAlert('This invite was withdrawn.');
          } else if (error instanceof ApiFailure && error.status === 403) {
            showAlert('This invite is for another email address.');
          } else {
            showAlert(failureMessage(error));
          }
        }
      });
    });
    panel.append(join);
    join.focus();
  };

  void show();
  return {};
}

export function notFoundView(
  { main }: RouteContext,
  heading: 'Board not found' | 'Pin not found' | 'Page not found',
): View {
  main.className = 'single-column';
  clear(main);
  const panel = el('div', { class: 'empty-state' });
  panel.append(lampPrint());
  panel.append(el('h1', { text: heading }));
  main.append(panel);
  return {};
}
