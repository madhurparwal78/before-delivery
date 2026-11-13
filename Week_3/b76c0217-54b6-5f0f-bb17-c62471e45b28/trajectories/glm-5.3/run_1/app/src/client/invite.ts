import { announce, api, qs, qsa } from './core';
import { initTheme } from './theme';

initTheme();

const meta = document.body.dataset;
const inviteToken = window.location.pathname.split('/invite/')[1] ?? '';

const form = qs<HTMLFormElement>('[data-invite-form]');
if (form) {
  const heading = qs('h1');
  if (heading && meta.teamName) heading.textContent = `Join ${meta.teamName} on Galley`;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = form.querySelector<HTMLInputElement>('[data-name]')?.value ?? '';
    const password = form.querySelector<HTMLInputElement>('[data-password]')?.value ?? '';
    void api('POST', `/api/invites/${inviteToken}/accept`, { name, password }).then((res) => {
      if (res.status === 201) {
        window.location.href = '/app';
      } else if (res.error) {
        const errorEl = form.querySelector<HTMLElement>('[data-error]');
        if (errorEl) errorEl.textContent = res.error.message;
        announce(res.error.message);
      }
    });
  });
}
