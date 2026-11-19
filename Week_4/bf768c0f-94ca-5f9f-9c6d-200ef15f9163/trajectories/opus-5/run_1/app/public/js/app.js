/**
 * Shared behaviour: the rail, the account menu, refusals shown beside the
 * thing that failed, the live region, and the unread count.
 */

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/** Every call is to this app's own origin, carrying the session cookie. */
export async function api(method, path, body, headers = {}) {
  const init = { method, headers: { ...headers }, credentials: 'same-origin' };
  if (body !== undefined && body !== null) {
    if (body instanceof FormData) {
      init.body = body;
    } else {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
  }
  const response = await fetch(path, init);
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!response.ok) {
    const message = (data && data.error) || `That did not work (${response.status}).`;
    throw new ApiError(response.status, message, data);
  }
  return data;
}

let toastTimer = null;

export function toast(message, kind = 'info') {
  const element = document.getElementById('toast');
  if (!element) {
    announce(message);
    return;
  }
  element.textContent = message;
  element.dataset.kind = kind;
  element.hidden = false;
  element.getAnimations().forEach((animation) => animation.cancel());
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { element.hidden = true; }, 5000);
}

/** Announce in the polite live region, in the pinned forms. */
export function announce(text) {
  const region = document.getElementById('live-region');
  if (!region) return;
  region.textContent = '';
  window.setTimeout(() => { region.textContent = text; }, 30);
}

export function setStatus(text) {
  const region = document.getElementById('status-region');
  if (region) region.textContent = text;
}

export function fieldError(id, message) {
  const element = document.getElementById(id);
  if (element) element.textContent = message || '';
}

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function soundOn() {
  return document.documentElement.dataset.sound === 'on';
}

function wireRail() {
  const toggle = document.getElementById('rail-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const open = document.body.classList.toggle('rail-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }

  const menuButton = document.getElementById('account-menu-button');
  const menu = document.getElementById('account-menu');
  if (menuButton && menu) {
    menuButton.addEventListener('click', () => {
      const open = menu.hidden;
      menu.hidden = !open;
      menuButton.setAttribute('aria-expanded', String(open));
      if (open) menu.querySelector('a, button')?.focus();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !menu.hidden) {
        menu.hidden = true;
        menuButton.setAttribute('aria-expanded', 'false');
        menuButton.focus();
      }
    });
    document.addEventListener('click', (event) => {
      if (menu.hidden) return;
      if (menu.contains(event.target) || menuButton.contains(event.target)) return;
      menu.hidden = true;
      menuButton.setAttribute('aria-expanded', 'false');
    });
  }

  document.querySelectorAll('[data-sign-out]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await api('POST', '/api/auth/logout');
      } finally {
        window.location.href = '/';
      }
    });
  });
}

/** The bell carries the member's exact unread count. */
export async function refreshUnread() {
  const badges = document.querySelectorAll('[data-unread-badge]');
  if (!badges.length) return 0;
  try {
    const data = await api('GET', '/api/notifications');
    badges.forEach((badge) => {
      badge.textContent = String(data.unread);
      badge.hidden = data.unread === 0;
    });
    const counter = document.getElementById('unread-count');
    if (counter) {
      counter.textContent = String(data.unread);
      counter.dataset.unread = String(data.unread);
    }
    return data.unread;
  } catch {
    return 0;
  }
}

if (document.documentElement.dataset.member) {
  wireRail();
  refreshUnread();
  window.setInterval(refreshUnread, 4000);
} else {
  wireRail();
}
