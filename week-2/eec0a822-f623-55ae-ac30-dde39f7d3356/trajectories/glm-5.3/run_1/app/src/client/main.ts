import { h, qs } from './ui.js';
import { loadSession, member, homePath, renderStaffShell } from './shell.js';
import { ApiError } from './api.js';
import {
  signInScreen, fleetScreen, publicYachtScreen, gonePage, endedPage, notFoundPage,
} from './screens-public.js';
import { holdsScreen, holdScreen, staffYachtScreen } from './screens-holds.js';
import { chartersScreen, charterScreen } from './screens-charters.js';
import { passagesScreen, newPassageScreen, passageScreen } from './screens-passages.js';
import { rotaScreen } from './screens-rota.js';
import { berthsScreen, berthBookingScreen, shorePowerScreen } from './screens-marina.js';
import { storesScreen, storeItemScreen, energyScreen } from './screens-stores.js';
import { fleetScreenStaff, profileScreen, brokersScreen, tariffsScreen } from './screens-admin.js';
import { manifestPageScreen, brokerPageScreen } from './screens-pages.js';
import { todayScreen } from './screens-today.js';

const app = qs<HTMLElement>('#app');

async function render(): Promise<void> {
  const loader = qs<HTMLElement>('#loader');
  const path = location.pathname;
  app.textContent = '';
  try {
    // Public pages first.
    if (path === '/sign-in' || path === '/') {
      const params = new URLSearchParams(location.search);
      app.append(signInScreen(params.get('returnTo')));
      return;
    }
    let m: RegExpMatchArray | null;
    if ((m = path.match(/^\/fleet\/([^/]+)$/))) {
      app.append(await fleetScreen(decodeURIComponent(m[1])));
      return;
    }
    if ((m = path.match(/^\/fleet\/([^/]+)\/([^/]+)$/))) {
      app.append(await publicYachtScreen(decodeURIComponent(m[1]), decodeURIComponent(m[2])));
      return;
    }
    if ((m = path.match(/^\/m\/([^/]+)$/))) {
      app.append(await manifestPageScreen(m[1]));
      return;
    }
    if ((m = path.match(/^\/b\/([^/]+)$/))) {
      app.append(await brokerPageScreen(m[1]));
      return;
    }

    // Staff pages need a session.
    if ((m = path.match(/^\/w\/([^/]+)(\/.*)?$/))) {
      const ws = decodeURIComponent(m[1]);
      const rest = m[2] ?? '/';
      const me = await loadSession();
      if (!me) {
        location.href = `/sign-in?returnTo=${encodeURIComponent(path + location.search)}`;
        return;
      }
      let content: HTMLElement | null = null;
      if (rest === '/today') content = await todayScreen(ws);
      else if (rest === '/fleet') content = await fleetScreenStaff(ws);
      else if ((m = rest.match(/^\/yachts\/([^/]+)\/profile$/))) content = await profileScreen(ws, decodeURIComponent(m[1]));
      else if ((m = rest.match(/^\/yachts\/([^/]+)\/rota$/))) content = await rotaScreen(ws, decodeURIComponent(m[1]));
      else if ((m = rest.match(/^\/yachts\/([^/]+)\/stores$/))) content = await storesScreen(ws, decodeURIComponent(m[1]));
      else if ((m = rest.match(/^\/yachts\/([^/]+)\/stores\/([^/]+)$/))) content = await storeItemScreen(ws, decodeURIComponent(m[1]), decodeURIComponent(m[2]));
      else if ((m = rest.match(/^\/yachts\/([^/]+)\/energy$/))) content = await energyScreen(ws, decodeURIComponent(m[1]));
      else if ((m = rest.match(/^\/yachts\/([^/]+)$/))) content = await staffYachtScreen(ws, decodeURIComponent(m[1]));
      else if (rest === '/holds') content = await holdsScreen(ws);
      else if ((m = rest.match(/^\/holds\/([^/]+)$/))) content = await holdScreen(ws, decodeURIComponent(m[1]));
      else if (rest === '/charters') content = await chartersScreen(ws);
      else if ((m = rest.match(/^\/charters\/([^/]+)$/))) content = await charterScreen(ws, decodeURIComponent(m[1]));
      else if (rest === '/passages') content = await passagesScreen(ws);
      else if (rest === '/passages/new') content = await newPassageScreen(ws);
      else if ((m = rest.match(/^\/passages\/([^/]+)$/))) content = await passageScreen(ws, decodeURIComponent(m[1]));
      else if (rest === '/berths') content = await berthsScreen(ws);
      else if ((m = rest.match(/^\/berth-bookings\/([^/]+)$/))) content = await berthBookingScreen(ws, decodeURIComponent(m[1]));
      else if (rest === '/shore-power') content = await shorePowerScreen(ws);
      else if (rest === '/brokers') content = await brokersScreen(ws);
      else if (rest === '/tariffs') content = await tariffsScreen(ws);
      if (content) {
        const announcements = h('div', { 'aria-live': 'polite', 'data-announcements': '', style: 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)' });
        app.append(renderStaffShell(path, [h('main', { class: 'page' }, content), announcements]));
        return;
      }
      app.append(notFoundPage());
      return;
    }

    app.append(notFoundPage());
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 401) {
        location.href = `/sign-in?returnTo=${encodeURIComponent(path + location.search)}`;
        return;
      }
      if (err.status === 410 && err.body?.error === 'yacht_withdrawn') {
        app.append(gonePage());
        return;
      }
      if (err.status === 404) {
        app.append(notFoundPage());
        return;
      }
    }
    console.error(err);
    app.append(notFoundPage());
  } finally {
    loader?.classList.add('hidden');
  }
}

window.addEventListener('popstate', () => { void render(); });
document.addEventListener('click', (e) => {
  const target = (e.target as HTMLElement).closest('a');
  if (!target) return;
  const href = target.getAttribute('href');
  if (!href || href.startsWith('#') || href.startsWith('http')) return;
  e.preventDefault();
  history.pushState(null, '', href);
  void render();
});

void render();
