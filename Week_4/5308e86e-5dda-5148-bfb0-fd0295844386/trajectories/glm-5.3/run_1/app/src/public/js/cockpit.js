// The cockpit shell: rail, drawer, top bar, search, avatar menu, command
// palette, stream and refreshes. One instance per page.
import {
  api, ApiError, getToken, setToken, setLastAccount, getLastAccount,
  announce, el, formatDollars, initials, sessionEpoch, bumpSessionEpoch,
} from './app.js';

export const APPROVALS_PATHS = ['/approvals', '/app', '/payments', '/payments/new', '/payments/recipients', '/payments/recipients/new', '/invoices', '/loans', '/cards', '/treasury-account', '/bill-pay'];

export class Cockpit {
  constructor({ pageName }) {
    this.pageName = pageName;
    this.accounts = [];
    this.user = null;
    this.waitingCount = 0;
    this.stream = null;
    this.timers = [];
    this.epoch = 0;
    this.outageShown = false;
    this.dueRefresh = null;
  }

  async boot() {
    const body = document.body;
    body.textContent = '';
    const epoch = ++sessionEpoch;
    this.epoch = epoch;
    document.title = 'Tallwind';
    const shell = el('div', { class: 'cockpit' });
    this.rail = el('nav', { class: 'cockpit-rail', 'aria-label': 'Accounts' });
    this.main = el('div', { class: 'cockpit-main' });
    this.topbar = this.buildTopbar();
    this.main.append(this.topbar);
    this.body = el('div', { class: 'cockpit-body' });
    this.main.append(this.body);
    shell.append(this.rail, this.main);
    body.append(shell);
    this.statusRegion = el('div', { class: 'status-region', role: 'status', 'aria-live': 'polite' });
    body.append(this.statusRegion);

    try {
      await this.loadMe();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        this.sendToLogin();
        return false;
      }
      throw e;
    }
    if (epoch !== sessionEpoch) return false;
    await this.loadAccounts();
    this.renderRail();
    this.startStream();
    this.startRailRefresh();
    return true;
  }

  sendToLogin() {
    setToken('');
    setLastAccount('');
    const target = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace(`/login?next=${target}`);
  }

  async loadMe() {
    const me = await api('GET', '/api/me');
    this.user = me.user;
    this.me = me;
    document.title = `Tallwind — ${this.user.name}`;
  }

  async loadAccounts() {
    const res = await api('GET', '/api/accounts');
    this.accounts = res.accounts;
  }

  activeAccountId() {
    const path = window.location.pathname;
    const m = /^\/app\/accounts\/([^/]+)/.exec(path);
    if (m) {
      const found = this.accounts.find(a => a.id === m[1]);
      if (found) return found.id;
    }
    return this.accounts.length > 0 ? this.accounts[0].id : '';
  }

  buildTopbar() {
    const bar = el('div', { class: 'cockpit-topbar' });
    this.accountsMenuButton = el('button', {
      class: 'button button-secondary accounts-menu-button',
      'aria-expanded': 'false',
      'aria-controls': 'accounts-drawer',
      text: '☰ Accounts menu',
      onclick: () => this.openDrawer(),
    });
    const searchWrap = el('div', { class: 'topbar-search' });
    this.searchInput = el('input', {
      class: 'input',
      type: 'search',
      placeholder: 'Search transactions, recipients, or jump to a payment',
      'aria-label': 'Search transactions, recipients, or jump to a payment',
      autocomplete: 'off',
      role: 'searchbox',
    });
    this.searchResults = el('div', {
      class: 'search-results',
      role: 'region',
      'aria-label': 'Search results',
      id: 'search-results',
      hidden: true,
    });
    searchWrap.append(this.searchInput, this.searchResults);
    this.searchInput.addEventListener('input', () => this.queueSearch());
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.searchInput.value = '';
        this.closeSearchResults();
        e.stopPropagation();
      }
    });
    const right = el('div', { class: 'topbar-right' });
    this.avatarButton = el('button', {
      class: 'avatar-button',
      'aria-expanded': 'false',
      'aria-controls': 'avatar-menu',
      'aria-label': 'Account menu',
    });
    this.avatarMenu = el('div', {
      class: 'avatar-menu',
      id: 'avatar-menu',
      role: 'menu',
      hidden: true,
    });
    right.append(this.avatarButton, this.avatarMenu);
    this.avatarButton.addEventListener('click', () => this.toggleAvatarMenu());
    bar.append(this.accountsMenuButton, searchWrap, right);
    return bar;
  }

  renderRail(container = this.rail) {
    container.textContent = '';
    const mark = el('a', { class: 'rail-mark', href: '/app', 'aria-label': 'Tallwind home' });
    mark.innerHTML = `<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><path d="M6 19c0-7 5-12 12-12" fill="none" stroke="#1e5bf0" stroke-width="2.4" stroke-linecap="round"/><path d="M10 20c0-7 4-10 10-10" fill="none" stroke="#101319" stroke-width="2.4" stroke-linecap="round"/></svg><span>TALLWIND</span>`;
    container.append(mark);
    const activeId = this.activeAccountId();
    const section = el('div', {});
    section.append(el('div', { class: 'rail-section-label', text: 'Accounts' }));
    for (const account of this.accounts) {
      const link = el('a', {
        class: 'rail-link',
        href: `/app/accounts/${account.id}`,
      });
      const name = el('span', { text: account.name });
      const bal = el('span', { class: 'mono', text: formatDollars(account.balance_cents) });
      link.append(name, bal);
      if (account.id === activeId) link.setAttribute('aria-current', 'page');
      section.append(link);
    }
    container.append(section);
    const pages = el('div', {});
    pages.append(el('div', { class: 'rail-section-label', text: 'Pages' }));
    this.approvalsLink = el('a', { class: 'rail-link', href: '/approvals' });
    this.updateApprovalsLink();
    const links = [
      ['Payments', '/payments'],
      null,
      ['Recipients', '/payments/recipients'],
      ['Invoicing', '/invoices'],
      ['Loans', '/loans'],
      ['Cards', '/cards'],
      ['Treasury', '/treasury-account'],
      ['Bill Pay', '/bill-pay'],
    ];
    for (const item of links) {
      if (item === null) {
        pages.append(this.approvalsLink);
      } else {
        pages.append(el('a', { class: 'rail-link', href: item[1], text: item[0] }));
      }
    }
    container.append(pages);
  }

  updateApprovalsLink() {
    if (!this.approvalsLink) return;
    this.approvalsLink.textContent = '';
    this.approvalsLink.setAttribute('aria-label', this.waitingCount > 0 ? `Approvals, ${this.waitingCount} waiting` : 'Approvals');
    this.approvalsLink.append(el('span', { text: this.waitingCount > 0 ? `Approvals, ${this.waitingCount} waiting` : 'Approvals' }));
  }

  async refreshApprovalsCount() {
    const epoch = this.epoch;
    try {
      const res = await api('GET', '/api/approvals');
      if (epoch !== this.epoch || epoch !== sessionEpoch) return;
      this.waitingCount = res.approvals.length;
      this.updateApprovalsLink();
      if (typeof this.onApprovalsRefresh === 'function') this.onApprovalsRefresh(res);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) this.sendToLogin();
    }
  }

  startRailRefresh() {
    const t = setInterval(() => this.refreshApprovalsCount(), 5000);
    this.timers.push(t);
    this.refreshApprovalsCount();
  }

  // ---------- stream ----------

  startStream() {
    this.openStream();
  }

  openStream() {
    const epoch = this.epoch;
    const token = getToken();
    if (!token) return;
    const url = `/api/stream?token=${encodeURIComponent(token)}${this.lastEventId ? `&last_event_id=${encodeURIComponent(this.lastEventId)}` : ''}`;
    try { this.stream?.close(); } catch { /* already closed */ }
    const es = new EventSource(url);
    this.stream = es;
    es.addEventListener('transaction', (ev) => {
      if (epoch !== this.epoch || epoch !== sessionEpoch) return;
      const data = JSON.parse(ev.data);
      this.lastEventId = data.id;
      if (typeof this.onTransaction === 'function') this.onTransaction(data);
      this.scheduleRefresh('stream');
    });
    es.onerror = () => {
      if (epoch !== this.epoch || epoch !== sessionEpoch) return;
      es.close();
      const retry = setTimeout(() => {
        if (epoch !== this.epoch || epoch !== sessionEpoch) return;
        this.probeStreamAuth();
      }, 2000);
      this.timers.push(retry);
    };
  }

  async probeStreamAuth() {
    const epoch = this.epoch;
    try {
      await api('GET', '/api/me');
      if (epoch !== this.epoch || epoch !== sessionEpoch) return;
      this.openStream();
      this.recovered();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        this.sendToLogin();
      }
    }
  }

  recovered() {
    if (this.outageShown) {
      this.outageShown = false;
      announce(this.statusRegion, 'Tallwind is back online.');
    }
    this.scheduleRefresh('recovery');
  }

  // ---------- refreshes ----------

  scheduleRefresh(reason) {
    if (this.dueRefresh) return;
    this.dueRefresh = setTimeout(() => {
      this.dueRefresh = null;
      this.refreshAll(reason).catch(() => {});
    }, reason === 'stream' ? 400 : 100);
    this.timers.push(this.dueRefresh);
  }

  async refreshAll(reason) {
    const epoch = this.epoch;
    try {
      const [accounts, approvals] = await Promise.all([
        api('GET', '/api/accounts'),
        api('GET', '/api/approvals'),
      ]);
      if (epoch !== this.epoch || epoch !== sessionEpoch) return false;
      this.accounts = accounts.accounts;
      this.waitingCount = approvals.approvals.length;
      this.updateApprovalsLink();
      this.renderRail();
      if (this.drawerOpen) this.renderRail(this.drawerPanel);
      this.outageShown = false;
      if (typeof this.onRefresh === 'function') {
        await this.onRefresh(reason);
      }
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        this.sendToLogin();
        return false;
      }
      if (e instanceof ApiError && e.status === 503) {
        this.showOutage();
        return false;
      }
      this.showOutage();
      return false;
    }
  }

  showOutage() {
    if (this.outageShown) return;
    this.outageShown = true;
    announce(this.statusRegion, "Tallwind can't be reached right now. Try again in a moment.");
  }

  startPeriodicRefresh() {
    const t = setInterval(() => this.scheduleRefresh('periodic'), 10000);
    this.timers.push(t);
  }

  destroy() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    try { this.stream?.close(); } catch { /* gone */ }
    this.stream = null;
  }

  // ---------- drawer ----------

  openDrawer() {
    if (this.drawerOpen) return;
    this.drawerOpen = true;
    this.accountsMenuButton.setAttribute('aria-expanded', 'true');
    const wrap = el('div', { class: 'drawer', id: 'accounts-drawer' });
    const backdrop = el('div', { class: 'drawer-backdrop' });
    this.drawerPanel = el('div', { class: 'drawer-panel', role: 'dialog', 'aria-label': 'Accounts menu' });
    this.renderRail(this.drawerPanel);
    const close = () => this.closeDrawer();
    backdrop.addEventListener('click', close);
    wrap.append(backdrop, this.drawerPanel);
    document.body.append(wrap);
    this.drawerWrap = wrap;
    const active = this.drawerPanel.querySelector('[aria-current="page"]') || this.drawerPanel.querySelector('.rail-link');
    if (active) active.focus();
    this.trapDrawer = trapFocus(this.drawerPanel, () => this.closeDrawer(), () => this.accountsMenuButton);
  }

  closeDrawer() {
    if (!this.drawerOpen) return;
    this.drawerOpen = false;
    this.accountsMenuButton.setAttribute('aria-expanded', 'false');
    if (this.trapDrawer) this.trapDrawer.off();
    this.drawerWrap?.remove();
    this.drawerWrap = null;
  }

  // ---------- avatar menu ----------

  toggleAvatarMenu() {
    if (this.avatarOpen) {
      this.closeAvatarMenu();
    } else {
      this.openAvatarMenu();
    }
  }

  openAvatarMenu() {
    this.avatarOpen = true;
    this.avatarButton.setAttribute('aria-expanded', 'true');
    this.avatarButton.textContent = initials(this.user.name);
    this.avatarMenu.textContent = '';
    const profile = el('a', { href: '/app', role: 'menuitem', text: 'Profile' });
    const logout = el('button', { role: 'menuitem', text: 'Log out', onclick: () => this.logout() });
    this.avatarMenu.append(profile, logout);
    this.avatarMenu.hidden = false;
    this.trapAvatar = trapFocus(this.avatarMenu, () => this.closeAvatarMenu(), () => this.avatarButton);
    profile.focus();
  }

  closeAvatarMenu() {
    if (!this.avatarOpen) return;
    this.avatarOpen = false;
    this.avatarButton.setAttribute('aria-expanded', 'false');
    this.avatarMenu.hidden = true;
    this.avatarMenu.textContent = '';
    if (this.trapAvatar) this.trapAvatar.off();
    this.avatarButton.focus();
  }

  async logout() {
    const epoch = this.epoch;
    try {
      await api('POST', '/api/auth/logout');
    } catch { /* token may already be gone */ }
    if (epoch !== sessionEpoch) return;
    this.destroy();
    setToken('');
    setLastAccount('');
    bumpSessionEpoch();
    window.location.replace('/');
  }

  // ---------- universal search ----------

  queueSearch() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    const text = this.searchInput.value;
    if (text.trim().length < 2) {
      this.closeSearchResults();
      return;
    }
    this.searchTimer = setTimeout(() => this.runSearch(text), 250);
  }

  async runSearch(text) {
    const epoch = this.epoch;
    const seq = ++this.searchSeq;
    try {
      const res = await api('GET', `/api/search?q=${encodeURIComponent(text)}`);
      if (epoch !== this.epoch || seq !== this.searchSeq) return;
      this.renderSearchResults(res, text);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) this.sendToLogin();
    }
  }

  renderSearchResults(res, text) {
    if (this.searchInput.value.trim() !== text.trim()) return;
    this.searchResults.textContent = '';
    if (res.recipients.length === 0 && res.transactions.length === 0) {
      this.searchResults.hidden = false;
      this.searchResults.append(el('div', { class: 'group-label', text: 'No matches' }));
      return;
    }
    if (res.recipients.length > 0) {
      this.searchResults.append(el('div', { class: 'group-label', text: 'Recipients' }));
      for (const r of res.recipients) {
        const link = el('a', { href: `/payments/new?recipient=${r.id}`, text: r.display_name });
        this.searchResults.append(link);
      }
    }
    if (res.transactions.length > 0) {
      this.searchResults.append(el('div', { class: 'group-label', text: 'Transactions' }));
      for (const t of res.transactions) {
        const opt = el('button', {
          text: `${t.counterparty} · ${formatDollars(t.amount_cents * (t.direction === 'debit' ? -1 : 1))}`,
          onclick: () => {
            this.searchInput.value = '';
            this.closeSearchResults();
            window.location.href = `/app?account=${t.account_id}`;
          },
        });
        this.searchResults.append(opt);
      }
    }
    this.searchResults.hidden = false;
  }

  closeSearchResults() {
    this.searchResults.hidden = true;
    this.searchResults.textContent = '';
  }
}

// Traps Tab inside a panel, closes on Escape, and returns focus to the opener.
export function trapFocus(panel, closeFn, opener) {
  const handler = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeFn();
      if (opener && opener.isConnected) opener.focus();
      return;
    }
    if (e.key === 'Tab') {
      const focusables = Array.from(panel.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(n => n.offsetParent !== null || panel.contains(n));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!panel.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  panel.addEventListener('keydown', handler);
  return { off: () => panel.removeEventListener('keydown', handler) };
}

// Signs out of a shared tab: nothing from the old session acts afterwards.
export function guardPage(pit) {
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) window.location.replace(window.location.pathname);
  });
}
