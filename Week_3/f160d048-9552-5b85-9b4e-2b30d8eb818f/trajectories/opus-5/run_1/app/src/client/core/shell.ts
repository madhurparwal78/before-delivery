import { announce } from './announce';
import { el, focus, on, trapFocus } from './dom';
import { markMotion, runMotion } from './motion';

export interface ClientConfig {
  toast_seconds: number;
  min_pay_reports: number;
  search_page_size: number;
}

export interface Me {
  id: string;
  display_name: string;
  email: string;
  role: 'member' | 'moderator' | 'employer_admin' | 'recruiter' | 'founder';
  company_slug: string | null;
  unlocked: boolean;
}

export const clientConfig: ClientConfig = JSON.parse(
  document.getElementById('client-config')?.textContent ?? '{}',
) as ClientConfig;

let me: Me | null = null;

export function currentUser(): Me | null {
  return me;
}

export function setCurrentUser(user: Me | null): void {
  me = user;
}

let toastHost: HTMLElement | null = null;

export function registerToastHost(host: HTMLElement): void {
  toastHost = host;
}

export function showToast(text: string): void {
  if (!toastHost) return;
  const toast = el('div', { class: 'toast', text });
  toastHost.append(toast);
  runMotion(toast, 'toast', 'opening', 'open', () => {
    window.setTimeout(
      () => runMotion(toast, 'toast', 'closing', 'closed', () => toast.remove()),
      clientConfig.toast_seconds * 1000,
    );
  });
}

export function toastAndAnnounce(text: string): void {
  showToast(text);
  announce(text);
}

interface NavLink {
  label: string;
  href: string;
}

function navLinks(): NavLink[] {
  const links: NavLink[] = [
    { label: 'Lab jobs', href: '/jobs' },
    { label: 'Companies', href: '/companies' },
    { label: 'Channels', href: '/channels' },
    { label: 'Share', href: '/contribute' },
  ];
  if (me?.role === 'member') {
    links.push(
      { label: 'My contributions', href: '/me/contributions' },
      { label: 'Saved jobs', href: '/saved' },
      { label: 'My applications', href: '/applications' },
      { label: 'Alerts', href: '/alerts' },
    );
  }
  if (me?.role === 'moderator' || me?.role === 'founder')
    links.push({ label: 'Moderation queue', href: '/moderation' });
  if (me?.role === 'employer_admin' || me?.role === 'recruiter')
    links.push({ label: 'Employer home', href: '/employer' });
  if (me?.role === 'founder') links.push({ label: 'Founder console', href: '/founder' });
  return links;
}

function signOutButton(onSignOut: () => void): HTMLElement {
  const button = el('button', { type: 'button', class: 'nav-action', text: 'Sign out' });
  on(button, 'click', () => onSignOut());
  return button;
}

function openMenu(opener: HTMLElement, onSignOut: () => void): void {
  const dialog = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Menu', class: 'sheet menu-sheet' });
  const list = el('nav', { class: 'menu-links' });
  for (const link of navLinks()) list.append(el('a', { href: link.href, text: link.label, class: 'nav-link' }));
  if (me) list.append(signOutButton(onSignOut));
  else list.append(el('a', { href: '/sign-in', text: 'Sign in', class: 'nav-link' }));
  const close = el('button', { type: 'button', class: 'nav-action', text: 'Close menu' });
  dialog.append(list, close);

  const backdrop = el('div', { class: 'backdrop' }, [dialog]);
  document.body.append(backdrop);
  const release = trapFocus(dialog);
  const shut = (): void => {
    release();
    backdrop.remove();
    focus(opener);
  };
  on(close, 'click', shut);
  on(dialog, 'keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      shut();
    }
  });
  focus(dialog.querySelector('a, button'));
}

export function buildHeader(onSignOut: () => void): HTMLElement {
  const wordmark = el('a', { href: '/', class: 'wordmark', text: 'Candour Bench' });
  const links = el('nav', { class: 'nav-links', 'aria-label': 'Main' });
  for (const link of navLinks()) links.append(el('a', { href: link.href, text: link.label, class: 'nav-link' }));
  if (me) links.append(signOutButton(onSignOut));
  else links.append(el('a', { href: '/sign-in', text: 'Sign in', class: 'nav-link' }));

  const menu = el('button', { type: 'button', class: 'nav-action menu-button', text: 'Menu' });
  on(menu, 'click', () => openMenu(menu, onSignOut));

  return el('header', { class: 'site-header' }, [wordmark, links, menu]);
}

/** A pending action disables its button and says `Working`. */
export function working(button: HTMLButtonElement): () => void {
  button.disabled = true;
  const caption = el('span', { class: 'working', text: 'Working' });
  button.insertAdjacentElement('afterend', caption);
  announce('Working');
  return () => {
    button.disabled = false;
    caption.remove();
  };
}

export function fieldError(input: HTMLElement, message: string): void {
  const id = `${input.id || `field-${Math.random().toString(36).slice(2)}`}-error`;
  if (!input.id) input.id = id.replace('-error', '');
  const existing = document.getElementById(id);
  if (existing) existing.remove();
  const error = el('p', { class: 'field-error', id, text: message });
  input.insertAdjacentElement('afterend', error);
  input.setAttribute('aria-describedby', id);
  input.setAttribute('aria-invalid', 'true');
}

export function clearFieldErrors(form: HTMLElement): void {
  for (const node of form.querySelectorAll('.field-error')) node.remove();
  for (const node of form.querySelectorAll('[aria-invalid]')) {
    node.removeAttribute('aria-invalid');
    node.removeAttribute('aria-describedby');
  }
}

/** The page's single alert; a new message replaces the old one. */
export function pageAlert(container: HTMLElement): (message: string | null) => HTMLElement | null {
  const host = el('div', { class: 'alert-host' });
  container.prepend(host);
  return (message: string | null) => {
    host.replaceChildren();
    if (message === null) return null;
    const alert = el('div', { role: 'alert', class: 'banner', text: message });
    host.append(alert);
    return alert;
  };
}

export function loadingFrame(): HTMLElement {
  const frame = el('div', { class: 'tile-frame loading', text: 'Loading' });
  markMotion(frame, 'band-crossfade', 'done');
  return frame;
}
