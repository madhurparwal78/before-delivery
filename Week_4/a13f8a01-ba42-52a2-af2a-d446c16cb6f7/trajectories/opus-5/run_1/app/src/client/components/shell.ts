import type { Pen } from '../../shared/api';
import { copy } from '../../shared/copy';
import { api, ApiFailure } from '../api';
import { h, say, status, trapFocus } from '../dom';
import { goto } from '../router';
import { me } from '../store';

const startPen = async (): Promise<void> => {
  const pen = await api.post<Pen>('/api/pens');
  goto(`/pen/${pen.id}`);
};

const navLinks = (): HTMLElement[] => {
  const user = me();
  const links: HTMLElement[] = [];
  if (user) links.push(h('a', { href: '/dashboard', text: 'Dashboard' }));
  links.push(h('a', { href: '/explore', text: 'Explore' }));
  links.push(h('a', { href: user ? '/collections' : '/signin', text: 'Collections' }));
  links.push(h('a', { href: '/shelf', text: 'The shelf' }));
  if (!user) links.push(h('a', { href: '/signin', text: 'Sign in' }));
  return links;
};

const startControl = (): HTMLElement => {
  const user = me();
  if (!user) return h('a', { href: '/signup', class: 'action accent', text: 'Start a pen' });
  return h('button', {
    type: 'button',
    class: 'action accent',
    text: 'Start a pen',
    onclick: () => void startPen(),
  });
};

const signOutButton = (): HTMLElement =>
  h('button', {
    type: 'button',
    class: 'ghost',
    text: 'Sign out',
    onclick: async () => {
      await api.post('/api/signout');
      window.location.assign('/');
    },
  });

const menu = (): HTMLElement => {
  const dialog = h('div', { role: 'dialog', 'aria-label': 'Menu', class: 'menu-dialog', hidden: true }, [
    ...navLinks(),
    ...(me() ? [signOutButton()] : []),
  ]);
  const button = h('button', {
    type: 'button',
    class: 'menu-button',
    text: 'Menu',
    'aria-expanded': 'false',
  });
  const close = (): void => {
    dialog.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    button.focus();
  };
  button.addEventListener('click', () => {
    if (dialog.hidden) {
      dialog.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      dialog.querySelector<HTMLElement>('a, button')?.focus();
    } else {
      close();
    }
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
    trapFocus(dialog)(event);
  });
  return h('div', { class: 'menu' }, [button, dialog]);
};

export const siteHeader = (): HTMLElement =>
  h('header', { class: 'site' }, [
    h('nav', { class: 'wide-nav', 'aria-label': 'Site' }, [
      ...navLinks(),
      ...(me() ? [signOutButton()] : []),
    ]),
    menu(),
    h('div', { class: 'start-slot' }, [startControl()]),
  ]);

/** The verification banner and the account status sit on every signed-in page. */
export const verifyBanner = (): HTMLElement => {
  const user = me();
  const accountStatus = status('Account status');
  const wrapper = h('div', { class: 'account' }, [accountStatus]);
  if (!user || user.verified) return wrapper;

  const sent = window.sessionStorage.getItem('ashlar.verification') !== 'pending';
  const resend = h('button', { type: 'button', class: 'ghost', text: 'Resend link' });
  const region = h(
    'section',
    { role: 'region', 'aria-label': 'Verify your email', class: 'panel panel-verify' },
    [
      h('p', { text: sent ? copy.verifySent(user.email) : copy.verifyPending }),
      resend,
    ],
  );
  resend.addEventListener('click', async () => {
    try {
      await api.post('/api/verify/resend');
      window.sessionStorage.setItem('ashlar.verification', 'sent');
      say(accountStatus, copy.resendSent(user.email));
      region.querySelector('p')!.textContent = copy.verifySent(user.email);
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'mail_unavailable') {
        say(accountStatus, copy.resendMailDown);
        return;
      }
      throw error;
    }
  });
  wrapper.insertBefore(region, accountStatus);
  return wrapper;
};

/** Clears the banner in place when the account is verified while the page is open. */
export const watchVerification = (wrapper: HTMLElement): (() => void) => () => {
  const region = wrapper.querySelector('[aria-label="Verify your email"]');
  region?.remove();
  say(wrapper.querySelector<HTMLElement>('[aria-label="Account status"]'), copy.verifiedLive);
};
