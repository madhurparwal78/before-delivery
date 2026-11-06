/**
 * Boot and route guards. A visitor only reaches sign in, apply and a share
 * link; every signed-in user who opens a screen their role cannot use is sent
 * to the published landing route for their role and status.
 */

import { handleSessionLoss } from './api.js';
import { ensureUser, landingFor, setCurrentUser } from './session.js';
import {
  mount,
  replace,
  setRouteResolver,
  startRouting,
  type Screen,
  type ScreenContext,
} from './router.js';
import { signInScreen } from './screens/signIn.js';
import { applyScreen } from './screens/apply.js';
import { boardScreen } from './screens/board.js';
import { kitchenScreen } from './screens/kitchen.js';
import { operatorScreen } from './screens/operator.js';
import { shiftScreen } from './screens/shift.js';
import { shareScreen } from './screens/share.js';
import { buildShell } from './ui/shell.js';
import type { Role } from '../shared/types.js';

function appRoot(): HTMLElement {
  const node = document.getElementById('app');
  if (node === null) throw new Error('missing app root');
  return node;
}

const root = appRoot();

/** The icon sprite is inlined so `use` references stay inside this document. */
async function loadIconSprite(): Promise<void> {
  const response = await fetch('/assets/icons.svg', { credentials: 'same-origin' });
  const markup = await response.text();
  const holder = document.createElement('div');
  holder.setAttribute('aria-hidden', 'true');
  holder.style.display = 'none';
  holder.innerHTML = markup;
  document.body.prepend(holder);
}

const SCREEN_ROLES: Record<string, Role[]> = {
  '/board': ['operator', 'shift_lead', 'renter'],
  '/kitchen': ['renter'],
  '/operator': ['operator'],
  '/shift': ['operator', 'shift_lead'],
};

async function resolveRoute(): Promise<void> {
  const path = window.location.pathname;
  const query = new URLSearchParams(window.location.search);
  const context: ScreenContext = { root, path, query };

  if (/^\/share\/[^/]+$/.test(path)) {
    mount(shareScreen, context);
    return;
  }

  const user = await ensureUser();

  if (user === null) {
    if (path === '/apply') {
      mount(applyScreen, context);
      return;
    }
    if (path !== '/') {
      replace('/');
      return;
    }
    mount(signInScreen, context);
    return;
  }

  if (path === '/' || path === '/apply') {
    replace(landingFor(user));
    return;
  }

  const allowed = SCREEN_ROLES[path];
  if (allowed === undefined || !allowed.includes(user.role)) {
    replace(landingFor(user));
    return;
  }

  const screens: Record<string, Screen> = {
    '/board': boardScreen,
    '/kitchen': kitchenScreen,
    '/operator': operatorScreen,
    '/shift': shiftScreen,
  };
  const screen = screens[path];

  const shell = buildShell(user, path);
  mount(() => {
    root.append(shell.element);
    return screen({ ...context, root: shell.main });
  }, context);
}

setRouteResolver(() => {
  void resolveRoute();
});
handleSessionLoss(() => {
  setCurrentUser(null);
  replace('/');
});
startRouting();

void (async () => {
  await loadIconSprite().catch(() => undefined);
  await resolveRoute();
})();
