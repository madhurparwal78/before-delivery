import { post } from './api.js';
import { clear, el, svgIcon, type Child } from './dom.js';
import { cachedCart, clearMe, loadCart, loadMe, onCartChange } from './store.js';
import { announce, button, field, openDialog, reducedMotion, setStatusRegion } from './ui.js';
import type { Cart, Me } from './types.js';
import { openSearchDialog } from './search.js';

interface MenuSpec {
  name: string;
  items: Child[];
}

function menuLinks(): MenuSpec[] {
  return [
    {
      name: 'Boards',
      items: [
        el('a', { href: '/boards#drift' }, 'Drift'),
        el('a', { href: '/boards#crest' }, 'Crest'),
        el('a', { href: '/boards#swift' }, 'Swift'),
        el('a', { href: '/boards' }, 'Compare all boards'),
        el('div', { class: 'card', style: 'padding:0.75rem;margin-top:0.35rem' }, [
          el('p', { class: 'caption', style: 'margin:0' }, 'Talk to a rider advisor'),
          el('a', { href: '/callback' }, 'Book a call'),
        ]),
      ],
    },
    {
      name: 'Parts',
      items: [
        el('a', { href: '/foil-boards' }, 'Foil boards'),
        el('a', { href: '/parts' }, 'All parts'),
        el('a', { href: '/parts#wings' }, 'Wings'),
      ],
    },
    {
      name: 'Ride',
      items: [
        el('a', { href: '/events' }, 'Demo events'),
        el('a', { href: '/match' }, 'Find my board'),
        el('a', { href: '/locations' }, 'Demo stations'),
      ],
    },
    {
      name: 'Help',
      items: [
        el('a', { href: '/track' }, 'Track an order'),
        el('a', { href: '/support' }, 'Open a support case'),
        el('a', { href: '/protection' }, 'Protection plans'),
        el('a', { href: '/shipping' }, 'Shipping and fees'),
      ],
    },
  ];
}

let openPanel: { panel: HTMLElement; trigger: HTMLElement } | null = null;

function closeMenu(returnFocus = false): void {
  if (!openPanel) return;
  const { panel, trigger } = openPanel;
  openPanel = null;
  panel.remove();
  trigger.setAttribute('aria-expanded', 'false');
  if (returnFocus) trigger.focus();
}

function toggleMenu(trigger: HTMLElement, host: HTMLElement, items: Child[]): void {
  const wasOpen = openPanel?.trigger === trigger;
  closeMenu(false);
  if (wasOpen) return;
  const panel = el('div', { class: reducedMotion() ? 'menu-panel' : 'menu-panel unfolding' }, items);
  host.appendChild(panel);
  trigger.setAttribute('aria-expanded', 'true');
  openPanel = { panel, trigger };
}

document.addEventListener('mousedown', (event) => {
  if (!openPanel) return;
  const target = event.target as Node;
  if (!openPanel.panel.contains(target) && !openPanel.trigger.contains(target)) closeMenu(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && openPanel) {
    event.preventDefault();
    closeMenu(true);
  }
});

function cartLink(): { node: HTMLAnchorElement; update: (cart: Cart) => void } {
  const badge = el('span', { class: 'cart-badge', 'aria-hidden': 'true' }, '0');
  const node = el('a', { href: '/cart', class: 'cart-link', 'aria-label': 'Cart, 0 items' }, [svgIcon('bag'), badge]);
  return {
    node,
    update(cart) {
      badge.textContent = String(cart.item_count);
      node.setAttribute('aria-label', `Cart, ${cart.item_count} items`);
    },
  };
}

function accountMenu(host: HTMLElement, me: Me | null): HTMLElement {
  const trigger = el(
    'button',
    { class: 'menu-button', type: 'button', 'aria-expanded': 'false', 'aria-label': 'Account' },
    svgIcon('person'),
  );
  trigger.addEventListener('click', () => {
    const items: Child[] = me
      ? [
          el('a', { href: me.user.role === 'customer' ? '/account' : '/staff' }, 'My account'),
          (() => {
            const signOut = el('button', { type: 'button' }, 'Sign out');
            signOut.addEventListener('click', async () => {
              await post('/api/auth/logout');
              clearMe();
              window.location.assign('/');
            });
            return signOut;
          })(),
        ]
      : [el('a', { href: '/login' }, 'Sign in'), el('a', { href: '/signup' }, 'Create account')];
    toggleMenu(trigger, host, items);
  });
  return trigger;
}

function newsletterForm(): HTMLElement {
  const email = field('Newsletter email', 'text', { type: 'email', autocomplete: 'email' });
  email.control.setAttribute('aria-label', 'Newsletter email');
  const consentId = 'newsletter-consent';
  const consent = el('input', { type: 'checkbox', id: consentId });
  const feedback = el('p', { class: 'caption', role: 'status' });
  const submit = button('Sign up', { 'aria-label': 'Sign up for the newsletter' });

  const form = el('form', { novalidate: true }, [
    el('h3', {}, 'The Tern Foils dispatch: new parts and demo dates'),
    email.wrapper,
    el('div', { class: 'field' }, [
      el('div', { class: 'row', style: 'gap:0.5rem;align-items:flex-start' }, [
        consent,
        el('label', { for: consentId }, 'I agree to receive the dispatch and have read the privacy notice'),
      ]),
    ]),
    submit,
    feedback,
  ]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    email.setError(null);
    feedback.textContent = 'Signing up...';
    submit.disabled = true;
    const result = await post<{ message: string; fields?: Record<string, string> }>('/api/newsletter', {
      email: email.control.value,
      consent: consent.checked,
    });
    submit.disabled = false;
    if (result.ok) {
      feedback.textContent = 'Thanks for subscribing.';
      return;
    }
    feedback.textContent = '';
    const fields = (result.body as { fields?: Record<string, string> }).fields ?? {};
    if (fields.email) email.setError(fields.email);
    if (fields.consent) feedback.textContent = fields.consent;
  });

  return form;
}

