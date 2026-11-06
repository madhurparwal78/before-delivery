import { api, ApiError, type BarnDay, type Me, type Practice } from './api.js';
import { clear, el } from './dom.js';
import { announce, mountNotices, pending, failureCopy } from './notices.js';
import { copy } from './copy.js';
import { buildShell, loadRailDays, type ScreenContext, type Shell } from './shell.js';
import { renderDay } from './screens/day.js';
import { renderHorses, renderHorsePanel } from './screens/horses.js';
import { renderInvoices } from './screens/invoices.js';
import { renderPrices } from './screens/prices.js';
import { renderDashboard } from './screens/dashboard.js';
import { renderVetPage } from './screens/vet.js';

/**
 * The single page app. Every screen has its own path, and loading, reloading, Back,
 * Forward and signing in all restore the same sheet or panel.
 */
let shell: Shell | null = null;
let me: Me | null = null;
let practice: Practice | null = null;
let timers: number[] = [];
let teardowns: (() => void)[] = [];

function clearScreenWork(): void {
  for (const timer of timers) window.clearInterval(timer);
  timers = [];
  for (const work of teardowns) work();
  teardowns = [];
}

/** A return target must be a path on this site starting with a single slash. */
function safeReturnTarget(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

function navigate(path: string): void {
  window.history.pushState({}, '', path);
  void render();
}

function replace(path: string): void {
  window.history.replaceState({}, '', path);
  shell?.setCurrentPath(window.location.pathname);
}

async function signOut(): Promise<void> {
  try {
    await api.delete('/api/session');
  } catch {
    // Signing out still takes effect on the next render.
  }
  me = null;
  practice = null;
  shell = null;
  clearScreenWork();
  window.history.pushState({}, '', '/sign-in');
  await render();
}

function renderSignIn(returnTo: string): void {
  clearScreenWork();
  clear(document.body);
  const email = el('input', {
    type: 'text',
    id: 'email',
    'aria-label': 'Email',
    autocomplete: 'username',
  }) as HTMLInputElement;
  const password = el('input', {
    type: 'password',
    id: 'password',
    'aria-label': 'Password',
    autocomplete: 'current-password',
  }) as HTMLInputElement;
  const submit = el('button', { type: 'submit', class: 'primary', text: 'Sign in' }) as HTMLButtonElement;
  const form = el('form', { 'aria-label': 'Sign in' }, [
    el('span', { class: 'wordmark', text: 'Rasp & Rein' }),
    el('div', { class: 'field' }, [el('label', { for: 'email', text: 'Email' }), email]),
    el('div', { class: 'field' }, [el('label', { for: 'password', text: 'Password' }), password]),
    submit,
  ]) as HTMLFormElement;

  const wrapper = el('div', { class: 'signin' }, [form]);
  document.body.append(wrapper);
  mountNotices(wrapper);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async (): Promise<void> => {
      const handle = pending(submit, copy.signingIn);
      try {
        await api.post<{ user: Me }>('/api/session', {
          body: { email: email.value, password: password.value },
        });
        handle.done();
        // After signing in, the browser is at the originally requested path and query.
        window.history.replaceState({}, '', returnTo);
        me = null;
        await render();
      } catch (error) {
        const failure = error instanceof ApiError ? error.failure : null;
        handle.failed(
          failure !== null && failure.status === 401 && !failure.network
            ? copy.signInWrong
            : failureCopy(error, copy.networkFailure),
        );
        email.focus();
      }
    })();
  });
  email.focus();
}

function screenContext(): ScreenContext {
  const current = shell as Shell;
  return {
    me: me as Me,
    practice: practice as Practice,
    main: current.main,
    navigate,
    replace,
    refreshRail: async () => {
      const days = await loadRailDays();
      current.setRailDays(days);
      current.setCurrentPath(window.location.pathname);
    },
    onRefresh: (work, everyMs) => {
      const timer = window.setInterval(() => void work().catch(() => undefined), everyMs);
      timers.push(timer);
    },
    onTeardown: (work) => teardowns.push(work),
    barnDays: () => current.days(),
  };
}

async function render(): Promise<void> {
  const path = window.location.pathname;
  const search = window.location.search;

  // The vet page needs no session at all.
  const vetMatch = /^\/vet\/([^/]+)$/.exec(path);
  if (vetMatch !== null) {
    clearScreenWork();
    await renderVetPage(decodeURIComponent(vetMatch[1] as string));
    return;
  }

  if (me === null) {
    try {
      me = await api.get<Me>('/api/me');
      practice = await api.get<Practice>('/api/practice');
    } catch (error) {
      const failure = error instanceof ApiError ? error.failure : null;
      if (failure?.network === true) {
        clear(document.body);
        const host = el('div', { class: 'signin' }, [
          el('p', { class: 'form-error', text: copy.networkFailure }),
        ]);
        document.body.append(host);
        mountNotices(host);
        return;
      }
      // Opening any app URL while signed out shows the Sign in form.
      renderSignIn(path === '/sign-in' ? '/' : safeReturnTarget(`${path}${search}`));
      return;
    }
  }

  if (path === '/sign-in') {
    window.history.replaceState({}, '', '/');
    await render();
    return;
  }

  if (shell === null) {
    shell = buildShell(me, navigate, signOut);
    shell.setRailDays(await loadRailDays());
  }
  clearScreenWork();
  shell.setCurrentPath(path);
  const ctx = screenContext();
  clear(ctx.main);

  const dayMatch = /^\/days\/([^/]+)$/.exec(path);
  const horseMatch = /^\/horses\/([^/]+)$/.exec(path);

  try {
    if (dayMatch !== null) {
      await renderDay(ctx, decodeURIComponent(dayMatch[1] as string));
    } else if (horseMatch !== null) {
      // A missing or unknown hoof value selects Left fore.
      const hoof = new URLSearchParams(search).get('hoof') ?? 'LF';
      await renderHorsePanel(ctx, decodeURIComponent(horseMatch[1] as string), hoof);
    } else if (path === '/horses') {
      await renderHorses(ctx);
    } else if (path === '/invoices') {
      await renderInvoices(ctx);
    } else if (path === '/prices') {
      await renderPrices(ctx);
    } else if (path === '/dashboard') {
      await renderDashboard(ctx);
    } else if (path === '/') {
      const first = shell.days()[0];
      if (first !== undefined) {
        window.history.replaceState({}, '', `/days/${first.id}`);
        shell.setCurrentPath(`/days/${first.id}`);
        await renderDay(ctx, first.id);
      }
    } else {
      ctx.main.append(el('p', { class: 'form-error', text: copy.dayNotAvailable }));
    }
  } catch (error) {
    const failure = error instanceof ApiError ? error.failure : null;
    if (failure?.status === 401 && !failure.network) {
      me = null;
      shell = null;
      renderSignIn(safeReturnTarget(`${path}${search}`));
      return;
    }
    const message = failureCopy(error, copy.networkFailure);
    ctx.main.append(el('p', { class: 'form-error', text: message }));
    announce(message);
  }

  // After a refresh the rail text equals the API's counts.
  ctx.onRefresh(async () => {
    const days: BarnDay[] = await loadRailDays();
    shell?.setRailDays(days);
    shell?.setCurrentPath(window.location.pathname);
  }, 30000);
}

window.addEventListener('popstate', () => void render());
void render();
