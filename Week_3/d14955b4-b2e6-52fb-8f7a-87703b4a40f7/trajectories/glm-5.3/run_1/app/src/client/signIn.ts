// Sign-in screen.
import { el } from './publicPage';
import { api } from './api';
import type { SessionBody } from './types';
import { announce, registerLiveRegion } from './announce';

export interface SignInOutcome {
  session: SessionBody;
}

export function signInPage(root: HTMLElement, resume: { threadUrl?: string; replyText?: string } | null): void {
  document.title = 'Sign in to Hushline';
  const container = el('div', { class: 'column' });
  const heading = el('h1', {}, 'Sign in to Hushline');
  const liveRegion = el('div', { role: 'status', 'aria-live': 'polite', class: 'visually-hidden' });
  liveRegion.id = 'sign-in-announcements';
  registerLiveRegion('sign-in', liveRegion);

  const form = el('form', { novalidate: 'novalidate' }) as HTMLFormElement;
  const summary = el('div', { class: 'error' });
  const emailField = el('div', {},
    el('label', { for: 'email' }, 'Email'),
  );
  const emailInput = el('input', { id: 'email', name: 'email', type: 'email', autocomplete: 'username' }) as HTMLInputElement;
  const emailError = el('span', { class: 'field-error', role: 'alert' });
  emailField.append(emailInput, emailError);

  const passwordField = el('div', {},
    el('label', { for: 'password' }, 'Password'),
  );
  const passwordInput = el('input', { id: 'password', name: 'password', type: 'password', autocomplete: 'current-password' }) as HTMLInputElement;
  const passwordError = el('span', { class: 'field-error', role: 'alert' });
  passwordField.append(passwordInput, passwordError);

  const button = el('button', { type: 'submit', class: 'accent' }, 'Sign in');

  form.append(summary, emailField, passwordField, button);
  container.append(heading, liveRegion, form);
  root.append(container);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    summary.textContent = '';
    emailError.textContent = '';
    passwordError.textContent = '';
    const email = emailInput.value;
    const password = passwordInput.value;
    const problems: { field: 'email' | 'password'; message: string }[] = [];
    if (email.trim() === '') problems.push({ field: 'email', message: 'Enter your email.' });
    if (password === '') problems.push({ field: 'password', message: 'Enter your password.' });
    if (problems.length > 0) {
      summary.textContent = '';
      const list = el('ul', { role: 'alert' });
      for (const problem of problems) {
        const target = problem.field === 'email' ? emailError : passwordError;
        target.textContent = problem.message;
        const link = el('a', { href: problem.field === 'email' ? '#email' : '#password' }, problem.message);
        link.addEventListener('click', (clickEvent) => {
          clickEvent.preventDefault();
          (problem.field === 'email' ? emailInput : passwordInput).focus();
        });
        list.append(el('li', {}, link));
      }
      summary.append(list);
      announce('sign-in', problems[0].message);
      return;
    }
    announce('sign-in', 'Signing in...');
    const result = await api<SessionBody>('POST', '/api/auth/login', { email, password });
    if (!result.ok) {
      announce('sign-in', "That email and password don't match.");
      summary.textContent = "That email and password don't match.";
      return;
    }
    const session = result.body!;
    sessionStorage.setItem('hushline_change_token', session.change_token);
    const stored = sessionStorage.getItem('hushline_return_thread');
    if (resume?.threadUrl || stored) {
      const target = resume?.threadUrl ?? stored ?? '/inbox';
      const query = new URLSearchParams(window.location.search);
      const notice = query.get('notice');
      sessionStorage.removeItem('hushline_return_thread');
      window.location.href = notice ? `${target}${target.includes('?') ? '&' : '?'}notice=${encodeURIComponent(notice)}` : target;
      return;
    }
    window.location.href = '/inbox';
  });
}
