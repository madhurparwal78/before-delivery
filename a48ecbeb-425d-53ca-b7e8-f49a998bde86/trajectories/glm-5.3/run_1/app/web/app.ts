import { api, announceStatus, dollars, el, provinceName, reducedMotion, type CartView, type Flavour, type Quote, type User } from './api.js';
import { CanTurntable, SCENE_FLAVOURS, createTurntable } from './can.js';
import { lucideIcon } from './icons.js';
import { buildCrateRail, drawCan, registerTotals, renderCartUi, shippingPhrase, store, updateStockDisplays } from './crate.js';

let user: User | null = null;
export function currentUser(): User | null {
  return user;
}

const app = document.getElementById('app')!;

document.body.dataset.reduced = String(reducedMotion());

const SCENES = [
  { id: 'canopy', heading: 'Grown under the canopy', message: 'Organic yerba mate, shade-grown and cold-brewed, then sparkled in small batches.', flavour: 'Guava & Lime' },
  { id: 'river', heading: 'Lightly sparkling, lightly sweet', message: 'Every can carries about 80 mg of caffeine from mate leaves and 30 calories or fewer.', flavour: 'Yuzu Ginger' },
  { id: 'orchard', heading: 'Build your crate', message: 'Mix any 12 cans. Your crate holds them while you shop.', flavour: 'Passionfruit Basil' },
  { id: 'night', heading: 'Every province, exact to the cent', message: 'Tax, deposit and shipping are shown before you pay.', flavour: 'Cacao Orange' },
];

const FAQ_ITEMS = [
  { q: 'How does the can deposit work?', a: 'Each can carries a deposit set by your province. The deposit is never discounted and never taxed, and it is shown as its own line before you pay.' },
  { q: 'When is my card charged for a subscription?', a: 'Your card is charged when your box renews, once per delivery rhythm. You get an email before each renewal and a receipt after it.' },
  { q: 'How long are limited-drop cans held?', a: 'Cans added to your crate are held for 15 minutes. When the hold ends, the cans go back on the shelf.' },
  { q: 'Can I change my box before it ships?', a: 'Yes. Pause, skip or swap your box any time before the change cutoff, which is 48 hours before your next renewal.' },
];

function header(): HTMLElement {
  const nav = el('nav', { 'aria-label': 'Main', class: 'main-nav' },
    el('a', { href: '/box', text: 'Shop' }),
    el('a', { href: '/flavours', text: 'Flavours' }),
    el('a', { href: '/subscribe', text: 'Subscribe' }),
    el('a', { href: '/stockists', text: 'Stockists' }),
    el('a', { href: '/account', text: 'Account' })
  );
  const cartButton = el('button', { class: 'cart-button', 'aria-label': 'Cart (0)', 'data-cart-button': 'true' },
    el('span', { text: 'Cart' }),
    el('span', { class: 'count', 'data-cart-count': 'true', text: '0' })
  );
  cartButton.addEventListener('click', () => openCartDrawer());
  const menuButton = el('button', { class: 'menu-toggle', 'aria-label': 'Menu', 'aria-expanded': 'false', text: 'Menu' });
  const mobileMenu = el('div', { class: 'mobile-menu', 'data-open': 'false' },
    el('ul', {},
      el('li', {}, el('a', { href: '/box', text: 'Shop' })),
      el('li', {}, el('a', { href: '/flavours', text: 'Flavours' })),
      el('li', {}, el('a', { href: '/subscribe', text: 'Subscribe' })),
      el('li', {}, el('a', { href: '/stockists', text: 'Stockists' })),
      el('li', {}, el('a', { href: '/account', text: 'Account' }))
    )
  );
  let menuOpen = false;
  const setMenu = (open: boolean): void => {
    menuOpen = open;
    menuButton.setAttribute('aria-expanded', String(open));
    mobileMenu.dataset.open = String(open);
    if (open) {
      mobileMenu.querySelector('a')?.focus();
    } else {
      menuButton.focus();
    }
  };
  menuButton.addEventListener('click', () => setMenu(!menuOpen));
  mobileMenu.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Escape') setMenu(false);
  });
  document.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Escape' && menuOpen) setMenu(false);
  });
  const header = el('header', { class: 'storefront-header' },
    el('div', { class: 'header-row' },
      el('a', { href: '/', class: 'wordmark', 'aria-label': 'Ceibo home' },
        el('span', { class: 'ceibo-mark', text: 'C' }), 'eibo'),
      nav,
      el('span', { class: 'header-spacer' }),
      menuButton,
      cartButton
    ),
    mobileMenu
  );
  return header;
}

