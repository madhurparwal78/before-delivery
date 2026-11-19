// Gambit Hall — shared front-end plumbing.

export const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const viewer = (() => {
  const node = document.getElementById('viewer-data');
  if (!node) return null;
  try { return JSON.parse(node.textContent); } catch { return null; }
})();

export async function api(path, options = {}) {
  const init = {
    method: options.method || 'GET',
    headers: { 'Accept': 'application/json', ...(options.headers || {}) },
    credentials: 'same-origin',
  };
  const token = window.localStorage.getItem('gh_token');
  if (token) init.headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) {
    if (options.body instanceof FormData) {
      init.body = options.body;
    } else {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
  }
  const response = await fetch(path, init);
  let payload = null;
  const text = await response.text();
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  }
  if (!response.ok) {
    const error = new Error((payload && (payload.error || payload.detail)) || `Refused (${response.status}).`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export function toast(message, kind = '') {
  const holder = document.getElementById('toasts');
  if (!holder) return;
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = message;
  holder.appendChild(node);
  setTimeout(() => node.remove(), 6000);
}

export function announce(text) {
  const region = document.getElementById('live-region');
  if (!region || !text) return;
  region.textContent = '';
  window.setTimeout(() => { region.textContent = text; }, 30);
}

export function showFieldError(id, message) {
  const node = document.getElementById(id);
  if (node) node.textContent = message || '';
}

/* ------------------------------------------------------------------ sound */
const SOUND_SHAPES = {
  move:      [{ f: 320, t: 0, d: 0.09, g: 0.16, w: 'triangle' }],
  capture:   [{ f: 180, t: 0, d: 0.14, g: 0.22, w: 'sawtooth' }, { f: 90, t: 0.03, d: 0.12, g: 0.18, w: 'square' }],
  promotion: [{ f: 440, t: 0, d: 0.1, g: 0.14, w: 'sine' }, { f: 660, t: 0.09, d: 0.1, g: 0.14, w: 'sine' }, { f: 880, t: 0.18, d: 0.18, g: 0.14, w: 'sine' }],
  victory:   [{ f: 523, t: 0, d: 0.14, g: 0.16, w: 'sine' }, { f: 659, t: 0.12, d: 0.14, g: 0.16, w: 'sine' }, { f: 784, t: 0.24, d: 0.3, g: 0.16, w: 'sine' }],
  defeat:    [{ f: 392, t: 0, d: 0.18, g: 0.16, w: 'triangle' }, { f: 294, t: 0.16, d: 0.22, g: 0.16, w: 'triangle' }, { f: 196, t: 0.34, d: 0.34, g: 0.16, w: 'triangle' }],
  draw:      [{ f: 440, t: 0, d: 0.22, g: 0.13, w: 'sine' }, { f: 440, t: 0.22, d: 0.26, g: 0.13, w: 'sine' }],
};

let audioContext = null;
let interacted = false;
['pointerdown', 'keydown'].forEach((event) =>
  window.addEventListener(event, () => { interacted = true; }, { once: true, passive: true })
);

export function soundOn() {
  return document.documentElement.dataset.sound === 'on';
}

export function playSound(kind) {
  if (!interacted || !soundOn() || !SOUND_SHAPES[kind]) return;
  try {
    audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioContext.currentTime;
    SOUND_SHAPES[kind].forEach((part) => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = part.w;
      osc.frequency.setValueAtTime(part.f, now + part.t);
      gain.gain.setValueAtTime(0.0001, now + part.t);
      gain.gain.exponentialRampToValueAtTime(part.g, now + part.t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + part.t + part.d);
      osc.connect(gain).connect(audioContext.destination);
      osc.start(now + part.t);
      osc.stop(now + part.t + part.d + 0.02);
    });
  } catch { /* a silent browser is still a working board */ }
}

/* ------------------------------------------------------------------ chrome */
function wireChrome() {
  const railToggle = document.getElementById('rail-toggle');
  const rail = document.getElementById('rail');
  if (railToggle && rail) {
    railToggle.addEventListener('click', () => {
      const open = rail.classList.toggle('open');
      railToggle.setAttribute('aria-expanded', String(open));
      railToggle.setAttribute('aria-label', open ? 'Close the menu' : 'Open the menu');
    });
  }
  const accountButton = document.getElementById('account-button');
  const accountMenu = document.getElementById('account-menu');
  if (accountButton && accountMenu) {
    accountButton.addEventListener('click', () => {
      const open = accountMenu.hidden;
      accountMenu.hidden = !open;
      accountButton.setAttribute('aria-expanded', String(open));
      if (open) accountMenu.querySelector('a, button')?.focus();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !accountMenu.hidden) {
        accountMenu.hidden = true;
        accountButton.setAttribute('aria-expanded', 'false');
        accountButton.focus();
      }
    });
    document.addEventListener('click', (event) => {
      if (!accountMenu.hidden && !accountMenu.contains(event.target) && event.target !== accountButton
          && !accountButton.contains(event.target)) {
        accountMenu.hidden = true;
        accountButton.setAttribute('aria-expanded', 'false');
      }
    });
  }
  const signOut = document.getElementById('sign-out');
  if (signOut) {
    signOut.addEventListener('click', async () => {
      try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* ended anyway */ }
      window.localStorage.removeItem('gh_token');
      window.location.href = '/';
    });
  }
}

export function startUnreadPolling() {
  const badge = document.getElementById('unread-count');
  if (!badge || !viewer) return;
  const tick = async () => {
    try {
      const data = await api('/api/notifications');
      badge.textContent = String(data.unread);
      badge.setAttribute('aria-label', `${data.unread} unread`);
      badge.classList.toggle('is-zero', data.unread === 0);
    } catch { /* the count will catch up */ }
  };
  window.setInterval(tick, 4000);
}

wireChrome();
startUnreadPolling();
