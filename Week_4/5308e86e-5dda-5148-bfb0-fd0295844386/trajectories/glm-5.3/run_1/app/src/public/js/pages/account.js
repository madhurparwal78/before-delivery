// Account page: balance, feed for one account, filters, statement download.
import { api, announce, el, formatDollars, initials, formatShortDate, sessionEpoch } from '../app.js';
import { Cockpit } from '../cockpit.js';

const METHODS = ['ach', 'wire', 'rtp', 'check', 'card', 'transfer'];

class AccountPage {
  constructor() {
    this.rows = new Map();
    this.order = [];
    this.nextCursor = null;
    this.loading = false;
  }

  accountId() {
    const m = /^\/app\/accounts\/([^/]+)/.exec(window.location.pathname);
    return m ? decodeURIComponent(m[1]) : '';
  }

  filtersFromAddress() {
    const q = new URLSearchParams(window.location.search);
    return {
      method: q.get('method') || '',
      direction: q.get('direction') || '',
    };
  }

  addressForFilters(f) {
    const base = `/app/accounts/${this.accountId()}`;
    const q = new URLSearchParams();
    if (f.method) q.set('method', f.method);
    if (f.direction) q.set('direction', f.direction);
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  }

  async run() {
    this.cockpit = new Cockpit({ pageName: 'account' });
    const ok = await this.cockpit.boot();
    if (!ok) return;
    this.cockpit.anyDialogOpen = () => this.cockpit.drawerOpen || this.cockpit.avatarOpen;
    new (await import('../palette.js')).CommandPalette(this.cockpit);
    const id = this.accountId();
    this.account = this.cockpit.accounts.find(a => a.id === id);
    if (!this.account) {
      window.history.replaceState(null, '', '/app');
      window.location.replace('/app');
      return;
    }
    this.build();
    this.cockpit.onRefresh = async (reason) => {
      await this.refreshFigures();
      if (reason !== 'user' && reason !== 'filter') await this.refreshFeedPreserve();
    };
    this.cockpit.onTransaction = (tx) => {
      if (tx.account_id === id && this.matchesFilters(tx)) this.prependRow(tx);
    };
    this.cockpit.startPeriodicRefresh();
    await this.refreshFigures();
    await this.loadFeed(true);
  }

  build() {
    const b = this.cockpit.body;
    b.textContent = '';
    const heading = el('div', { class: 'page-heading' });
    this.title = el('h1', { text: this.account.name });
    heading.append(this.title);
    b.append(heading);

    this.card = el('div', { class: 'info-card panel-fade', style: 'margin-bottom:16px' });
    this.balanceEl = el('div', { class: 'balance' });
    this.availableEl = el('div', { class: 'available-line' });
    this.card.append(this.balanceEl, this.availableEl);
    b.append(this.card);

    this.feedCard = el('div', { class: 'feed-card panel-fade' });
    const statementBar = el('div', { class: 'statement-bar' });
    this.monthSelect = el('select', { class: 'input', 'aria-label': 'Statement month' });
    statementBar.append(this.monthSelect);
    this.downloadButton = el('button', { class: 'button button-secondary', text: 'Download statement', onclick: () => this.download() });
    statementBar.append(this.downloadButton);
    this.feedCard.append(statementBar);

    const filters = el('div', { class: 'filter-group', role: 'group', 'aria-label': 'Filter transactions' });
    this.filterMethod = el('select', { class: 'input', 'aria-label': 'Filter by method' });
    this.filterMethod.append(el('option', { value: '', text: 'All methods' }));
    for (const m of METHODS) this.filterMethod.append(el('option', { value: m, text: m.toUpperCase() }));
    this.filterDirection = el('select', { class: 'input', 'aria-label': 'Filter by direction' });
    this.filterDirection.append(el('option', { value: '', text: 'In and out' }));
    this.filterDirection.append(el('option', { value: 'in', text: 'Money in' }));
    this.filterDirection.append(el('option', { value: 'out', text: 'Money out' }));
    this.countEl = el('span', { class: 'feed-count' });
    filters.append(this.filterMethod, this.filterDirection, this.countEl);
    this.feedCard.append(filters);
    this.feedList = el('ul', { class: 'feed-list', 'aria-label': 'Transaction feed' });
    this.feedCard.append(this.feedList);
    this.moreWrap = el('div', { class: 'show-more' });
    this.moreButton = el('button', { class: 'button button-secondary', text: 'Show more transactions', onclick: () => this.showMore() });
    this.moreWrap.append(this.moreButton);
    this.feedCard.append(this.moreWrap);
    b.append(this.feedCard);

    this.filterMethod.addEventListener('change', () => this.changeFilter());
    this.filterDirection.addEventListener('change', () => this.changeFilter());
    this.applyAddressFilters();
    this.loadMonths();
    window.addEventListener('popstate', () => {
      this.applyAddressFilters();
      this.loadFeed(true, { announceCount: true });
    });
  }

  async loadMonths() {
    try {
      const me = await api('GET', '/api/me');
      const ym = me.business_date.slice(0, 7);
      const [y, m] = ym.split('-').map(Number);
      for (let i = 0; i < 12; i++) {
        let yy = y, mm = m - i;
        while (mm <= 0) { mm += 12; yy -= 1; }
        const value = `${String(yy).padStart(4, '0')}-${String(mm).padStart(2, '0')}`;
        const label = monthName(value);
        this.monthSelect.append(el('option', { value, text: label }));
      }
    } catch { /* keep a single default option */ }
  }

