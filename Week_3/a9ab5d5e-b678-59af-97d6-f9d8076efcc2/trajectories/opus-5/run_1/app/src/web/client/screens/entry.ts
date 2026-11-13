import { ApiFailure, api, loadIdentity, setToken } from '../api';
import { Screen, keepDialog, navigate, safeNext, say, takeKeptDialog } from '../app';
import { el, fieldError, isPending, labelled, pendingButton, textbox } from '../dom';

function heroFields(): HTMLElement {
  return el('div', { class: 'hero-fields', 'aria-hidden': 'true' }, [
    el('div', { class: 'field-mint' }),
    el('div', { class: 'field-pink' }),
  ]);
}

export function signInScreen(): Screen {
  return {
    mount(main: HTMLElement): void {
      const email = textbox('Email');
      const password = el('input', { type: 'password', 'aria-label': 'Password', autocomplete: 'current-password' });
      const submit = el('button', { type: 'submit', class: 'pill', text: 'Sign in' });
      const startLink = el('a', { href: '/start', class: 'plain-link', text: 'Start a household' });
      startLink.addEventListener('click', (event) => {
        event.preventDefault();
        navigate('/start');
      });
      const form = el('form', { class: 'card sign-in-card' }, [
        labelled('Email', email),
        labelled('Password', password),
        submit,
        startLink,
      ]);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (isPending(submit)) return;
        void signIn();
      });
      main.append(
        el('section', { class: 'hero' }, [
          heroFields(),
          el('h1', { class: 'hero-headline', text: 'Two houses. One plan.' }),
          form,
        ]),
      );
      email.focus();

      async function signIn(): Promise<void> {
        fieldError(email, null);
        fieldError(password, null);
        const kept = takeKeptDialog();
        pendingButton(submit, true, 'Signing in...');
        try {
          const result = await api<{ userId: string; role: string; token: string }>('POST', '/api/session', {
            json: { email: email.value, password: password.value },
          });
          setToken(result.data.token);
          const me = await loadIdentity();
          const next = safeNext(new URL(window.location.href).searchParams.get('next'));
          if (kept && me) {
            keepDialog(kept);
            say('You were signed out. Your entries are still here. Check them and send again.');
          }
          navigate(next ?? '/calendar', { replace: true });
        } catch (error) {
          if (kept) keepDialog(kept);
          if (error instanceof ApiFailure) {
            if (error.code === 'too_many_attempts') {
              say(`Too many tries. Try again in ${error.retryAfter ?? 1} seconds.`);
            } else if (error.code === 'invalid_credentials') {
              fieldError(password, "That email and password don't match.");
              say("That email and password don't match.");
            } else {
              const field = error.firstFieldError;
              if (field) {
                fieldError(field.field === 'email' ? email : password, field.message);
                say(field.message);
              } else {
                say(error.problem.title);
              }
            }
          }
        } finally {
          pendingButton(submit, false, '');
        }
      }
    },
  };
}

