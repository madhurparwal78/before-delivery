// The cockpit shell: the accounts rail, the top bar, the drawer, the command
// palette and the one status region. Width rules are judged on the window's
// inner width in CSS pixels.

import { el, clear, icon, mark, trapTab } from '../dom.js';
import * as api from '../api.js';
import * as session from '../session.js';
import * as router from '../router.js';
import { announce } from '../status.js';
import { money, initials } from '../format.js';
import * as data from './data.js';
import { openPalette } from './palette.js';
import { dialogIsOpen } from './dialog.js';
import { createSearcher } from './search.js';

export const RAIL_INLINE_WIDTH = 1024;
export const TWO_COLUMN_WIDTH = 600;

export function layout() {
  const width = window.innerWidth;
  return {
    width,
    railInline: width >= RAIL_INLINE_WIDTH,
    cards: width < TWO_COLUMN_WIDTH ? 'one' : width < RAIL_INLINE_WIDTH ? 'two' : 'all',
    stackRows: width < TWO_COLUMN_WIDTH,
  };
}

const PAGE_LINKS = [
  ['Payments', '/payments'],
  ['Recipients', '/payments/recipients'],
  ['Approvals', '/approvals'],
  ['Invoicing', '/invoices'],
  ['Loans', '/loans'],
  ['Cards', '/cards'],
  ['Treasury', '/treasury-account'],
  ['Bill Pay', '/bill-pay'],
];

let shell = null;

export function ensureShell() {
  if (shell) return shell;
  return buildShell();
}

function approvalsName() {
  const waiting = data.state.approvalsWaiting;
  return waiting > 0 ? `Approvals, ${waiting} waiting` : 'Approvals';
}