  applyAddressFilters() {
    const q = new URLSearchParams(window.location.search);
    if (q.get('account')) {
      q.delete('account');
      const s = q.toString();
      window.history.replaceState(null, '', s ? `${window.location.pathname}?${s}` : window.location.pathname);
    }
    let f = { method: q.get('method') || '', direction: q.get('direction') || '' };
    let changed = false;
    if (f.method && !METHODS.includes(f.method)) { f.method = ''; changed = true; }
    if (f.direction && f.direction !== 'in' && f.direction !== 'out') { f.direction = ''; changed = true; }
    if (changed) window.history.replaceState(null, '', this.addressForFilters(f));
    this.currentFilters = f;
    this.filterMethod.value = f.method;
    this.filterDirection.value = f.direction;
  }

  changeFilter() {
    const f = { method: this.filterMethod.value, direction: this.filterDirection.value };
    this.currentFilters = f;
    window.history.pushState(null, '', this.addressForFilters(f));
    this.loadFeed(true, { announceCount: true });
  }

  matchesFilters(tx) {
    const f = this.currentFilters;
    if (f.method && tx.method !== f.method) return false;
    if (f.direction === 'in' && tx.direction !== 'credit') return false;
    if (f.direction === 'out' && tx.direction !== 'debit') return false;
    return true;
  }

  buildQuery() {
    const f = this.currentFilters;
    const q = new URLSearchParams();
    q.set('account_id', this.account.id);
    if (f.method) q.set('method', f.method);
    if (f.direction) q.set('direction', f.direction === 'in' ? 'credit' : 'debit');
    if (this.nextCursor) q.set('cursor', this.nextCursor);
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
      if (reset) for (const tx of res.transactions) this.appendRow(tx);
      this.nextCursor = res.next_cursor;
      this.moreButton.parentElement.style.display = res.next_cursor ? '' : 'none';
      if (this.order.length === 0) {
        this.feedList.textContent = '';
        this.feedList.append(el('li', { class: 'feed-empty', text: 'No transactions yet.' }));
      }
      this.updateCount();
      if (announceCount) announce(this.cockpit.statusRegion, `${this.order.length} transactions shown`);
    } catch {
      this.cockpit.showOutage();
    } finally {
      this.loading = false;
    }
  }

  async refreshFeedPreserve() {
    const epoch = this.cockpit.epoch;
    try {
      const savedCursor = this.nextCursor;
      this.nextCursor = null;
      const res = await api('GET', this.buildQuery());
      this.nextCursor = savedCursor;
      if (epoch !== this.cockpit.epoch || epoch !== sessionEpoch) return;
      const known = new Set(this.order);
      if (this.order.length === 0) this.feedList.textContent = '';
      for (const tx of res.transactions.filter(t => !known.has(t.id))) this.prependRow(tx);
      this.updateCount();
    } catch { /* keep shown rows */ }
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
    li.append(el('span', { class: 'feed-avatar', 'aria-hidden': 'true', text: initials(tx.counterparty) }));
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
    li.append(main, amount);
    return li;
  }

  async showMore() {
    if (this.loading || !this.nextCursor) return;
    this.loading = true;
    const prev = this.moreButton.textContent;
    this.moreButton.textContent = 'Loading…';
    try {
      const res = await api('GET', this.buildQuery());
      for (const tx of res.transactions) this.appendRow(tx);
      this.nextCursor = res.next_cursor;
      this.moreButton.parentElement.style.display = res.next_cursor ? '' : 'none';
      this.updateCount();
      announce(this.cockpit.statusRegion, `${this.order.length} transactions shown`);
    } catch {
      this.cockpit.showOutage();
    } finally {
      this.loading = false;
      this.moreButton.textContent = prev;
    }
  }

  async refreshFigures() {
    const epoch = this.cockpit.epoch;
    try {
      const res = await api('GET', `/api/accounts/${this.account.id}`);
      if (epoch !== this.cockpit.epoch || epoch !== sessionEpoch) return;
      this.balanceEl.textContent = formatDollars(res.account.balance_cents);
      this.availableEl.textContent = `Available ${formatDollars(res.account.available_cents)}`;
    } catch { /* keep figures */ }
  }

  async download() {
    const month = this.monthSelect.value;
    announce(this.cockpit.statusRegion, 'Preparing statement…');
    try {
      const res = await fetch(`/api/accounts/${this.account.id}/statement.csv?month=${encodeURIComponent(month)}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('tallwind_token')}` },
      });
      if (!res.ok) throw new Error('download');
      const disposition = res.headers.get('content-disposition') || '';
      let filename = `${this.account.name}-statement-${month}.csv`;
      const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
      if (star) {
        try { filename = decodeURIComponent(star[1]); } catch { /* keep fallback */ }
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: filename });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      announce(this.cockpit.statusRegion, 'Statement downloaded');
    } catch {
      announce(this.cockpit.statusRegion, "Tallwind can't be reached right now. Try again in a moment.");
    }
  }
}

function monthName(ym) {
  const [y, m] = ym.split('-').map(Number);
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${names[m - 1]} ${y}`;
}

new AccountPage().run();
