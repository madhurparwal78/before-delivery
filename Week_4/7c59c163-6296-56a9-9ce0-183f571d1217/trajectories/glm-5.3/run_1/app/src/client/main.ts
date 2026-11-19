import { api, ApiError, downloadFile, type ApiKey, type Balance, type Billing, type Book, type Deposit, type Market, type Me, type Order, type Positions, type Statement, type Totals, type WebhookInfo } from './api.js';
import { formatMoney, formatPrice, formatThousands, feeForFill, monthName, shortId } from './format.js';
import { Orbit, hasWebGL, prefersReducedMotion } from './orbit.js';

const app = document.getElementById('app') as HTMLElement;

interface AppState {
  me: Me | null;
  route: string;
}

const state: AppState = { me: null, route: '/' };

// ---------- Router ----------

export function navigate(path: string): void {
  history.pushState({}, '', path);
  void render();
}

window.addEventListener('popstate', () => {
  void render();
});

document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const link = target.closest('a[data-link]') as HTMLAnchorElement | null;
  if (link) {
    e.preventDefault();
    navigate(link.getAttribute('href') ?? '/');
  }
});

async function render(): Promise<void> {
  const path = location.pathname;
  state.route = path;
  if (!state.me) {
    try {
      state.me = await api.get<Me>('/api/me');
    } catch {
      state.me = null;
    }
  }
  const signedIn = state.me !== null;
  const me = state.me;

  if (path === '/' ) { await renderHome(signedIn); return; }
  if (path === '/signin-error') { renderMessagePage('Sign-in link expired', 'Start again from Sign in.'); return; }
  if (path === '/signin-unavailable') { renderMessagePage('Sign-in is unavailable right now — try again in a minute.'); return; }
  if (path === '/no-venue') { renderMessagePage('No venue yet', 'Ask your venue\u2019s owner for an invite.'); return; }
  if (!signedIn) { renderSignedOut(); return; }
  if (me && !me.venue && !me.roles.includes('founder_operator')) {
    window.location.replace('/no-venue');
    return;
  }
  if (path === '/markets') { await renderMarkets(); return; }
  if (path.startsWith('/markets/')) { await renderMarketDetail(path.slice('/markets/'.length)); return; }
  if (path === '/balance') { await renderBalance(); return; }
  if (path === '/orders') { await renderOrders(); return; }
  if (path.startsWith('/orders/')) { await renderOrderDetail(path.slice('/orders/'.length)); return; }
  if (path === '/statements') { await renderStatements(); return; }
  if (path === '/profile') { await renderProfile(); return; }
  if (path === '/builder' && me?.roles.includes('builder')) { await renderBuilder(); return; }
  if (path === '/admin' && me?.roles.includes('market_admin')) { await renderAdmin(); return; }
  if (path === '/owner' && me?.roles.includes('org_owner')) { await renderOwner(); return; }
  if (path === '/platform' && me?.roles.includes('founder_operator')) { await renderPlatform(); return; }
  if (path.startsWith('/invites/')) { await renderAcceptInvite(path.slice('/invites/'.length)); return; }
  renderMessagePage('We couldn\u2019t find that page');
}

// ---------- Shared layout ----------

function topbar(active: string): string {
  const me = state.me;
  const links: string[] = ['/markets', '/balance', '/orders', '/statements', '/profile'];
  if (me?.roles.includes('builder')) links.push('/builder');
  if (me?.roles.includes('market_admin')) links.push('/admin');
  if (me?.roles.includes('org_owner')) links.push('/owner');
  if (me?.roles.includes('founder_operator')) links.push('/platform');
  const label = (p: string): string => ({
    '/markets': 'Markets', '/balance': 'Balance', '/orders': 'Orders', '/statements': 'Statements',
    '/profile': 'Profile', '/builder': 'Builder', '/admin': 'Admin', '/owner': 'Owner', '/platform': 'Platform',
  })[p] ?? p;
  const nav = links.map((p) => `<a href="${p}" data-link${p === active ? ' aria-current="page"' : ''}>${label(p)}</a>`).join('');
  return `
  <header class="topbar">
    <span class="venue-name">${me?.venue?.name ?? 'Plumtide Venue'}</span>
    <nav class="mainnav" role="navigation" aria-label="Venue">${nav}</nav>
    <button class="pill small menu-btn" id="menu-btn" aria-haspopup="dialog">Menu</button>
    <button class="pill small" id="signout-btn">Sign out</button>
  </header>`;
}

function bindTopbar(): void {
  document.getElementById('signout-btn')?.addEventListener('click', async () => {
    await api.del('/api/session');
    state.me = null;
    window.location.replace('/');
  });
  document.getElementById('menu-btn')?.addEventListener('click', () => {
    openMenuDialog();
  });
}

function openMenuDialog(): void {
  const me = state.me;
  const links: string[] = ['/markets', '/balance', '/orders', '/statements', '/profile'];
  if (me?.roles.includes('builder')) links.push('/builder');
  if (me?.roles.includes('market_admin')) links.push('/admin');
  if (me?.roles.includes('org_owner')) links.push('/owner');
  if (me?.roles.includes('founder_operator')) links.push('/platform');
  const label = (p: string): string => ({
    '/markets': 'Markets', '/balance': 'Balance', '/orders': 'Orders', '/statements': 'Statements',
    '/profile': 'Profile', '/builder': 'Builder', '/admin': 'Admin', '/owner': 'Owner', '/platform': 'Platform',
  })[p] ?? p;
  const dialog = document.createElement('dialog');
  dialog.className = 'sheet menu-sheet';
  dialog.setAttribute('aria-label', 'Menu');
  dialog.innerHTML = `<nav>${links.map((p) => `<a href="${p}" data-link>${label(p)}</a>`).join('')}</nav>`;
  document.body.appendChild(dialog);
  const close = (): void => {
    dialog.close();
    dialog.remove();
  };
  dialog.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => close()));
  dialog.addEventListener('close', close);
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  dialog.showModal();
  const first = dialog.querySelector('a') as HTMLAnchorElement | null;
  first?.focus();
}

function renderMessagePage(heading: string, subline?: string): void {
  app.innerHTML = `
    <main class="field slate">
      <div class="empty-state">
        <div class="sticker st-coin" aria-hidden="true">YES<br>NO</div>
        <h1>${heading}</h1>
        ${subline ? `<p>${subline.includes('Sign in') ? `${subline.replace('Sign in.', '<a href="/auth/login">Sign in</a>.')}` : subline}</p>` : ''}
      </div>
    </main>`;
}

function renderSignedOut(): void {
  const path = state.route;
  renderMessagePage('We couldn\u2019t find that page');
  if (path !== '/' && !path.startsWith('/signin')) {
    // signed-out users hitting a private route see Not found, per spec.
  }
}

function signinLink(next: string): string {
  return `<a class="pill" href="/auth/login?next=${encodeURIComponent(next)}">Sign in</a>`;
}

// ---------- Home ----------

const SAMPLE_BOOK: Book = {
  market_id: 'sample',
  sequence: 0,
  last_price: 55,
  bids: [{ price: 52, quantity: 120 }, { price: 48, quantity: 260 }, { price: 44, quantity: 90 }],
  asks: [{ price: 57, quantity: 180 }, { price: 61, quantity: 240 }, { price: 65, quantity: 70 }],
};

async function renderHome(signedIn: boolean): Promise<void> {
  const summary = signedIn && state.me?.venue ? await api.get<{ volume_cents_today: number; open_interest_contracts: number; flagship_market_id: string | null }>('/api/venue/summary').catch(() => null) : null;
  const flagshipHref = summary?.flagship_market_id ? `/markets/${summary.flagship_market_id}` : '/markets';
  const volume = summary ? formatMoney(summary.volume_cents_today) : '$0.00';
  app.innerHTML = `
  ${signedIn ? topbar('/') : ''}
  <section class="hero field slate" id="hero">
    <h1>Plumtide Venue</h1>
    <p class="numeral" id="hero-volume">${signedIn ? `${volume} today` : 'Sample book'}</p>
    <div class="orbit-wrap" role="region" aria-label="Orderbook Orbit" id="orbit-region">
      <div class="orbit-canvas-wrap"></div>
      ${signedIn ? '' : '<p>Sample book</p>'}
    </div>
    <a class="pill" id="open-book" href="${signedIn ? flagshipHref : '/auth/login'}" ${signedIn ? 'data-link' : ''}>Open the book</a>
    <div class="sticker st-coin" aria-hidden="true">YES<br>NO</div>
    <div class="sticker st-dial" aria-hidden="true">Margin<br>dial</div>
    <div class="sticker st-cube" aria-hidden="true">Spot<br>cube</div>
    <div class="sticker st-envelope" aria-hidden="true">Monthly<br>statement</div>
  </section>
  <section class="chapter field sage">
    <div class="center card">
      <h2>One shared book</h2>
      <p>Spot, margin and yes/no event contracts rest on a single price-time-priority book, so yes and no interest finally meet.</p>
    </div>
  </section>
  <section class="chapter field blush">
    <div class="center card">
      <h2>Your venue today</h2>
      <p>Volume today: <span class="numeral">${volume}</span></p>
      <p>Open interest: <span class="numeral">${summary ? formatThousands(summary.open_interest_contracts) : '0'}</span> contracts</p>
    </div>
  </section>
  <section class="chapter field olive">
    <div class="center">
      <h2>See you on the book</h2>
      <a class="pill" href="${signedIn ? flagshipHref : '/auth/login'}" ${signedIn ? 'data-link' : ''}>Open the book</a>
    </div>
  </section>`;
  bindTopbar();
  const region = document.getElementById('orbit-region');
  const wrap = region?.querySelector('.orbit-canvas-wrap') as HTMLElement | null;
  if (region && wrap) {
    if (prefersReducedMotion() || !hasWebGL()) {
      wrap.innerHTML = ladderHtml(SAMPLE_BOOK);
    } else {
      const canvas = document.createElement('canvas');
      canvas.className = 'orbit';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', 'Orderbook Orbit');
      wrap.appendChild(canvas);
      const orbit = new Orbit(canvas, null);
      orbit.setBook(SAMPLE_BOOK);
      orbit.setElevation(35);
    }
  }
  if (!signedIn) {
    document.getElementById('open-book')?.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.href = `/auth/login?next=${encodeURIComponent('/')}`;
    });
  }
}

function ladderHtml(book: Book): string {
  const maxQty = Math.max(1, ...book.bids.map((l) => l.quantity), ...book.asks.map((l) => l.quantity));
  const level = (side: 'bid' | 'ask', l: { price: number; quantity: number }): string => `
    <div class="ladder-level">
      <span class="bar" style="width:${Math.round((l.quantity / maxQty) * 100)}%; ${side === 'ask' ? 'background: var(--blush);' : ''}"></span>
      <span class="label"><span>${side === 'ask' ? 'Ask' : 'Bid'} ${l.price}</span><span>${l.quantity}</span></span>
    </div>`;
  return `
  <div class="ladder" role="region" aria-label="Depth ladder">
    <div class="ladder-cols">
      <div><h3>Bids</h3><div role="list" aria-label="Bids">${book.bids.map((l) => level('bid', l)).join('')}</div></div>
      <div><h3>Asks</h3><div role="list" aria-label="Asks">${book.asks.map((l) => level('ask', l)).join('')}</div></div>
    </div>
  </div>`;
}

