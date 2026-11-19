// Owner sign-in: a single card on the pale band.

import { api, Refused } from '../api.js';
import { el, on } from '../dom.js';
import { MESSAGE } from '../../shared/copy.js';
import { carFileFooter } from '../parts/footer.js';
import { unitsBar } from '../parts/units.js';
import { announce, statusRegion } from '../ui/status.js';
import { pressable } from '../ui/pending.js';
import { dimStill } from './ended.js';

export function signInPage(root: HTMLElement, landing: string): void {
  const status = statusRegion('Owner status');
  const field = el('input', { type: 'password', 'aria-label': 'Passphrase', class: 'field-input', autocomplete: 'current-password' });
  const error = el('p', { class: 'field-error', hidden: true });
  const button = el('button', { type: 'button', class: 'pill pill-solid' }, ['Sign in']);

  const submit = async (): Promise<void> => {
    announce(status, 'Checking passphrase');
    try {
      await api.post('/api/owner/session', { passphrase: field.value });
      window.location.assign(landing);
    } catch (bad) {
      const message = bad instanceof Refused && bad.status === 401
        ? MESSAGE.passphraseWrong
        : MESSAGE.sendFailed;
      error.hidden = false;
      error.textContent = message;
      announce(status, message);
    }
  };

  pressable(button, submit);
  on(field, 'keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Enter') {
      event.preventDefault();
      button.click();
    }
  });

  root.replaceChildren(el('div', { class: 'owner-page signin-page' }, [
    unitsBar(),
    el('header', { class: 'work-header' }, [
      el('span', { class: 'wordmark' }, ['Ostler Lane']),
      el('p', {}, ['Open Bonnet']),
    ]),
    el('main', { id: 'main', class: 'signin-main' }, [
      el('div', { class: 'signin-art', 'aria-hidden': 'true' }, [dimStill(560, 320)]),
      el('div', { class: 'card signin-card' }, [
        el('h1', {}, ['Sign in to your car files']),
        el('p', { class: 'lead' }, ['One owner, one passphrase. Buyers and inspectors arrive by their own named link.']),
        el('label', { class: 'field' }, [el('span', {}, ['Passphrase']), field, error]),
        button,
        status,
      ]),
    ]),
    carFileFooter(),
  ]));
  field.focus();
}
