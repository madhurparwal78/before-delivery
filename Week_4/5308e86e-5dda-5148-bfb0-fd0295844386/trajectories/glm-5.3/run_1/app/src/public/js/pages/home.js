// Cockpit home: snapshot cards, filters in the address, live feed.
import { api, ApiError, announce, el, formatDollars, initials, formatShortDate, sessionEpoch } from '../app.js';
import { Cockpit } from '../cockpit.js';

const METHODS = ['ach', 'wire', 'rtp', 'check', 'card', 'transfer'];

class HomePage {
  constructor() {
    this.rows = new Map(); // transaction id -> row element
    this.order = [];
    this.nextCursor = null;
    this.loading = false;
  }

  filtersFromAddress() {
    const q = new URLSearchParams(window.location.search);
    return {
      account: q.get('account') || '',
      method: q.get('method') || '',
      direction: q.get('direction') || '',
    };
  }

  addressForFilters(f) {
    const q = new URLSearchParams();
    if (f.account) q.set('account', f.account);
    if (f.method) q.set('method', f.method);
    if (f.direction) q.set('direction', f.direction);
    const s = q.toString();
    return s ? `/app?${s}` : '/app';
  }

  async run() {
    this.cockpit = new Cockpit({ pageName: 'home' });
    const ok = await this.cockpit.boot();
    if (!ok) return;
    this.cockpit.anyDialogOpen = () => this.cockpit.drawerOpen || this.cockpit.avatarOpen || this.removeDialogOpen;
    new (await import('../palette.js')).CommandPalette(this.cockpit);
    this.build();
    this.cockpit.onRefresh = async (reason) => {
      await this.refreshFigures();
      if (reason !== 'user' && reason !== 'filter') await this.refreshFeedPreserve();
    };
    this.cockpit.onTransaction = (tx) => {
      if (this.matchesFilters(tx)) this.prependRow(tx);
    };
    this.cockpit.startPeriodicRefresh();
    await this.refreshFigures();
    await this.loadFeed(true);
  }

  build() {
    const b = this.cockpit.body;
    b.textContent = '';
    const heading = el('div', { class: 'page-heading' });
    this.headingEl = heading;
    b.append(heading);

    this.snapshotRow = el('div', { class: 'snapshot-row panel-fade' });
    b.append(this.snapshotRow);

    this.feedCard = el('div', { class: 'feed-card panel-fade' });
    const filters = el('div', { class: 'filter-group', role: 'group', 'aria-label': 'Filter transactions' });
    this.filterAccount = el('select', { class: 'input', 'aria-label': 'Filter by account' });
    this.filterAccount.append(el('option', { value: '', text: 'All accounts' }));
    for (const a of this.cockpit.accounts) {
      this.filterAccount.append(el('option', { value: a.id, text: a.name }));
    }
    this.filterMethod = el('select', { class: 'input', 'aria-label': 'Filter by method' });
    this.filterMethod.append(el('option', { value: '', text: 'All methods' }));
    for (const m of METHODS) this.filterMethod.append(el('option', { value: m, text: m.toUpperCase() }));
    this.filterDirection = el('select', { class: 'input', 'aria-label': 'Filter by direction' });
    this.filterDirection.append(el('option', { value: '', text: 'In and out' }));
    this.filterDirection.append(el('option', { value: 'in', text: 'Money in' }));
    this.filterDirection.append(el('option', { value: 'out', text: 'Money out' }));
    this.countEl = el('span', { class: 'feed-count' });
    filters.append(this.filterAccount, this.filterMethod, this.filterDirection, this.countEl);
    this.feedCard.append(filters);
    this.feedList = el('ul', { class: 'feed-list', 'aria-label': 'Transaction feed' });
    this.feedCard.append(this.feedList);
    this.moreWrap = el('div', { class: 'show-more' });
    this.moreButton = el('button', { class: 'button button-secondary', text: 'Show more transactions', onclick: () => this.showMore() });
    this.moreWrap.append(this.moreButton);
    this.feedCard.append(this.moreWrap);
    b.append(this.feedCard);

    for (const sel of [this.filterAccount, this.filterMethod, this.filterDirection]) {
      sel.addEventListener('change', () => this.changeFilter());
    }
    this.applyAddressFilters();
    window.addEventListener('popstate', () => {
      this.applyAddressFilters();
      this.loadFeed(true, { announceCount: true });
    });
  }

