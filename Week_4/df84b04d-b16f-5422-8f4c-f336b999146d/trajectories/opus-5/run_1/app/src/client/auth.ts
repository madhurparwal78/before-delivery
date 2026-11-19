import { alerts, announce as say, fixed } from '../shared/copy.js';
import { api, failureOf } from './api.js';
import { clear, el, icon } from './dom.js';
import { alertNow, announce } from './regions.js';

interface Field {
  wrapper: HTMLElement;
  input: HTMLInputElement;
  error: HTMLElement;
}

function field(label: string, type: string, name: string): Field {
  const id = `field-${name}`;
  const input = el('input', { id, type, name, class: 'input', autocomplete: 'off' });
  const error = el('p', { class: 'field-error', id: `${id}-error` });
  const wrapper = el('div', { class: 'field' }, [
    el('label', { for: id }, [label]),
    input,
    error
  ]);
  return { wrapper, input, error };
}

function showErrors(fields: Record<string, Field>, errors: Record<string, string>): void {
  for (const [name, entry] of Object.entries(fields)) {
    const message = errors[name];
    entry.error.textContent = message ?? '';
    entry.input.setAttribute('aria-invalid', message === undefined ? 'false' : 'true');
  }
}

function pending(button: HTMLButtonElement, label: string, busy: boolean): void {
  button.disabled = busy;
  if (busy) {
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Sending';
  } else {
    button.removeAttribute('aria-busy');
    button.textContent = label;
  }
}

function card(title: string, children: HTMLElement[]): HTMLElement {
  return el('main', { class: 'band band-pale auth-band' }, [
    el('div', { class: 'auth-card card' }, [el('h1', {}, [title]), ...children])
  ]);
}

function authTopBar(): HTMLElement {
  return el('header', { class: 'top-bar' }, [
    el('div', { class: 'top-bar-inner' }, [
      el('a', { class: 'brand', href: '/' }, [
        el('span', { class: 'brand-mark', 'aria-hidden': 'true' }, [
          icon('M12 21V8m0 0L7 4m5 4 5-4M12 14l-4-3m4 3 4-3')
        ]),
        el('span', { class: 'wordmark' }, ['Twigline'])
      ])
    ])
  ]);
}

export function renderSignUp(
  root: HTMLElement,
  go: (path: string) => void,
  prefill: string
): void {
  clear(root);
  const name = field('Name', 'text', 'name');
  const email = field('Email', 'email', 'email');
  const password = field('Password', 'password', 'password');
  const send = el('button', { type: 'submit', class: 'pill pill-accent wide' }, ['Send code']);
  const stepOne = el('form', { class: 'auth-form', novalidate: true }, [
    name.wrapper,
    email.wrapper,
    password.wrapper,
    send
  ]);

  const code = field('Confirmation code', 'text', 'code');
  const confirm = el('button', { type: 'submit', class: 'pill pill-accent wide' }, ['Confirm']);
  const again = el('button', { type: 'button', class: 'pill pill-outline wide' }, ['Send a new code']);
  const stepTwo = el('form', { class: 'auth-form', novalidate: true }, [code.wrapper, confirm, again]);
  const sentNote = el('p', { class: 'muted' });

  const container = card('Start your outline', [
    el('p', { class: 'muted' }, ['One outline, one code by email.']),
    stepOne,
    el('p', { class: 'muted' }, [
      'Already have an outline? ',
      el('a', { class: 'accent-link', href: '/signin' }, ['Sign in'])
    ])
  ]);
  root.append(authTopBar(), container);

  const askForCode = async (): Promise<void> => {
    showErrors({ name, email, password }, {});
    pending(send, 'Send code', true);
    try {
      await api.signUp(name.input.value, email.input.value, password.input.value);
      const address = email.input.value.trim().toLowerCase();
      announce(say.codeSent(address));
      sentNote.textContent = say.codeSent(address);
      const card = container.querySelector('.auth-card')!;
      clear(card);
      card.append(el('h1', {}, ['Enter your code']), sentNote, stepTwo);
      code.input.focus();
    } catch (error) {
      const failure = failureOf(error);
      if (failure?.errors !== undefined) showErrors({ name, email, password }, failure.errors);
      if (failure?.error === 'mail_unavailable') alertNow(alerts.codeNotSent);
    } finally {
      pending(send, 'Send code', false);
    }
  };

  stepOne.addEventListener('submit', (event) => {
    event.preventDefault();
    void askForCode();
  });

  again.addEventListener('click', () => {
    void (async () => {
      pending(again, 'Send a new code', true);
      try {
        await api.signUp(name.input.value, email.input.value, password.input.value);
        announce(say.codeSent(email.input.value.trim().toLowerCase()));
      } catch (error) {
        if (failureOf(error)?.error === 'mail_unavailable') alertNow(alerts.codeNotSent);
      } finally {
        pending(again, 'Send a new code', false);
      }
    })();
  });

  stepTwo.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      showErrors({ code }, {});
      try {
        await api.confirm(email.input.value, code.input.value);
        go('/');
      } catch (error) {
        const failure = failureOf(error);
        if (failure?.errors !== undefined) showErrors({ code }, failure.errors);
      }
    })();
  });

  email.input.value = prefill;
  name.input.focus();
}