// ---------- Markets ----------

const STATUS_TEXT: Record<string, string> = {
  listed: 'Listed', trading: 'Trading open', halted: 'Trading halted', closed: 'Trading closed',
  resolved: 'Resolved', settled: 'Settled',
};

function marketStatusText(status: string, outcome: string | null): string {
  if (status === 'resolved' || status === 'settled') {
    return `${status === 'settled' ? 'Settled' : 'Resolved'} ${(outcome ?? 'yes').toUpperCase()}`;
  }
  return STATUS_TEXT[status] ?? status;
}

async function renderMarkets(): Promise<void> {
  const markets = await api.get<{ markets: Market[] }>('/api/markets');
  app.innerHTML = `
  ${topbar('/markets')}
  <main class="field sage">
    <div class="center">
      <h1>Markets</h1>
      <div class="grid cols-3" role="list" aria-label="Markets">
        ${markets.markets.map((m) => `
          <a class="card" role="listitem" href="/markets/${m.id}" data-link>
            <h3>${m.symbol} — ${m.title}</h3>
            <p>${m.kind === 'event' ? 'Event' : 'Spot and margin'} · ${marketStatusText(m.status, m.outcome)}</p>
            <p class="tabular">Last ${m.last_price === null ? '—' : formatPrice(m.kind, m.last_price)}</p>
            ${m.kind === 'event' && m.closes_at ? `<p>Closes ${new Date(m.closes_at).toLocaleString('en-US')}</p>` : ''}
          </a>`).join('')}
      </div>
    </div>
  </main>`;
  bindTopbar();
}

// ---------- Market detail ----------

interface TicketState {
  outcome: 'yes' | 'no';
  mode: 'spot' | 'margin';
  side: 'buy' | 'sell';
  price: string;
  quantity: string;
}

interface DetailState {
  market: Market | null;
  book: Book | null;
  balance: Balance | null;
  orders: Order[];
  ticket: TicketState;
  updates: string[];
  highlight: string | null;
  pendingLine: string | null;
}

const detail = (marketId: string): DetailState => {
  const key = `detail:${marketId}`;
  const existing = (window as unknown as Record<string, DetailState | undefined>)[key];
  if (existing) return existing;
  const fresh: DetailState = {
    market: null,
    book: null,
    balance: null,
    orders: [],
    ticket: { outcome: 'yes', mode: 'spot', side: 'buy', price: '', quantity: '' },
    updates: [],
    highlight: null,
    pendingLine: null,
  };
  (window as unknown as Record<string, DetailState>)[key] = fresh;
  return fresh;
};

function levelOptions(book: Book, kind: 'pair' | 'event'): { key: string; label: string; price: number; quantity: number; side: 'ask' | 'bid' }[] {
  const asks = [...book.asks].reverse().map((l) => ({
    key: `ask:${l.price}`,
    label: `Ask ${formatPrice(kind, l.price)}, ${l.quantity} resting`,
    price: l.price, quantity: l.quantity, side: 'ask' as const,
  }));
  const bids = book.bids.map((l) => ({
    key: `bid:${l.price}`,
    label: `Bid ${formatPrice(kind, l.price)}, ${l.quantity} resting`,
    price: l.price, quantity: l.quantity, side: 'bid' as const,
  }));
  return [...asks, ...bids];
}

function ticketSummary(st: DetailState): string {
  const market = st.market;
  if (!market) return '';
  const price = Number(st.ticket.price);
  const qty = Number(st.ticket.quantity);
  if (!Number.isFinite(price) || !Number.isFinite(qty) || price <= 0 || qty <= 0) return '';
  const notional = price * qty;
  const fee = feeForFill(notional, market.taker_fee_bps);
  const money = formatMoney;
  if (market.kind === 'event' || (market.kind === 'pair' && st.ticket.mode === 'spot')) {
    if (st.ticket.side === 'buy' || market.kind === 'event') {
      return `Cost ${money(notional)} + fee ${money(fee)} = ${money(notional + fee)}`;
    }
    return `Proceeds ${money(notional)} − fee ${money(fee)} = ${money(notional - fee)}`;
  }
  const collateral = Math.ceil(notional / 2);
  return `Collateral ${money(collateral)} + fee ${money(fee)} = ${money(collateral + fee)}`;
}

function prefillFromLevel(st: DetailState, key: string, price: number, quantity: number, side: 'ask' | 'bid'): void {
  const market = st.market;
  if (!market) return;
  st.ticket.quantity = String(quantity);
  if (market.kind === 'event') {
    if (side === 'ask') {
      st.ticket.outcome = 'yes';
      st.ticket.price = String(price);
    } else {
      st.ticket.outcome = 'no';
      st.ticket.price = String(100 - price);
    }
  } else {
    st.ticket.side = side === 'ask' ? 'buy' : 'sell';
    st.ticket.price = market.kind === 'pair' ? (price / 100).toFixed(2) : String(price);
  }
}

async function renderMarketDetail(marketId: string): Promise<void> {
  const st = detail(marketId);
  const [marketRes, bookRes, balanceRes, ordersRes] = await Promise.all([
    api.get<Market & { server_time: string }>(`/api/markets/${marketId}`),
    api.get<Book>(`/api/markets/${marketId}/book`).catch(() => null),
    api.get<Balance>('/api/balance').catch(() => null),
    api.get<{ orders: Order[] }>('/api/orders?status=open').catch(() => ({ orders: [] })),
  ]);
  st.market = marketRes;
  st.book = bookRes;
  st.balance = balanceRes;
  st.orders = ordersRes.orders;
  if (!st.ticket.price) st.ticket.price = marketRes.kind === 'pair' && bookRes ? ((bookRes.asks[0]?.price ?? 0) / 100).toFixed(2) : '';

  paintMarketDetail(st, marketId);
  connectStream(st, marketId);
}