  applyAddressFilters() {
    let f = this.filtersFromAddress();
    let changed = false;
    const own = new Set(this.cockpit.accounts.map(a => a.id));
    if (f.account && !own.has(f.account)) { f.account = ''; changed = true; }
    if (f.method && !METHODS.includes(f.method)) { f.method = ''; changed = true; }
    if (f.direction && f.direction !== 'in' && f.direction !== 'out') { f.direction = ''; changed = true; }
    if (changed) {
      window.history.replaceState(null, '', this.addressForFilters(f));
    }
    this.currentFilters = f;
    this.filterAccount.value = f.account;
    this.filterMethod.value = f.method;
    this.filterDirection.value = f.direction;
  }

  changeFilter() {
    const f = {
      account: this.filterAccount.value,
      method: this.filterMethod.value,
      direction: this.filterDirection.value,
    };
    this.currentFilters = f;
    const url = this.addressForFilters(f);
    window.history.pushState(null, '', url);
    this.loadFeed(true, { announceCount: true });
  }

  matchesFilters(tx) {
    const f = this.currentFilters;
    if (f.account && tx.account_id !== f.account) return false;
    if (f.method && tx.method !== f.method) return false;
    if (f.direction === 'in' && tx.direction !== 'credit') return false;
    if (f.direction === 'out' && tx.direction !== 'debit') return false;
    return true;
  }

  buildQuery(limit) {
    const f = this.currentFilters;
    const q = new URLSearchParams();
    if (f.account) q.set('account_id', f.account);
    if (f.method) q.set('method', f.method);
    if (f.direction) q.set('direction', f.direction === 'in' ? 'credit' : 'debit');
    if (limit) q.set('limit', String(limit));
    if (this.nextCursor && !limit) q.set('cursor', this.nextCursor);
    return `/api/transactions?${q.toString()}`;
  }

  async loadFeed(reset, { announceCount = false } = {}) {
    const epoch = this.cockpit.epoch;
    if (reset) {
      this.nextCursor = null;
      this.rows.clear();
      this.order = [];
      this.feedList.textContent = '';
    }
    this.loading = true;
    try {
      const res = await api('GET', this.buildQuery());
      if (epoch !== this.cockpit.epoch || epoch !== sessionEpoch) return;
      if (reset) {
        for (const tx of res.transactions) this.appendRow(tx);
      }
      this.nextCursor = res.next_cursor;
      this.moreButton.parentElement.style.display = res.next_cursor ? '' : 'none';
      if (this.order.length === 0) {
        this.feedList.textContent = '';
        this.feedList.append(el('li', { class: 'feed-empty', text: 'No transactions yet.' }));
      }
      this.updateCount();
      if (announceCount) announce(this.cockpit.statusRegion, `${this.order.length} transactions shown`);
    } catch (e) {
      this.cockpit.showOutage();
    } finally {
      this.loading = false;
    }
  }

  async refreshFeedPreserve() {
    // Refresh keeps every row shown and adds only newer rows at the top.
    const epoch = this.cockpit.epoch;
    try {
      const limit = Math.max(50, Math.min(100, this.order.length + 10));
      const res = await api('GET', this.buildQuery(limit));
      if (epoch !== this.cockpit.epoch || epoch !== sessionEpoch) return;
      const known = new Set(this.order);
      const fresh = res.transactions.filter(t => !known.has(t.id));
      if (this.order.length === 0) {
        this.feedList.textContent = '';
      }
      for (const tx of fresh) this.prependRow(tx);
      this.updateCount();
    } catch {
      // Keep what is shown; the outage copy handles the message.
    }
  }

  updateCount() {
    this.countEl.textContent = `${this.order.length} transactions shown`;
  }

  appendRow(tx) {
    const row = this.renderRow(tx);
    this.rows.set(tx.id, row);
    this.order.push(tx.id);
    this.feedList.append(row);
  }

  prependRow(tx) {
    if (this.rows.has(tx.id)) return;
    const empty = this.feedList.querySelector('.feed-empty');
    if (empty) empty.remove();
    const row = this.renderRow(tx);
    this.rows.set(tx.id, row);
    this.order.unshift(tx.id);
    this.feedList.prepend(row);
    this.updateCount();
  }

