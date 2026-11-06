/**
 * App shell: routing, the top bar, the units dialog, the service notice and
 * the Sign in again protocol.
 */
import { api, ApiFailure, NoAnswer, randomKey, setApiEvents, type Me, type Units } from './api.ts';
import { state, isStaff, loadMe, loadStatus, setRoute } from './state.ts';
import { announce, h, patchText } from './ui.ts';
import { openDialog } from './dialog.ts';
import { Reread } from './reread.ts';
import { SERVICE_NOTICES, SIGN_IN_AGAIN_PENDING, SIGN_IN_AGAIN_REFUSED, SIGN_IN_AGAIN_TEXT, SAVING_UNITS, UNITS_UPDATED } from '../shared/copy.ts';
import { renderSignIn } from './screens/signin.ts';
import { renderBays } from './screens/bays.ts';
import { renderCar } from './screens/car.ts';
import { renderRound } from './screens/round.ts';
import { renderJobs } from './screens/jobs.ts';
import { renderJob } from './screens/job.ts';
import { renderReleases } from './screens/releases.ts';
import { renderBoard } from './screens/board.ts';
import { renderStaff } from './screens/staff.ts';
import { renderPortal, renderPortalCar, renderPortalInvoice, renderRequestRelease, renderPortalRelease } from './screens/portal.ts';
import type { Screen } from './screens/screen.ts';

const ROLE_HOME: Record<Me['role'], string> = {
  concierge: '/bays',
  care_technician: '/round',
  workshop_lead: '/jobs',
  house_manager: '/board',
  owner: '/portal',
};

const NAV: Record<Me['role'], { label: string; href: string }[]> = {
  concierge: [
    { label: 'Bays', href: '/bays' },
    { label: 'Releases', href: '/releases' },
  ],
  care_technician: [{ label: 'Care round', href: '/round' }],
  workshop_lead: [{ label: 'Jobs', href: '/jobs' }],
  house_manager: [
    { label: 'Board', href: '/board' },
    { label: 'Bays', href: '/bays' },
    { label: 'Releases', href: '/releases' },
    { label: 'Staff access', href: '/staff' },
  ],
  owner: [{ label: 'My cars', href: '/portal' }],
};

let screen: Screen | null = null;
let rereadsPaused = false;
const rereads: Reread[] = [];

export function registerReread(reread: Reread): void {
  rereads.push(reread);
  if (rereadsPaused) reread.pause();
}

export function clearRereads(): void {
  for (const reread of rereads) reread.stop();
  rereads.length = 0;
}

function pauseRereads(): void {
  rereadsPaused = true;
  for (const reread of rereads) reread.pause();
}

function resumeRereads(): void {
  rereadsPaused = false;
  for (const reread of rereads) reread.resume();
}

interface InterruptedAction {
  key: string;
  resend: () => Promise<void>;
}

let interrupted: InterruptedAction | null = null;

export function markInterrupted(key: string, resend: () => Promise<void>): void {
  interrupted = { key, resend };
}

export function clearInterrupted(key: string): void {
  if (interrupted?.key === key) interrupted = null;
}

export async function navigate(path: string): Promise<void> {
  window.history.pushState({}, '', path);
  await route();
}

window.addEventListener('popstate', () => {
  void route();
});

export async function route(): Promise<void> {
  setRoute();
  clearRereads();
  screen?.destroy();
  screen = null;
  const root = document.getElementById('app') as HTMLElement;
  root.replaceChildren();
  const path = state.route.path;

  if (!state.me) {
    await renderSignIn(root);
    return;
  }
  const me = state.me;
  if (path === '/sign-in') {
    window.history.replaceState({}, '', ROLE_HOME[me.role]);
    await route();
    return;
  }
  if (isStaff() && path.startsWith('/portal')) {
    window.history.replaceState({}, '', ROLE_HOME[me.role]);
    await route();
    return;
  }
  if (me.role === 'owner' && !path.startsWith('/portal')) {
    if (path.startsWith('/jobs/') && /^\/jobs\/[^/]+$/.test(path)) {
      window.history.replaceState({}, '', `/portal/jobs/${path.split('/')[2]}${window.location.search}`);
      await route();
      return;
    }
    window.history.replaceState({}, '', '/portal');
    await route();
    return;
  }

  renderShell(root);
  const main = root.querySelector<HTMLElement>('main') as HTMLElement;
  const render = async (): Promise<void> => {
    let next: Screen;
    if (path === '/bays') next = renderBays(main);
    else if (/^\/cars\/[^/]+$/.test(path)) next = renderCar(main, path.split('/')[2]);
    else if (path === '/round') next = renderRound(main);
    else if (path === '/jobs') next = renderJobs(main);
    else if (/^\/jobs\/[^/]+$/.test(path)) next = renderJob(main, path.split('/')[2], false);
    else if (path === '/releases') next = renderReleases(main);
    else if (path === '/board') next = renderBoard(main);
    else if (path === '/staff') next = renderStaff(main);
    else if (path === '/portal') next = renderPortal(main);
    else if (/^\/portal\/cars\/[^/]+$/.test(path)) next = renderPortalCar(main, path.split('/')[3]);
    else if (/^\/portal\/jobs\/[^/]+$/.test(path)) next = renderJob(main, path.split('/')[3], true);
    else if (/^\/portal\/invoices\/[^/]+$/.test(path)) next = renderPortalInvoice(main, path.split('/')[3]);
    else if (/^\/portal\/cars\/[^/]+\/release$/.test(path)) next = renderRequestRelease(main, path.split('/')[3]);
    else if (/^\/portal\/releases\/[^/]+$/.test(path)) next = renderPortalRelease(main, path.split('/')[3]);
    else {
      main.replaceChildren(h('div', { class: 'not-found' }, h('h1', { text: "We couldn't find that page" })));
      return;
    }
    screen = next;
    await next.render();
  };
  await render();
}