let drawerState: { open: boolean; closing: boolean } = { open: false, closing: false };

function openCartDrawer(): void {
  if (drawerState.closing) {
    drawerState.closing = false;
    return;
  }
  drawerState.open = true;
  const existing = document.querySelector('[data-cart-drawer]') as HTMLElement | null;
  existing?.remove();
  const backdrop = el('div', { class: 'drawer-backdrop', 'data-cart-backdrop': 'true' });
  const drawer = el('aside', { class: 'cart-drawer', 'data-cart-drawer': 'true', role: 'dialog', 'aria-label': 'Cart' });
  const title = el('h2', { text: 'Your cart', id: 'cart-title', tabindex: '-1' });
  const close = el('button', { class: 'btn btn-ghost', 'aria-label': 'Close cart', text: 'Close' });
  const lines = el('ul', { class: 'cart-lines', 'data-cart-lines': 'true' });
  const timer = el('p', { class: 'hold-timer', 'data-hold-timer': 'true', role: 'timer', 'aria-label': 'Hold time left' });
  const totalLine = el('p', { 'data-cart-total': 'true', class: 'mono' });
  const checkout = el('a', { class: 'btn btn-primary', href: '/checkout', text: 'Checkout' });
  const expiredNote = el('p', { 'data-cart-expired': 'true', hidden: true, text: 'Your hold ended and the cans went back on the shelf.' });
  const totalRegionMove = el('div', { 'data-cart-order-total': 'true' });
  drawer.append(title, close, timer, lines, totalLine, totalRegionMove, expiredNote, checkout);
  backdrop.append();
  document.body.append(backdrop, drawer);

  const focusables = (): HTMLElement[] =>
    [...drawer.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea')].filter(
      (n) => !n.hasAttribute('disabled')
    );
  const trap = (e: KeyboardEvent): void => {
    if (e.key !== 'Tab') return;
    const list = focusables();
    if (list.length === 0) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      closeDrawer();
    } else if (e.key === 'Tab') {
      trap(e);
    }
  };
  document.addEventListener('keydown', onKey);
  const closeDrawer = (): void => {
    drawerState.closing = true;
    drawerState.open = false;
    const finish = (): void => {
      drawer.remove();
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      drawerState.closing = false;
      (document.querySelector('[data-cart-button]') as HTMLElement)?.focus();
    };
    if (reducedMotion()) {
      finish();
    } else {
      drawer.classList.add('closing');
      setTimeout(finish, 200);
    }
  };
  close.addEventListener('click', closeDrawer);
  backdrop.addEventListener('click', closeDrawer);
  renderCartContents(drawer);
  title.focus();
}

