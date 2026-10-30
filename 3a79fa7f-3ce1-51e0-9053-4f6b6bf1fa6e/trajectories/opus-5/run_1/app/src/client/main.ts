import { el } from './dom.js';
import { renderShell } from './shell.js';
import { renderHome } from './pages/home.js';
import { renderBoards, renderFoilBoards, renderParts } from './pages/catalogpages.js';
import { renderMatch } from './pages/match.js';
import { renderBuild } from './pages/build.js';
import { renderCart, renderSharedCart } from './pages/cart.js';
import { renderCheckout } from './pages/checkout.js';
import { renderAccount, renderOrderPage } from './pages/account.js';
import { renderTradeIn } from './pages/tradein.js';
import { renderEvents, renderLocations } from './pages/locations.js';
import { renderCallback } from './pages/callback.js';
import { renderContact, renderSupport, renderTrack } from './pages/support.js';
import { renderForgotPassword, renderLogin, renderResetPassword, renderSignup } from './pages/auth.js';
import { renderStaff } from './pages/staff.js';
import { renderFaq, renderNotFound, renderPartners, renderPrivacy, renderProtection, renderShipping } from './pages/info.js';

type Renderer = (main: HTMLElement) => void | Promise<void>;

const ROUTES: Record<string, Renderer> = {
  home: renderHome,
  boards: renderBoards,
  'foil-boards': renderFoilBoards,
  parts: renderParts,
  match: renderMatch,
  build: renderBuild,
  'build-code': renderBuild,
  cart: renderCart,
  'cart-shared': renderSharedCart,
  checkout: renderCheckout,
  account: renderAccount,
  order: renderOrderPage,
  'trade-in': renderTradeIn,
  locations: renderLocations,
  events: renderEvents,
  callback: renderCallback,
  track: renderTrack,
  support: renderSupport,
  contact: renderContact,
  signup: renderSignup,
  login: renderLogin,
  'forgot-password': renderForgotPassword,
  'reset-password': renderResetPassword,
  staff: renderStaff,
  shipping: renderShipping,
  protection: renderProtection,
  faq: renderFaq,
  partners: renderPartners,
  'privacy-policy': renderPrivacy,
  'not-found': renderNotFound,
};

function start(): void {
  const route = document.querySelector('meta[name="tf-route"]')?.getAttribute('content') ?? 'not-found';
  const main = el('main', { id: 'main' });
  renderShell(main, route);
  const render = ROUTES[route] ?? renderNotFound;
  void Promise.resolve(render(main)).catch(() => {
    main.replaceChildren(
      el('div', { class: 'band wrap' }, [
        el('h1', {}, 'Something went wrong'),
        el('div', { class: 'alert-region', role: 'alert' }, 'Something went wrong. Please try again.'),
      ]),
    );
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