function paintMarketDetail(st: DetailState, marketId: string): void {
  const market = st.market;
  if (!market) return;
  const book = st.book;
  const opts = book ? levelOptions(book, market.kind) : [];
  const selected = st.highlight;
  const logged = st.updates.slice(-10);
  const useLadder = prefersReducedMotion() || !hasWebGL();
  const lastPrice = book?.last_price ?? market.last_price;

  app.innerHTML = `
  ${topbar('/markets')}
  <main class="field blush market-detail" id="market-page">
    <a href="#ticket-anchor" id="skip-ticket" class="pill small ghost">Skip to order ticket</a>
    <div class="detail-header">
      <div>
        <h1>${market.title}</h1>
        <p role="status" aria-label="Market status">${marketStatusText(market.status, market.outcome)}</p>
        ${market.kind === 'event' && market.closes_at ? `<p>Closes ${new Date(market.closes_at).toLocaleString('en-US')}</p>` : ''}
      </div>
      <div>
        <div role="region" aria-label="Your balance" class="card"><p class="tabular">Available ${formatMoney(st.balance?.available_cents ?? 0)}</p></div>
        <div role="region" aria-label="Open interest" class="card"><p class="numeral">${formatThousands(market.open_interest)}</p></div>
      </div>
    </div>
    <div class="detail-grid three-pane">
      <section class="card" id="book-pane">
        <h3>Book levels</h3>
        <div class="book-listbox" role="listbox" aria-label="Book levels" tabindex="0" id="book-levels">
          ${opts.length === 0 ? '<p>No resting orders yet — be the first on the book.</p>' : opts.map((o) => `
            <div class="book-option ${o.side}" role="option" aria-selected="${selected === o.key}" data-level="${o.key}" data-price="${o.price}" data-qty="${o.quantity}" data-side="${o.side}" tabindex="-1">${o.label}</div>`).join('')}
        </div>
      </section>
      <section class="orbit-region" role="region" aria-label="Orderbook Orbit" id="orbit-region">
        <div class="orbit-canvas-wrap" id="orbit-wrap"></div>
        ${opts.length === 0 ? '<p>No resting orders yet — be the first on the book.</p>' : ''}
        <div role="region" aria-label="Last trade"><p class="numeral tabular" id="last-trade">${lastPrice === null ? '—' : formatPrice(market.kind, lastPrice)}</p></div>
      </section>
      <section class="card" id="ticket-pane">
        <a id="ticket-anchor"></a>
        <h3>Order ticket</h3>
        <form role="form" aria-label="Order ticket" id="ticket-form" onsubmit="return false">
          ${market.kind === 'event'
            ? `<fieldset><legend>Outcome</legend>
               <div class="radiogroup" role="radiogroup" aria-label="Outcome">
                 <label class="radio-pill"><input type="radio" name="outcome" value="yes" ${st.ticket.outcome === 'yes' ? 'checked' : ''}> Yes</label>
                 <label class="radio-pill"><input type="radio" name="outcome" value="no" ${st.ticket.outcome === 'no' ? 'checked' : ''}> No</label>
               </div></fieldset>`
            : `<fieldset><legend>Mode</legend>
               <div class="radiogroup" role="radiogroup" aria-label="Mode">
                 <label class="radio-pill"><input type="radio" name="mode" value="spot" ${st.ticket.mode === 'spot' ? 'checked' : ''}> Spot</label>
                 <label class="radio-pill"><input type="radio" name="mode" value="margin" ${st.ticket.mode === 'margin' ? 'checked' : ''}> Margin</label>
               </div></fieldset>
               <fieldset><legend>Side</legend>
               <div class="radiogroup" role="radiogroup" aria-label="Side">
                 <label class="radio-pill"><input type="radio" name="side" value="buy" ${st.ticket.side === 'buy' ? 'checked' : ''}> Buy</label>
                 <label class="radio-pill"><input type="radio" name="side" value="sell" ${st.ticket.side === 'sell' ? 'checked' : ''}> Sell</label>
               </div></fieldset>`}
          <label for="price">Price</label>
          <div class="stepper-row">
            <button type="button" class="stepper" id="price-down" aria-label="Decrease price">−</button>
            <input id="price" name="price" type="number" step="any" min="0" autocomplete="off" value="${st.ticket.price}">
            <button type="button" class="stepper" id="price-up" aria-label="Increase price">+</button>
          </div>
          <label for="quantity">Quantity</label>
          <div class="stepper-row">
            <button type="button" class="stepper" id="qty-down" aria-label="Decrease quantity">−</button>
            <input id="quantity" name="quantity" type="number" step="1" min="0" autocomplete="off" value="${st.ticket.quantity}">
            <button type="button" class="stepper" id="qty-up" aria-label="Increase quantity">+</button>
          </div>
          <p role="status" aria-label="Ticket summary" id="ticket-summary" class="status-line">${ticketSummary(st)}</p>
          <button type="button" class="pill" id="review-btn">Review order</button>
        </form>
        <div role="status" aria-label="Order updates" id="order-updates" aria-live="polite" class="log">
          ${logged.map((line) => `<div class="line">${line}</div>`).join('')}
        </div>
      </section>
      <section class="card span-all" id="orders-pane">
        <h3>Your orders</h3>
        <table>
          <thead><tr><th>Order</th><th>Status</th><th>Price</th><th>Qty</th><th>Filled</th><th></th></tr></thead>
          <tbody>
            ${st.orders.map((o) => `
              <tr>
                <td class="tabular">${o.outcome ? o.outcome.toUpperCase() : o.mode ?? ''} ${o.side}</td>
                <td>${o.status.replace('_', ' ')}</td>
                <td class="tabular">${formatPrice(market.kind, o.price)}</td>
                <td class="tabular">${o.quantity}</td>
                <td class="tabular">${o.filled_quantity}</td>
                <td>${o.status === 'resting' || o.status === 'partially_filled' ? `<button class="pill small" data-cancel="${o.id}">Cancel order ${shortId(o.id)}</button>` : ''}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </section>
    </div>
  </main>`;
  bindTopbar();
  bindTicket(st, marketId);
  bindBookLevels(st, marketId);
  if (useLadder && book) {
    const wrap = document.getElementById('orbit-wrap');
    if (wrap) wrap.innerHTML = ladderHtml(book);
  } else {
    mountOrbit(st, marketId);
  }
}

let orbitInstance: Orbit | null = null;

function mountOrbit(st: DetailState, marketId: string): void {
  const wrap = document.getElementById('orbit-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.className = 'orbit';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Orderbook Orbit');
  wrap.appendChild(canvas);
  orbitInstance?.destroy();
  orbitInstance = new Orbit(canvas, (level) => {
    if (level) selectLevel(st, marketId, level);
  });
  if (st.book) orbitInstance.setBook(st.book);
  orbitInstance.setHighlight(st.highlight);
  updateScrollCamera(st);
}

function updateScrollCamera(st: DetailState): void {
  const page = document.getElementById('market-page');
  if (!page || !orbitInstance) return;
  const onScroll = (): void => {
    const y = window.scrollY;
    let elevation: number;
    if (y <= 600) {
      elevation = 90 - (y / 600) * 55;
    } else if (y <= 1200) {
      elevation = 35 - ((y - 600) / 600) * 35;
    } else {
      elevation = 0;
    }
    orbitInstance?.setElevation(elevation);
    syncOrbitAttrs();
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

function syncOrbitAttrs(): void {
  const canvas = document.querySelector('canvas.orbit') as HTMLCanvasElement | null;
  if (!canvas || !orbitInstance) return;
  const attrs = orbitInstance.attrs();
  canvas.setAttribute('data-elevation', attrs.elevation);
  canvas.setAttribute('data-yaw', attrs.yaw);
  canvas.setAttribute('data-settled', attrs.settled);
  canvas.setAttribute('data-highlight', attrs.highlight || (detail(canvasDatasetMarketId(canvas))?.highlight ?? ''));
  canvas.setAttribute('data-rings', attrs.rings);
}

function canvasDatasetMarketId(canvas: HTMLCanvasElement): string {
  return canvas.getAttribute('data-market-id') ?? location.pathname.split('/')[2] ?? '';
}

function selectLevel(st: DetailState, marketId: string, key: string): void {
  const book = st.book;
  const market = st.market;
  if (!book || !market) return;
  const all = levelOptions(book, market.kind);
  const found = all.find((o) => o.key === key);
  if (!found) return;
  st.highlight = key;
  prefillFromLevel(st, key, found.price, found.quantity, found.side);
  paintTicketOnly(st);
  orbitInstance?.setHighlight(key);
  const listbox = document.getElementById('book-levels');
  const optionEl = listbox?.querySelector(`[data-level="${CSS.escape(key)}"]`);
  optionEl?.setAttribute('aria-selected', 'true');
  listbox?.querySelectorAll('[role="option"]').forEach((el) => {
    if (el !== optionEl) el.setAttribute('aria-selected', 'false');
  });
  const qty = document.getElementById('quantity') as HTMLInputElement | null;
  qty?.focus();
  void marketId;
}

function paintTicketOnly(st: DetailState): void {
  const price = document.getElementById('price') as HTMLInputElement | null;
  const qty = document.getElementById('quantity') as HTMLInputElement | null;
  if (price) price.value = st.ticket.price;
  if (qty) qty.value = st.ticket.quantity;
  document.querySelectorAll<HTMLInputElement>('input[name="outcome"]').forEach((el) => {
    el.checked = el.value === st.ticket.outcome;
  });
  document.querySelectorAll<HTMLInputElement>('input[name="mode"]').forEach((el) => {
    el.checked = el.value === st.ticket.mode;
  });
  document.querySelectorAll<HTMLInputElement>('input[name="side"]').forEach((el) => {
    el.checked = el.value === st.ticket.side;
  });
  const summary = document.getElementById('ticket-summary');
  if (summary) summary.textContent = ticketSummary(st);
}

function bindTicket(st: DetailState, marketId: string): void {
  const price = document.getElementById('price') as HTMLInputElement | null;
  const qty = document.getElementById('quantity') as HTMLInputElement | null;
  const refresh = (): void => {
    paintTicketOnly(st);
  };
  price?.addEventListener('input', () => {
    st.ticket.price = price.value;
    refresh();
  });
  qty?.addEventListener('input', () => {
    st.ticket.quantity = qty.value;
    refresh();
  });
  document.querySelectorAll<HTMLInputElement>('input[name="outcome"]').forEach((el) => {
    el.addEventListener('change', () => {
      st.ticket.outcome = el.value as 'yes' | 'no';
      refresh();
    });
  });
  document.querySelectorAll<HTMLInputElement>('input[name="mode"]').forEach((el) => {
    el.addEventListener('change', () => {
      st.ticket.mode = el.value as 'spot' | 'margin';
      refresh();
    });
  });
  document.querySelectorAll<HTMLInputElement>('input[name="side"]').forEach((el) => {
    el.addEventListener('change', () => {
      st.ticket.side = el.value as 'buy' | 'sell';
      refresh();
    });
  });
  const step = (id: string, apply: (v: number) => number, field: 'price' | 'quantity'): void => {
    document.getElementById(id)?.addEventListener('click', () => {
      const current = Number(st.ticket[field]) || 0;
      const market = st.market;
      const isEvent = market?.kind === 'event';
      const tick = field === 'price' ? (isEvent ? 1 : 0.01) : 1;
      const next = apply(current) === current ? current : Math.max(0, apply(current));
      st.ticket[field] = field === 'price' && !isEvent ? next.toFixed(2) : String(next);
      if (tick === 0.01 && field === 'price') {
        st.ticket.price = next.toFixed(2);
      }
      paintTicketOnly(st);
    });
  };
  step('price-down', (v) => v - 1, 'price');
  step('price-up', (v) => v + 1, 'price');
  step('qty-down', (v) => v - 1, 'quantity');
  step('qty-up', (v) => v + 1, 'quantity');
  document.getElementById('review-btn')?.addEventListener('click', () => {
    openReviewDialog(st, marketId);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-cancel]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const orderId = btn.getAttribute('data-cancel');
      if (orderId) openCancelDialog(st, marketId, orderId, btn);
    });
  });
  document.getElementById('ticket-form')?.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      openReviewDialog(st, marketId);
    }
  });
}

function trapFocus(dialog: HTMLElement): void {
  dialog.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('button, [href], input, select, textarea')).filter((el) => !el.hasAttribute('disabled'));
    if (focusables.length === 0) return;
    const first = focusables[0] as HTMLElement;
    const last = focusables[focusables.length - 1] as HTMLElement;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}

function openReviewDialog(st: DetailState, marketId: string): void {
  const market = st.market;
  if (!market) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'sheet';
  dialog.setAttribute('aria-label', 'Review order');
  dialog.innerHTML = `
    <h2>Review order</h2>
    <p>${ticketSummary(st)}</p>
    <div class="dialog-actions">
      <button class="pill" id="confirm-order">Confirm order</button>
      <button class="pill ghost" id="back-order">Back</button>
    </div>`;
  document.body.appendChild(dialog);
  const opener = document.getElementById('review-btn') as HTMLElement | null;
  const close = (focus?: HTMLElement): void => {
    dialog.close();
    dialog.remove();
    (focus ?? opener)?.focus();
  };
  dialog.querySelector('#back-order')?.addEventListener('click', () => close());
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  dialog.addEventListener('close', () => dialog.remove());
  trapFocus(dialog);
  dialog.showModal();
  dialog.querySelector('#confirm-order')?.addEventListener('click', async () => {
    close();
    await submitTicket(st, marketId);
  });
  const confirmBtn = dialog.querySelector('#confirm-order');
  if (confirmBtn instanceof HTMLElement) confirmBtn.focus();
}

async function submitTicket(st: DetailState, marketId: string): Promise<void> {
  const market = st.market;
  if (!market) return;
  const updates = document.getElementById('order-updates');
  st.pendingLine = 'Sending order\u2026';
  const renderUpdates = (): void => {
    if (!updates) return;
    const lines = [...st.updates.slice(-10)];
    if (st.pendingLine) lines.push(st.pendingLine);
    updates.innerHTML = lines.map((line) => `<div class="line">${line}</div>`).join('');
  };
  renderUpdates();
  const price = market.kind === 'pair' ? Math.round(Number(st.ticket.price) * 100) : Number(st.ticket.price);
  const quantity = Number(st.ticket.quantity);
  const body = market.kind === 'event'
    ? { market_id: marketId, outcome: st.ticket.outcome, price, quantity }
    : { market_id: marketId, mode: st.ticket.mode, side: st.ticket.side, price, quantity };
  try {
    const order = await api.post<Order>('/api/orders', body);
    st.pendingLine = null;
    if (order.status === 'filled') {
      st.updates.push('Filled in full');
    } else if (order.status === 'partially_filled') {
      st.updates.push(`Partially filled — ${order.filled_quantity} of ${order.quantity}`);
    } else {
      st.updates.push('Order resting');
    }
    for (const fill of order.fills) {
      st.updates.push(`Filled ${fill.quantity} at ${formatPrice(market.kind, fill.price)}`);
    }
    renderUpdates();
    await refreshDetailData(st, marketId);
    paintMarketDetailKeepScroll(st, marketId);
  } catch (err) {
    st.pendingLine = null;
    st.updates.push(errorMessage(err));
    renderUpdates();
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'market_not_trading') return 'This market isn\u2019t trading right now.';
    if (err.code === 'validation' && err.fields) {
      for (const [field, code] of Object.entries(err.fields)) {
        if (field === 'price' && code === 'out_of_range') return 'Enter a price in range.';
        if (field === 'quantity') {
          if (code === 'out_of_range') return 'Enter a quantity from 1 to 100,000.';
          if (code === 'insufficient_funds') return 'Not enough available balance for this order.';
          if (code === 'insufficient_holdings') return 'You don\u2019t hold enough units to sell.';
          if (code === 'exceeds_position') return 'This would flip your margin position — close it first.';
        }
      }
    }
    if (err.code === 'invalid_transition') return 'This order has already ended.';
    return err.code.replace(/_/g, ' ');
  }
  return 'Something went wrong.';
}

function paintMarketDetailKeepScroll(st: DetailState, marketId: string): void {
  const y = window.scrollY;
  paintMarketDetail(st, marketId);
  window.scrollTo(0, y);
}

async function refreshDetailData(st: DetailState, marketId: string): Promise<void> {
  const [market, book, balance, orders] = await Promise.all([
    api.get<Market>(`/api/markets/${marketId}`).catch(() => null),
    api.get<Book>(`/api/markets/${marketId}/book`).catch(() => null),
    api.get<Balance>('/api/balance').catch(() => null),
    api.get<{ orders: Order[] }>('/api/orders?status=open').catch(() => null),
  ]);
  if (market) st.market = market;
  if (book) st.book = book;
  if (balance) st.balance = balance;
  if (orders) st.orders = orders.orders;
  if (book) orbitInstance?.setBook(book);
}

function bindBookLevels(st: DetailState, marketId: string): void {
  const listbox = document.getElementById('book-levels');
  if (!listbox) return;
  listbox.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('[role="option"]') as HTMLElement | null;
    if (!target) return;
    const key = target.getAttribute('data-level');
    if (key) selectLevel(st, marketId, key);
  });
  listbox.addEventListener('keydown', (e) => {
    const options = Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]'));
    if (options.length === 0) return;
    const currentIndex = options.findIndex((o) => o.getAttribute('aria-selected') === 'true');
    let nextIndex = currentIndex;
    if (e.key === 'ArrowDown') nextIndex = Math.min(options.length - 1, currentIndex + 1);
    else if (e.key === 'ArrowUp') nextIndex = Math.max(0, currentIndex - 1);
    else if (e.key === 'Home') nextIndex = 0;
    else if (e.key === 'End') nextIndex = options.length - 1;
    else if (e.key === 'Enter' || e.key === ' ') {
      const chosen = options[currentIndex < 0 ? 0 : currentIndex];
      const key = chosen?.getAttribute('data-level');
      if (key) {
        e.preventDefault();
        selectLevel(st, marketId, key);
      }
      return;
    } else {
      return;
    }
    e.preventDefault();
    const chosen = options[nextIndex];
    const key = chosen?.getAttribute('data-level');
    if (key) {
      st.highlight = key;
      chosen?.setAttribute('aria-selected', 'true');
      options.forEach((o) => {
        if (o !== chosen) o.setAttribute('aria-selected', 'false');
      });
      orbitInstance?.setHighlight(key);
      const canvas = document.querySelector('canvas.orbit');
      if (canvas) canvas.setAttribute('data-highlight', key);
      const [side, priceStr] = key.split(':');
      const price = Number(priceStr);
      const qty = Number(chosen?.getAttribute('data-qty') ?? '0');
      prefillFromLevel(st, key, price, qty, side === 'ask' ? 'ask' : 'bid');
      paintTicketOnly(st);
    }
  });
}

let streamSource: EventSource | null = null;

function connectStream(st: DetailState, marketId: string): void {
  streamSource?.close();
  streamSource = new EventSource(`/api/stream?market_id=${encodeURIComponent(marketId)}`);
  streamSource.addEventListener('book', (ev) => {
    const book = JSON.parse((ev as MessageEvent).data) as Book;
    st.book = book;
    orbitInstance?.setBook(book);
    const y = window.scrollY;
    const listbox = document.getElementById('book-levels');
    if (listbox && st.market) {
      const opts = levelOptions(book, st.market.kind);
      listbox.innerHTML = opts.length === 0
        ? '<p>No resting orders yet — be the first on the book.</p>'
        : opts.map((o) => `<div class="book-option ${o.side}" role="option" aria-selected="${st.highlight === o.key}" data-level="${o.key}" data-price="${o.price}" data-qty="${o.quantity}" data-side="${o.side}" tabindex="-1">${o.label}</div>`).join('');
    }
    const last = document.getElementById('last-trade');
    if (last && st.market) last.textContent = book.last_price === null ? '—' : formatPrice(st.market.kind, book.last_price);
    void y;
  });
  streamSource.addEventListener('balance', (ev) => {
    const balance = JSON.parse((ev as MessageEvent).data) as Balance;
    st.balance = balance;
    const el = document.querySelector('[aria-label="Your balance"] p');
    if (el) el.textContent = `Available ${formatMoney(balance.available_cents)}`;
  });
  streamSource.addEventListener('order', () => {
    void refreshDetailData(st, marketId).then(() => paintMarketDetailKeepScroll(st, marketId));
  });
  streamSource.addEventListener('fill', (ev) => {
    const fill = JSON.parse((ev as MessageEvent).data) as { quantity: number; price: number };
    if (st.market) {
      st.updates.push(`Filled ${fill.quantity} at ${formatPrice(st.market.kind, fill.price)}`);
    }
    const updates = document.getElementById('order-updates');
    if (updates) updates.innerHTML = st.updates.slice(-10).map((line) => `<div class="line">${line}</div>`).join('');
  });
  streamSource.addEventListener('liquidation', (ev) => {
    const liq = JSON.parse((ev as MessageEvent).data) as { market_id: string; mark_price: number };
    if (st.market) {
      st.updates.push(`Your ${st.market.symbol} margin position was liquidated at ${formatPrice('pair', liq.mark_price)}.`);
      const updates = document.getElementById('order-updates');
      if (updates) updates.innerHTML = st.updates.slice(-10).map((line) => `<div class="line">${line}</div>`).join('');
    }
  });
  streamSource.addEventListener('market', (ev) => {
    const payload = JSON.parse((ev as MessageEvent).data) as { status: string; outcome?: string };
    if (st.market) {
      const outcome = payload.outcome === 'yes' || payload.outcome === 'no' ? payload.outcome : st.market.outcome;
      st.market = { ...st.market, status: payload.status, outcome };
      const statusEl = document.querySelector('[role="status"][aria-label="Market status"]');
      if (statusEl) statusEl.textContent = marketStatusText(payload.status, payload.outcome ?? null);
    }
  });
  streamSource.addEventListener('trade', () => {
    void refreshDetailData(st, marketId);
  });
}

function openCancelDialog(st: DetailState, marketId: string, orderId: string, opener: HTMLElement): void {
  const dialog = document.createElement('dialog');
  dialog.className = 'sheet';
  dialog.setAttribute('aria-label', 'Cancel order');
  dialog.innerHTML = `
    <h2>Cancel order</h2>
    <p>Cancel this resting order?</p>
    <div class="dialog-actions">
      <button class="pill" id="yes-cancel">Yes, cancel</button>
      <button class="pill ghost" id="keep-order">Keep order</button>
    </div>`;
  document.body.appendChild(dialog);
  const updates = () => document.getElementById('order-updates');
  const close = (focus?: HTMLElement): void => {
    dialog.close();
    dialog.remove();
    (focus ?? opener).focus();
  };
  dialog.querySelector('#keep-order')?.addEventListener('click', () => close());
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  dialog.addEventListener('close', () => dialog.remove());
  trapFocus(dialog);
  dialog.showModal();
  dialog.querySelector('#yes-cancel')?.addEventListener('click', async () => {
    close();
    st.pendingLine = 'Cancelling\u2026';
    const box = updates();
    if (box) box.innerHTML = [...st.updates.slice(-10), st.pendingLine].map((l) => `<div class="line">${l}</div>`).join('');
    try {
      await api.del(`/api/orders/${orderId}`);
      st.pendingLine = null;
      st.updates.push('Order cancelled');
      if (box) box.innerHTML = st.updates.slice(-10).map((l) => `<div class="line">${l}</div>`).join('');
      await refreshDetailData(st, marketId);
      paintMarketDetailKeepScroll(st, marketId);
      const heading = document.getElementById('orders-pane')?.querySelector('h3');
      if (heading instanceof HTMLElement) heading.setAttribute('tabindex', '-1');
      if (heading instanceof HTMLElement) heading.focus();
    } catch (err) {
      st.pendingLine = null;
      st.updates.push(errorMessage(err));
      if (box) box.innerHTML = st.updates.slice(-10).map((l) => `<div class="line">${l}</div>`).join('');
    }
  });
  const yesBtn = dialog.querySelector('#yes-cancel');
  if (yesBtn instanceof HTMLElement) yesBtn.focus();
}

// ---------- Balance ----------

async function renderBalance(): Promise<void> {
  const [balance, deposits, positions] = await Promise.all([
    api.get<Balance>('/api/balance'),
    api.get<{ deposits: Deposit[] }>('/api/deposits'),
    api.get<Positions>('/api/positions'),
  ]);
  const markets = await api.get<{ markets: Market[] }>('/api/markets');
  const nameOf = (id: string): string => markets.markets.find((m) => m.id === id)?.symbol ?? id.slice(0, 8);
  app.innerHTML = `
  ${topbar('/balance')}
  <main class="field slate">
    <div class="center">
      <h1>Balance</h1>
      <div class="grid cols-2">
        <div class="card"><h3>Available</h3><p class="numeral tabular">${formatMoney(balance.available_cents)}</p></div>
        <div class="card"><h3>Held</h3><p class="numeral tabular">${formatMoney(balance.held_cents)}</p></div>
        <div class="card"><h3>Collateral</h3><p class="numeral tabular">${formatMoney(balance.collateral_cents)}</p></div>
        <div class="card"><button class="pill" id="deposit-btn">Deposit by card</button></div>
      </div>
      <p role="status" aria-label="Deposit status" id="deposit-status" class="status-line"></p>
      <div class="card">
        <h3>Deposits</h3>
        <table aria-label="Deposits">
          <thead><tr><th>Time</th><th>Amount</th><th>Card</th><th>Status</th></tr></thead>
          <tbody id="deposit-rows">
            ${deposits.deposits.map((d) => `<tr><td>${new Date(d.created_at).toLocaleString('en-US')}</td><td class="tabular">${formatMoney(d.amount_cents)}</td><td>•••• ${d.card_last4}</td><td>${d.status}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="card">
        <h3>Positions</h3>
        <table aria-label="Positions">
          <thead><tr><th>Market</th><th>Kind</th><th>Side/Outcome</th><th>Quantity</th></tr></thead>
          <tbody>
            ${positions.spot.map((p) => `<tr><td>${nameOf(p.market_id)}</td><td>Spot</td><td>units</td><td class="tabular">${p.quantity}</td></tr>`).join('')}
            ${positions.margin.map((p) => `<tr><td>${nameOf(p.market_id)}</td><td>Margin</td><td>${p.side}</td><td class="tabular">${p.quantity}</td></tr>`).join('')}
            ${positions.event.map((p) => `<tr><td>${nameOf(p.market_id)}</td><td>Event</td><td>${p.outcome.toUpperCase()}</td><td class="tabular">${p.quantity}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  </main>`;
  bindTopbar();
  document.getElementById('deposit-btn')?.addEventListener('click', () => openDepositDialog());
}

function openDepositDialog(): void {
  const status = () => document.getElementById('deposit-status');
  const dialog = document.createElement('dialog');
  dialog.className = 'sheet';
  dialog.setAttribute('aria-label', 'Deposit by card');
  dialog.innerHTML = `
    <h2>Deposit by card</h2>
    <form id="deposit-form" onsubmit="return false">
      <label for="dep-amount">Amount (USD)</label>
      <input id="dep-amount" type="text" inputmode="decimal" autocomplete="off">
      <label for="dep-card">Card number</label>
      <input id="dep-card" type="text" inputmode="numeric" autocomplete="off">
      <div class="dialog-actions">
        <button class="pill" id="dep-submit">Deposit</button>
      </div>
    </form>`;
  document.body.appendChild(dialog);
  const opener = document.getElementById('deposit-btn') as HTMLElement | null;
  const close = (): void => {
    dialog.close();
    dialog.remove();
    opener?.focus();
  };
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  dialog.addEventListener('close', () => dialog.remove());
  trapFocus(dialog);
  dialog.showModal();
  const amount = dialog.querySelector('#dep-amount') as HTMLInputElement;
  amount.focus();
  const submit = async (): Promise<void> => {
    const card = dialog.querySelector('#dep-card') as HTMLInputElement;
    const dollars = Number(amount.value.replace(/[$,\s]/g, ''));
    const cents = Math.round(dollars * 100);
    const el = status();
    if (el) el.textContent = 'Waiting for card confirmation\u2026';
    close();
    try {
      const deposit = await api.post<Deposit>('/api/deposits', { amount_cents: cents, card_number: card.value });
      if (el) el.textContent = `Deposit confirmed — ${formatMoney(deposit.amount_cents)} added to your balance.`;
      const rows = document.getElementById('deposit-rows');
      rows?.insertAdjacentHTML('afterbegin', `<tr><td>${new Date(deposit.created_at).toLocaleString('en-US')}</td><td class="tabular">${formatMoney(deposit.amount_cents)}</td><td>•••• ${deposit.card_last4}</td><td>${deposit.status}</td></tr>`);
    } catch (err) {
      if (el) {
        if (err instanceof ApiError) {
          if (err.code === 'payment_declined') el.textContent = 'Card declined — nothing was charged.';
          else if (err.code === 'validation' && err.fields?.['amount_cents'] === 'out_of_range') el.textContent = 'Enter an amount from $5.00 to $5,000.00.';
          else if (err.code === 'validation' && err.fields?.['card_number'] === 'invalid') el.textContent = 'Enter a valid card number.';
          else if (err.code === 'payments_unavailable') el.textContent = 'Card payments are paused — your balance is safe';
          else el.textContent = err.code.replace(/_/g, ' ');
        } else {
          el.textContent = 'Something went wrong.';
        }
      }
    }
  };
  dialog.querySelector('#dep-submit')?.addEventListener('click', () => void submit());
  (dialog.querySelector('#deposit-form') as HTMLFormElement | null)?.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
    }
  });
}

// ---------- Orders ----------

async function renderOrders(): Promise<void> {
  const orders = await api.get<{ orders: Order[] }>('/api/orders?status=all');
  const markets = await api.get<{ markets: Market[] }>('/api/markets');
  const kindOf = (id: string): 'pair' | 'event' => markets.markets.find((m) => m.id === id)?.kind ?? 'pair';
  app.innerHTML = `
  ${topbar('/orders')}
  <main class="field slate">
    <div class="center">
      <h1>Orders</h1>
      <div class="card">
        <table>
          <thead><tr><th>Market</th><th>Order</th><th>Status</th><th>Price</th><th>Qty</th><th>Filled</th><th></th></tr></thead>
          <tbody>
            ${orders.orders.map((o) => `
              <tr>
                <td><a href="/orders/${o.id}" data-link>${shortId(o.id)}</a></td>
                <td>${o.outcome ? o.outcome.toUpperCase() : o.mode ?? ''} ${o.side}</td>
                <td>${o.status.replace('_', ' ')}</td>
                <td class="tabular">${formatPrice(kindOf(o.market_id), o.price)}</td>
                <td class="tabular">${o.quantity}</td>
                <td class="tabular">${o.filled_quantity}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  </main>`;
  bindTopbar();
}

async function renderOrderDetail(orderId: string): Promise<void> {
  const order = await api.get<Order>(`/api/orders/${orderId}`).catch(() => null);
  if (!order) {
    renderMessagePage('We couldn\u2019t find that page');
    return;
  }
  const markets = await api.get<{ markets: Market[] }>('/api/markets');
  const market = markets.markets.find((m) => m.id === order.market_id);
  const kind = market?.kind ?? 'pair';
  app.innerHTML = `
  ${topbar('/orders')}
  <main class="field slate">
    <div class="center">
      <h1>Order ${shortId(order.id)}</h1>
      <div class="card">
        <p>${market?.symbol ?? ''} · ${order.outcome ? order.outcome.toUpperCase() : order.mode ?? ''} ${order.side}</p>
        <p>Status: ${order.status.replace('_', ' ')}</p>
        <p class="tabular">Price ${formatPrice(kind, order.price)} · Quantity ${order.quantity} · Filled ${order.filled_quantity}</p>
      </div>
      <div class="card">
        <h3>Fills</h3>
        <table>
          <thead><tr><th>Time</th><th>Price</th><th>Qty</th><th>Fee</th><th>Liquidity</th></tr></thead>
          <tbody>
            ${order.fills.map((f) => `<tr><td>${new Date(f.filled_at).toLocaleString('en-US')}</td><td class="tabular">${formatPrice(kind, f.price)}</td><td class="tabular">${f.quantity}</td><td class="tabular">${formatMoney(f.fee_cents)}</td><td>${f.liquidity}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  </main>`;
  bindTopbar();
}

// ---------- Statements ----------

async function renderStatements(): Promise<void> {
  const statements = await api.get<{ statements: Statement[] }>('/api/statements');
  app.innerHTML = `
  ${topbar('/statements')}
  <main class="field slate">
    <div class="center">
      <h1>Statements</h1>
      <div role="alert" id="statement-alert"></div>
      <div class="card">
        ${statements.statements.length === 0
          ? '<p>No statements yet — your first arrives on the 1st.</p>'
          : `<div role="list" aria-label="Statements">
              ${statements.statements.map((s) => `<div role="listitem"><a href="#" data-statement="${s.id}" id="dl-${s.id}">Download ${monthName(s.month)} statement</a></div>`).join('')}
            </div>`}
      </div>
    </div>
  </main>`;
  bindTopbar();
  document.querySelectorAll<HTMLAnchorElement>('[data-statement]').forEach((link) => {
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      const id = link.getAttribute('data-statement');
      if (!id) return;
      const alertEl = document.getElementById('statement-alert');
      try {
        const linkRes = await api.get<{ url: string }>(`/api/statements/${id}/link`);
        window.open(linkRes.url, '_blank');
        if (alertEl) alertEl.textContent = '';
      } catch (err) {
        if (alertEl) {
          alertEl.innerHTML = '<div class="alert-banner" role="alert">Statements are unavailable right now — try again in a few minutes.</div>';
        }
        void err;
      }
    });
  });
}

// ---------- Profile ----------

async function renderProfile(): Promise<void> {
  const me = state.me;
  const documents = await api.get<{ documents: { id: string; filename: string; content_type: string; size_bytes: number; uploaded_at: string }[] }>('/api/me/documents').catch(() => ({ documents: [] }));
  app.innerHTML = `
  ${topbar('/profile')}
  <main class="field slate">
    <div class="center">
      <h1>Profile</h1>
      <div class="card">
        <h3>Display name</h3>
        <label for="display-name">Display name</label>
        <input id="display-name" type="text" value="${me?.display_name ?? ''}">
        <p role="status" aria-label="Profile status" id="profile-status" class="status-line"></p>
        <button class="pill" id="save-profile">Save profile</button>
      </div>
      <div class="card">
        <h3>ID document</h3>
        <label for="doc-input">ID document</label>
        <input id="doc-input" type="file" accept=".pdf,.png,.jpeg,.jpg">
        <p role="status" aria-label="Profile status" id="doc-status" class="status-line"></p>
        <button class="pill" id="upload-doc">Upload ID document</button>
      </div>
      <div class="card">
        <h3>Your documents</h3>
        <table aria-label="Your documents">
          <thead><tr><th>Filename</th><th>Type</th><th>Size</th><th>Uploaded</th></tr></thead>
          <tbody id="doc-rows">
            ${documents.documents.map((d) => `<tr><td>${d.filename}</td><td>${d.content_type}</td><td>${d.size_bytes}</td><td>${new Date(d.uploaded_at).toLocaleString('en-US')}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  </main>`;
  bindTopbar();
  document.getElementById('save-profile')?.addEventListener('click', async () => {
    const input = document.getElementById('display-name') as HTMLInputElement;
    const statusEl = document.getElementById('profile-status');
    if (statusEl) statusEl.textContent = 'Saving\u2026';
    try {
      const updated = await api.patch<Me>('/api/me', { display_name: input.value });
      state.me = updated;
      if (statusEl) statusEl.textContent = 'Profile saved.';
    } catch (err) {
      if (statusEl) statusEl.textContent = err instanceof ApiError && err.code === 'validation' ? 'Enter a display name of 1 to 60 characters.' : 'Something went wrong.';
    }
  });
  document.getElementById('upload-doc')?.addEventListener('click', async () => {
    const input = document.getElementById('doc-input') as HTMLInputElement;
    const file = input.files?.[0];
    const statusEl = document.getElementById('doc-status');
    if (!file) {
      if (statusEl) statusEl.textContent = 'Choose a file first.';
      return;
    }
    if (statusEl) statusEl.textContent = 'Uploading\u2026';
    const form = new FormData();
    form.append('document', file);
    try {
      const doc = await api.post<{ id: string; filename: string; content_type: string; size_bytes: number; uploaded_at: string }>('/api/me/documents', form);
      if (statusEl) statusEl.textContent = 'Document uploaded.';
      const rows = document.getElementById('doc-rows');
      rows?.insertAdjacentHTML('afterbegin', `<tr><td>${doc.filename}</td><td>${doc.content_type}</td><td>${doc.size_bytes}</td><td>${new Date(doc.uploaded_at).toLocaleString('en-US')}</td></tr>`);
    } catch (err) {
      if (statusEl) {
        if (err instanceof ApiError) {
          if (err.code === 'validation' && err.fields?.['document'] === 'unsupported_type') statusEl.textContent = 'Upload a PDF, PNG or JPEG of up to 5,000,000 bytes.';
          else if (err.code === 'documents_unavailable') statusEl.textContent = 'Documents are unavailable right now — try again in a few minutes.';
          else statusEl.textContent = err.code.replace(/_/g, ' ');
        }
      }
    }
  });
}

// ---------- Builder ----------

async function renderBuilder(): Promise<void> {
  const [keys, billing, webhooks] = await Promise.all([
    api.get<{ keys: ApiKey[] }>('/api/keys'),
    api.get<Billing>('/api/billing').catch(() => null),
    api.get<WebhookInfo>('/api/webhooks').catch(() => null),
  ]);
  const billingState = billing?.state ?? 'active';
  const badgeText = billingState === 'active' ? 'Active' : billingState === 'payment_failed' ? 'Payment failed' : 'Downgraded';
  const banner = billingState === 'payment_failed'
    ? '<div class="alert-banner" role="alert">Your last plan payment failed — pay now to keep your rate.</div>'
    : billingState === 'downgraded'
      ? '<div class="alert-banner" role="alert">Your plan is downgraded to Sandbox until the outstanding invoice is paid.</div>'
      : '';
  app.innerHTML = `
  ${topbar('/builder')}
  <main class="field olive">
    <div class="center">
      <h1>Builder</h1>
      <div class="grid cols-2">
        <section class="card" role="region" aria-label="Plan">
          <h3>Plan</h3>
          <p><span class="badge ${billingState === 'active' ? '' : 'warn'}" id="plan-badge">${badgeText}</span></p>
          ${banner}
          <div class="radiogroup" role="radiogroup" aria-label="Builder plan">
            <label class="radio-pill"><input type="radio" name="plan" value="sandbox" ${billing?.plan === 'sandbox' ? 'checked' : ''}> Sandbox</label>
            <label class="radio-pill"><input type="radio" name="plan" value="builder" ${billing?.plan === 'builder' ? 'checked' : ''}> Builder</label>
            <label class="radio-pill"><input type="radio" name="plan" value="desk" ${billing?.plan === 'desk' ? 'checked' : ''}> Desk</label>
          </div>
          <p role="status" aria-label="Billing status" id="billing-status" class="status-line"></p>
          <div class="row-actions">
            <button class="pill" id="change-plan">Change plan</button>
            ${billingState !== 'active' ? '<button class="pill" id="pay-balance">Pay outstanding balance</button>' : ''}
          </div>
          <h4>Invoices</h4>
          <table aria-label="Invoices">
            <thead><tr><th>Number</th><th>Date</th><th>Amount</th><th>Balance</th></tr></thead>
            <tbody>
              ${(billing?.invoices ?? []).map((inv) => `<tr><td>${inv.number}</td><td>${inv.invoice_date}</td><td class="tabular">${formatMoney(inv.amount_cents)}</td><td class="tabular">${formatMoney(inv.balance_cents)}</td></tr>`).join('')}
            </tbody>
          </table>
        </section>
        <section class="card">
          <h3>API keys</h3>
          <button class="pill" id="new-key">Create API key</button>
          <table aria-label="API keys">
            <thead><tr><th>Name</th><th>Created</th><th></th></tr></thead>
            <tbody id="key-rows">
              ${keys.keys.map((k) => `<tr><td>${k.name}</td><td>${new Date(k.created_at).toLocaleDateString('en-US')}</td><td>${k.revoked_at ? 'revoked' : `<button class="pill small" data-revoke="${k.id}">Revoke ${k.name}</button>`}</td></tr>`).join('')}
            </tbody>
          </table>
        </section>
      </div>
      <section class="card">
        <h3>Webhooks</h3>
        <label for="endpoint-url">Endpoint URL</label>
        <input id="endpoint-url" type="url" value="${webhooks?.endpoint?.url ?? ''}">
        <p role="status" aria-label="Webhook status" id="webhook-status" class="status-line"></p>
        <button class="pill" id="save-endpoint">Save endpoint</button>
        ${webhooks?.delivery === 'delayed' ? '<div class="alert-banner" role="alert">Webhook delivery is delayed — your fills are safe and will be sent.</div>' : ''}
        <h4>Delivery attempts</h4>
        <table aria-label="Delivery attempts">
          <thead><tr><th>Event</th><th>Status</th><th>Response</th><th>Time</th></tr></thead>
          <tbody>
            ${(webhooks?.attempts ?? []).map((a) => `<tr><td>${a.event_type}</td><td>${a.status}</td><td>${a.response_status ?? ''}</td><td>${a.timestamp}</td></tr>`).join('')}
          </tbody>
        </table>
      </section>
    </div>
  </main>`;
  bindTopbar();
  const billingStatus = () => document.getElementById('billing-status');
  document.getElementById('change-plan')?.addEventListener('click', async () => {
    const chosen = document.querySelector<HTMLInputElement>('input[name="plan"]:checked')?.value;
    if (!chosen) return;
    if (billingStatus()) billingStatus()!.textContent = 'Updating plan\u2026';
    try {
      await api.post<Billing>('/api/billing/plan', { plan: chosen });
      if (billingStatus()) billingStatus()!.textContent = `Plan updated to ${chosen.charAt(0).toUpperCase()}${chosen.slice(1)}.`;
      await renderBuilder();
    } catch (err) {
      const el = billingStatus();
      if (el) {
        if (err instanceof ApiError) {
          if (err.code === 'already_on_plan') el.textContent = 'You are already on this plan.';
          else if (err.code === 'plan_locked') el.textContent = 'Pay the outstanding balance before changing plan.';
          else if (err.code === 'billing_unavailable') el.textContent = 'Billing is unavailable right now — your keys keep their current rate.';
          else el.textContent = err.code.replace(/_/g, ' ');
        }
      }
    }
  });
  document.getElementById('pay-balance')?.addEventListener('click', async () => {
    if (billingStatus()) billingStatus()!.textContent = 'Sending payment\u2026';
    try {
      await api.post<Billing>('/api/billing/pay');
      if (billingStatus()) billingStatus()!.textContent = 'Payment received.';
      await renderBuilder();
    } catch (err) {
      const el = billingStatus();
      if (el && err instanceof ApiError) {
        el.textContent = err.code === 'nothing_due' ? 'Nothing due.' : err.code === 'billing_unavailable' ? 'Billing is unavailable right now — your keys keep their current rate.' : err.code.replace(/_/g, ' ');
      }
    }
  });
  document.getElementById('new-key')?.addEventListener('click', () => openNewKeyDialog());
  document.querySelectorAll<HTMLButtonElement>('[data-revoke]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-revoke');
      if (!id) return;
      await api.del(`/api/keys/${id}`);
      btn.closest('tr')?.remove();
    });
  });
  document.getElementById('save-endpoint')?.addEventListener('click', async () => {
    const input = document.getElementById('endpoint-url') as HTMLInputElement;
    const el = document.getElementById('webhook-status');
    if (el) el.textContent = 'Saving endpoint\u2026';
    try {
      await api.put('/api/webhooks/endpoint', { url: input.value });
      if (el) el.textContent = 'Endpoint saved.';
    } catch (err) {
      if (el && err instanceof ApiError) {
        el.textContent = err.code === 'validation' && err.fields?.['url'] === 'invalid' ? 'Enter an http or https URL.' : err.code === 'webhooks_unavailable' ? 'Webhook delivery is delayed — your fills are safe and will be sent.' : err.code.replace(/_/g, ' ');
      }
    }
  });
}

function openNewKeyDialog(): void {
  const dialog = document.createElement('dialog');
  dialog.className = 'sheet';
  dialog.setAttribute('aria-label', 'New API key');
  dialog.innerHTML = `
    <h2>New API key</h2>
    <label for="key-name">Key name</label>
    <input id="key-name" type="text">
    <div class="dialog-actions">
      <button class="pill" id="create-key">Create key</button>
    </div>
    <div id="key-result"></div>`;
  document.body.appendChild(dialog);
  const opener = document.getElementById('new-key') as HTMLElement | null;
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      dialog.close();
      dialog.remove();
      opener?.focus();
    }
  });
  dialog.addEventListener('close', () => dialog.remove());
  trapFocus(dialog);
  dialog.showModal();
  (dialog.querySelector('#key-name') as HTMLInputElement | null)?.focus();
  dialog.querySelector('#create-key')?.addEventListener('click', async () => {
    const name = (dialog.querySelector('#key-name') as HTMLInputElement).value;
    const result = dialog.querySelector('#key-result');
    if (result) result.textContent = 'Creating key\u2026';
    try {
      const key = await api.post<{ id: string; name: string; secret: string }>('/api/keys', { name });
      if (result) result.innerHTML = `
        <p class="secret-box">${key.secret}</p>
        <p>This key is shown once.</p>
        <button class="pill small" id="copy-key">Copy key</button>`;
      dialog.querySelector('#copy-key')?.addEventListener('click', () => {
        void navigator.clipboard.writeText(key.secret);
      });
    } catch (err) {
      if (result) result.textContent = err instanceof ApiError && err.code === 'validation' ? 'Enter a key name of up to 40 characters.' : 'Something went wrong.';
    }
  });
}