function renderCartContents(drawer: HTMLElement): void {
  const cart = store.cart;
  if (!cart) return;
  const lines = drawer.querySelector('[data-cart-lines]') as HTMLElement;
  const totalLine = drawer.querySelector('[data-cart-total]') as HTMLElement;
  const expiredNote = drawer.querySelector('[data-cart-expired]') as HTMLElement;
  lines.textContent = '';
  const counts = new Map<string, number>();
  for (const slot of cart.slots) {
    if (slot && slot.flavour) counts.set(slot.flavour, (counts.get(slot.flavour) ?? 0) + 1);
  }
  for (const [slug, qty] of counts) {
    lines.append(el('li', {}, el('span', { text: `${qty} x ${store.flavourName(slug)}` }), el('span', { text: `${qty}` })));
  }
  if (store.quote) {
    totalLine.textContent = `Total ${dollars(store.quote.total_cents)}`;
    const totalRegion = drawer.querySelector('[data-cart-order-total]') as HTMLElement;
    totalRegion.textContent = '';
    const table = el('table', { 'aria-label': 'Price breakdown' });
    const tbody = el('tbody');
    const q = store.quote;
    tbody.append(
      el('tr', {}, el('td', { text: 'Subtotal' }), el('td', { text: dollars(q.goods_cents) })),
      q.subscribe ? el('tr', {}, el('td', { text: 'Subscribe & save (10%)' }), el('td', { text: `-${dollars(q.discount_cents)}` })) : null,
      el('tr', {}, el('td', { text: 'Deposit' }), el('td', { text: dollars(q.deposit_cents) })),
      el('tr', {}, el('td', { text: 'Shipping' }), el('td', { text: q.shipping_cents === 0 && q.lines.length > 0 ? 'Free' : dollars(q.shipping_cents) })),
      ...q.taxes.map((t) => el('tr', {}, el('td', { text: `${t.name} (${t.rate}%)` }), el('td', { text: dollars(t.cents) }))),
      el('tr', { class: 'total-row' }, el('td', { text: 'Total' }), el('td', { text: dollars(q.total_cents) }))
    );
    table.append(tbody);
    totalRegion.append(table);
  }
  expiredNote.hidden = cart.hold.status !== 'expired';
}

function updateHeaderCount(): void {
  const count = store.cart?.count ?? 0;
  const button = document.querySelector('[data-cart-button]') as HTMLElement | null;
  if (button) button.setAttribute('aria-label', `Cart (${count})`);
  const span = document.querySelector('[data-cart-count]') as HTMLElement | null;
  if (span) span.textContent = String(count);
}

export function refreshCartUi(): void {
  updateHeaderCount();
  const drawer = document.querySelector('[data-cart-drawer]') as HTMLElement | null;
  if (drawer) renderCartContents(drawer);
}

function holdTimerLoop(): void {
  setInterval(() => {
    const timer = document.querySelector('[data-hold-timer]') as HTMLElement | null;
    const cart = store.cart;
    if (!timer || !cart) return;
    if (cart.hold.status === 'active' && cart.hold.expires_at) {
      const expiresAt = Date.parse(cart.hold.expires_at) - store.serverSkewMs;
      const left = Math.max(0, expiresAt - Date.now());
      const mm = String(Math.floor(left / 60000)).padStart(2, '0');
      const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');
      timer.textContent = `${mm}:${ss}`;
      if (left <= 0) {
        void pollExpired();
      }
    } else {
      timer.textContent = '00:00';
    }
  }, 1000);
}

let expiryPolling = false;
async function pollExpired(): Promise<void> {
  if (expiryPolling) return;
  expiryPolling = true;
  try {
    const data = await api<{ cart: CartView }>('/api/cart');
    store.cart = data.cart;
    updateHeaderCount();
    refreshCartUi();
    const drawer = document.querySelector('[data-cart-drawer]') as HTMLElement | null;
    if (drawer) renderCartContents(drawer);
    if (data.cart.hold.status !== 'active') {
      const region = document.querySelector('[data-region="crate-updates"]');
      if (region) announceStatus(region, 'Your hold ended and the cans went back on the shelf.');
    }
  } catch {
    // ignore; next tick retries
  } finally {
    expiryPolling = false;
  }
}

