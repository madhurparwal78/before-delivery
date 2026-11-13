import { api, applyMotionAttributes, qs, qsa } from './core.js';
import { refreshCart, setupBag } from './bag.js';
import { setupCardControls, setupCollection } from './collection.js';
import { setupCheckout } from './checkout.js';
import { setupCompare } from './compare.js';
import { setupAdmin } from './admin.js';
import { setupDialogs } from './dialog.js';
import { setupOrder } from './order.js';
import { setupProduct } from './product.js';
import { setupSearch } from './search.js';
import { onLive, startLive, updateHeaderCounts } from './live.js';

function setupAuth(): void {
  const signIn = qs<HTMLFormElement>('[data-sign-in]');
  signIn?.addEventListener('submit', (event) => {
    event.preventDefault();
    const error = qs<HTMLElement>('[data-form-error]', signIn);
    if (error !== null) error.textContent = '';
    void api('/api/session', {
      method: 'POST',
      body: {
        email: qs<HTMLInputElement>('#sign-in-email', signIn)?.value ?? '',
        password: qs<HTMLInputElement>('#sign-in-password', signIn)?.value ?? ''
      }
    })
      .then(() => {
        const next = new URLSearchParams(window.location.search).get('next');
        window.location.href = next === null ? '/account' : next;
      })
      .catch((reason: unknown) => {
        if (error !== null && reason instanceof Error) error.textContent = reason.message;
      });
  });

  const register = qs<HTMLFormElement>('[data-register]');
  register?.addEventListener('submit', (event) => {
    event.preventDefault();
    for (const node of qsa<HTMLElement>('[data-error-for]', register)) node.textContent = '';
    const error = qs<HTMLElement>('[data-form-error]', register);
    if (error !== null) error.textContent = '';
    void api<{ user: { id: string } }>('/api/accounts', {
      method: 'POST',
      body: {
        name: qs<HTMLInputElement>('#register-name', register)?.value ?? '',
        email: qs<HTMLInputElement>('#register-email', register)?.value ?? '',
        password: qs<HTMLInputElement>('#register-password', register)?.value ?? ''
      }
    })
      .then(() => {
        window.location.href = '/account';
      })
      .catch((reason: unknown) => {
        const body = (reason as { body?: { message: string; fields?: Record<string, string> } }).body;
        if (body === undefined) return;
        if (body.fields !== undefined) {
          for (const [key, copy] of Object.entries(body.fields)) {
            const holder = qs<HTMLElement>(`[data-error-for="${key}"]`, register);
            if (holder !== null) holder.textContent = copy;
          }
        } else if (error !== null) {
          error.textContent = body.message;
        }
      });
  });

  const signOut = qs<HTMLElement>('[data-sign-out]');
  signOut?.addEventListener('click', () => {
    void api('/api/session', { method: 'DELETE' }).then(() => {
      window.location.href = '/';
    });
  });
}

function setupAccountTabs(): void {
  const tabs = qs<HTMLElement>('[data-account-tabs]');
  if (tabs === null) return;
  const select = (name: string): void => {
    for (const tab of qsa<HTMLElement>('[role="tab"]', tabs)) {
      const on = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.setAttribute('tabindex', on ? '0' : '-1');
    }
    for (const panel of qsa<HTMLElement>('[data-panel]')) {
      panel.hidden = panel.dataset.panel !== name;
    }
  };
  tabs.addEventListener('click', (event) => {
    const tab = (event.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
    if (tab === null) return;
    select(tab.dataset.tab ?? 'orders');
  });
  tabs.addEventListener('keydown', (event: KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const list = qsa<HTMLElement>('[role="tab"]', tabs);
    const index = list.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const next = list[(index + step + list.length) % list.length];
    select(next.dataset.tab ?? 'orders');
    next.focus();
  });
}

function boot(): void {
  applyMotionAttributes();
  setupDialogs();
  setupSearch();
  setupBag();
  setupCardControls();
  setupAuth();
  setupAccountTabs();

  const page = document.body.dataset.page ?? '';
  if (page === 'collection' || page === 'wishlist') setupCollection();
  if (page === 'product') setupProduct();
  if (page === 'compare') setupCompare();
  if (page === 'checkout') setupCheckout();
  if (page === 'order') setupOrder();
  if (page.startsWith('admin-')) setupAdmin();

  onLive((type, data) => {
    if (type === 'cart') updateHeaderCounts({ cart: Number(data.count ?? 0) });
    if (type === 'wishlist') updateHeaderCounts({ wishlist: Number(data.count ?? 0) });
    if (type === 'stock' || type === 'price') {
      if (page === 'bag') void refreshCart();
    }
  });

  startLive();

  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => {
    applyMotionAttributes();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
