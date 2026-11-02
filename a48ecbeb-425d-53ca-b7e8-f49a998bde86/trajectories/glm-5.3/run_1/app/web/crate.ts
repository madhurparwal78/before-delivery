import { api, announceStatus, dollars, el, provinceName, reducedMotion, type CartView, type Flavour, type Quote } from './api.js';
import { lucideIcon } from './icons.js';

export interface CrateCallbacks {
  onCartChange?: (cart: CartView) => void;
  onQuote?: (quote: Quote) => void;
  pageContext: () => { page: 'box' | 'flavour' };
}

export class StoreState {
  flavours: Flavour[] = [];
  cart: CartView | null = null;
  quote: Quote | null = null;
  serverSkewMs = 0;
  flavourNames: Record<string, string> = {};

  flavourName(slug: string | null): string {
    if (!slug) return '';
    return this.flavourNames[slug] ?? slug;
  }

  stockLeft(slug: string): number {
    return this.flavours.find((f) => f.slug === slug)?.stock_left ?? 0;
  }

  crateEligible(): boolean {
    if (!this.cart) return false;
    const slots = this.cart.slots.filter((s) => s && s.flavour) as { flavour: string }[];
    if (slots.length !== 12) return false;
    const counts = new Map<string, number>();
    for (const s of slots) counts.set(s.flavour, (counts.get(s.flavour) ?? 0) + 1);
    if (counts.size === 1) {
      const flavour = this.flavours.find((f) => f.slug === [...counts.keys()][0]);
      return !!flavour?.subscribable;
    }
    if (counts.size === 3) {
      return ['guava-lime', 'yuzu-ginger', 'passionfruit-basil'].every(
        (slug) => (counts.get(slug) ?? 0) === 4
      );
    }
    return false;
  }

  async loadFlavours(): Promise<void> {
    const data = await api<{ flavours: Flavour[] }>('/api/flavours');
    this.flavours = data.flavours;
    for (const f of this.flavours) this.flavourNames[f.slug] = f.name;
  }

  async loadCart(): Promise<CartView> {
    const data = await api<{ cart: CartView }>('/api/cart');
    this.cart = data.cart;
    this.serverSkewMs = Date.now() - Date.parse(data.cart.server_time);
    return data.cart;
  }

  async refreshQuote(announceChange: boolean): Promise<void> {
    if (!this.cart) return;
    const counts = new Map<string, number>();
    for (const slot of this.cart.slots) {
      if (slot && slot.flavour) counts.set(slot.flavour, (counts.get(slot.flavour) ?? 0) + 1);
    }
    const data = await api<Quote>('/api/quote', {
      json: {
        province: this.cart.province,
        subscribe: this.cart.subscribe,
        cans: [...counts.entries()].map(([flavour, quantity]) => ({ flavour, quantity })),
      },
    });
    this.quote = data;
    if (announceChange) {
      const region = document.querySelector('[data-region="total-updates"]');
      if (region) announceStatus(region, `Total ${dollars(data.total_cents)} with shipping to ${provinceName(data.province)}.`);
    }
  }
}

export const store = new StoreState();

export function shippingPhrase(quote: Quote): string {
  if (quote.free_shipping.remaining_cents <= 0) {
    return `Free shipping unlocked in ${provinceName(quote.province)}.`;
  }
  return `$${(quote.free_shipping.remaining_cents / 100).toFixed(2)} to free shipping in ${provinceName(quote.province)}.`;
}

function flavourColour(slug: string): { label: string; band?: string } {
  const map: Record<string, { label: string; band?: string }> = {
    'guava-lime': { label: '#e88fa2', band: '#cfe37a' },
    'yuzu-ginger': { label: '#f2c14e' },
    'passionfruit-basil': { label: '#8a63b5' },
    'cacao-orange': { label: '#5a3a2b', band: '#e88a3c' },
  };
  return map[slug] ?? { label: '#e88fa2' };
}