function liveFeed(): void {
  const source = new EventSource('/api/live');
  source.addEventListener('stock', (event) => {
    const data = JSON.parse((event as MessageEvent).data) as { flavour: string; stock_left: number };
    const flavour = store.flavours.find((f) => f.slug === data.flavour);
    if (flavour) flavour.stock_left = data.stock_left;
    updateStockDisplays();
    if (flavour) {
      const card = document.querySelector(`[data-flavour-card="${flavour.slug}"]`);
      const notice = card?.querySelector('[data-stock-live-notice]') as HTMLElement | null;
      if (notice) notice.hidden = true;
    }
  });
  source.addEventListener('review', (event) => {
    const data = JSON.parse((event as MessageEvent).data) as { flavour: string; review: { status: string } };
    if (data.review.status === 'approved' && window.location.pathname.startsWith('/flavours/')) {
      renderRoute();
    }
  });
  source.onerror = () => {
    source.close();
    setTimeout(liveFeed, 3000);
  };
}

// ---------- routing ----------

export async function renderRoute(): Promise<void> {
  const path = window.location.pathname;
  app.textContent = '';
  document.body.dataset.office = String(path.startsWith('/office'));
  if (path.startsWith('/office')) {
    const { renderOffice } = await import('./pages/office.js');
    app.append(headerOffice());
    await renderOffice(app);
    return;
  }
  app.append(header());
  if (path === '/') await renderHome();
  else if (path === '/box') await renderBox();
  else if (path.startsWith('/flavours/')) await renderFlavour(path.split('/')[2] ?? '');
  else if (path === '/flavours') await renderFlavoursIndex();
  else if (path === '/subscribe') await renderSubscribeInfo();
  else if (path === '/checkout') await renderCheckout();
  else if (path.startsWith('/orders/') && path.endsWith('/thanks')) await renderThanks(path.split('/')[2] ?? '');
  else if (path === '/account') await renderAccount();
  else if (path.startsWith('/account/subscriptions/')) await renderSubscriptionPath(path);
  else if (path === '/sign-in') renderSignIn();
  else if (path === '/sign-up') renderSignUp();
  else if (path === '/stockists') await renderStockists();
  else if (path === '/stockists/apply') renderApply();
  else if (path.startsWith('/stockists/applications/')) await renderApplication(path.split('/')[3] ?? '');
  else renderNotFound();
  updateHeaderCount();
}

export function renderNotFound(): void {
  const main = el('main', { class: 'page narrow' },
    el('h1', { text: "We couldn't find that page." }),
    el('p', {}, el('a', { href: '/', text: 'Back to the canopy' }))
  );
  app.append(main);
}

function headerOffice(): HTMLElement {
  const top = el('header', { class: 'office-topbar' });
  const who = el('span', { class: 'who', 'data-office-who': 'true' });
  const nav = el('nav', { 'aria-label': 'Back office', class: 'office-nav', 'data-office-nav': 'true' });
  top.append(who, nav);
  return top;
}

function linkNavigate(e: MouseEvent): void {
  const a = (e.target as HTMLElement).closest('a');
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href || href.startsWith('http') || a.target === '_blank') return;
  e.preventDefault();
  window.history.pushState({}, '', href);
  void renderRoute();
}

document.addEventListener('click', linkNavigate);
window.addEventListener('popstate', () => void renderRoute());

// ---------- home ----------

