import { api } from '../api.js';
import { el } from '../dom.js';
import { fieldError } from '../dialog.js';
import { say } from '../status.js';
import { ERROR_COPY, UI_COPY } from '../../shared/copy.js';
import { addNotice } from '../notice.js';
import { homeRoute, setAccount } from '../runtime.js';
import { navigate } from '../router.js';
import { startLiveStream } from '../live.js';

const card = (heading: string, children: (Node | string)[]): HTMLElement =>
  el('section', { class: 'qy-auth-card qy-card' }, [el('h1', { class: 'qy-card-heading', text: heading }), ...children]);

const textField = (label: string, id: string, type = 'text', autocomplete?: string): HTMLElement => {
  const input = el('input', { id, type, class: 'qy-input', 'aria-label': label, autocomplete });
  return el('div', { class: 'qy-field' }, [el('label', { for: id, text: label }), input]);
};

const inputOf = (root: HTMLElement, id: string): HTMLInputElement =>
  root.querySelector<HTMLInputElement>(`#${id}`) as HTMLInputElement;

/** Verification reminders and mail problems both stand in the Notice band. */
export const showVerifyReminder = (email: string): void => {
  addNotice({
    id: 'verify-reminder',
    text: UI_COPY.verifyReminder(email),
    actions: [
      {
        label: 'Resend verification email',
        run: () => {
          void (async () => {
            const result = await api.resendVerification();
            if (result.ok) say(UI_COPY.verificationSent(result.value.sentTo));
            else say(result.message);
          })();
        },
      },
    ],
  });
};

export const signupPage = (main: HTMLElement, url: URL): void => {
  const form = el('form', { class: 'qy-form', novalidate: true });
  const name = textField('Name', 'signup-name', 'text', 'name');
  const email = textField('Email', 'signup-email', 'email', 'email');
  const password = textField('Password', 'signup-password', 'password', 'new-password');
  const educator = el('input', { type: 'radio', id: 'type-educator', name: 'accountType', value: 'educator' });
  const personal = el('input', { type: 'radio', id: 'type-personal', name: 'accountType', value: 'personal' });
  if (url.searchParams.get('type') === 'educator') educator.checked = true;
  else personal.checked = true;
  const group = el('fieldset', { class: 'qy-radiogroup', role: 'radiogroup', 'aria-label': 'Account type' }, [
    el('legend', { text: 'Account type' }),
    el('div', { class: 'qy-radio' }, [educator, el('label', { for: 'type-educator', text: 'Educator' })]),
    el('div', { class: 'qy-radio' }, [personal, el('label', { for: 'type-personal', text: 'Personal maker' })]),
  ]);
  const submit = el('button', { type: 'submit', class: 'qy-pill qy-pill-solid', text: 'Create account' });
  form.append(name, email, password, group, submit);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      const nameInput = inputOf(form, 'signup-name');
      const emailInput = inputOf(form, 'signup-email');
      const passwordInput = inputOf(form, 'signup-password');
      for (const input of [nameInput, emailInput, passwordInput]) fieldError(input, null);
      const result = await api.signup({
        displayName: nameInput.value,
        email: emailInput.value,
        password: passwordInput.value,
        accountType: educator.checked ? 'educator' : 'personal',
      });
      if (!result.ok) {
        if (result.code === 'email_taken') {
          fieldError(emailInput, result.message);
          say(result.message);
          return;
        }
        const fields: [HTMLElement, string | undefined][] = [
          [nameInput, result.fields?.displayName],
          [emailInput, result.fields?.email],
          [passwordInput, result.fields?.password],
        ];
        const announced: string[] = [];
        for (const [input, copy] of fields) {
          if (!copy) continue;
          fieldError(input, copy);
          announced.push(copy);
        }
        for (const copy of announced) say(copy);
        if (announced.length === 0) say(result.message);
        return;
      }
      setAccount(result.value.account);
      startLiveStream();
      if (!result.value.verificationEmailSent) {
        addNotice({ id: 'mail-unavailable', text: ERROR_COPY.mail_unavailable });
      } else {
        say(UI_COPY.verificationSent(result.value.account.email ?? ''));
      }
      navigate(homeRoute());
    })();
  });

  main.append(
    el('div', { class: 'qy-centre' }, [
      card('Create your Quarkyard account', [
        el('p', { class: 'qy-muted', text: 'Educators run classrooms. Personal makers design at home.' }),
        form,
        el('p', { class: 'qy-muted' }, [
          document.createTextNode('Already have an account? '),
          el('a', { href: '/signin', class: 'qy-link', text: 'Sign in' }),
        ]),
      ]),
    ]),
  );
};

export const signinPage = (main: HTMLElement): void => {
  const form = el('form', { class: 'qy-form', novalidate: true });
  form.append(
    textField('Email', 'signin-email', 'email', 'email'),
    textField('Password', 'signin-password', 'password', 'current-password'),
    el('button', { type: 'submit', class: 'qy-pill qy-pill-solid', text: 'Sign in' }),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      const result = await api.signin({
        email: inputOf(form, 'signin-email').value,
        password: inputOf(form, 'signin-password').value,
      });
      if (!result.ok) {
        say(result.message);
        return;
      }
      setAccount(result.value.account);
      startLiveStream();
      if (!result.value.account.emailVerified && result.value.account.email) {
        showVerifyReminder(result.value.account.email);
      }
      navigate(homeRoute());
    })();
  });
  main.append(
    el('div', { class: 'qy-centre' }, [
      card('Sign in', [
        form,
        el('p', { class: 'qy-muted' }, [
          document.createTextNode('Joining a class? '),
          el('a', { href: '/join', class: 'qy-link', text: 'Join a class' }),
        ]),
      ]),
    ]),
  );
};

export const verifyPage = async (main: HTMLElement, url: URL): Promise<void> => {
  const token = url.searchParams.get('token') ?? '';
  const result = await api.verify(token);
  const heading = result.ok ? UI_COPY.verifySucceeded : result.message;
  if (result.ok) {
    setAccount(result.value.account);
    say(UI_COPY.verifySucceeded);
  } else {
    say(result.message);
  }
  main.append(
    el('div', { class: 'qy-centre' }, [
      card(heading, [el('a', { href: homeRoute(), class: 'qy-pill qy-pill-solid', text: 'Go to your home page' })]),
    ]),
  );
};
