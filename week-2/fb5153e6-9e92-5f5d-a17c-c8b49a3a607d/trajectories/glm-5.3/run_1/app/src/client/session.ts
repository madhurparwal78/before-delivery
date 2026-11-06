import { api, copy, escapeHtml, wireCore } from './app-core.js';

/** Sign-in page: POST the session, then land on next or the role's landing route. */
function wireSignIn(): void {
  const form = document.getElementById('sign-in-form') as HTMLFormElement | null;
  const alert = document.querySelector<HTMLElement>('#sign-in-form .form-alert');
  if (form === null) return;
  form.addEventListener('submit', event => {
    event.preventDefault();
    const email = (document.getElementById('sign-in-email') as HTMLInputElement).value;
    const password = (document.getElementById('sign-in-password') as HTMLInputElement).value;
    alert!.hidden = true;
    void api<{ role: string; landing: string }>('/api/session', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
      .then(result => {
        const next = form.dataset['next'] ?? '';
        const url = new URL(window.location.href);
        const lang = url.searchParams.get('lang');
        const sameOriginNext = next.startsWith('/') && !next.startsWith('//') ? next : '';
        const target = sameOriginNext === '' ? result.landing : sameOriginNext;
        const suffix = lang === 'de' ? '?lang=de' : lang === 'en' ? '?lang=en' : '';
        window.location.href = target.includes('?') ? `${target}&${suffix.replace('?', '')}` : `${target}${suffix}`;
      })
      .catch(err => {
        alert!.textContent = copy('invalid_credentials') === 'invalid_credentials' ? err.message : copy('invalid_credentials');
        alert!.hidden = false;
      });
  });
}

wireCore();
wireSignIn();
