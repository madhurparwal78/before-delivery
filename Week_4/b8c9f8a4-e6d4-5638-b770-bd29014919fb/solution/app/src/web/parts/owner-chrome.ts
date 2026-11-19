// The chrome every owner screen carries: the units bar, the header with Sign out, the status
// region and the service notice.

import { api } from '../api.js';
import { el, on } from '../dom.js';
import { unitsBar } from './units.js';
import { alertRegion, statusRegion } from '../ui/status.js';

interface OwnerChrome {
  header: HTMLElement;
  bar: HTMLElement;
  status: HTMLElement;
  notice: HTMLElement;
}

export function ownerChrome(subtitle: string): OwnerChrome {
  // On the header's dark ground an action is an outline pill, as the brief's three kinds say.
  const signOut = el('button', { type: 'button', class: 'pill pill-outline' }, ['Sign out']);
  on(signOut, 'click', () => {
    void api.delete('/api/owner/session').finally(() => window.location.assign('/owner'));
  });
  return {
    bar: unitsBar(),
    header: el('header', { class: 'work-header' }, [
      el('div', {}, [
        el('span', { class: 'wordmark' }, ['Ostler Lane']),
        el('p', { class: 'work-subtitle' }, [subtitle]),
      ]),
      signOut,
    ]),
    status: statusRegion('Owner status'),
    notice: alertRegion(),
  };
}
