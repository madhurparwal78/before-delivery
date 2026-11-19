// The shared chrome: the phone Menu, the cookie dialog, the locale and the trackers.

import { api, lastChannel, token } from './api.js';

const CONSENT_COOKIE = 'hub_consent';
const LOCALE_COOKIE = 'hub_locale';
const CONSENT_DAYS = 365;

function readCookie(name) {
  const match = document.cookie.split('; ').find((part) => part.startsWith(name + '='));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function writeCookie(name, value, days) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${value}; path=/; expires=${expires}; SameSite=Lax`;
}

function readConsent() {
  const raw = readCookie(CONSENT_COOKIE);
  if (!raw) return null;
  const analytics = /analytics:1/.test(raw);
  const marketing = /marketing:1/.test(raw);
  return { analytics, marketing };
}

// --- the phone Menu: collapsed means unavailable --------------------------

function setUpMenu() {
  const button = document.getElementById('menu-button');
  const links = document.getElementById('primary-links');
  if (!button || !links) return;
  const phone = () => !window.matchMedia('(min-width: 768px)').matches;

  function apply() {
    if (phone()) {
      button.hidden = false;
      links.hidden = button.getAttribute('aria-expanded') !== 'true';
    } else {
      button.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      links.hidden = false;
    }
  }

  button.addEventListener('click', () => {
    const open = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', open ? 'false' : 'true');
    apply();
  });
  links.addEventListener('click', (event) => {
    if (event.target.closest('a') && phone()) {
      button.setAttribute('aria-expanded', 'false');
      apply();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (button.getAttribute('aria-expanded') !== 'true') return;
    button.setAttribute('aria-expanded', 'false');
    apply();
    button.focus();
  });
  window.addEventListener('resize', apply);
  apply();
}

// --- the cookie dialog ----------------------------------------------------

function setUpConsent() {
  const dialog = document.getElementById('cookie-dialog');
  const opener = document.getElementById('cookie-preferences');
  const status = document.getElementById('cookie-status');
  if (!dialog || !opener || !status) return;
  const analytics = document.getElementById('cookie-analytics');
  const marketing = document.getElementById('cookie-marketing');
  let openedBy = null;

  function show(byButton) {
    const stored = readConsent();
    analytics.checked = stored ? stored.analytics : false;
    marketing.checked = stored ? stored.marketing : false;
    dialog.hidden = false;
    openedBy = byButton;
    if (byButton) analytics.focus();
  }

  function close() {
    dialog.hidden = true;
    const target = openedBy || document.querySelector('.skip-link');
    openedBy = null;
    if (target) target.focus();
  }

  function save(wantAnalytics, wantMarketing) {
    writeCookie(CONSENT_COOKIE,
      `analytics:${wantAnalytics ? 1 : 0}|marketing:${wantMarketing ? 1 : 0}`, CONSENT_DAYS);
    status.textContent = 'Cookie preferences saved.';
    close();
    startTrackers();
  }

  opener.addEventListener('click', () => show(opener));
  document.getElementById('cookie-accept').addEventListener('click', () => save(true, true));
  document.getElementById('cookie-reject').addEventListener('click', () => save(false, false));
  document.getElementById('cookie-save').addEventListener('click',
    () => save(analytics.checked, marketing.checked));
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  });

  if (!readConsent()) show(null);
}

// --- trackers -------------------------------------------------------------

function randomId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)))
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function startTrackers() {
  const consent = readConsent();
  if (!consent) return;
  if (consent.analytics) {
    let visitor = readCookie('hub_aid');
    if (!visitor) {
      visitor = randomId();
      writeCookie('hub_aid', visitor, CONSENT_DAYS);
    }
    api('/api/analytics/pageview', {
      method: 'POST',
      body: { path: window.location.pathname, visitor_id: visitor },
      token: null,
    }).catch(() => {});
  }
  if (consent.marketing && !readCookie('hub_mkt')) {
    writeCookie('hub_mkt', randomId(), CONSENT_DAYS);
  }
}

// --- locale ---------------------------------------------------------------

function setUpLocale() {
  const select = document.getElementById('locale-select');
  if (!select) return;
  const current = readCookie(LOCALE_COOKIE) || 'en-US';
  select.value = current;
  document.documentElement.lang = current;
  select.addEventListener('change', () => {
    writeCookie(LOCALE_COOKIE, select.value, CONSENT_DAYS);
    document.documentElement.lang = select.value;
  });
}

// --- the signed-in link ---------------------------------------------------

function setUpSessionLink() {
  const link = document.getElementById('session-link');
  if (!link) return;
  if (token()) {
    link.textContent = 'Open Community Hub';
    link.href = lastChannel() || '/servers';
  } else {
    link.textContent = 'Log in';
    link.href = '/login';
  }
}

setUpMenu();
setUpConsent();
setUpLocale();
setUpSessionLink();
startTrackers();