function renderShell(root: HTMLElement): void {
  const me = state.me as Me;
  const menuButton = h('button', {
    class: 'menu-btn',
    'aria-expanded': 'false',
    'aria-controls': 'main-nav',
    text: 'Menu',
    onclick: () => {
      const expanded = nav.dataset.open === 'true';
      nav.dataset.open = String(!expanded);
      menuButton.setAttribute('aria-expanded', String(!expanded));
      if (!expanded) {
        nav.querySelector('a')?.focus();
      } else {
        menuButton.focus();
      }
    },
  });
  const nav = h('nav', {
    class: 'main',
    id: 'main-nav',
    'aria-label': 'Main',
    'data-open': 'false',
  });
  nav.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Escape') {
      event.preventDefault();
      nav.dataset.open = 'false';
      menuButton.setAttribute('aria-expanded', 'false');
      menuButton.focus();
    }
  });
  for (const item of NAV[me.role]) {
    const link = h('a', { href: item.href, text: item.label });
    if (state.route.path === item.href || state.route.path.startsWith(`${item.href}/`)) {
      link.setAttribute('aria-current', 'page');
    }
    link.addEventListener('click', (event) => {
      event.preventDefault();
      nav.dataset.open = 'false';
      menuButton.setAttribute('aria-expanded', 'false');
      void navigate(item.href);
    });
    nav.append(link);
  }
  const unitsButton = h('button', {
    text: 'Units',
    onclick: () => openUnitsDialog(unitsButton),
  });
  const signOut = h('button', {
    text: 'Sign out',
    onclick: async () => {
      try {
        await api.del('/api/session');
      } catch {
        // leaving anyway
      }
      state.me = null;
      await navigate('/sign-in');
    },
  });
  const topbar = h(
    'div',
    { class: 'topbar' },
    h('div', { class: 'brand' },
      h('span', { class: 'house', text: 'Marrow & Lark Motor House' }),
      h('span', { class: 'product', text: 'Lacquer' })),
    menuButton,
    nav,
    h('div', { class: 'spacer' }),
    h('div', { class: 'top-actions' }, unitsButton, signOut),
  );
  const noticeArea = h('div', { 'data-notice': 'service', class: 'staff-only' });
  const main = h('main');
  root.append(topbar, noticeArea, main);
  if (!isStaff()) noticeArea.classList.add('hidden');
  void startNoticeLoop(noticeArea);
}

function openUnitsDialog(opener: HTMLElement): void {
  openDialog({
    name: 'Units',
    opener,
    build: (dialog, close) => {
      const filmGroup = h('div', { role: 'radiogroup', 'aria-label': 'Film build' },
        h('div', { class: 'row' },
          h('label', { class: 'inline' }, h('input', { type: 'radio', name: 'film', value: 'um', ...(state.units.film === 'um' ? { checked: true } : {}) }), ' µm'),
          h('label', { class: 'inline' }, h('input', { type: 'radio', name: 'film', value: 'mil', ...(state.units.film === 'mil' ? { checked: true } : {}) }), ' mil'),
        ));
      const pressureGroup = h('div', { role: 'radiogroup', 'aria-label': 'Tyre pressure' },
        h('div', { class: 'row' },
          h('label', { class: 'inline' }, h('input', { type: 'radio', name: 'pressure', value: 'bar', ...(state.units.pressure === 'bar' ? { checked: true } : {}) }), ' bar'),
          h('label', { class: 'inline' }, h('input', { type: 'radio', name: 'pressure', value: 'psi', ...(state.units.pressure === 'psi' ? { checked: true } : {}) }), ' psi'),
        ));
      const distanceGroup = h('div', { role: 'radiogroup', 'aria-label': 'Distance' },
        h('div', { class: 'row' },
          h('label', { class: 'inline' }, h('input', { type: 'radio', name: 'distance', value: 'km', ...(state.units.distance === 'km' ? { checked: true } : {}) }), ' km'),
          h('label', { class: 'inline' }, h('input', { type: 'radio', name: 'distance', value: 'mi', ...(state.units.distance === 'mi' ? { checked: true } : {}) }), ' mi'),
        ));
      const statusEl = h('p', { class: 'status-region', role: 'status', 'data-region': 'settings' });
      const save = h('button', {
        class: 'primary',
        text: 'Save units',
        onclick: async () => {
          const read = (name: string): string => (dialog.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? '');
          announce(statusEl, SAVING_UNITS);
          save.disabled = true;
          try {
            const response = (await api.put(
              '/api/me/units',
              { film: read('film'), pressure: read('pressure'), distance: read('distance') },
            )) as { units: Units };
            state.units = response.units;
            announce(statusEl, UNITS_UPDATED);
            save.disabled = false;
            close('submit');
            await route();
          } catch (err) {
            save.disabled = false;
            if (err instanceof ApiFailure) {
              announce(statusEl, err.detail.code ?? 'Saving failed.');
            }
          }
        },
      });
      dialog.append(
        h('h2', { text: 'Units' }),
        filmGroup, pressureGroup, distanceGroup,
        statusEl,
        h('div', { class: 'actions' }, save, h('button', { text: 'Close', onclick: () => close('cancel') })),
      );
    },
  });
}

