import { el, t } from './ui.js';
import { api, setLocale, type Account } from './api-client.js';
import { loadMe, notify, store } from './store.js';
import { languagePickerHtml } from './language.js';
import { tr } from '../shared/i18n.js';
import { locale } from './ui.js';

/**
 * The signed-out pages (DP-01, DP-07): a paper card over a turning sample hero.
 */
export function mountAuthPage(kind: 'home' | 'signup' | 'signin' | 'forgot-password' | 'reset-password' | 'verify'): void {
  const root = document.getElementById('root');
  if (!root) return;
  root.replaceChildren();
  const card = el('div', { class: 'paper-card' });
  const params = new URLSearchParams(location.search);
  const token = params.get('token') ?? '';

  const heading = el('h1', { class: 'card-heading' });
  const formBox = el('div', {});

  if (kind === 'home') {
    heading.textContent = 'Linewright';
    const intro = el('p', { class: 'home-intro', text: t('copy', 'home-intro') });
    const signup = el('a', { href: '/signup', class: 'primary-link', text: t('copy', 'signup-link') });
    const signin = el('a', { href: '/signin', class: 'secondary-link', text: t('copy', 'signin-link') });
    formBox.append(intro, el('div', { class: 'card-row' }, signup, signin));
  } else if (kind === 'signup') {
    heading.textContent = t('screens', 'sign-up');
    const form = el('form', {});
    const summary = el('div', { class: 'error-summary', role: 'alert' });
    const email = el('input', { id: 'signup-email', type: 'email', autocomplete: 'email' });
    const emailLabel = el('label', { for: 'signup-email', text: t('controls', 'email') });
    const password = el('input', { id: 'signup-password', type: 'password', autocomplete: 'new-password' });
    const passwordLabel = el('label', { for: 'signup-password', text: t('controls', 'password') });
    const displayName = el('input', { id: 'signup-display-name', type: 'text', autocomplete: 'nickname' });
    const displayNameLabel = el('label', { for: 'signup-display-name', text: t('controls', 'display-name') });
    const submit = el('button', { type: 'submit', class: 'primary', text: t('controls', 'create-account') });
    form.append(summary, emailLabel, email, passwordLabel, password, displayNameLabel, displayName, submit);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      summary.replaceChildren();
      const result = await api<{ account: Account }>('POST', '/api/auth/signup', {
        email: email.value, password: password.value, display_name: displayName.value, locale,
      });
      if (result.status === 201) {
        location.href = '/hangar';
        return;
      }
      const data = result.data as { error?: { fields?: Record<string, string> } } | null;
      const fields = data?.error?.fields ?? {};
      const items: HTMLElement[] = [];
      for (const [field, message] of Object.entries(fields)) {
        const anchor = el('a', { href: '#', text: message });
        anchor.addEventListener('click', (ev) => {
          ev.preventDefault();
          const target = document.getElementById(`signup-${field === 'email' ? 'email' : field === 'password' ? 'password' : 'display-name'}`);
          (target as HTMLElement | null)?.focus();
        });
        items.push(el('div', {}, anchor));
      }
      if (items.length === 0) items.push(el('div', { text: t('copy', 'generic-error') }));
      summary.append(...items);
    });
    formBox.append(form);
    formBox.append(el('a', { href: '/signin', class: 'secondary-link', text: t('copy', 'signin-link') }));
  } else if (kind === 'signin') {
    heading.textContent = t('screens', 'sign-in');
    const form = el('form', {});
    const summary = el('div', { class: 'error-summary', role: 'alert' });
    const email = el('input', { id: 'signin-email', type: 'email', autocomplete: 'email' });
    const emailLabel = el('label', { for: 'signin-email', text: t('controls', 'email') });
    const password = el('input', { id: 'signin-password', type: 'password', autocomplete: 'current-password' });
    const passwordLabel = el('label', { for: 'signin-password', text: t('controls', 'password') });
    const submit = el('button', { type: 'submit', class: 'primary', text: t('controls', 'sign-in') });
    form.append(summary, emailLabel, email, passwordLabel, password, submit);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      summary.replaceChildren();
      const result = await api<{ account: Account }>('POST', '/api/auth/signin', { email: email.value, password: password.value });
      if (result.status === 200) {
        location.href = '/hangar';
        return;
      }
      summary.append(el('div', { text: t('copy', 'wrong-credentials') }));
    });
    formBox.append(form);
    formBox.append(el('a', { href: '/forgot-password', class: 'secondary-link', text: t('controls', 'forgot-password') }));
  } else if (kind === 'forgot-password') {
    heading.textContent = t('screens', 'forgot-password');
    const form = el('form', {});
    const email = el('input', { id: 'forgot-email', type: 'email', autocomplete: 'email' });
    const emailLabel = el('label', { for: 'forgot-email', text: t('controls', 'email') });
    const submit = el('button', { type: 'submit', class: 'primary', text: t('controls', 'send-reset-link') });
    form.append(emailLabel, email, submit);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      submit.disabled = true;
      submit.textContent = t('copy', 'working');
      const result = await api('POST', '/api/auth/password-reset', { email: email.value });
      submit.disabled = false;
      submit.textContent = t('controls', 'send-reset-link');
      if (result.status === 202) {
        notify(t('copy', 'reset-requested'));
      } else if (result.status === 503) {
        const banner = document.getElementById('global-alert');
        if (banner) {
          banner.hidden = false;
          banner.textContent = t('copy', 'reset-not-sent');
        }
      }
    });
    formBox.append(form);
    formBox.append(el('a', { href: '/signin', class: 'secondary-link', text: t('copy', 'signin-link') }));
  } else if (kind === 'reset-password') {
    heading.textContent = t('screens', 'reset-password');
    const headingLine = el('h2', { class: 'card-subheading', text: t('copy', 'reset-heading-2') });
    const form = el('form', {});
    const password = el('input', { id: 'reset-password-field', type: 'password', autocomplete: 'new-password' });
    const passwordLabel = el('label', { for: 'reset-password-field', text: t('controls', 'password') });
    const submit = el('button', { type: 'submit', class: 'primary', text: t('controls', 'set-new-password') });
    form.append(passwordLabel, password, submit);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const result = await api('POST', '/api/auth/password-reset/confirm', { token, password: password.value });
      if (result.status === 200) {
        notify(t('copy', 'password-changed'));
        location.href = '/signin';
        return;
      }
      if (result.status === 410) {
        const data = result.data as { error?: { code?: string } } | null;
        const code = data?.error?.code ?? 'link_expired';
        const key = code === 'link_used' ? 'link-used' : code === 'link_replaced' ? 'link-replaced' : 'link-expired';
        heading.textContent = t('copy', key);
        form.replaceChildren();
        return;
      }
      notify(t('copy', 'generic-error'));
    });
    formBox.append(headingLine, form);
  } else if (kind === 'verify') {
    heading.textContent = t('screens', 'verify');
    void (async () => {
      const result = await api<{ account: Account }>('POST', '/api/auth/verify', { token });
      const data = result.data as { error?: { code?: string } } | null;
      const code = data?.error?.code;
      if (result.status === 200) {
        heading.textContent = t('copy', 'email-confirmed');
      } else if (result.status === 410) {
        heading.textContent = t('copy', code === 'link_used' ? 'link-used' : code === 'link_replaced' ? 'link-replaced' : 'link-expired');
      } else {
        heading.textContent = t('copy', 'generic-error');
      }
    })();
    formBox.append(el('a', { href: '/signin', class: 'secondary-link', text: t('copy', 'signin-link') }));
  }

  card.append(languagePickerHtml(), heading, formBox);
  const scene = el('div', { class: 'sample-scene', 'aria-label': t('copy', 'sample-hero-hint'), role: 'img' });
  root.append(scene, card);
}

export async function signOut(): Promise<void> {
  await api('POST', '/api/auth/signout');
  location.href = '/';
}

export { setLocale };
export type { Account };
