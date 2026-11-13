import { h, clear } from '../lib/els.js';
import { router } from '../lib/router.js';
import { api, ApiFail } from '../lib/api.js';
import { announce } from '../lib/announce.js';
import { store } from '../lib/store.js';

export async function signInPage(): Promise<HTMLElement> {
  const root = h('div', { class: 'signin-page' });
  const back = router.query.get('back');
  const emailInput = h('input', { type: 'text', class: 'field', 'aria-label': 'Email', inputmode: 'email', autocomplete: 'email' }) as HTMLInputElement;
  const codeInput = h('input', { type: 'text', class: 'field', 'aria-label': 'Code', inputmode: 'numeric', maxlength: '6' }) as HTMLInputElement;
  const nameInput = h('input', { type: 'text', class: 'field', 'aria-label': 'Display name', maxlength: '60' }) as HTMLInputElement;
  const nameWrap = h('div', { class: 'muted' });
  const alertTarget = h('div');

  let knownEmail = false;

  const sendCode = h('button', {
    type: 'button', class: 'btn primary', onClick: async () => {
      sendCode.textContent = 'Working';
      clear(alertTarget);
      try {
        await api('POST', '/api/auth/code', { email: emailInput.value.trim().toLowerCase() });
        knownEmail = await api<unknown>('GET', '/api/me').then(() => true).catch(() => false);
        announce(`Your code is on its way to ${emailInput.value.trim()}.`);
        const memberExists = await checkMember();
        if (!memberExists) nameWrap.append(nameInput);
        codeInput.focus();
      } catch (e) {
        if (e instanceof ApiFail) {
          alertTarget.append(h('div', { role: 'alert', class: 'alert' }, e.body.message));
        }
      } finally {
        sendCode.textContent = 'Send code';
        void knownEmail;
      }
    },
  }, 'Send code');

  const checkMember = async (): Promise<boolean> => {
    // The server does not reveal which emails exist; show the display-name field
    // after the code is sent so a new member can complete sign-in.
    nameWrap.innerHTML = '';
    nameWrap.append(nameInput);
    return false;
  };

  const signIn = h('button', {
    type: 'button', class: 'btn primary', onClick: async () => {
      signIn.textContent = 'Working';
      clear(alertTarget);
      try {
        await api('POST', '/api/auth/verify', {
          email: emailInput.value.trim().toLowerCase(),
          code: codeInput.value.trim(),
          display_name: nameInput.value.trim() || undefined,
        });
        await store.refreshMe();
        router.go(back ?? '/');
      } catch (e) {
        if (e instanceof ApiFail) {
          alertTarget.append(h('div', { role: 'alert', class: 'alert' }, e.body.message));
        }
      } finally {
        signIn.textContent = 'Sign in';
      }
    },
  }, 'Sign in');

  root.append(
    h('h1', null, 'Sign in'),
    h('p', null, h('label', null, 'Email'), emailInput),
    h('p', null, sendCode),
    h('p', null, h('label', null, 'Code'), codeInput),
    nameWrap,
    h('p', null, signIn),
    alertTarget,
  );
  return root;
}