async function renderHome(): Promise<void> {
  await ensureStoreLoaded();
  const main = el('main', {});
  let can: CanTurntable | null = null;
  SCENES.forEach((scene, index) => {
    const section = el('section', {
      class: 'scene',
      'data-scene': scene.id,
      'aria-label': scene.id === 'canopy' ? 'Canopy' : scene.id === 'river' ? 'River' : scene.id === 'orchard' ? 'Orchard' : 'Night sky',
    });
    const message = el('div', { class: 'scene-message' },
      el('h2', { text: scene.heading }),
      el('p', { text: scene.message })
    );
    if (index === 2) {
      message.append(el('a', { class: 'btn btn-primary', href: '/box', text: 'Build your crate' }));
    }
    const stage = el('div', { class: 'can-stage' });
    section.append(el('div', { class: 'wrap' }, message, stage));
    const wrap = section.querySelector('.wrap') as HTMLElement;
    if (index === 0) {
      const turnwrap = el('div', { 'data-can-turntable': 'true' });
      stage.append(turnwrap);
      can = createTurntable(turnwrap, { startFlavour: 'guava-lime', startAngle: 20 });
      const buttons = el('div', { class: 'turn-buttons' },
        el('button', { class: 'turn-button', 'aria-label': 'Turn can left' }, lucideIcon('rotate-ccw', 22)),
        el('button', { class: 'turn-button', 'aria-label': 'Turn can right' }, lucideIcon('rotate-cw', 22))
      );
      const [left, right] = buttons.querySelectorAll('button');
      left.addEventListener('click', () => can?.turn(-45));
      right.addEventListener('click', () => can?.turn(45));
      section.append(el('div', { class: 'turn-buttons', 'data-turn-buttons': 'true' }));
      wrap.append(buttons);
      (wrap.lastChild as HTMLElement).remove();
    }
    main.append(section);
    if (index < SCENES.length - 1) {
      main.append(el('div', { class: 'scene-border', 'aria-hidden': 'true' }));
    }
  });
  // FAQ on the night sky scene
  const faq = el('div', { class: 'home-faq' });
  faq.append(el('h2', { text: 'Questions' }));
  FAQ_ITEMS.forEach((item) => {
    const button = el('button', { class: 'faq-question', 'aria-expanded': 'false', 'aria-controls': `faq-${slugify(item.q)}`, text: item.q });
    const answer = el('div', { class: 'faq-answer', id: `faq-${slugify(item.q)}`, role: 'region', 'aria-label': item.q, hidden: true },
      el('p', { text: item.a })
    );
    const itemEl = el('div', { class: 'faq-item' }, button, answer);
    button.addEventListener('click', () => {
      const open = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!open));
      answer.hidden = open;
    });
    button.addEventListener('keydown', (e) => {
      const items = [...faq.querySelectorAll('.faq-question')] as HTMLElement[];
      const idx = items.indexOf(button);
      if ((e as KeyboardEvent).key === 'ArrowDown' && idx < items.length - 1) {
        e.preventDefault();
        items[idx + 1].focus();
      } else if ((e as KeyboardEvent).key === 'ArrowUp' && idx > 0) {
        e.preventDefault();
        items[idx - 1].focus();
      }
    });
    faq.append(itemEl);
  });
  main.append(faq);
  app.append(main);

  const canStage = main.querySelector('.can-stage') as HTMLElement;
  void canStage;
  const turntable = main.querySelector('[data-can-turntable]') as HTMLElement;
  if (turntable && can) {
    can.setFlavour(SCENE_FLAVOURS[0]);
  }
  // scroll-linked turning and flavour change
  let lastScene = -1;
  const onScroll = (): void => {
    const scenes = [...main.querySelectorAll('.scene')];
    const middle = window.scrollY + window.innerHeight / 2;
    let active = 0;
    scenes.forEach((scene, i) => {
      const rect = scene.getBoundingClientRect();
      if (rect.top <= window.innerHeight / 2) active = i;
    });
    if (active !== lastScene) {
      lastScene = active;
      can?.setFlavour(SCENE_FLAVOURS[active]);
    }
    can?.setScrollAngle(20 + active * 90);
    void middle;
  };
  window.addEventListener('scroll', onScroll, { passive: true });
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ---------- box ----------

async function ensureStoreLoaded(): Promise<void> {
  if (store.flavours.length === 0) await store.loadFlavours();
  await store.loadCart();
  await store.refreshQuote(false);
}

