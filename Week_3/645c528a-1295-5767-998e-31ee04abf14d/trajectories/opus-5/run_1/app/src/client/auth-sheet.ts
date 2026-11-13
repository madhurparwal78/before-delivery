import { AUTH_COPY } from '../shared/copy.js';
import { api } from './api.js';
import { attachDialogKeys, el, focusableIn, labelledButton } from './dom.js';
import { refreshMe } from './state.js';

interface SheetOptions {
  opener: HTMLElement | null;
  onSuccess: () => void;
  onClose?: () => void;
}

const MOTION_MS = 330;

function mountSheet(options: {
  name: string;
  opener: HTMLElement | null;
  onClosed?: () => void;
  build: (close: () => void) => (Node | string)[];
}): { element: HTMLElement; close: () => void } {
  for (const stale of document.querySelectorAll('.backdrop.closing')) stale.remove();
  const sheet = el('div', {
    className: 'dialog sheet',
    attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': options.name },
  });
  const backdrop = el('div', { className: 'backdrop', children: [sheet] });
  const close = (): void => {
    detach();
    backdrop.classList.add('closing');
    backdrop.setAttribute('aria-hidden', 'true');
    backdrop.setAttribute('inert', '');
    const delay = document.documentElement.classList.contains('reduced-motion') ? 0 : MOTION_MS;
    window.setTimeout(() => backdrop.remove(), delay);
    if (options.opener && document.contains(options.opener)) options.opener.focus();
    options.onClosed?.();
  };
  let detach = (): void => undefined;
  sheet.append(...options.build(close));
  document.body.append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('open'));
  detach = attachDialogKeys(sheet, { onEscape: close });
  focusableIn(sheet)[0]?.focus();
  return { element: sheet, close };
}

function field(options: { label: string; type: string; inputMode?: string }): { row: HTMLElement; input: HTMLInputElement; error: HTMLElement } {
  const id = `field-${options.label.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  const input = el('input', {
    id,
    className: 'text-input',
    attrs: { type: options.type, ...(options.inputMode ? { inputmode: options.inputMode } : {}) },
  });
  const error = el('p', { className: 'field-error' });
  error.hidden = true;
  const row = el('div', {
    className: 'field-row',
    children: [el('label', { text: options.label, attrs: { for: id } }), input, error],
  });
  return { row, input, error };
}

export function openSignUpSheet(options: SheetOptions): void {
  const email = field({ label: 'Email', type: 'email' });
  const password = field({ label: 'Password', type: 'password' });
  const displayName = field({ label: 'Display name', type: 'text' });
  const birthYear = field({ label: 'Year of birth', type: 'text', inputMode: 'numeric' });
  const summary = el('div', { className: 'error-summary', attrs: { role: 'alert', 'aria-label': 'Check these fields', tabindex: '-1' } });
  summary.hidden = true;
  const notice = el('p', { className: 'notice', attrs: { role: 'status', 'aria-live': 'polite' } });
  const ageNote = el('p', { className: 'notice age-note' });

  birthYear.input.addEventListener('input', () => {
    const year = Number.parseInt(birthYear.input.value, 10);
    const currentYear = new Date().getUTCFullYear();
    if (!Number.isInteger(year) || birthYear.input.value.length !== 4) {
      ageNote.textContent = '';
      return;
    }
    const age = currentYear - year;
    ageNote.textContent = age < 13 ? AUTH_COPY.underAge : age < 18 ? AUTH_COPY.minorNote : '';
  });

  let succeeded = false;
  const sheet = mountSheet({
    name: 'Create your account',
    opener: options.opener,
    onClosed: () => {
      if (!succeeded) options.onClose?.();
    },
    build: (close) => {
      const submit = labelledButton('Create account', () => void send(), { className: 'button primary' });
      const switchButton = labelledButton(
        'Sign in instead',
        () => {
          succeeded = true;
          close();
          openSignInSheet(options);
        },
        { className: 'button' },
      );
      const closeButton = labelledButton('Close', close, { className: 'button quiet' });

      const send = async (): Promise<void> => {
        summary.hidden = true;
        while (summary.firstChild) summary.firstChild.remove();
        for (const entry of [email, password, displayName, birthYear]) {
          entry.error.hidden = true;
          entry.error.textContent = '';
          entry.input.removeAttribute('aria-invalid');
        }
        submit.disabled = true;
        notice.textContent = AUTH_COPY.pending;
        const result = await api<{ id: string }>('POST', '/api/auth/signup', {
          email: email.input.value.trim(),
          password: password.input.value,
          displayName: displayName.input.value.trim(),
          birthYear: Number.parseInt(birthYear.input.value, 10),
        });
        submit.disabled = false;
        submit.focus();
        notice.textContent = '';
        if (result.ok) {
          succeeded = true;
          await refreshMe();
          close();
          options.onSuccess();
          return;
        }
        const failure = result.failure;
        if (failure.status === 422 && failure.errors) {
          const entries: [string, { input: HTMLInputElement; error: HTMLElement }][] = [
            ['email', email],
            ['password', password],
            ['displayName', displayName],
            ['birthYear', birthYear],
          ];
          for (const [key, entry] of entries) {
            const message = failure.errors[key];
            if (!message) continue;
            entry.error.hidden = false;
            entry.error.textContent = message;
            entry.input.setAttribute('aria-invalid', 'true');
            const link = el('a', { className: 'summary-link', text: message, attrs: { href: `#${entry.input.id}` } });
            link.addEventListener('click', (event) => {
              event.preventDefault();
              entry.input.focus();
            });
            summary.append(link);
          }
          summary.hidden = false;
          summary.focus();
          return;
        }
        notice.textContent = failure.message;
      };

      return [
        el('h2', { text: 'Create your account' }),
        summary,
        email.row,
        password.row,
        displayName.row,
        birthYear.row,
        ageNote,
        notice,
        el('div', { className: 'button-row', children: [submit, switchButton, closeButton] }),
      ];
    },
  });
  void sheet;
}

export function openSignInSheet(options: SheetOptions): void {
  const email = field({ label: 'Email', type: 'email' });
  const password = field({ label: 'Password', type: 'password' });
  const notice = el('p', { className: 'notice', attrs: { role: 'status', 'aria-live': 'polite' } });

  let signedIn = false;
  mountSheet({
    name: 'Sign in',
    opener: options.opener,
    onClosed: () => {
      if (!signedIn) options.onClose?.();
    },
    build: (close) => {
      const submit = labelledButton('Sign in', () => void send(), { className: 'button primary' });
      const switchButton = labelledButton(
        'Create an account instead',
        () => {
          signedIn = true;
          close();
          openSignUpSheet(options);
        },
        { className: 'button' },
      );
      const closeButton = labelledButton('Close', close, { className: 'button quiet' });

      const send = async (): Promise<void> => {
        submit.disabled = true;
        const result = await api<{ id: string }>('POST', '/api/auth/signin', {
          email: email.input.value.trim(),
          password: password.input.value,
        });
        submit.disabled = false;
        submit.focus();
        if (result.ok) {
          signedIn = true;
          await refreshMe();
          close();
          options.onSuccess();
          return;
        }
        notice.textContent = result.failure.message;
      };

      return [
        el('h2', { text: 'Sign in' }),
        email.row,
        password.row,
        notice,
        el('div', { className: 'button-row', children: [submit, switchButton, closeButton] }),
      ];
    },
  });
}