export function renderShell(main: HTMLElement, route: string): void {
  const root = document.getElementById('app');
  if (!root) throw new Error('Missing app root');
  clear(root);

  const status = el('div', { class: 'status-region', role: 'status', 'aria-live': 'polite', 'aria-label': 'Announcements' });
  setStatusRegion(status);

  const header = el('header', { class: 'site-header' });
  const nav = el('nav', { class: 'header-nav', 'aria-label': 'Main' });
  for (const spec of menuLinks()) {
    const trigger = el('button', { class: 'menu-button', type: 'button', 'aria-expanded': 'false' }, [
      el('span', {}, spec.name),
      svgIcon('caret'),
    ]);
    trigger.addEventListener('click', () => toggleMenu(trigger, header, spec.items));
    nav.appendChild(trigger);
  }

  const mobileMenu = el(
    'button',
    { class: 'menu-button menu-button-mobile', type: 'button', 'aria-expanded': 'false' },
    'Menu',
  );
  mobileMenu.addEventListener('click', () => {
    mobileMenu.setAttribute('aria-expanded', 'true');
    openDialog({
      title: 'Menu',
      opener: mobileMenu,
      content: menuLinks().map((spec) =>
        el('div', { class: 'stack', style: 'margin-bottom:1rem' }, [el('h3', {}, spec.name), ...spec.items]),
      ),
      onClose: () => mobileMenu.setAttribute('aria-expanded', 'false'),
    });
  });

  // The locator page publishes its own "Search" button, and every name is unique on its page.
  const searchLabel = route === 'locations' ? 'Search the catalog' : 'Search';
  const searchButton = el('button', { class: 'menu-button', type: 'button', 'aria-label': searchLabel }, svgIcon('search'));
  searchButton.addEventListener('click', () => openSearchDialog(searchButton));

  const cart = cartLink();
  const tools = el('div', { class: 'header-tools' }, [searchButton, accountMenu(header, null), cart.node]);

  header.appendChild(
    el('div', { class: 'header-inner' }, [
      el('a', { href: '/', class: 'wordmark', 'aria-label': 'Tern Foils home' }, 'Tern Foils'),
      nav,
      mobileMenu,
      tools,
    ]),
  );

  const announcementBar = el(
    'div',
    { class: 'announcement-bar' },
    el('a', { href: '/trade-in' }, ['Trade in your old board for credit', svgIcon('arrow')]),
  );

  const footer = el('footer', { class: 'site-footer' }, [
    el('div', { class: 'footer-grid' }, [
      el('div', { class: 'stack' }, [
        el('h3', {}, 'Boards'),
        el('a', { href: '/boards' }, 'Compare all boards'),
        el('a', { href: '/foil-boards' }, 'Foil boards'),
        el('a', { href: '/parts' }, 'Parts'),
      ]),
      el('div', { class: 'stack' }, [
        el('h3', {}, 'Ride'),
        el('a', { href: '/locations' }, 'Demo stations'),
        el('a', { href: '/events' }, 'Demo events'),
        el('a', { href: '/match' }, 'Take the board quiz'),
      ]),
      el('div', { class: 'stack' }, [
        el('h3', {}, 'Workshop'),
        el('a', { href: '/partners' }, 'Partners'),
        el('a', { href: '/privacy-policy' }, 'Privacy policy'),
        el('a', { href: '/contact' }, 'Write to the workshop'),
        el('a', { href: '/faq' }, 'Rider questions'),
      ]),
      newsletterForm(),
    ]),
    el('p', { class: 'footer-note' }, '(C) 2026 Tern Foils'),
  ]);

  root.append(status, announcementBar, header, main, footer);

  onCartChange((value) => cart.update(value));
  void loadCart().then((value) => cart.update(value));
  void loadMe().then((me) => {
    const fresh = accountMenu(header, me);
    tools.replaceChild(fresh, tools.children[1]!);
  });
}

/** Adding to the cart opens the drawer from the right. */
export function openCartDrawer(lineName: string, opener: HTMLElement | null): void {
  const cart = cachedCart();
  const count = cart?.item_count ?? 0;
  openDialog({
    title: 'Item added to your cart',
    variant: 'drawer',
    opener,
    content: [
      el('p', {}, `${lineName} is in your cart.`),
      el('div', { class: 'row' }, [
        el('a', { href: '/cart', class: 'btn btn-secondary' }, 'View cart'),
        el('a', { href: '/checkout', class: 'btn' }, 'Check out'),
      ]),
    ],
  });
  announce(`Added ${lineName}. Cart has ${count} items.`);
}