function flavourCard(flavour: Flavour, callbacks: { refresh: () => void }): HTMLElement {
  const card = el('article', { class: 'flavour-card', 'data-flavour-card': flavour.slug });
  const art = el('div', { class: 'can-art-holder' });
  drawCan(art, flavour.slug);
  const info = el('div', {},
    el('h3', { text: flavour.name }),
    el('p', { class: 'flavour-price', text: `$${(flavour.can_price_cents / 100).toFixed(2)}` }),
    el('p', { class: 'flavour-stock' }, el('span', { 'data-stock-left': 'true', text: `${flavour.stock_left} left` })),
    flavour.limited ? el('p', { class: 'muted', text: 'Limited drop' }) : null,
    el('p', { 'data-stock-live-notice': 'true', hidden: true, text: 'Live stock paused. Counts refresh when you add a can.' })
  );
  const badge = el('p', { 'data-sold-out-badge': 'true', hidden: true },
    el('span', { class: 'sold-out-badge' }, el('span', { class: 'icon', 'aria-hidden': 'true' }), ' Sold out'));
  const actions = el('div', { class: 'card-actions' },
    el('button', {
      class: 'btn btn-primary',
      'aria-label': `Add ${flavour.name}`,
      'data-add-button': 'true',
      text: 'Add',
    }),
    el('button', {
      class: 'btn btn-ghost',
      'aria-label': `Fill crate with ${flavour.name}`,
      text: 'Fill crate',
    })
  );
  const [addBtn, fillBtn] = actions.querySelectorAll('button');
  addBtn.addEventListener('click', async () => {
    const { addCans } = await import('./crate.js');
    await addCans(flavour.slug, 1, card, { pageContext: () => ({ page: 'box' }), onCartChange: () => refreshCartUi() });
    callbacks.refresh();
  });
  fillBtn.addEventListener('click', async () => {
    const { addCans } = await import('./crate.js');
    const empty = store.cart ? store.cart.slots.filter((s) => !s || !s.flavour).length : 12;
    if (empty === 0) {
      const region = document.querySelector('[data-region="crate-updates"]');
      if (region) announceStatus(region, `Couldn't add ${flavour.name}: your crate is full. 12 of 12 cans in your crate. ${store.quote ? shippingPhrase(store.quote) : ''}`);
      return;
    }
    await addCans(flavour.slug, empty, card, { pageContext: () => ({ page: 'box' }), onCartChange: () => refreshCartUi() });
    callbacks.refresh();
  });
  card.append(art, info, badge, actions);
  return card;
}

async function renderBox(): Promise<void> {
  await ensureStoreLoaded();
  const main = el('main', { class: 'page' });
  const grid = el('div', { class: 'two-col' });
  const left = el('div', {});
  const heading = el('h1', { text: 'Build your crate' });
  const flavourHeading = el('h2', { class: 'visually-hidden', text: 'Flavours' });
  const list = el('ul', { 'aria-label': 'Flavours', class: 'flavour-list' });
  const refresh = (): void => {
    updateStockDisplays();
  };
  for (const flavour of store.flavours) {
    list.append(el('li', {}, flavourCard(flavour, { refresh })));
  }
  const prev = el('button', { class: 'btn btn-ghost', 'aria-label': 'Previous flavours' }, lucideIcon('chevron-left', 20));
  const next = el('button', { class: 'btn btn-ghost', 'aria-label': 'Next flavours' }, lucideIcon('chevron-right', 20));
  const refreshList = (): void => {
    const items = [...list.children] as HTMLElement[];
    const reduced = window.matchMedia('(max-width: 1199px)').matches;
    const step = reduced ? 1 : items.length;
    let start = 0;
    for (let i = 0; i < items.length; i++) {
      if (items[i].getAttribute('data-visible') === 'true') start = i;
    }
    items.forEach((item, i) => {
      item.hidden = !(i >= start && i < start + step);
      item.setAttribute('data-visible', String(i >= start && i < start + step));
    });
  };
  prev.addEventListener('click', () => {
    const items = [...list.children] as HTMLElement[];
    const firstVisible = items.findIndex((i) => i.getAttribute('data-visible') === 'true');
    const step = window.matchMedia('(max-width: 1199px)').matches ? 1 : items.length;
    const newStart = Math.max(0, firstVisible - step);
    items.forEach((item, i) => {
      item.hidden = !(i >= newStart && i < newStart + step);
      item.setAttribute('data-visible', String(i >= newStart && i < newStart + step));
    });
  });
  next.addEventListener('click', () => {
    const items = [...list.children] as HTMLElement[];
    const firstVisible = items.findIndex((i) => i.getAttribute('data-visible') === 'true');
    const step = window.matchMedia('(max-width: 1199px)').matches ? 1 : items.length;
    const newStart = Math.min(items.length - 1, firstVisible + step);
    items.forEach((item, i) => {
      item.hidden = !(i >= newStart && i < newStart + step);
      item.setAttribute('data-visible', String(i >= newStart && i < newStart + step));
    });
  });
  const carousel = el('div', { class: 'flavour-carousel' }, list, el('div', { class: 'turn-buttons' }, prev, next));
  left.append(heading, flavourHeading, carousel);
  const right = el('div', {});
  grid.append(left, right);
  main.append(grid);
  app.append(main);
  const { buildCrateRail } = await import('./crate.js');
  buildCrateRail(right, {
    pageContext: () => ({ page: 'box' }),
    onCartChange: () => refreshCartUi(),
    onQuote: () => undefined,
  });
  registerTotals(() => ({
    update: () => undefined,
  }));
  refreshList();
  refreshCartUi();
}