let noticeTimer: number | null = null;

async function startNoticeLoop(noticeArea: HTMLElement): Promise<void> {
  if (noticeTimer !== null) window.clearInterval(noticeTimer);
  const update = async (): Promise<void> => {
    await loadStatus();
    const down: HTMLElement[] = [];
    if (state.status.storage === 'down') down.push(h('p', null, h('span', { class: 'icon', text: '▲' }), SERVICE_NOTICES.storage));
    if (state.status.billing === 'down') down.push(h('p', null, h('span', { class: 'icon', text: '▲' }), SERVICE_NOTICES.billing));
    if (state.status.mail === 'down') down.push(h('p', null, h('span', { class: 'icon', text: '▲' }), SERVICE_NOTICES.mail));
    const region = noticeArea.querySelector<HTMLElement>('[data-region="service"]');
    if (down.length === 0) {
      noticeArea.classList.add('hidden');
      if (region) patchText(region, '');
    } else {
      noticeArea.classList.remove('hidden');
      noticeArea.replaceChildren(h('div', { role: 'status', 'data-region': 'service' }, ...down));
    }
  };
  await update();
  noticeTimer = window.setInterval(update, 5_000);
}

setApiEvents({
  onSessionEnd(kind) {
    if (kind === 'access_revoked') {
      window.location.href = '/sign-in?revoked=1';
      return;
    }
    if (kind === 'unauthenticated') {
      window.location.href = '/sign-in';
      return;
    }
    openSignInAgain();
  },
});

let signInAgainDialog: HTMLDialogElement | null = null;

function openSignInAgain(): void {
  if (signInAgainDialog) return;
  pauseRereads();
  const dialog = document.createElement('dialog');
  dialog.className = 'lq';
  dialog.setAttribute('aria-label', 'Sign in again');
  const email = state.me?.email ?? '';
  const password = h('input', { type: 'password', autocomplete: 'current-password' });
  const errorEl = h('p', { class: 'status-region', role: 'status', 'data-region': 'signin-again-error' });
  const fieldError = h('p', { class: 'error hidden' });
  const submit = h('button', {
    class: 'primary',
    text: 'Sign in again',
    onclick: async () => {
      announce(errorEl, SIGN_IN_AGAIN_PENDING);
      fieldError.classList.add('hidden');
      submit.disabled = true;
      try {
        await api.post('/api/session', { email, password: password.value });
        submit.disabled = false;
        signInAgainDialog = null;
        dialog.close();
        resumeRereads();
        if (interrupted) {
          const action = interrupted;
          interrupted = null;
          await action.resend();
        }
      } catch (err) {
        submit.disabled = false;
        if (err instanceof NoAnswer) {
          announce(errorEl, 'No answer from the server. Try again.');
          return;
        }
        if (err instanceof ApiFailure) {
          password.after(fieldError);
          fieldError.classList.remove('hidden');
          fieldError.textContent = SIGN_IN_AGAIN_REFUSED;
          return;
        }
      }
    },
  });
  dialog.append(
    h('p', { text: SIGN_IN_AGAIN_TEXT }),
    h('p', { text: email }),
    h('div', { class: 'field' }, h('label', { text: 'Password' }), password, fieldError),
    errorEl,
    h('div', { class: 'actions' }, submit),
  );
  dialog.addEventListener('cancel', (event) => event.preventDefault());
  document.body.append(dialog);
  dialog.showModal();
  password.focus();
  signInAgainDialog = dialog;
}

export function signInAgainOpen(): boolean {
  return signInAgainDialog !== null;
}

export async function boot(): Promise<void> {
  setRoute();
  await loadMe();
  if (!state.me) {
    const next = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
    if (state.route.path !== '/sign-in') {
      window.history.replaceState({}, '', `/sign-in?next=${next}`);
      setRoute();
    }
  }
  if (state.route.path === '/sign-in') {
    await loadMe();
  }
  await route();
  void randomKey();
}

void boot();
