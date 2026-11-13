import { api } from './api';
import { el, on } from './dom';

export const signOutButton = (): HTMLElement => {
  const button = el('button', { type: 'button', text: 'Sign out' });
  on(button, 'click', () => {
    void api.post('/api/auth/signout').then(() => window.location.assign('/'));
  });
  return button;
};

export const signInLink = (next: string): HTMLElement =>
  el('a', { href: `/signin?next=${encodeURIComponent(next)}`, text: 'Sign in' });