// ---------- flavour page ----------

async function renderFlavour(slug: string): Promise<void> {
  await ensureStoreLoaded();
  const flavour = store.flavours.find((f) => f.slug === slug);
  if (!flavour) {
    renderNotFound();
    return;
  }
  const main = el('main', { class: 'page' });
  const grid = el('div', { class: 'two-col' });
  const left = el('div', {});
  left.append(el('h1', { text: flavour.name }));
  const descriptions: Record<string, string> = {
    'guava-lime': 'Guava and lime over cold-brewed mate. Sweet-tart, soft, easy.',
    'yuzu-ginger': 'Yuzu citrus with a warm ginger finish. Bright and clean.',
    'passionfruit-basil': 'Passionfruit layered with garden basil. Herbal and deep.',
    'cacao-orange': 'Cocoa and orange in a richer mate base. Our limited drop.',
  };
  const ingredients: Record<string, string> = {
    'guava-lime': 'Sparkling water, cold-brewed organic yerba mate, guava juice, lime juice.',
    'yuzu-ginger': 'Sparkling water, cold-brewed organic yerba mate, yuzu juice, ginger extract.',
    'passionfruit-basil': 'Sparkling water, cold-brewed organic yerba mate, passionfruit juice, basil.',
    'cacao-orange': 'Sparkling water, cold-brewed organic yerba mate, cocoa extract, orange juice.',
  };
  left.append(el('p', { class: 'lede', text: descriptions[flavour.slug] ?? '' }));
  left.append(el('h2', { text: 'Ingredients' }));
  left.append(el('p', { text: ingredients[flavour.slug] ?? '' }));
  left.append(el('h2', { text: 'Reviews' }));
  const reviewsList = el('ul', { 'aria-label': 'Reviews', class: 'list-plain', 'data-reviews': 'true' });
  const status = el('p', { role: 'status', 'aria-live': 'polite', class: 'generic-status', 'data-region': 'review-status' });
  const rating = el('div', { role: 'radiogroup', 'aria-label': 'Rating', class: 'field-row' },
    [1, 2, 3, 4, 5].map((n) => el('label', {}, el('input', { type: 'radio', name: 'rating', value: String(n) }), ` ${n}`))
  );
  const body = el('textarea', { 'aria-label': 'Your review', rows: '4', class: 'field-row' });
  body.style.width = '100%';
  const post = el('button', { class: 'btn btn-primary', text: 'Post review' });
  post.addEventListener('click', async () => {
    const checked = rating.querySelector('input:checked') as HTMLInputElement | null;
    const value = body.value.trim();
    if (!checked || value.length < 10) {
      announceStatus(status, 'Pick a rating and write at least 10 characters.');
      return;
    }
    try {
      await api(`/api/flavours/${flavour.slug}/reviews`, {
        json: { rating: Number(checked.value), body: value },
      });
      announceStatus(status, "Thanks. Your review will appear once it's approved.");
      body.value = '';
    } catch (e) {
      const err = e as { status?: number; body?: { error?: string; message?: string } };
      if (err.body?.error === 'not_a_buyer') announceStatus(status, 'Only customers who bought this flavour can review it.');
      else if (err.body?.error === 'already_reviewed') announceStatus(status, "You've already reviewed this flavour.");
      else if (err.status === 401) window.location.href = `/sign-in?next=${encodeURIComponent(window.location.pathname)}`;
      else announceStatus(status, 'Reviews are paused for a moment. Try again shortly.');
    }
  });
  left.append(reviewsList, rating, body, post, status);
  const right = el('div', {});
  grid.append(left, right);
  main.append(grid);
  app.append(main);
  const { buildCrateRail } = await import('./crate.js');
  buildCrateRail(right, {
    pageContext: () => ({ page: 'flavour' }),
    onCartChange: () => refreshCartUi(),
  });
  registerTotals(() => ({ update: () => undefined }));
  refreshCartUi();
  try {
    const data = await api<{ reviews: { id: string; rating: number; body: string; author_first_name: string; created_at: string }[] }>(
      `/api/flavours/${flavour.slug}/reviews`
    );
    for (const review of data.reviews) {
      reviewsList.append(el('li', {},
        el('p', { text: review.body }),
        el('p', { class: 'muted mono', text: `${'★'.repeat(review.rating)} by ${review.author_first_name}` })
      ));
    }
  } catch {
    reviewsList.append(el('li', { text: 'Reviews are unavailable right now.' }));
  }
}

