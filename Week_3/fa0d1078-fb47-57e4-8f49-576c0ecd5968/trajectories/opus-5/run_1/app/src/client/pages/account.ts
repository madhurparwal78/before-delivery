import type { PlayerShape } from '../../shared/api';
import { M } from '../../shared/messages';
import { api, ApiFailure } from '../api';
import { announce } from '../announcer';
import { button, clear, el, text } from '../dom';
import type { PageContext } from '../main';
import { navigate, noticeFor, setPlayer } from '../main';
import { pending } from '../pending';

export type AccountKind = 'signin' | 'signup' | 'reset-request' | 'reset-confirm' | 'verify';

interface Field {
  name: string;
  label: string;
  type: string;
  input: HTMLInputElement;
  error: HTMLElement;
}

const HEADINGS: Record<AccountKind, string> = {
  signin: 'Sign in',
  signup: 'Create your account',
  'reset-request': 'Reset your password',
  'reset-confirm': 'Choose a new password',
  verify: 'Confirm your email',
};

function makeField(name: string, label: string, type: string): Field {
  const input = el('input', { type, id: `field-${name}`, name, autocomplete: 'off' });
  const error = el('p', { class: 'field-error', id: `error-${name}` });
  input.setAttribute('aria-describedby', `error-${name}`);
  return { name, label, type, input, error };
}

export async function renderAccountPage(context: PageContext, kind: AccountKind): Promise<void> {
  const { main } = context;
  main.append(text('h1', HEADINGS[kind]));
  const tile = el('div', { class: 'tile account-tile' });
  main.append(tile);

  if (kind === 'verify') {
    const sentence = el('p', { class: 'serif-sentence' }, [M.preparing]);
    tile.append(sentence);
    try {
      await api.post('/api/auth/verify', { token: context.params.token });
      sentence.textContent = M.emailConfirmed;
      announce(M.emailConfirmed);
      const me = await api.get<{ player: PlayerShape }>('/api/me').catch(() => null);
      if (me) setPlayer(me.player);
    } catch (cause) {
      const text = verifyFailure(cause);
      sentence.textContent = text;
      announce(text);
    }
    return;
  }

  const fields: Field[] = [];
  if (kind === 'signup') {
    fields.push(
      makeField('email', 'Email', 'email'),
      makeField('display_name', 'Display name', 'text'),
      makeField('password', 'Password', 'password'),
    );
  } else if (kind === 'signin') {
    fields.push(makeField('email', 'Email', 'email'), makeField('password', 'Password', 'password'));
  } else if (kind === 'reset-request') {
    fields.push(makeField('email', 'Email', 'email'));
  } else {
    fields.push(makeField('password', 'New password', 'password'));
  }

  const alert = el('div', { role: 'alert', class: 'form-alert', hidden: true });
  const notice = el('p', { class: 'notice' });
  const submitLabel =
    kind === 'signup'
      ? 'Create account'
      : kind === 'signin'
        ? 'Sign in'
        : kind === 'reset-request'
          ? 'Send reset link'
          : 'Save password';
  const submit = button(submitLabel, { class: 'primary' });
  const form = el('form', { class: 'account-form', novalidate: true });
  form.append(alert);
  for (const field of fields) {
    form.append(
      el('label', { class: 'field', for: field.input.id }, [field.label, field.input]),
      field.error,
    );
  }
  form.append(submit, notice);
  tile.append(form);

  function showFields(problems: Record<string, string>): void {
    clear(alert);
    for (const field of fields) field.error.textContent = problems[field.name] ?? '';
    const broken = fields.filter((field) => problems[field.name]);
    if (broken.length === 0) {
      alert.hidden = true;
      return;
    }
    alert.hidden = false;
    alert.append(text('h2', 'Check these details'));
    const list = el('ul');
    for (const field of broken) {
      const anchor = el('a', { href: `#${field.input.id}` }, [problems[field.name] as string]);
      anchor.addEventListener('click', (event) => {
        event.preventDefault();
        field.input.focus();
      });
      list.append(el('li', {}, [anchor]));
    }
    alert.append(list);
  }

  function valueOf(name: string): string {
    return fields.find((field) => field.name === name)?.input.value ?? '';
  }

  async function run(): Promise<void> {
    notice.textContent = '';
    try {
      if (kind === 'signup') {
        const answer = await api.post<{ player: PlayerShape; verification_sent: boolean }>(
          '/api/auth/signup',
          {
            email: valueOf('email'),
            display_name: valueOf('display_name'),
            password: valueOf('password'),
          },
        );
        showFields({});
        setPlayer(answer.player);
        if (!answer.verification_sent) {
          notice.textContent = M.signupMailDown;
          announce(M.signupMailDown);
          return;
        }
        navigate('/');
        return;
      }
      if (kind === 'signin') {
        const answer = await api.post<{ player: PlayerShape }>('/api/auth/signin', {
          email: valueOf('email'),
          password: valueOf('password'),
        });
        showFields({});
        setPlayer(answer.player);
        const next = new URLSearchParams(location.search).get('next');
        navigate(next && next.startsWith('/') ? next : '/');
        return;
      }
      if (kind === 'reset-request') {
        await api.post('/api/auth/reset', { email: valueOf('email') });
        showFields({});
        notice.textContent = M.resetSent;
        announce(M.resetSent);
        return;
      }
      const answer = await api.post<{ player: PlayerShape }>('/api/auth/reset/confirm', {
        token: context.params.token,
        password: valueOf('password'),
      });
      showFields({});
      setPlayer(answer.player);
      notice.textContent = M.passwordSaved;
      announce(M.passwordSaved);
    } catch (cause) {
      if (cause instanceof ApiFailure && cause.code === 'VALIDATION') {
        showFields(cause.fields);
        return;
      }
      const sentence =
        kind === 'reset-confirm' && cause instanceof ApiFailure
          ? resetFailure(cause)
          : noticeFor(cause);
      notice.textContent = sentence;
      announce(sentence);
    }
  }

  const pendingSentence: Record<Exclude<AccountKind, 'verify'>, string | null> = {
    signup: M.pendingSignup,
    signin: M.pendingSignin,
    'reset-request': M.pendingReset,
    'reset-confirm': null,
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void pending(submit, pendingSentence[kind], run);
  });
  submit.addEventListener('click', (event) => {
    event.preventDefault();
    void pending(submit, pendingSentence[kind], run);
  });
}

function verifyFailure(cause: unknown): string {
  if (!(cause instanceof ApiFailure)) return M.unexpected;
  switch (cause.code) {
    case 'TOKEN_USED':
      return M.verifyUsed;
    case 'TOKEN_EXPIRED':
      return M.verifyExpired;
    case 'TOKEN_NOT_FOUND':
      return M.verifyInvalid;
    default:
      return noticeFor(cause);
  }
}

function resetFailure(cause: ApiFailure): string {
  switch (cause.code) {
    case 'TOKEN_USED':
      return M.resetUsed;
    case 'TOKEN_EXPIRED':
      return M.resetExpired;
    case 'TOKEN_NOT_FOUND':
      return M.resetInvalid;
    default:
      return noticeFor(cause);
  }
}