export function drawCan(container: HTMLElement, slug: string, small = false): void {
  const c = flavourColour(slug);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 40 56');
  svg.setAttribute('class', small ? 'can-art slot-can' : 'can-art');
  svg.setAttribute('aria-hidden', 'true');
  const rect = (x: string, y: string, w: string, h: string, fill: string, rx = '6') => {
    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', w); r.setAttribute('height', h);
    r.setAttribute('rx', rx); r.setAttribute('fill', fill);
    return r;
  };
  svg.append(rect('12', '2', '16', '52', c.label, '5'));
  const label = rect('12', '18', '16', '14', 'rgba(245,239,223,0.9)', '2');
  svg.append(label);
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', '20');
  text.setAttribute('y', '27');
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('font-size', '4.5');
  text.setAttribute('font-weight', '700');
  text.textContent = 'CEIBO';
  svg.append(text);
  if (c.band) svg.append(rect('12', '44', '16', '6', c.band, '2'));
  container.append(svg);
}

export interface CrateUi {
  root: HTMLElement;
  rerender: () => void;
}

export function buildCrateRail(parent: HTMLElement, callbacks: CrateCallbacks): CrateUi {
  const root = el('section', { class: 'crate-rail', 'data-region': 'crate' });
  const heading = el('h2', { text: 'Your crate' });
  const counter = el('p', {
    class: 'crate-counter',
    'data-region': 'crate-counter',
    'aria-label': 'Cans in crate',
  });
  const grid = el('ul', { 'aria-label': 'Crate slots', class: 'crate-grid' });
  const meterWrap = el('div', { class: 'free-shipping-meter' });
  const meterText = el('p', { 'data-region': 'meter-text' });
  const meter = el(
    'div',
    { class: 'meter-track', role: 'meter' },
    el('span', { 'data-region': 'meter-val' })
  );
  const meterEl = el(
    'div',
    {
      role: 'meter',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuenow': '0',
      'aria-valuetext': '',
      class: 'meter-live',
    },
    el('span', { class: 'visually-hidden', 'data-meter-value': 'true' })
  );
  void meter;
  meterWrap.append(meterText, meterEl);
  const totalRegion = buildTotals();
  const crateStatus = el('p', { 'data-region': 'crate-updates', role: 'status', 'aria-live': 'polite', class: 'crate-updates' });
  const totalStatus = el('p', { 'data-region': 'total-updates', role: 'status', 'aria-live': 'polite', class: 'total-updates' });
  root.append(heading, counter, grid, meterWrap, totalRegion.root, totalStatus, crateStatus);
  parent.append(root);
  const ui: CrateUi = {
    root,
    rerender: () => renderCrate(grid, counter, meterWrap, totalRegion, callbacks),
  };
  ui.rerender();
  return ui;
}

function buildTotals(): { root: HTMLElement; update: (quote: Quote) => void } {
  const root = el('section', { class: 'order-total', 'data-region': 'order-total' });
  const heading = el('h3', { text: 'Order total' });
  const provinceRow = el('div', { class: 'field-row' });
  const provinceLabel = el('label', { text: 'Province', for: 'province-select' });
  const province = el('select', { id: 'province-select', 'aria-label': 'Province' });
  for (const code of ['AB', 'BC', 'NS', 'ON', 'QC']) {
    province.append(el('option', { value: code, text: provinceName(code) }));
  }
  provinceRow.append(provinceLabel, province);
  const switchRow = el('div', { class: 'subscribe-switch-row' });
  const switchInput = el('input', {
    type: 'checkbox',
    role: 'switch',
    id: 'subscribe-switch',
    'aria-label': 'Subscribe and save 10%',
  });
  const switchLabel = el('label', { text: 'Subscribe and save 10%', for: 'subscribe-switch' });
  const hint = el('span', {
    class: 'subscribe-hint',
    'data-region': 'subscribe-hint',
    hidden: true,
    text: 'Subscriptions come as 12 of one flavour or 4 of each.',
  });
  switchRow.append(switchInput, switchLabel, hint);
  const cadenceRow = el('div', { class: 'cadence-row', hidden: true, 'data-region': 'cadence-row' });
  cadenceRow.setAttribute('role', 'radiogroup');
  cadenceRow.setAttribute('aria-label', 'Deliver every');
  cadenceRow.append(
    el('label', {},
      el('input', { type: 'radio', name: 'cadence', value: 'monthly', checked: true }), ' Month'),
    el('label', {},
      el('input', { type: 'radio', name: 'cadence', value: 'bimonthly' }), ' Two months')
  );
  const table = el('table', { 'aria-label': 'Price breakdown', 'data-region': 'price-breakdown' });
  const tbody = el('tbody');
  table.append(tbody);
  root.append(heading, provinceRow, switchRow, cadenceRow, table);

  province.addEventListener('change', async () => {
    await api<{ cart: CartView }>('/api/cart', {
      method: 'PATCH',
      json: { province: province.value },
    });
    await store.loadCart();
    await store.refreshQuote(true);
    renderTotals(tbody, store.quote);
    renderCartUi();
  });
  switchInput.addEventListener('change', async () => {
    try {
      await api<{ cart: CartView }>('/api/cart', {
        method: 'PATCH',
        json: { subscribe: switchInput.checked },
      });
      await store.loadCart();
    } catch (e) {
      const body = (e as { body?: { error?: string; message?: string } }).body;
      if (body?.error === 'not_subscribable') {
        switchInput.checked = false;
      }
    }
    await store.refreshQuote(true);
    renderTotals(tbody, store.quote);
    renderCartUi();
  });
  cadenceRow.addEventListener('change', async (e) => {
    const target = e.target as HTMLInputElement;
    if (target.name !== 'cadence') return;
    await api('/api/cart', { method: 'PATCH', json: { cadence: target.value } });
    await store.loadCart();
    await store.refreshQuote(false);
    renderTotals(tbody, store.quote);
  });

  return {
    root,
    update: (quote: Quote) => {
      province.value = quote.province;
      const eligible = store.crateEligible();
      switchInput.disabled = !eligible && store.cart !== null && store.cart.count === 12;
      switchInput.checked = quote.subscribe;
      hint.hidden = !(switchInput.disabled && !eligible);
      cadenceRow.hidden = !quote.subscribe;
      renderTotals(tbody, quote);
    },
  };
}

