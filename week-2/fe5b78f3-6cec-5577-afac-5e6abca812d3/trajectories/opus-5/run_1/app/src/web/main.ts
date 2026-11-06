import { ApiRequestError, api } from './api';
import { clearAllDrafts, createState } from './app-state';
import { icon, routeRibbon } from './components';
import type { RibbonStop } from './components';
import { clear, h } from './dom';
import type { Router, Screen, ScreenContext } from './screen';
import { renderSignIn, renderRegister } from './screens/auth';
import { renderBookingDetail } from './screens/booking-detail';
import { renderBooking } from './screens/booking';
import { renderMyBookings } from './screens/my-bookings';
import { renderNotFound } from './screens/not-found';
import { renderPnrStatus } from './screens/pnr';
import { renderResults } from './screens/results';
import { renderSearch } from './screens/search';

async function start(): Promise<void> {
  const root = document.getElementById('app');
  if (root === null) return;

  const state = createState();
  const navSlot = document.createElement('nav');
  navSlot.setAttribute('aria-label', 'Main');
  navSlot.className = 'nav';
  const ribbonSlot = h('div');
  const main = h('main', { id: 'main' });
  let cleanup: (() => void) | null = null;

  const router: Router = {
    go(path: string, replace = false) {
      if (replace) window.history.replaceState({}, '', path);
      else window.history.pushState({}, '', path);
      void render();
    },
    state,
    refreshNav() {
      paintNav();
    },
  };

  function paintNav(): void {
    clear(navSlot);
    for (const [label, path] of [
      ['Search trains', '/'],
      ['My bookings', '/bookings'],
      ['PNR status', '/pnr'],
    ] as const) {
      const link = h('a', { href: path }, [label]);
      link.addEventListener('click', (event) => {
        event.preventDefault();
        router.go(path);
      });
      navSlot.appendChild(link);
    }
    if (state.account === null) {
      const link = h('a', { href: '/signin' }, ['Sign in']);
      link.addEventListener('click', (event) => {
        event.preventDefault();
        router.go('/signin');
      });
      navSlot.appendChild(link);
      return;
    }
    const button = h('button', { type: 'button' }, ['Sign out']);
    button.addEventListener('click', () => {
      void api.signOut().then(() => {
        state.account = null;
        clearAllDrafts();
        router.go('/');
      });
    });
    navSlot.appendChild(button);
  }

  function setRibbon(stops: readonly RibbonStop[]): void {
    clear(ribbonSlot);
    if (stops.length > 0) ribbonSlot.appendChild(routeRibbon(stops));
  }

  async function render(): Promise<void> {
    cleanup?.();
    cleanup = null;
    paintNav();
    clear(main);
    setRibbon([]);
    const url = new URL(window.location.href);
    const context: ScreenContext = { router, state, main, url, setRibbon };
    const path = url.pathname;
    let screen: Screen;
    if (path === '/') screen = await renderSearch(context);
    else if (path === '/trains') screen = await renderResults(context);
    else if (path === '/book') screen = await renderBooking(context);
    else if (path === '/bookings') screen = await renderMyBookings(context);
    else if (/^\/bookings\/[^/]+$/.test(path)) {
      screen = await renderBookingDetail(context, decodeURIComponent(path.split('/')[2]));
    } else if (path === '/pnr') screen = await renderPnrStatus(context, null);
    else if (/^\/pnr\/[^/]+$/.test(path)) {
      screen = await renderPnrStatus(context, decodeURIComponent(path.split('/')[2]));
    } else if (path === '/signin') screen = await renderSignIn(context);
    else if (path === '/register') screen = await renderRegister(context);
    else screen = renderNotFound(context);
    if (screen.ribbon.length > 0) setRibbon(screen.ribbon);
    cleanup = screen.cleanup ?? null;
  }

  const brand = h('a', { class: 'wordmark', href: '/' }, [icon('train-front'), 'Pakka Rail']);
  brand.addEventListener('click', (event) => {
    event.preventDefault();
    router.go('/');
  });
  const view = h('div', { class: 'shell' }, [
    h('header', { class: 'topbar' }, [brand, navSlot]),
    ribbonSlot,
    main,
  ]);
  clear(root);
  root.appendChild(view);

  window.addEventListener('popstate', () => {
    void render();
  });

  try {
    state.account = await api.me();
  } catch (error) {
    if (!(error instanceof ApiRequestError)) throw error;
  }
  state.stations = await api.stations().then((body) => body.stations).catch(() => []);
  await state.clock.load().catch(() => undefined);
  await render();
}

void start();
