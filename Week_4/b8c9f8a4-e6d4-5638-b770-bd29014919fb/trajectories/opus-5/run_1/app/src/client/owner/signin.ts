import { ERRORS, PENDING } from '../../shared/copy';
import { request } from '../shared/api';
import { carFileFooter, statusRegion, unitsBar } from '../shared/chrome';
import { el, focusTarget, onPress, setPending } from '../shared/dom';
import { announce } from '../shared/live';

/** A `return` value that is not a path under /owner/ lands on the garage. */
export const landingFor = (returnValue: string | null): string => {
  if (returnValue === null) return '/owner/cars';
  if (!returnValue.startsWith('/owner/')) return '/owner/cars';
  if (returnValue.startsWith('//')) return '/owner/cars';
  try {
    const parsed = new URL(returnValue, window.location.origin);
    if (parsed.origin !== window.location.origin) return '/owner/cars';
    if (!parsed.pathname.startsWith('/owner/')) return '/owner/cars';
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return '/owner/cars';
  }
};

export const renderSignIn = (root: HTMLElement): void => {
  const status = statusRegion('Owner status');
  const field = el('input', { type: 'password', class: 'text-input', id: 'passphrase' }) as HTMLInputElement;
  field.setAttribute('aria-label', 'Passphrase');
  const button = el('button', { type: 'button', class: 'pill-solid', text: 'Sign in' });
  const error = el('p', { class: 'field-error' });
  error.hidden = true;

  const send = async (): Promise<void> => {
    setPending(button, true);
    error.hidden = true;
    announce(status, PENDING.signIn);
    try {
      await request('/api/owner/session', { method: 'POST', body: { passphrase: field.value } });
      const wanted = new URLSearchParams(window.location.search).get('return');
      window.location.assign(landingFor(wanted));
    } catch {
      error.hidden = false;
      error.textContent = ERRORS.badPassphrase;
      announce(status, ERRORS.badPassphrase);
      setPending(button, false);
    }
  };

  field.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (button.dataset.pending === 'true') return;
    void send();
  });
  onPress(button, () => {
    void send();
  });

  const card = el('div', { class: 'signin-card card' }, [
    el('h1', { class: 'signin-heading', text: 'Open Bonnet' }),
    el('p', { class: 'signin-lead', text: 'One owner, one car file. Sign in to carry on.' }),
    el('label', { class: 'field-label', for: 'passphrase', text: 'Passphrase' }),
    field,
    error,
    button,
  ]);

  root.replaceChildren(
    unitsBar(),
    status,
    el('main', { class: 'signin-main' }, [card]),
    carFileFooter(),
  );
  focusTarget(field);
};