function renderTotals(tbody: HTMLElement, quote: Quote | null): void {
  if (!quote) return;
  tbody.textContent = '';
  const row = (label: string, value: string, cls = ''): void => {
    tbody.append(el('tr', { class: cls }, el('td', { text: label }), el('td', { text: value })));
  };
  row('Subtotal', dollars(quote.goods_cents));
  if (quote.subscribe) {
    row('Subscribe & save (10%)', `-${dollars(quote.discount_cents)}`);
  }
  row('Deposit', dollars(quote.deposit_cents));
  row('Shipping', quote.shipping_cents === 0 && quote.lines.length > 0 ? 'Free' : dollars(quote.shipping_cents));
  for (const tax of quote.taxes) {
    row(`${tax.name} (${tax.rate}%)`, dollars(tax.cents));
  }
  row('Total', dollars(quote.total_cents), 'total-row');
}

let cartUiRefresh: (() => void) | null = null;
export function renderCartUi(): void {
  cartUiRefresh?.();
}

function renderCrate(
  grid: HTMLElement,
  counter: HTMLElement,
  meterWrap: HTMLElement,
  totalRegion: { update: (quote: Quote) => void },
  callbacks: CrateCallbacks
): void {
  const cart = store.cart;
  const quote = store.quote;
  if (!cart) return;
  const flavourOfSlot = (index: number): string | null => {
    const slot = cart.slots[index];
    return slot && slot.flavour ? slot.flavour : null;
  };
  counter.textContent = `${String(cart.count).padStart(2, '0')}/12`;
  grid.textContent = '';
  for (let k = 0; k < 12; k++) {
    const flavour = flavourOfSlot(k);
    const li = el('li', { class: 'crate-slot' + (flavour ? ' filled' : ''), 'data-slot': String(k) });
    li.setAttribute('aria-label', flavour ? `Slot ${k + 1}: ${store.flavourName(flavour)}` : `Slot ${k + 1}: empty`);
    if (flavour) {
      drawCan(li, flavour, true);
      const remove = el('button', {
        class: 'slot-remove',
        'aria-label': `Remove ${store.flavourName(flavour)} from slot ${k + 1}`,
        title: `Remove ${store.flavourName(flavour)} from slot ${k + 1}`,
      }, lucideIcon('x', 14));
      remove.addEventListener('click', async () => {
        await removeSlot(k, callbacks, grid, counter, meterWrap, totalRegion);
      });
      remove.addEventListener('keydown', async (e) => {
        const key = (e as KeyboardEvent).key;
        if (key === 'Delete' || key === 'Backspace' || key === 'Enter' || key === ' ') {
          e.preventDefault();
          await removeSlot(k, callbacks, grid, counter, meterWrap, totalRegion);
        }
      });
      li.append(remove);
    }
    grid.append(li);
  }
  if (quote) {
    const meterText = meterWrap.querySelector('[data-region="meter-text"]') as HTMLElement;
    meterText.textContent = shippingPhrase(quote);
    const meter = meterWrap.querySelector('.meter-live') as HTMLElement;
    const fill = meterWrap.querySelector('.meter-track') as HTMLElement | null;
    meter.setAttribute('aria-valuenow', String(quote.free_shipping.progress_percent));
    meter.setAttribute('aria-valuetext', shippingPhrase(quote));
    if (fill) {
      const fillBar = fill.querySelector('.meter-fill') as HTMLElement | null;
      if (!fillBar) {
        fill.append(el('div', { class: 'meter-fill' }));
      }
      const bar = fill.querySelector('.meter-fill') as HTMLElement;
      bar.style.width = `${quote.free_shipping.progress_percent}%`;
    }
    totalRegion.update(quote);
  }
  const meterEl = meterWrap.querySelector('.meter-track') as HTMLElement | null;
  if (meterEl && meterEl.parentElement) {
    const live = meterWrap.querySelector('.meter-live') as HTMLElement;
    live.textContent = '';
    live.append(meterEl, el('span', { class: 'visually-hidden', text: shippingPhrase(quote ?? store.quote!) }));
  }
  callbacks.onCartChange?.(cart);
}