  renderRow(tx) {
    const li = el('li', { class: 'feed-row row-enter' });
    const avatar = el('span', { class: `feed-avatar h${hashString(tx.counterparty) % 4}`, 'aria-hidden': 'true', text: initials(tx.counterparty) });
    const main = el('div', {});
    main.append(el('div', { class: 'feed-name', text: tx.counterparty }));
    const meta = el('div', { class: 'feed-meta' });
    meta.append(el('span', { class: `chip ${tx.method}`, text: tx.method.toUpperCase() }));
    meta.append(el('span', { text: formatShortDate(tx.created_at.slice(0, 10)) }));
    main.append(meta);
    const amount = el('div', { class: `feed-amount ${tx.direction}` });
    const sign = tx.direction === 'credit' ? '+' : '−';
    amount.append(el('span', { text: `${sign}${formatDollars(tx.amount_cents)}` }));
    amount.append(el('span', { class: 'feed-direction', text: tx.direction === 'credit' ? 'Money in' : 'Money out' }));
    li.append(avatar, main, amount);
    return li;
  }

  async showMore() {
    if (this.loading || !this.nextCursor) return;
    const epoch = this.cockpit.epoch;
    const focusHolder = this.moreButton;
    this.loading = true;
    const prevText = this.moreButton.textContent;
    this.moreButton.textContent = 'Loading…';
    try {
      const res = await api('GET', this.buildQuery());
      if (epoch !== this.cockpit.epoch || epoch !== sessionEpoch) return;
      for (const tx of res.transactions) this.appendRow(tx);
      this.nextCursor = res.next_cursor;
      this.moreButton.parentElement.style.display = res.next_cursor ? '' : 'none';
      this.updateCount();
      announce(this.cockpit.statusRegion, `${this.order.length} transactions shown`);
    } catch {
      this.cockpit.showOutage();
    } finally {
      this.loading = false;
      this.moreButton.textContent = prevText;
      if (document.activeElement === document.body) focusHolder.focus();
    }
  }

  async refreshFigures() {
    const epoch = this.cockpit.epoch;
    try {
      const snap = await api('GET', '/api/snapshot');
      if (epoch !== this.cockpit.epoch || epoch !== sessionEpoch) return;
      this.renderSnapshot(snap);
    } catch (e) {
      // keep the figures shown
    }
  }

  renderSnapshot(snap) {
    const row = this.snapshotRow;
    row.textContent = '';
    const total = el('div', { class: 'snapshot-card snapshot-total' });
    total.append(el('div', { class: 'feed-direction', text: 'Total cash' }));
    total.append(el('div', { class: 'balance', text: formatDollars(snap.total_cash_cents) }));
    total.append(el('div', { class: 'available-line', text: `Available ${formatDollars(snap.total_available_cents)}` }));
    row.append(total);
    for (const p of snap.per_account) {
      const account = this.cockpit.accounts.find(a => a.id === p.account_id);
      const card = el('div', { class: 'snapshot-card' });
      card.append(el('div', { class: 'feed-direction', text: account ? account.name : 'Account' }));
      card.append(el('div', { class: 'balance', text: formatDollars(p.balance_cents) }));
      card.append(el('div', { class: 'available-line', text: `Available ${formatDollars(p.available_cents)}` }));
      card.append(sparkline(p.sparkline));
      row.append(card);
    }
    const actions = el('div', { class: 'snapshot-card' });
    const send = el('a', { class: 'button button-primary', href: '/payments/new', text: 'Send payment', role: 'button' });
    this.readAloud = el('button', { class: 'button button-secondary', text: '🔊 Read balances aloud', onclick: () => this.readBalances(snap) });
    if (!('speechSynthesis' in window)) this.readAloud.disabled = true;
    actions.append(send, this.readAloud);
    row.append(actions);
  }

  readBalances(snap) {
    if (!('speechSynthesis' in window)) return;
    const accountNames = new Map(this.cockpit.accounts.map(a => [a.id, a.name]));
    const parts = [`Total cash is ${formatDollars(snap.total_cash_cents)}`];
    for (const p of snap.per_account) {
      parts.push(`${accountNames.get(p.account_id) || 'Account'} ${formatDollars(p.balance_cents)}`);
    }
    const utter = new SpeechSynthesisUtterance(parts.join('. '));
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  }
}

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function sparkline(values) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'sparkline');
  svg.setAttribute('viewBox', `0 0 300 40`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(max - min, 1);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 300},${38 - ((v - min) / span) * 34}`).join(' ');
  const poly = document.createElementNS(ns, 'polyline');
  poly.setAttribute('points', pts);
  poly.setAttribute('fill', 'none');
  poly.setAttribute('stroke', 'var(--action)');
  poly.setAttribute('stroke-width', '2');
  poly.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(poly);
  return svg;
}

new HomePage().run();
