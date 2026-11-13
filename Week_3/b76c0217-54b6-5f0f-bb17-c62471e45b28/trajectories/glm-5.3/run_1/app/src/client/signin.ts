import { announce, api, qs } from './core';
import { initTheme } from './theme';

initTheme();

const meta = document.body.dataset;
const next = new URLSearchParams(window.location.search).get('next');
const returnTo = next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') && !next.includes('://') ? next : '/app';

const form = qs<HTMLFormElement>('[data-signin-form]');
if (form) {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = form.querySelector<HTMLInputElement>('[data-email]')?.value ?? '';
    const password = form.querySelector<HTMLInputElement>('[data-password]')?.value ?? '';
    void api<{ redirectTo: string }>('POST', '/api/session', { email, password, next: returnTo }).then((res) => {
      if (res.data) {
        window.location.href = res.data.redirectTo;
      } else if (res.error) {
        const errorEl = form.querySelector<HTMLElement>('[data-error]');
        if (errorEl) errorEl.textContent = res.error.message;
        announce(res.error.message);
      }
    });
  });
}