async function removeSlot(
  k: number,
  callbacks: CrateCallbacks,
  grid: HTMLElement,
  counter: HTMLElement,
  meterWrap: HTMLElement,
  totalRegion: { update: (quote: Quote) => void }
): Promise<void> {
  const flavour = store.flavourName(store.cart?.slots[k]?.flavour ?? null);
  try {
    const data = await api<{ cart: CartView; stock_left: number }>(`/api/cart/items/${k}`, { method: 'DELETE' });
    store.cart = data.cart;
    const f = store.flavours.find((x) => x.slug === data.cart.slots[k]);
    void f;
    await applyNewStock(data.cart, data.stock_left, store.cart?.slots[k] ? null : null);
    await store.refreshQuote(false);
    renderCrate(grid, counter, meterWrap, totalRegion, callbacks);
    const region = document.querySelector('[data-region="crate-updates"]');
    if (region) {
      announceStatus(
        region,
        `Removed ${flavour}. ${data.cart.count} of 12 cans in your crate. ${
          store.quote ? shippingPhrase(store.quote) : ''
        }`
      );
    }
    // focus next filled slot's remove button, else previous, else first Add button
    const filledSlots = data.cart.slots
      .map((s, i) => (s && s.flavour ? i : -1))
      .filter((i) => i >= 0);
    let next: number | null = null;
    for (const i of filledSlots) {
      if (i > k) {
        next = i;
        break;
      }
    }
    if (next === null && filledSlots.length > 0) {
      const before = filledSlots.filter((i) => i < k);
      next = before.length > 0 ? before[before.length - 1] : null;
    }
    if (next !== null) {
      const btn = grid.querySelector(`[data-slot="${next}"] .slot-remove`) as HTMLElement | null;
      btn?.focus();
    } else {
      const addBtn = document.querySelector('[data-add-button]') as HTMLElement | null;
      addBtn?.focus();
    }
    renderCartUi();
  } catch {
    const region = document.querySelector('[data-region="crate-updates"]');
    if (region) {
      announceStatus(region, "The shop can't update your crate right now. Try again in a moment.");
    }
  }
}

async function applyNewStock(cart: CartView, stockLeft: number, _flavour: null): Promise<void> {
  void cart;
  void _flavour;
  void stockLeft;
}

export function updateStockDisplays(): void {
  for (const flavour of store.flavours) {
    for (const card of document.querySelectorAll(`[data-flavour-card="${flavour.slug}"]`)) {
      const stockEl = card.querySelector('[data-stock-left]') as HTMLElement | null;
      if (stockEl) stockEl.textContent = `${flavour.stock_left} left`;
      const badge = card.querySelector('[data-sold-out-badge]') as HTMLElement | null;
      if (badge) badge.hidden = flavour.stock_left > 0;
    }
  }
}