export function renderSignIn(
  root: HTMLElement,
  go: (path: string) => void,
  next: string,
  prefill: string
): void {
  clear(root);
  const email = field('Email', 'email', 'email');
  const password = field('Password', 'password', 'password');
  const submit = el('button', { type: 'submit', class: 'pill pill-accent wide' }, ['Sign in']);
  const form = el('form', { class: 'auth-form', novalidate: true }, [
    email.wrapper,
    password.wrapper,
    submit
  ]);
  root.append(
    authTopBar(),
    card('Sign in', [
      form,
      el('p', { class: 'muted' }, [el('a', { class: 'accent-link', href: '/signup' }, ['Create an account'])])
    ])
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      try {
        await api.signIn(email.input.value, password.input.value);
        go(next);
      } catch {
        alertNow(alerts.signInFailed);
      }
    })();
  });
  email.input.value = prefill;
  email.input.focus();
}

export interface InvitationView {
  token: string;
  signedInEmail: string | null;
}

export function renderInvitation(
  root: HTMLElement,
  view: InvitationView,
  go: (path: string) => void,
  notFoundPage: () => void
): void {
  clear(root);
  root.append(authTopBar());
  const holder = el('main', { class: 'band band-pale auth-band' });
  root.append(holder);
  void (async () => {
    let invitation;
    try {
      invitation = await api.invitation(view.token);
    } catch {
      notFoundPage();
      return;
    }
    const children: HTMLElement[] = [
      el('p', { class: 'muted' }, [
        `${invitation.inviter.name} shared the branch ${invitation.bulletText} with you.`
      ])
    ];
    if (invitation.status === 'lapsed') {
      children.push(el('p', { class: 'muted' }, [fixed.inviteLapsed]));
    } else if (view.signedInEmail === null) {
      children.push(
        el('p', { class: 'muted' }, [fixed.inviteSignedOut(invitation.email)]),
        el('div', { class: 'invite-actions' }, [
          el('a', { class: 'pill pill-accent', href: `/signin?next=/invite/${view.token}&email=${encodeURIComponent(invitation.email)}` }, ['Sign in']),
          el('a', { class: 'pill pill-outline', href: `/signup?next=/invite/${view.token}&email=${encodeURIComponent(invitation.email)}` }, [
            'Create an account'
          ])
        ])
      );
    } else if (view.signedInEmail !== invitation.email) {
      children.push(el('p', { class: 'muted' }, [fixed.inviteWrongAccount]));
    } else {
      const accept = el('button', { type: 'button', class: 'pill pill-accent wide' }, [
        'Accept invitation'
      ]);
      accept.addEventListener('click', () => {
        void (async () => {
          try {
            const result = await api.acceptInvitation(view.token);
            announce(say.invitationAccepted(invitation.bulletText));
            go(`/b/${result.bulletId}`);
          } catch (error) {
            const failure = failureOf(error);
            if (failure?.message !== undefined) alertNow(failure.message);
          }
        })();
      });
      children.push(accept);
    }
    clear(holder);
    holder.append(el('div', { class: 'auth-card card' }, [el('h1', {}, ['Branch invitation']), ...children]));
  })();
}
