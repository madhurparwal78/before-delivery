import { request } from '../shared/api';
import { el, onPress, setPending } from '../shared/dom';
import { announce } from '../shared/live';

/** On every owner screen. Signing out ends every owner session. */
export const signOutButton = (status: HTMLElement): HTMLButtonElement => {
  const button = el('button', { type: 'button', class: 'pill-outline', text: 'Sign out' });
  onPress(button, () => {
    setPending(button, true);
    void request('/api/owner/session', { method: 'DELETE' })
      .then(() => {
        window.location.assign('/owner');
      })
      .catch(() => {
        setPending(button, false);
        announce(status, 'That could not be sent. Try again.');
      });
  });
  return button;
};