async function renderFlavoursIndex(): Promise<void> {
  await ensureStoreLoaded();
  const main = el('main', { class: 'page' });
  main.append(el('h1', { text: 'Flavours' }));
  const list = el('ul', { 'aria-label': 'Flavours', class: 'flavour-list' });
  for (const flavour of store.flavours) {
    const li = el('li', {},
      el('a', { href: `/flavours/${flavour.slug}` }, el('h2', { text: flavour.name })),
      el('p', { class: 'flavour-price', text: `$${(flavour.can_price_cents / 100).toFixed(2)}` }),
      el('p', { class: 'flavour-stock', text: `${flavour.stock_left} left` }));
    list.append(li);
  }
  main.append(list);
  app.append(main);
}

async function renderSubscribeInfo(): Promise<void> {
  const main = el('main', { class: 'page narrow' },
    el('h1', { text: 'Subscribe and save 10%' }),
    el('p', { text: 'Build a crate of 12 cans - one flavour or four of each - and choose monthly or every two months. Each box renews automatically and you can pause, skip or swap any time before the change cutoff.' }),
    el('p', {}, el('a', { class: 'btn btn-primary', href: '/box', text: 'Build your crate' }))
  );
  app.append(main);
}

import { renderCheckout, renderThanks } from './pages/checkout.js';
import { renderAccount, renderSubscriptionPath } from './pages/account.js';
import { renderSignIn, renderSignUp } from './pages/auth.js';
import { renderStockists, renderApply, renderApplication } from './pages/stockists.js';

void quoteType;

type quoteType = Quote | null;
export type { CartView, User };

async function boot(): Promise<void> {
  try {
    const me = await api<{ user: User }>('/api/me');
    user = me.user;
  } catch {
    user = null;
  }
  await renderRoute();
  holdTimerLoop();
  liveFeed();
}

void boot;
export { boot, el, dollars, provinceName };