export interface AddOutcome {
  ok: boolean;
}

export async function addCans(
  flavourSlug: string,
  quantity: number,
  cardEl: HTMLElement,
  callbacks: CrateCallbacks
): Promise<AddOutcome> {
  const flavour = store.flavours.find((f) => f.slug === flavourSlug)!;
  const crateRoot = document.querySelector('[data-region="crate"]') as HTMLElement | null;
  if (!crateRoot || !store.cart) return { ok: false };
  const grid = crateRoot.querySelector('.crate-grid') as HTMLElement;
  const counter = crateRoot.querySelector('[data-region="crate-counter"]') as HTMLElement;
  const meterWrap = crateRoot.querySelector('.free-shipping-meter') as HTMLElement;
  const firstEmpty = store.cart.slots.findIndex((s) => !s || !s.flavour);
  const reduced = reducedMotion();
  let tokens: HTMLElement[] = [];
  if (!reduced && firstEmpty >= 0 && cardEl) {
    tokens = spawnTokens(cardEl, flavourSlug, Math.min(quantity, 12 - store.cart.count));
  }
  const targetSlot = firstEmpty;
  if (!reduced && targetSlot >= 0 && tokens.length > 0) {
    animateFlight(tokens[0], targetSlot, () => markPending(targetSlot));
  } else if (targetSlot >= 0) {
    markPending(targetSlot);
  }
  try {
    const data = await api<{
      cart: CartView;
      added: { flavour: string; slots: number[] };
      stock_left: number;
    }>('/api/cart/items', { json: { flavour: flavourSlug, quantity } });
    store.cart = data.cart;
    const f = store.flavours.find((x) => x.slug === flavourSlug);
    if (f) f.stock_left = data.stock_left;
    updateStockDisplays();
    await store.refreshQuote(false);
    renderCrate(grid, counter, meterWrap, totalsRef(), callbacks);
    if (!reduced) {
      settleFill(data.added.slots);
    }
    const region = document.querySelector('[data-region="crate-updates"]');
    if (region) {
      const phrase = store.quote ? shippingPhrase(store.quote) : '';
      const message =
        quantity === 1
          ? `Added ${flavour.name}. ${data.cart.count} of 12 cans in your crate. ${data.stock_left} left. ${phrase}`
          : `Added ${quantity} ${flavour.name}. ${data.cart.count} of 12 cans in your crate. ${data.stock_left} left. ${phrase}`;
      announceStatus(region, message);
    }
    renderCartUi();
    return { ok: true };
  } catch (e) {
    const err = e as { status?: number; body?: { error?: string; stock_left?: number; limit?: string } };
    const flyBack = (): void => {
      for (const token of tokens) token.remove();
      if (targetSlot >= 0) {
        const slot = grid.querySelector(`[data-slot="${targetSlot}"]`) as HTMLElement | null;
        slot?.classList.remove('pending');
        slot?.removeAttribute('aria-label');
        if (slot) slot.setAttribute('aria-label', `Slot ${targetSlot + 1}: empty`);
      }
    };
    if (!reduced) {
      if (tokens.length > 0) {
        animateReturn(tokens[0], cardEl, flyBack);
      } else {
        flyBack();
      }
    } else {
      flyBack();
    }
    const stock = err.body?.stock_left ?? flavour.stock_left;
    if (err.body?.error === 'sold_out') {
      const f = store.flavours.find((x) => x.slug === flavourSlug);
      if (f) f.stock_left = stock;
      updateStockDisplays();
      const badge = cardEl.querySelector('[data-sold-out-badge]') as HTMLElement | null;
      if (badge) badge.hidden = false;
    }
    const region = document.querySelector('[data-region="crate-updates"]');
    if (region) {
      const phrase = store.quote ? shippingPhrase(store.quote) : '';
      const count = store.cart?.count ?? 0;
      let message: string;
      if (err.body?.error === 'sold_out') {
        message = `Couldn't add ${flavour.name}: sold out. ${count} of 12 cans in your crate. ${stock} left. ${phrase}`;
      } else if (err.body?.limit === 'crate') {
        message = `Couldn't add ${flavour.name}: your crate is full. ${count} of 12 cans in your crate. ${stock} left. ${phrase}`;
      } else if (err.body?.limit === 'drop') {
        message = `Couldn't add ${flavour.name}: you can hold up to 6 cans of a limited drop. ${count} of 12 cans in your crate. ${stock} left. ${phrase}`;
      } else {
        message = "The shop can't update your crate right now. Try again in a moment.";
      }
      announceStatus(region, message);
    }
    return { ok: false };
  }
}