function buildShell() {
  const root = document.getElementById('chrome');
  clear(root);

  let activePage = null;
  let activeAccountId = null;
  let drawer = null;
  let drawerScrim = null;
  let avatarMenu = null;
  let searchPanel = null;

  const slot = el('div', { class: 'cockpit-page', id: 'main-content' });
  const statusRegion = el('div', {
    class: 'status-region',
    role: 'status',
    'aria-live': 'polite',
    'data-status-region': 'true',
  });

  // ---- the rail ----
  function buildRail(idPrefix) {
    const accountList = el('ul', { class: 'rail-group' });
    const pageList = el('ul', { class: 'rail-group' });
    const nav = el('nav', { class: 'rail-nav', 'aria-label': 'Cockpit' }, [
      el('p', { class: 'rail-heading', text: 'Accounts' }),
      accountList,
      el('p', { class: 'rail-heading', text: 'Company' }),
      pageList,
    ]);
    const parts = { nav, accountList, pageList, accountLinks: new Map(), pageLinks: new Map() };

    for (const [label, href] of PAGE_LINKS) {
      const link = el('a', { class: 'rail-link', href, id: `${idPrefix}-page-${href.replace(/\W/g, '')}` }, [
        el('span', { text: label }),
      ]);
      parts.pageLinks.set(href, link);
      pageList.append(el('li', {}, [link]));
    }
    paintRail(parts);
    return parts;
  }

  function paintRail(parts) {
    const accounts = data.state.accounts;
    const existing = [...parts.accountLinks.keys()].join(',');
    const wanted = accounts.map((account) => account.id).join(',');
    if (existing !== wanted) {
      clear(parts.accountList);
      parts.accountLinks.clear();
      for (const account of accounts) {
        const balance = el('span', { class: 'rail-balance mono' });
        const link = el('a', { class: 'rail-link', href: `/app/accounts/${account.id}` }, [
          el('span', { text: account.name }),
          balance,
        ]);
        parts.accountLinks.set(account.id, { link, balance });
        parts.accountList.append(el('li', {}, [link]));
      }
    }
    for (const account of accounts) {
      const entry = parts.accountLinks.get(account.id);
      if (!entry) continue;
      const figures = data.perAccount(account.id);
      entry.balance.textContent = money(figures ? figures.balance_cents : account.balance_cents);
      const current =
        activeAccountId === account.id ||
        (activePage === 'home' && accounts[0] && accounts[0].id === account.id);
      if (current) entry.link.setAttribute('aria-current', 'page');
      else entry.link.removeAttribute('aria-current');
    }
    const approvals = parts.pageLinks.get('/approvals');
    if (approvals) approvals.firstChild.textContent = approvalsName();
    for (const [href, link] of parts.pageLinks) {
      if (window.location.pathname === href) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  }

  const inlineRail = buildRail('rail');
  const railAside = el('aside', { class: 'rail' }, [
    el('a', { class: 'brand', href: '/app', 'aria-label': 'Tallwind home' }, [
      mark(24),
      el('span', { text: 'Tallwind' }),
    ]),
    inlineRail.nav,
  ]);

  // ---- the drawer ----
  const accountsMenuButton = el(
    'button',
    { type: 'button', class: 'icon-btn', 'aria-expanded': 'false', 'aria-label': 'Accounts menu' },
    [icon('menu', { size: 20 })]
  );

  function closeDrawer({ focusButton = false } = {}) {
    if (!drawer) return;
    drawer.remove();
    if (drawerScrim) drawerScrim.remove();
    drawer = null;
    drawerScrim = null;
    accountsMenuButton.setAttribute('aria-expanded', 'false');
    if (focusButton) accountsMenuButton.focus();
  }

  function openDrawer() {
    if (drawer) {
      closeDrawer();
      return;
    }
    const parts = buildRail('drawer');
    drawerScrim = el('div', { class: 'rail-scrim' });
    drawerScrim.addEventListener('click', () => closeDrawer());
    drawer = el('div', { class: 'rail rail-drawer', role: 'dialog', 'aria-label': 'Accounts menu' }, [
      el('a', { class: 'brand', href: '/app', 'aria-label': 'Tallwind home' }, [mark(24), el('span', { text: 'Tallwind' })]),
      parts.nav,
      el('a', { class: 'rail-link', href: '/payments/new', text: 'Send payment' }),
    ]);
    drawer.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDrawer({ focusButton: true });
        return;
      }
      trapTab(drawer, event);
    });
    drawer.addEventListener('click', (event) => {
      if (event.target.closest('a')) closeDrawer();
    });
    document.body.append(drawerScrim, drawer);
    accountsMenuButton.setAttribute('aria-expanded', 'true');
    const current = drawer.querySelector('[aria-current="page"]') || drawer.querySelector('a');
    if (current) current.focus();
  }

  accountsMenuButton.addEventListener('click', openDrawer);

  // ---- the top bar ----
  const searchInput = el('input', {
    type: 'search',
    id: 'cockpit-search',
    autocomplete: 'off',
    placeholder: 'Search transactions, recipients, or jump to a payment',
    'aria-label': 'Search transactions, recipients, or jump to a payment',
  });

  function closeSearchResults() {
    if (!searchPanel) return;
    searchPanel.remove();
    searchPanel = null;
  }

  function paintSearchResults(result) {
    closeSearchResults();
    if (!result) return;
    const items = [];
    for (const recipient of result.recipients) {
      items.push(
        el('a', { href: `/payments/new?recipient=${recipient.id}`, text: recipient.display_name })
      );
    }
    for (const transaction of result.transactions) {
      items.push(
        el('a', {
          href: `/app?account=${transaction.account_id}`,
          text: `${transaction.counterparty} ${money(transaction.amount_cents)}`,
        })
      );
    }
    searchPanel = el('div', { class: 'search-results', role: 'region', 'aria-label': 'Search results' }, items.length ? items : [el('p', { class: 'hint', style: 'margin:0.5rem', text: 'No matches' })]);
    searchShell.append(searchPanel);
  }

  const searcher = createSearcher(({ result, pending }) => {
    if (pending) return;
    if (result) paintSearchResults(result);
    else closeSearchResults();
  });

  searchInput.addEventListener('input', () => searcher.run(searchInput.value));
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      searchInput.value = '';
      searcher.run('');
      closeSearchResults();
      searchInput.focus();
    }
  });

  const searchShell = el('div', { class: 'search-shell' }, [
    el('label', { class: 'visually-hidden', for: 'cockpit-search', text: 'Search transactions, recipients, or jump to a payment' }),
    searchInput,
  ]);

  // The initials are decorative, drawn by CSS, so the button's whole name is
  // "Account menu".
  const avatarButton = el('button', {
    type: 'button',
    class: 'avatar',
    'aria-expanded': 'false',
    'aria-label': 'Account menu',
  });
  const avatarInitials = {
    set textContent(value) {
      avatarButton.style.setProperty('--initials', `"${value}"`);
    },
  };

  function closeAvatarMenu({ focusButton = false } = {}) {
    if (!avatarMenu) return;
    avatarMenu.remove();
    avatarMenu = null;
    avatarButton.setAttribute('aria-expanded', 'false');
    if (focusButton) avatarButton.focus();
  }

  async function logOut() {
    // From this moment the page sends nothing else with the old token.
    data.stop();
    closeAvatarMenu();
    await api.post('/api/auth/logout');
    session.clear();
    teardown();
    router.navigate('/', { replace: false });
  }

  function openAvatarMenu() {
    if (avatarMenu) {
      closeAvatarMenu();
      return;
    }
    const profile = el('button', { type: 'button', text: 'Profile' });
    profile.addEventListener('click', () => {
      const user = session.user();
      closeAvatarMenu({ focusButton: true });
      announce(user ? `Signed in as ${user.name}, ${user.email}` : 'Signed in');
    });
    const logout = el('button', { type: 'button', text: 'Log out' });
    logout.addEventListener('click', () => logOut());
    avatarMenu = el('ul', { class: 'avatar-menu', 'aria-label': 'Account menu' }, [
      el('li', {}, [profile]),
      el('li', {}, [logout]),
    ]);
    avatarMenu.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeAvatarMenu({ focusButton: true });
        return;
      }
      trapTab(avatarMenu, event);
    });
    topbar.append(avatarMenu);
    avatarButton.setAttribute('aria-expanded', 'true');
    profile.focus();
  }

  avatarButton.addEventListener('click', openAvatarMenu);

  const topbar = el('header', { class: 'topbar' }, [searchShell, avatarButton]);

  const main = el('div', { class: 'cockpit-main' }, [topbar, statusRegion, slot]);
  const frame = el('div', { class: 'cockpit' }, [railAside, main]);
  root.append(frame);

  // ---- width rules ----
  function applyLayout() {
    const current = layout();
    if (current.railInline) {
      if (!railAside.isConnected) frame.prepend(railAside);
      frame.classList.remove('narrow');
      if (accountsMenuButton.isConnected) accountsMenuButton.remove();
      if (drawer) {
        const hadFocus = drawer.contains(document.activeElement);
        closeDrawer();
        if (hadFocus) {
          const current2 = inlineRail.nav.querySelector('[aria-current="page"]');
          if (current2) current2.focus();
        }
      }
    } else {
      if (railAside.isConnected) railAside.remove();
      frame.classList.add('narrow');
      if (!accountsMenuButton.isConnected) topbar.prepend(accountsMenuButton);
    }
    for (const listener of layoutListeners) listener(current);
  }

  const layoutListeners = new Set();
  const onResize = () => applyLayout();
  window.addEventListener('resize', onResize);

  // ---- keyboard: the command palette from anywhere ----
  const onKeydown = (event) => {
    if ((event.ctrlKey || event.metaKey) && (event.key === 'k' || event.key === 'K')) {
      if (dialogIsOpen()) return;
      event.preventDefault();
      openPalette();
    }
  };
  document.addEventListener('keydown', onKeydown);

  const onDocumentClick = (event) => {
    if (avatarMenu && !avatarMenu.contains(event.target) && !avatarButton.contains(event.target)) {
      closeAvatarMenu();
    }
    if (searchPanel && !searchShell.contains(event.target)) closeSearchResults();
  };
  document.addEventListener('click', onDocumentClick);

  function teardown() {
    window.removeEventListener('resize', onResize);
    document.removeEventListener('keydown', onKeydown);
    document.removeEventListener('click', onDocumentClick);
    closeDrawer();
    closeAvatarMenu();
    closeSearchResults();
    data.stop();
    shell = null;
  }

  const unsubscribe = data.subscribe((event) => {
    if (event.type === 'money' || event.type === 'approvals') {
      paintRail(inlineRail);
      const user = session.user();
      if (user) avatarInitials.textContent = initials(user.name);
    }
  });

  data.start();
  const user = session.user();
  if (user) avatarInitials.textContent = initials(user.name);

  shell = {
    slot,
    teardown: () => {
      unsubscribe();
      teardown();
    },
    layout,
    onLayout(listener) {
      layoutListeners.add(listener);
      return () => layoutListeners.delete(listener);
    },
    mount(node, pageName, params) {
      activePage = pageName;
      activeAccountId = params && params.accountId ? params.accountId : null;
      clear(slot);
      slot.append(node);
      paintRail(inlineRail);
      applyLayout();
      const current = session.user();
      if (current) avatarInitials.textContent = initials(current.name);
      window.scrollTo(0, 0);
    },
  };
  applyLayout();
  return shell;
}
