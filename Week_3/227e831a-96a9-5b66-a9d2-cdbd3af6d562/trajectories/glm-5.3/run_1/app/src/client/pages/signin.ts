import { el } from '../dom.js';
import { api } from '../api.js';
import { navigate } from '../router.js';

/**
 * The Sign in screen: one passphrase field and a Sign in button, centred on
 * the contour ground.
 */
export function renderSignIn(page: HTMLElement): void {
  page.textContent = '';
  const wrap = el('div', { class: 'sign-in-wrap' });
  const card = el('div', { class: 'sign-in-card' });
  card.append(el('h1', { text: 'Skinout' }));
  const field = el('div', { class: 'field' });
  const label = el('label', { class: 'field-label', for: 'passphrase', text: 'Passphrase' });
  const input = el('input', { id: 'passphrase', type: 'password', autocomplete: 'current-password' }) as HTMLInputElement;
  const errorText = el('div', { id: 'signin-error', class: 'field-error', hidden: 'hidden' });
  field.append(label, input, errorText);
  const button = el('button', { type: 'submit', text: 'Sign in' });
  button.addEventListener('click', () => {
    void (async () => {
      button.disabled = true;
      const answer = await api.post('/api/session', { passphrase: input.value });
      button.disabled = false;
      if (!answer.ok) {
        errorText.textContent = "That passphrase didn't match.";
        errorText.removeAttribute('hidden');
        input.focus();
        return;
      }
      navigate('/trips');
    })();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      button.click();
    }
  });
  card.append(field, button);
  wrap.append(card);
  page.append(wrap);
  input.focus();
}
