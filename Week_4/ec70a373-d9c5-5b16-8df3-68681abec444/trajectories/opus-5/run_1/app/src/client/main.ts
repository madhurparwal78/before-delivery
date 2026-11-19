import { onUnauthenticated, request } from './api';
import { COPY } from './copy';
import { button, clear, el, labelled } from './dom';
import { icon } from './icons';
import { StatusRegion, clearFieldError, showFieldError } from './status';
import { clearAll } from './timers';
import { handleUnauthenticated, registerSignInFormHandler, setBlockingDialog, setSignedInEmail } from './auth';
import type { MeJson, SiteJson } from '../shared/types';
import { renderBook } from './screens/book';
import { renderPacks } from './screens/packs';
import { renderDocuments } from './screens/documents';
import { renderTruck } from './screens/truck';
import { renderSiteDay } from './screens/site';
import { renderCompliance } from './screens/compliance';
import { renderTrucks } from './screens/trucks';
import { renderRates } from './screens/rates';
import { renderReports } from './screens/reports';
import { renderInspect } from './screens/inspect';

export interface AppContext {
  me: MeJson;
  sites: SiteJson[];
  navigate(path: string, options?: { replace?: boolean }): void;
  siteById(siteId: string): SiteJson | null;
}

interface ScreenDef {
  path: string;
  label: string;
  render: (container: HTMLElement, ctx: AppContext) => void;
}

const MEMBER_SCREENS: ScreenDef[] = [
  { path: '/book', label: 'Book', render: renderBook },
  { path: '/packs', label: 'Packs', render: renderPacks },
  { path: '/documents', label: 'Documents', render: renderDocuments },
];

const TRUCK_SCREEN: ScreenDef = { path: '/truck', label: 'Truck log', render: renderTruck };

const MANAGER_SCREENS: ScreenDef[] = [
  { path: '/site', label: 'Site day', render: renderSiteDay },
  { path: '/compliance', label: 'Compliance', render: (container) => renderCompliance(container) },
  { path: '/trucks', label: 'Trucks', render: renderTrucks },
];

const FINANCE_SCREENS: ScreenDef[] = [
  { path: '/rates', label: 'Rates', render: renderRates },
  { path: '/reports', label: 'Reports', render: (container) => renderReports(container) },
];

const PHONE_QUERY = '(max-width: 639.98px)';

let me: MeJson | null = null;
let sites: SiteJson[] = [];
let navigationOpen = false;

function root(): HTMLElement {
  return document.getElementById('app') as HTMLElement;
}

function screensFor(user: MeJson): ScreenDef[] {
  if (user.user.role === 'member') {
    return user.member !== null && user.member.truck !== null
      ? [...MEMBER_SCREENS, TRUCK_SCREEN]
      : MEMBER_SCREENS;
  }
  if (user.user.role === 'kitchen_manager') return MANAGER_SCREENS;
  return FINANCE_SCREENS;
}

function homeFor(user: MeJson): string {
  if (user.user.role === 'member') return '/book';
  if (user.user.role === 'kitchen_manager') return '/site';
  return '/rates';
}

export function navigate(path: string, options: { replace?: boolean } = {}): void {
  const current = `${window.location.pathname}${window.location.search}`;
  if (path !== current) {
    if (options.replace === true) window.history.replaceState({}, '', path);
    else window.history.pushState({}, '', path);
  }
  void renderRoute();
}

function context(user: MeJson): AppContext {
  return {
    me: user,
    sites,
    navigate,
    siteById: (siteId: string) => sites.find((site) => site.id === siteId) ?? null,
  };
}

function renderSignIn(statusCopy: string): void {
  clearAll();
  setBlockingDialog(null);
  const host = root();
  clear(host);
  const header = el('header', { class: 'app-header' }, [
    el('span', { class: 'brand', text: 'Pilotlight' }),
  ]);
  const status = new StatusRegion('Sign-in status');
  const email = el('input', { type: 'email', autocomplete: 'username' });
  const password = el('input', { type: 'password', autocomplete: 'current-password' });
  const submit = button('Sign in', { class: 'primary', type: 'submit' });
  const form = el('form', { class: 'sign-in-form', novalidate: true }, [
    el('h1', { text: 'Sign in' }),
    labelled('Email', email, 'sign-in-email'),
    labelled('Password', password, 'sign-in-password'),
    submit,
    status.element,
  ]);
  const main = el('main', { class: 'screen screen-sign-in' }, [form]);
  host.append(header, main);
  if (statusCopy !== '') status.write(statusCopy);
  email.focus();

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (submit.getAttribute('aria-disabled') === 'true') return;
    clearFieldError(email);
    clearFieldError(password);
    submit.setAttribute('aria-disabled', 'true');
    status.write(COPY.signingIn);
    void request<MeJson>('/api/session', {
      method: 'POST',
      body: { email: email.value, password: password.value },
      skipAuthGate: true,
    }).then(async (result) => {
      submit.setAttribute('aria-disabled', 'false');
      if (result.ok) {
        me = result.data;
        setSignedInEmail(result.data.user.email);
        await loadSites();
        const path = `${window.location.pathname}${window.location.search}`;
        const allowed = screensFor(result.data).some((screen) => path.startsWith(screen.path));
        navigate(allowed ? path : homeFor(result.data), { replace: true });
        return;
      }
      if (result.error.code === 'invalid_credentials') status.write(COPY.signInInvalid);
      else if (result.error.code === 'too_many_attempts') {
        status.write(COPY.signInThrottled(result.retryAfterSeconds));
      } else if (result.error.code === 'validation') {
        const fields = result.error.fields ?? {};
        if (fields.email !== undefined) {
          showFieldError(email, COPY.signInEmail);
          status.write(COPY.signInEmail);
        } else {
          showFieldError(password, COPY.signInPassword);
          status.write(COPY.signInPassword);
        }
      } else if (result.status === 0) status.write(COPY.offline);
      else status.write(COPY.internal);
    });
  });
}