// ---------- Admin ----------

async function renderAdmin(): Promise<void> {
  const [markets, deposits, documents] = await Promise.all([
    api.get<{ markets: Market[] }>('/api/markets'),
    api.get<{ deposits: (Deposit & { member: { id: string; display_name: string; email: string } })[] }>('/api/admin/deposits?q='),
    api.get<{ documents: { id: string; member: { id: string; display_name: string }; filename: string; content_type: string; size_bytes: number; uploaded_at: string }[] }>('/api/admin/documents').catch(() => ({ documents: [] })),
  ]);
  const can = (m: Market, to: string): boolean => {
    if (to === 'trading') return m.status === 'listed' || m.status === 'halted';
    if (to === 'halted') return m.status === 'trading';
    return false;
  };
  app.innerHTML = `
  ${topbar('/admin')}
  <main class="field sage">
    <div class="center">
      <h1>Market admin</h1>
      <p role="status" aria-label="Admin updates" id="admin-status" class="status-line"></p>
      <div class="card">
        <button class="pill" id="list-market">List market</button>
        <table aria-label="Markets">
          <thead><tr><th>Symbol</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${markets.markets.map((m) => `
              <tr>
                <td>${m.symbol}</td>
                <td>${marketStatusText(m.status, m.outcome)}</td>
                <td class="row-actions">
                  ${can(m, 'trading') ? `<button class="pill small" data-open="${m.id}">Open trading</button>` : ''}
                  ${can(m, 'halted') ? `<button class="pill small" data-halt="${m.id}">Halt</button>` : ''}
                  ${m.status === 'halted' ? `<button class="pill small" data-resume="${m.id}">Resume</button>` : ''}
                  ${m.kind === 'event' && m.status === 'closed' ? `<button class="pill small" data-resolve="${m.id}" data-symbol="${m.symbol}">Resolve</button>` : ''}
                  ${m.kind === 'pair' ? `<button class="pill small" data-liquidate="${m.id}">Run liquidations</button>` : ''}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="card">
        <h3>Deposits</h3>
        <table aria-label="Deposits">
          <thead><tr><th>Member</th><th>Amount</th><th>Refundable</th><th></th></tr></thead>
          <tbody>
            ${deposits.deposits.map((d) => `
              <tr>
                <td>${d.member.display_name}</td>
                <td class="tabular">${formatMoney(d.amount_cents)}</td>
                <td class="tabular">${formatMoney(d.amount_cents - d.refunded_cents)}</td>
                <td>${d.status === 'succeeded' ? `<button class="pill small" data-refund="${d.id}" data-max="${d.amount_cents - d.refunded_cents}">Refund</button>` : ''}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="card">
        <h3>ID documents</h3>
        <table aria-label="ID documents">
          <thead><tr><th>Member</th><th>Filename</th><th>Size</th><th></th></tr></thead>
          <tbody>
            ${documents.documents.map((d) => `<tr><td>${d.member.display_name}</td><td>${d.filename}</td><td>${d.size_bytes}</td><td><a href="#" data-doc="${d.id}">View document</a></td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  </main>`;
  bindTopbar();
  const statusEl = () => document.getElementById('admin-status');
  const post = async (path: string, body?: unknown): Promise<void> => {
    try {
      await api.post(path, body);
      await renderAdmin();
    } catch (err) {
      const el = statusEl();
      if (el) el.textContent = err instanceof ApiError ? err.code.replace(/_/g, ' ') : 'Something went wrong.';
    }
  };
  document.querySelectorAll<HTMLButtonElement>('[data-open]').forEach((b) => b.addEventListener('click', () => void post(`/api/markets/${b.getAttribute('data-open')}/open`)));
  document.querySelectorAll<HTMLButtonElement>('[data-halt]').forEach((b) => b.addEventListener('click', () => void post(`/api/markets/${b.getAttribute('data-halt')}/halt`)));
  document.querySelectorAll<HTMLButtonElement>('[data-resume]').forEach((b) => b.addEventListener('click', () => void post(`/api/markets/${b.getAttribute('data-resume')}/resume`)));
  document.querySelectorAll<HTMLButtonElement>('[data-liquidate]').forEach((b) => b.addEventListener('click', () => void post(`/api/markets/${b.getAttribute('data-liquidate')}/liquidations`)));
  document.querySelectorAll<HTMLButtonElement>('[data-resolve]').forEach((b) => b.addEventListener('click', () => openResolveDialog(b.getAttribute('data-resolve') ?? '', b.getAttribute('data-symbol') ?? '')));
  document.getElementById('list-market')?.addEventListener('click', () => openListMarketDialog());
  document.querySelectorAll<HTMLButtonElement>('[data-refund]').forEach((b) => b.addEventListener('click', () => openRefundDialog(b.getAttribute('data-refund') ?? '', Number(b.getAttribute('data-max') ?? '0'), b)));
  document.querySelectorAll<HTMLAnchorElement>('[data-doc]').forEach((a) => a.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      const link = await api.get<{ url: string }>(`/api/admin/documents/${a.getAttribute('data-doc')}/link`);
      window.open(link.url, '_blank');
    } catch {
      const el = statusEl();
      if (el) el.textContent = 'Documents are unavailable right now — try again in a few minutes.';
    }
  }));
}

function openListMarketDialog(): void {
  const dialog = document.createElement('dialog');
  dialog.className = 'sheet';
  dialog.setAttribute('aria-label', 'List market');
  dialog.innerHTML = `
    <h2>List market</h2>
    <label for="lm-kind">Kind</label>
    <select id="lm-kind"><option value="event">Event</option><option value="pair">Pair</option></select>
    <label for="lm-symbol">Symbol</label>
    <input id="lm-symbol" type="text">
    <label for="lm-title">Title</label>
    <input id="lm-title" type="text">
    <label for="lm-closes">Closes at</label>
    <input id="lm-closes" type="datetime-local">
    <div class="dialog-actions">
      <button class="pill" id="lm-create">List market</button>
    </div>`;
  document.body.appendChild(dialog);
  const opener = document.getElementById('list-market') as HTMLElement | null;
  const close = (): void => {
    dialog.close();
    dialog.remove();
    opener?.focus();
  };
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  dialog.addEventListener('close', () => dialog.remove());
  trapFocus(dialog);
  dialog.showModal();
  (dialog.querySelector('#lm-symbol') as HTMLInputElement | null)?.focus();
  dialog.querySelector('#lm-create')?.addEventListener('click', async () => {
    const kind = (dialog.querySelector('#lm-kind') as HTMLSelectElement).value as 'event' | 'pair';
    const symbol = (dialog.querySelector('#lm-symbol') as HTMLInputElement).value.toUpperCase();
    const title = (dialog.querySelector('#lm-title') as HTMLInputElement).value;
    const closes = (dialog.querySelector('#lm-closes') as HTMLInputElement).value;
    try {
      await api.post('/api/markets', { kind, symbol, title, closes_at: kind === 'event' ? new Date(closes).toISOString() : undefined });
      close();
      await renderAdmin();
    } catch {
      // errors shown on next render
    }
  });
}

function openResolveDialog(marketId: string, symbol: string): void {
  const dialog = document.createElement('dialog');
  dialog.className = 'sheet';
  dialog.setAttribute('aria-label', `Resolve ${symbol}`);
  dialog.innerHTML = `
    <h2>Resolve ${symbol}</h2>
    <div class="radiogroup" role="radiogroup" aria-label="Resolution">
      <label class="radio-pill"><input type="radio" name="resolution" value="yes" checked> Yes</label>
      <label class="radio-pill"><input type="radio" name="resolution" value="no"> No</label>
    </div>
    <div class="dialog-actions">
      <button class="pill" id="confirm-resolution">Confirm resolution</button>
    </div>`;
  document.body.appendChild(dialog);
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      dialog.close();
      dialog.remove();
    }
  });
  dialog.addEventListener('close', () => dialog.remove());
  trapFocus(dialog);
  dialog.showModal();
  const btn = dialog.querySelector('#confirm-resolution');
  if (btn instanceof HTMLElement) btn.focus();
  dialog.querySelector('#confirm-resolution')?.addEventListener('click', async () => {
    const outcome = dialog.querySelector<HTMLInputElement>('input[name="resolution"]:checked')?.value as 'yes' | 'no';
    dialog.close();
    dialog.remove();
    await api.post(`/api/markets/${marketId}/resolve`, { outcome });
    await renderAdmin();
  });
}

function openRefundDialog(depositId: string, maxCents: number, opener: HTMLElement): void {
  const dialog = document.createElement('dialog');
  dialog.className = 'sheet';
  dialog.setAttribute('aria-label', 'Refund deposit');
  dialog.innerHTML = `
    <h2>Refund deposit</h2>
    <label for="refund-amount">Refund amount (USD)</label>
    <input id="refund-amount" type="text" inputmode="decimal">
    <div class="dialog-actions">
      <button class="pill" id="issue-refund">Issue refund</button>
    </div>`;
  document.body.appendChild(dialog);
  const close = (focus?: HTMLElement): void => {
    dialog.close();
    dialog.remove();
    (focus ?? opener).focus();
  };
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  dialog.addEventListener('close', () => dialog.remove());
  trapFocus(dialog);
  dialog.showModal();
  (dialog.querySelector('#refund-amount') as HTMLInputElement | null)?.focus();
  dialog.querySelector('#issue-refund')?.addEventListener('click', async () => {
    const value = (dialog.querySelector('#refund-amount') as HTMLInputElement).value;
    const cents = Math.round(Number(value.replace(/[$,\s]/g, '')) * 100);
    try {
      const refund = await api.post<{ amount_cents: number }>(`/api/deposits/${depositId}/refunds`, { amount_cents: cents });
      close();
      const statusEl = document.getElementById('admin-status');
      if (statusEl) statusEl.textContent = `Refund of ${formatMoney(refund.amount_cents)} issued.`;
      await renderAdmin();
    } catch (err) {
      const statusEl = document.getElementById('admin-status');
      if (statusEl && err instanceof ApiError) {
        if (err.code === 'validation' && err.fields?.['amount_cents'] === 'exceeds_refundable') statusEl.textContent = `Enter an amount up to ${formatMoney(maxCents)}.`;
        else if (err.code === 'payments_unavailable') statusEl.textContent = 'Card payments are paused — your balance is safe';
        else statusEl.textContent = err.code.replace(/_/g, ' ');
      }
      close();
    }
  });
}

// ---------- Owner ----------

async function renderOwner(): Promise<void> {
  const [totals, billing, venue] = await Promise.all([
    api.get<Totals>('/api/venue/totals'),
    api.get<{ builders: { member_id: string; display_name: string; plan: string; effective_plan: string; state: string }[] }>('/api/venue/billing').catch(() => ({ builders: [] })),
    state.me ? Promise.resolve({ venue: state.me.venue }) : Promise.resolve({ venue: null }),
  ]);
  void venue;
  app.innerHTML = `
  ${topbar('/owner')}
  <main class="field slate">
    <div class="center">
      <h1>Venue</h1>
      <section class="card" role="region" aria-label="Venue totals">
        <div class="grid cols-3">
          <div><h3>Members</h3><p class="numeral">${formatThousands(totals.members)}</p></div>
          <div><h3>Open orders</h3><p class="numeral">${formatThousands(totals.open_orders)}</p></div>
          <div><h3>Open interest</h3><p class="numeral">${formatThousands(totals.open_interest_contracts)}</p></div>
          <div><h3>Deposits</h3><p class="numeral">${formatMoney(totals.deposits_cents)}</p></div>
          <div><h3>Refunds</h3><p class="numeral">${formatMoney(totals.refunds_cents)}</p></div>
          <div><h3>Fees</h3><p class="numeral">${formatMoney(totals.fees_cents)}</p></div>
          <div><h3>Volume today</h3><p class="numeral">${formatMoney(totals.volume_cents_today)}</p></div>
        </div>
      </section>
      <p role="status" aria-label="Venue updates" id="venue-status" class="status-line"></p>
      <section class="card">
        <h3>Find member</h3>
        <label for="member-search">Find member</label>
        <input id="member-search" type="text" role="combobox" aria-expanded="false" aria-controls="member-listbox" autocomplete="off">
        <div id="member-listbox" role="listbox" aria-label="Find member"></div>
        <div id="member-roles"></div>
        <button class="pill" id="invite-member">Invite member</button>
      </section>
      <section class="card">
        <h3>Fee schedule</h3>
        <label for="taker-fee">Taker fee (bps)</label>
        <input id="taker-fee" type="number" step="1" min="0" max="1000" value="125">
        <label for="maker-fee">Maker fee (bps)</label>
        <input id="maker-fee" type="number" step="1" min="0" max="1000" value="0">
        <button class="pill" id="save-fees">Save fees</button>
      </section>
      <section class="card">
        <h3>Exports and statements</h3>
        <label for="export-month">Export month</label>
        <input id="export-month" type="month">
        <a class="pill" href="#" id="export-fills">Export fills (CSV)</a>
        <button class="pill" id="generate-statements">Generate statements</button>
      </section>
      <section class="card">
        <h3>Builder billing</h3>
        <table aria-label="Builder billing">
          <thead><tr><th>Member</th><th>Plan</th><th>Effective</th><th>State</th></tr></thead>
          <tbody>
            ${billing.builders.map((b) => `<tr><td>${b.display_name}</td><td>${b.plan}</td><td>${b.effective_plan}</td><td>${b.state.replace('_', ' ')}</td></tr>`).join('')}
          </tbody>
        </table>
      </section>
    </div>
  </main>`;
  bindTopbar();
  const statusEl = () => document.getElementById('venue-status');
  const search = document.getElementById('member-search') as HTMLInputElement;
  const listbox = document.getElementById('member-listbox') as HTMLElement;
  let activeIndex = -1;
  const runSearch = async (): Promise<void> => {
    const q = search.value.trim();
    if (q.length === 0) {
      listbox.innerHTML = '';
      return;
    }
    const res = await api.get<{ members: { id: string; display_name: string; email: string; roles: string[] }[] }>(`/api/venue/members?q=${encodeURIComponent(q)}`).catch(() => ({ members: [] }));
    listbox.innerHTML = res.members.map((m, i) => `<div role="option" tabindex="-1" aria-selected="false" data-member="${m.id}" data-index="${i}">${m.display_name} — ${m.email}</div>`).join('');
    search.setAttribute('aria-expanded', String(res.members.length > 0));
    listbox.querySelectorAll<HTMLElement>('[data-member]').forEach((opt) => {
      opt.addEventListener('click', () => {
        const member = res.members.find((m) => m.id === opt.getAttribute('data-member'));
        const rolesEl = document.getElementById('member-roles');
        if (rolesEl && member) rolesEl.textContent = `${member.display_name}: ${member.roles.join(', ')}`;
        activeIndex = -1;
      });
    });
  };
  search.addEventListener('input', () => void runSearch());
  search.addEventListener('keydown', (e) => {
    const options = Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]'));
    if (e.key === 'ArrowDown') {
      activeIndex = Math.min(options.length - 1, activeIndex + 1);
    } else if (e.key === 'ArrowUp') {
      activeIndex = Math.max(0, activeIndex - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = options[activeIndex < 0 ? 0 : activeIndex];
      chosen?.click();
      return;
    } else {
      return;
    }
    e.preventDefault();
    options.forEach((o, i) => o.setAttribute('aria-selected', String(i === activeIndex)));
    options[activeIndex]?.focus?.();
  });
  document.getElementById('invite-member')?.addEventListener('click', () => openInviteDialog());
  document.getElementById('save-fees')?.addEventListener('click', async () => {
    const taker = Number((document.getElementById('taker-fee') as HTMLInputElement).value);
    const maker = Number((document.getElementById('maker-fee') as HTMLInputElement).value);
    const el = statusEl();
    if (el) el.textContent = 'Saving fees\u2026';
    try {
      await api.put('/api/venue/fees', { taker_fee_bps: taker, maker_fee_bps: maker });
      if (el) el.textContent = 'Fees saved.';
    } catch (err) {
      if (el) el.textContent = err instanceof ApiError && err.code === 'validation' ? 'Enter whole basis points from 0 to 1,000, with the maker fee no higher than the taker fee.' : 'Something went wrong.';
    }
  });
  document.getElementById('export-fills')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const month = (document.getElementById('export-month') as HTMLInputElement).value;
    const query = month ? `?month=${month}` : '';
    await downloadFile(`/api/venue/fills.csv${query}`, `fills-${month || 'current'}.csv`);
  });
  document.getElementById('generate-statements')?.addEventListener('click', async () => {
    const month = (document.getElementById('export-month') as HTMLInputElement).value;
    const el = statusEl();
    if (el) el.textContent = 'Generating\u2026';
    try {
      const res = await api.post<{ month: string; members: number }>('/api/venue/statements', { month });
      if (el) el.textContent = `Statements are being generated for ${monthName(res.month)}.`;
    } catch (err) {
      if (el && err instanceof ApiError) {
        el.textContent = err.code === 'validation' && err.fields?.['month'] === 'not_closed' ? 'Choose a month that has ended.'
          : err.code === 'statements_unavailable' ? 'Statements are unavailable right now — try again in a few minutes.'
          : err.code.replace(/_/g, ' ');
      }
    }
  });
}

function openInviteDialog(): void {
  const dialog = document.createElement('dialog');
  dialog.className = 'sheet';
  dialog.setAttribute('aria-label', 'Invite member');
  dialog.innerHTML = `
    <h2>Invite member</h2>
    <label for="inv-email">Email</label>
    <input id="inv-email" type="email">
    <label for="inv-name">Display name</label>
    <input id="inv-name" type="text">
    <label class="radio-pill"><input type="checkbox" id="inv-trader"> Trader</label>
    <label class="radio-pill"><input type="checkbox" id="inv-builder"> Builder</label>
    <label class="radio-pill"><input type="checkbox" id="inv-admin"> Market admin</label>
    <div class="dialog-actions">
      <button class="pill" id="send-invite">Send invite</button>
    </div>`;
  document.body.appendChild(dialog);
  const opener = document.getElementById('invite-member') as HTMLElement | null;
  const close = (): void => {
    dialog.close();
    dialog.remove();
    opener?.focus();
  };
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  dialog.addEventListener('close', () => dialog.remove());
  trapFocus(dialog);
  dialog.showModal();
  (dialog.querySelector('#inv-email') as HTMLInputElement | null)?.focus();
  dialog.querySelector('#send-invite')?.addEventListener('click', async () => {
    const email = (dialog.querySelector('#inv-email') as HTMLInputElement).value;
    const displayName = (dialog.querySelector('#inv-name') as HTMLInputElement).value;
    const roles: string[] = [];
    if ((dialog.querySelector('#inv-trader') as HTMLInputElement).checked) roles.push('trader');
    if ((dialog.querySelector('#inv-builder') as HTMLInputElement).checked) roles.push('builder');
    if ((dialog.querySelector('#inv-admin') as HTMLInputElement).checked) roles.push('market_admin');
    const statusEl = document.getElementById('venue-status');
    if (statusEl) statusEl.textContent = 'Sending invite\u2026';
    try {
      await api.post('/api/venue/invites', { email, display_name: displayName, roles });
      close();
      if (statusEl) statusEl.textContent = `Invite sent to ${email}.`;
    } catch (err) {
      if (statusEl && err instanceof ApiError) {
        if (err.code === 'validation' && err.fields?.['email'] === 'invalid') statusEl.textContent = 'Enter a valid email.';
        else if (err.code === 'validation' && err.fields?.['roles'] === 'invalid') statusEl.textContent = 'Choose at least one role.';
        else if (err.code === 'already_member') statusEl.textContent = 'That person is already a member.';
        else if (err.code === 'identity_unavailable') statusEl.textContent = 'Sign-in is unavailable right now — try again in a minute.';
        else statusEl.textContent = err.code.replace(/_/g, ' ');
      }
      close();
    }
  });
}

// ---------- Platform ----------

async function renderPlatform(): Promise<void> {
  const [venues, health] = await Promise.all([
    api.get<{ venues: { id: string; slug: string; name: string; time_zone: string; member_count: number; created_at: string }[] }>('/api/platform/venues'),
    api.get<{ providers: Record<string, string>; checked_at: string }>('/api/platform/health').catch(() => null),
  ]);
  app.innerHTML = `
  ${topbar('/platform')}
  <main class="field slate">
    <div class="center">
      <h1>Platform</h1>
      <section class="card" role="region" aria-label="Provider health">
        <h3>Provider health</h3>
        <div class="grid cols-3">
          ${health ? Object.entries(health.providers).map(([name, status]) => `<div><p>${name}</p><p class="numeral">${status}</p></div>`).join('') : '<p>Checking\u2026</p>'}
        </div>
      </section>
      <section class="card">
        <h3>Venues</h3>
        <table aria-label="Venues">
          <thead><tr><th>Name</th><th>Slug</th><th>Time zone</th><th>Members</th></tr></thead>
          <tbody>
            ${venues.venues.map((v) => `<tr><td>${v.name}</td><td>${v.slug}</td><td>${v.time_zone}</td><td>${v.member_count}</td></tr>`).join('')}
          </tbody>
        </table>
        <button class="pill" id="onboard-venue">Onboard venue</button>
      </section>
    </div>
  </main>`;
  bindTopbar();
  document.getElementById('onboard-venue')?.addEventListener('click', () => {
    const dialog = document.createElement('dialog');
    dialog.className = 'sheet';
    dialog.setAttribute('aria-label', 'Onboard venue');
    dialog.innerHTML = `
      <h2>Onboard venue</h2>
      <label for="ov-slug">Slug</label>
      <input id="ov-slug" type="text">
      <label for="ov-name">Name</label>
      <input id="ov-name" type="text">
      <label for="ov-tz">Time zone</label>
      <input id="ov-tz" type="text" value="America/New_York">
      <label for="ov-email">Owner email</label>
      <input id="ov-email" type="email">
      <div class="dialog-actions">
        <button class="pill" id="ov-create">Onboard venue</button>
      </div>`;
    document.body.appendChild(dialog);
    const opener = document.getElementById('onboard-venue') as HTMLElement | null;
    const close = (): void => {
      dialog.close();
      dialog.remove();
      opener?.focus();
    };
    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
    dialog.addEventListener('close', () => dialog.remove());
    trapFocus(dialog);
    dialog.showModal();
    (dialog.querySelector('#ov-slug') as HTMLInputElement | null)?.focus();
    dialog.querySelector('#ov-create')?.addEventListener('click', async () => {
      try {
        await api.post('/api/platform/venues', {
          slug: (dialog.querySelector('#ov-slug') as HTMLInputElement).value,
          name: (dialog.querySelector('#ov-name') as HTMLInputElement).value,
          time_zone: (dialog.querySelector('#ov-tz') as HTMLInputElement).value,
          owner_email: (dialog.querySelector('#ov-email') as HTMLInputElement).value,
        });
        close();
        await renderPlatform();
      } catch {
        close();
      }
    });
  });
}

// ---------- Accept invite ----------

async function renderAcceptInvite(token: string): Promise<void> {
  const invite = await api.get<{ email: string; venue_name: string }>(`/api/invites/${token}`).catch(() => null);
  if (!invite) {
    renderMessagePage('We couldn\u2019t find that page');
    return;
  }
  app.innerHTML = `
  <main class="field slate">
    <div class="center card" style="max-width:460px">
      <h1>${invite.venue_name}</h1>
      <p>Invite for ${invite.email}</p>
      <form role="form" aria-label="Accept invite" id="accept-form" onsubmit="return false">
        <label for="invite-password">Choose a password</label>
        <input id="invite-password" type="password" autocomplete="new-password">
        <p role="status" id="invite-status" class="status-line"></p>
        <button class="pill" id="accept-btn" type="button">Accept invite</button>
      </form>
    </div>
  </main>`;
  document.getElementById('accept-btn')?.addEventListener('click', async () => {
    const password = (document.getElementById('invite-password') as HTMLInputElement).value;
    const status = document.getElementById('invite-status');
    try {
      await api.post(`/api/invites/${token}/accept`, { password });
      if (status) status.textContent = 'Invite accepted. You can sign in now.';
      window.location.href = '/';
    } catch (err) {
      if (status && err instanceof ApiError) {
        status.textContent = err.code === 'invite_expired' ? 'This invite has expired — ask for a new one.' : err.code === 'validation' ? 'Choose a password of 12 to 128 characters.' : 'Something went wrong.';
      }
    }
  });
}

// ---------- Boot ----------

void render();