let totalsRef: () => { update: (quote: Quote) => void } = () => ({ update: () => {} });
export function registerTotals(ref: () => { update: (quote: Quote) => void }): void {
  totalsRef = ref;
}

function spawnTokens(cardEl: HTMLElement, slug: string, count: number): HTMLElement[] {
  const tokens: HTMLElement[] = [];
  const rect = cardEl.getBoundingClientRect();
  for (let i = 0; i < Math.min(count, 3); i++) {
    const token = document.createElement('div');
    token.className = 'fly-token';
    token.style.left = `${rect.left + rect.width / 2 - 17}px`;
    token.style.top = `${rect.top + 10}px`;
    const inner = document.createElement('div');
    token.append(inner);
    drawCan(inner, slug, true);
    document.body.append(token);
    tokens.push(token);
  }
  const token = tokens[0];
  token.animate(
    [
      { transform: 'scale(1)' },
      { transform: 'scale(1.08)' },
    ],
    { duration: 120, easing: 'ease-out' }
  );
  return tokens;
}

function markPending(slot: number): void {
  const grid = document.querySelector('[data-region="crate"] .crate-grid') as HTMLElement | null;
  const li = grid?.querySelector(`[data-slot="${slot}"]`) as HTMLElement | null;
  if (!li) return;
  li.classList.add('pending');
  li.setAttribute('aria-label', `Slot ${slot + 1}: ${store.flavourName(store.cart?.slots[slot]?.flavour ?? '') || 'pending'}, pending`);
}

function animateFlight(token: HTMLElement, slotIndex: number, onLand: () => void): void {
  const grid = document.querySelector('[data-region="crate"] .crate-grid') as HTMLElement | null;
  const li = grid?.querySelector(`[data-slot="${slotIndex}"]`) as HTMLElement | null;
  if (!li) {
    token.remove();
    return;
  }
  const from = token.getBoundingClientRect();
  const to = li.getBoundingClientRect();
  const startX = from.left;
  const startY = from.top;
  const dx = to.left + to.width / 2 - (startX + 17);
  const dy = to.top + to.height / 2 - (startY + 23);
  const midX = (startX + (startX + dx)) / 2;
  const rise = -60;
  const anim = token.animate(
    [
      { transform: 'translate(0, 0) scale(1.08)' },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 + rise}px) scale(1.02)` },
      { transform: `translate(${dx}px, ${dy}px) scale(0.9)` },
    ],
    { duration: 420, easing: 'ease-in-out' }
  );
  void midX;
  anim.onfinish = () => {
    token.remove();
    onLand();
  };
}

function animateReturn(token: HTMLElement, cardEl: HTMLElement, done: () => void): void {
  const from = token.getBoundingClientRect();
  const to = cardEl.getBoundingClientRect();
  const dx = to.left + to.width / 2 - (from.left + 17);
  const dy = to.top + 10 - from.top;
  const anim = token.animate(
    [
      { transform: 'translate(0, 0)' },
      { transform: `translate(${dx}px, ${dy}px)` },
    ],
    { duration: 300, easing: 'ease-in' }
  );
  anim.onfinish = () => {
    done();
  };
}

function settleFill(slots: number[]): void {
  const grid = document.querySelector('[data-region="crate"] .crate-grid') as HTMLElement | null;
  for (const slot of slots) {
    const li = grid?.querySelector(`[data-slot="${slot}"]`) as HTMLElement | null;
    if (!li) continue;
    li.classList.remove('pending');
    li.classList.add('filled');
    const reduced = reducedMotion();
    li.animate(
      [
        { transform: 'scale(1.12)' },
        { transform: 'scale(0.96)' },
        { transform: 'scale(1)' },
      ],
      { duration: reduced ? 0.1 : 160, easing: 'ease-out' }
    );
  }
}

export function counterText(cart: CartView): string {
  return `${String(cart.count).padStart(2, '0')}/12`;
}