export function startScreen(): Screen {
  return {
    mount(main: HTMLElement): void {
      const householdName = textbox('Household name');
      const currency = textbox('Currency');
      const yourName = textbox('Your name');
      const yourEmail = textbox('Your email');
      const password = el('input', { type: 'password', 'aria-label': 'Password', autocomplete: 'new-password' });
      const otherName = textbox("Other parent's name");
      const otherEmail = textbox("Other parent's email");
      const submit = el('button', { type: 'submit', class: 'pill', text: 'Create household' });
      const controls: [HTMLElement, string][] = [
        [householdName, 'householdName'],
        [currency, 'currency'],
        [yourName, 'yourName'],
        [yourEmail, 'email'],
        [password, 'password'],
        [otherName, 'otherParentName'],
        [otherEmail, 'otherParentEmail'],
      ];
      const form = el('form', { class: 'card start-card' }, [
        el('h1', { class: 'page-headline', text: 'Start a household' }),
        labelled('Household name', householdName),
        labelled('Currency', currency),
        labelled('Your name', yourName),
        labelled('Your email', yourEmail),
        labelled('Password', password),
        labelled("Other parent's name", otherName),
        labelled("Other parent's email", otherEmail),
        submit,
      ]);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (isPending(submit)) return;
        void create();
      });
      main.append(el('section', { class: 'single-column' }, [form]));
      householdName.focus();

      async function create(): Promise<void> {
        for (const [control] of controls) fieldError(control, null);
        pendingButton(submit, true, 'Creating...');
        try {
          const result = await api<{ householdId: string; token: string }>('POST', '/api/households', {
            json: {
              householdName: householdName.value,
              currency: currency.value,
              yourName: yourName.value,
              email: yourEmail.value,
              password: password.value,
              otherParentName: otherName.value,
              otherParentEmail: otherEmail.value,
            },
          });
          setToken(result.data.token);
          await loadIdentity();
          navigate('/plan', { replace: true });
          say('Household created. Enter your plan.');
        } catch (error) {
          if (error instanceof ApiFailure) {
            if (error.code === 'email_taken') {
              fieldError(yourEmail, 'That email address is already in use.');
              say('That email address is already in use.');
            } else {
              const field = error.firstFieldError;
              if (field) {
                const control = controls.find(([, name]) => name === field.field);
                if (control) {
                  fieldError(control[0], field.message);
                  control[0].focus();
                }
                say(field.message);
              } else {
                say(error.problem.title);
              }
            }
          }
        } finally {
          pendingButton(submit, false, '');
        }
      }
    },
  };
}

export function joinScreen(params: Record<string, string>): Screen {
  return {
    async mount(main: HTMLElement): Promise<void> {
      const inviteToken = params.token as string;
      let invite: { householdName: string; otherParentName: string };
      try {
        invite = (
          await api<{ householdName: string; otherParentName: string }>('GET', `/api/join/${inviteToken}`)
        ).data;
      } catch {
        main.append(deadLinkCard());
        return;
      }
      const password = el('input', { type: 'password', 'aria-label': 'Password', autocomplete: 'new-password' });
      const submit = el('button', { type: 'submit', class: 'pill', text: 'Join household' });
      const form = el('form', { class: 'card' }, [
        el('h1', { class: 'page-headline', text: `Join ${invite.householdName}` }),
        el('p', { text: invite.otherParentName }),
        labelled('Password', password),
        submit,
      ]);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (isPending(submit)) return;
        void join();
      });
      main.append(el('section', { class: 'single-column' }, [form]));
      password.focus();

      async function join(): Promise<void> {
        fieldError(password, null);
        pendingButton(submit, true, 'Joining...');
        try {
          const result = await api<{ token: string }>('POST', '/api/join', {
            json: { token: inviteToken, password: password.value },
          });
          setToken(result.data.token);
          await loadIdentity();
          navigate('/calendar', { replace: true });
        } catch (error) {
          if (error instanceof ApiFailure) {
            if (error.code === 'not_found') {
              main.replaceChildren(deadLinkCard());
              return;
            }
            const field = error.firstFieldError;
            if (field) {
              fieldError(password, field.message);
              password.focus();
              say(field.message);
            } else {
              say(error.problem.title);
            }
          }
        } finally {
          pendingButton(submit, false, '');
        }
      }
    },
  };
}

export function deadLinkCard(): HTMLElement {
  return el('section', { class: 'single-column' }, [
    el('div', { class: 'card' }, [el('h1', { class: 'page-headline', text: 'This link no longer works.' })]),
  ]);
}

export function notFoundScreen(): Screen {
  return {
    mount(main: HTMLElement): void {
      main.append(
        el('section', { class: 'single-column' }, [
          el('div', { class: 'card' }, [el('h1', { class: 'page-headline', text: "We couldn't find that page." })]),
        ]),
      );
    },
  };
}
