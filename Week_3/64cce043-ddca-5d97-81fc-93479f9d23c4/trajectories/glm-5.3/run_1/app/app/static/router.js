/* Strongroom Ledger routing and screen bootstrap. */

(() => {
  'use strict';
  const { S, api, el, $, announce, showAlert, setScoreNumber, showPreviewTag,
    renderExposure, startStream, stopStream, checkStatus, scheduleStatusChecks,
    storeDraft, loadDraft, discardDraft, REDUCED } = window.Strongroom;

  const boot = document.getElementById('app-root');

  async function fetchKinds() {
    const { data } = await api('/api/kinds');
    if (data) {
      S.kinds = data.kinds;
      S.levels = data.levels;
      for (const k of data.kinds) {
        window.Screens.KIND_LABEL[k.code] = k.label;
        window.Screens.KINDS_ORDER.push(k.code);
      }
    }
  }

  async function fetchMe() {
    const { status, data } = await api('/api/me');
    if (status === 200) {
      S.me = data;
      S.role = data.role;
      return data;
    }
    return null;
  }

  function navHighlight(route) {
    const nav = document.getElementById('main-nav');
    if (!nav) return;
    for (const a of nav.querySelectorAll('a')) {
      const key = a.getAttribute('data-nav');
      const current =
        (key === 'ledger' && (route === '/vault' || route.startsWith('/vault/holdings'))) ||
        (key === 'breaches' && (route.startsWith('/vault/breaches'))) ||
        (key === 'rules' && route.startsWith('/vault/rules')) ||
        (key === 'contact' && route.startsWith('/vault/contact')) ||
        (key === 'account' && route.startsWith('/vault/account'));
      if (current) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  }

  // Phone menu
  function setupMenu() {
    const toggle = document.getElementById('menu-toggle');
    const nav = document.getElementById('main-nav');
    if (!toggle || !nav) return;
    toggle.addEventListener('click', () => {
      const open = nav.getAttribute('data-open') === 'true';
      nav.setAttribute('data-open', String(!open));
      toggle.setAttribute('aria-expanded', String(!open));
    });
    toggle.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && nav.getAttribute('data-open') === 'true') {
        nav.setAttribute('data-open', 'false');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.focus();
      }
    });
    for (const a of nav.querySelectorAll('a')) {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        nav.setAttribute('data-open', 'false');
        toggle.setAttribute('aria-expanded', 'false');
        history.pushState({}, '', a.getAttribute('href'));
        renderRoute();
      });
    }
  }

  document.getElementById('signout').addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' });
    discardDraft();
    stopStream();
    location.href = '/';
  });

  window.addEventListener('popstate', () => renderRoute(true));

  async function renderRoute(fromPop = false) {
    const route = location.pathname;
    S.route = route;
    navHighlight(route);
    const screen = document.getElementById('screen');
    screen.innerHTML = '';

    const me = await fetchMe();
    if (!me) {
      // Signed out: vault and shared screens send the caller to sign in.
      if (route === '/vault' || route.startsWith('/vault/') || route === '/shared') {
        const target = encodeURIComponent(route + location.search);
        location.replace(`/?next=${target}`);
        return;
      }
      location.replace('/');
      return;
    }

    if (S.role === 'contact' && (route === '/vault' || route.startsWith('/vault/'))) {
      history.replaceState({}, '', '/shared');
      return renderRoute(true);
    }
    if (S.role === 'owner' && route === '/shared') {
      history.replaceState({}, '', '/vault');
      return renderRoute(true);
    }

    const Sc = window.Screens;
    if (route === '/vault' || route === '/shared') {
      await Sc.renderLedgerScreen(screen);
    } else if (route.startsWith('/vault/holdings/')) {
      const id = route.split('/').pop();
      await Sc.renderHoldingDetail(screen, id);
    } else if (route === '/vault/breaches') {
      await Sc.renderBreachesScreen(screen);
    } else if (route.startsWith('/vault/breaches/')) {
      const id = route.split('/').pop();
      await Sc.renderBreachDetail(screen, id);
    } else if (route === '/vault/rules') {
      await Sc.renderRulesScreen(screen);
    } else if (route === '/vault/contact') {
      await Sc.renderContactScreen(screen);
    } else if (route === '/vault/account') {
      await Sc.renderAccountScreen(screen);
    } else {
      renderNotFound(screen);
    }
  }

  function renderNotFound(screen) {
    const wrap = el('div', { class: 'empty-state' });
    wrap.appendChild(el('h1', { class: 'screen-title', text: 'Not found' }));
    wrap.appendChild(el('p', { text: 'This record does not exist or is not in your view.' }));
    const back = el('a', { href: '/vault', text: 'Back to ledger' });
    back.addEventListener('click', (e) => {
      e.preventDefault();
      history.pushState({}, '', '/vault');
      renderRoute();
    });
    wrap.appendChild(back);
    screen.replaceChildren(wrap);
  }

  async function init() {
    setupMenu();
    scheduleStatusChecks();
    await fetchKinds();
    await renderRoute();
  }

  init();
})();