function buildHeader(user: MeJson): HTMLElement {
  const header = el('header', { class: 'app-header' });
  const brand = el('span', { class: 'brand', text: 'Pilotlight' });
  const signOut = button('Sign out', { class: 'sign-out' });
  signOut.addEventListener('click', () => {
    void request('/api/session', { method: 'DELETE', skipAuthGate: true }).then(() => {
      me = null;
      window.history.pushState({}, '', '/');
      renderSignIn('');
    });
  });
  const nav = el('nav', { 'aria-label': 'Main', class: 'main-nav' });
  for (const screen of screensFor(user)) {
    const link = el('a', { href: screen.path, class: 'nav-link', text: screen.label });
    link.addEventListener('click', (event) => {
      event.preventDefault();
      if (isPhone() && navigationOpen) toggleNavigation(false);
      navigate(screen.path);
    });
    nav.append(link);
  }
  const menu = button('Menu', { class: 'menu-button', 'aria-expanded': 'false' });
  menu.prepend(icon('menu'));
  menu.addEventListener('click', () => toggleNavigation(!navigationOpen));
  menu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && navigationOpen) toggleNavigation(false);
  });
  nav.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      toggleNavigation(false);
      menu.focus();
    }
  });
  header.append(brand);
  if (isPhone()) header.append(menu);
  else header.append(nav);
  header.append(signOut);
  return header;
}

function isPhone(): boolean {
  return window.matchMedia(PHONE_QUERY).matches;
}

function toggleNavigation(open: boolean): void {
  const header = document.querySelector('.app-header');
  const menu = header?.querySelector('.menu-button') as HTMLElement | null;
  if (header === null || menu === null || me === null) return;
  navigationOpen = open;
  menu.setAttribute('aria-expanded', open ? 'true' : 'false');
  const existing = header.querySelector('nav.main-nav');
  if (!open) {
    existing?.remove();
    return;
  }
  if (existing !== null) return;
  const nav = el('nav', { 'aria-label': 'Main', class: 'main-nav nav-panel' });
  for (const screen of screensFor(me)) {
    const link = el('a', { href: screen.path, class: 'nav-link', text: screen.label });
    link.addEventListener('click', (event) => {
      event.preventDefault();
      toggleNavigation(false);
      navigate(screen.path);
    });
    nav.append(link);
  }
  nav.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      toggleNavigation(false);
      menu.focus();
    }
  });
  header.append(nav);
  (nav.querySelector('a') as HTMLElement | null)?.focus();
}

async function loadSites(): Promise<void> {
  const result = await request<{ sites: SiteJson[] }>('/api/sites');
  if (result.ok) sites = result.data.sites;
}

async function renderRoute(): Promise<void> {
  const path = window.location.pathname;
  clearAll();
  setBlockingDialog(null);
  if (/^\/inspect\/[A-Za-z0-9_-]+$/.test(path)) {
    const host = root();
    clear(host);
    const header = el('header', { class: 'app-header' }, [
      el('span', { class: 'brand', text: 'Pilotlight' }),
    ]);
    const main = el('main', { class: 'screen screen-inspect' });
    host.append(header, main);
    renderInspect(main, path.split('/')[2] as string);
    return;
  }
  if (me === null) {
    const result = await request<MeJson>('/api/me', { skipAuthGate: true });
    if (!result.ok) {
      renderSignIn('');
      return;
    }
    me = result.data;
    setSignedInEmail(result.data.user.email);
    await loadSites();
  }
  const user = me;
  const screens = screensFor(user);
  const screen = screens.find((candidate) => path === candidate.path);
  if (screen === undefined) {
    navigate(homeFor(user), { replace: true });
    return;
  }
  navigationOpen = false;
  const host = root();
  clear(host);
  const main = el('main', { class: `screen screen-${screen.path.slice(1)}` });
  host.append(buildHeader(user), main);
  screen.render(main, context(user));
}

function start(): void {
  onUnauthenticated(() => handleUnauthenticated());
  registerSignInFormHandler((copy) => {
    me = null;
    renderSignIn(copy);
  });
  window.addEventListener('popstate', () => {
    void renderRoute();
  });
  window.matchMedia(PHONE_QUERY).addEventListener('change', () => {
    if (me !== null) void renderRoute();
  });
  void renderRoute();
}

start();
