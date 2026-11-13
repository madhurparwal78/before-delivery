import { api } from '../api.js';
import { escapeHtml, type ShellState } from '../shell.js';

export function renderSignInPage(_state: ShellState): string {
  return `
  <div style="max-width:420px">
    <h1 class="page-title">Sign in</h1>
    <form id="sign-in-form">
      <div class="field"><label for="email">Email</label><input id="email" type="email" autocomplete="username"></div>
      <div class="field"><label for="password">Password</label><input id="password" type="password" autocomplete="current-password"></div>
      <div class="field"><button type="submit" id="sign-in-button">Sign in</button></div>
    </form>
    <p id="sign-in-alert" role="alert" class="live-status"></p>
  </div>`;
}

export function mountSignInPage(): void {
  const form = document.getElementById('sign-in-form') as HTMLFormElement;
  const alert = document.getElementById('sign-in-alert') as HTMLElement;
  const button = document.getElementById('sign-in-button') as HTMLButtonElement;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = (document.getElementById('email') as HTMLInputElement).value.trim();
    const password = (document.getElementById('password') as HTMLInputElement).value;
    button.disabled = true;
    button.textContent = 'Signing in';
    try {
      await api.signIn(email, password);
      const next = new URLSearchParams(window.location.search).get('next');
      const safeNext = next !== null && next.startsWith('/') && !next.startsWith('//') && !next.includes('://') ? next : '/';
      window.location.href = safeNext;
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Sign in';
      const apiError = error as { code?: string };
      alert.textContent = apiError?.code === 'invalid_credentials' || apiError?.code === 'unauthenticated'
        ? "That email and password don't match."
        : 'Something went wrong. Try again.';
    }
  });
  void escapeHtml;
}
