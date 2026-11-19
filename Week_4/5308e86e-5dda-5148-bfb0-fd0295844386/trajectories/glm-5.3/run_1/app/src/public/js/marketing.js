// Marketing page behaviours: header menus, pricing toggle, home page reveal,
// contact form, login and signup.
import { announce, el } from './app.js';

// ---------- header menus ----------

const MENUS = {
  products: [
    ['Business banking', '/business-banking'],
    ['Payments', '/business-payments'],
    ['Credit card', '/credit'],
    ['Treasury', '/treasury'],
    ['Invoicing', '/invoicing'],
    ['Spend management', '/spend-management'],
    ['Payroll', '/payroll'],
    ['Books', '/books'],
  ],
  solutions: [
    ['Venture debt', '/venture-debt'],
    ['Working capital loans', '/working-capital-loans'],
  ],
  resources: [
    ['Demo', '/demo'],
    ['Plans and pricing', '/pricing'],
  ],
  about: [
    ['Contact sales', '/contact'],
    ['Open an account', '/signup'],
  ],
};

export function setupHeader() {
  let openTrigger = null;
  const closeAll = (refocus) => {
    document.querySelectorAll('[data-menu-trigger][aria-expanded="true"]').forEach((t) => {
      t.setAttribute('aria-expanded', 'false');
      const panel = document.getElementById(t.getAttribute('aria-controls'));
      if (panel) panel.remove();
      if (refocus && t === openTrigger) t.focus();
    });
    openTrigger = null;
  };
  document.querySelectorAll('[data-menu-trigger]').forEach((trigger) => {
    const name = trigger.dataset.menuTrigger;
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (trigger.getAttribute('aria-expanded') === 'true') {
        closeAll(true);
        return;
      }
      closeAll(false);
      openTrigger = trigger;
      trigger.setAttribute('aria-expanded', 'true');
      const panel = el('div', {
        class: 'menu-panel',
        id: trigger.getAttribute('aria-controls'),
        role: 'region',
        'aria-label': trigger.textContent.trim(),
      });
      for (const [label, href] of MENUS[name]) {
        panel.append(el('a', { href, text: label }));
      }
      document.querySelector('.marketing-header').append(panel);
      panel._links = Array.from(panel.querySelectorAll('a'));
      panel.addEventListener('keydown', (e) => {
        const links = panel._links;
        const idx = links.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); links[(idx + 1 + links.length) % links.length].focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); links[(idx - 1 + links.length) % links.length].focus(); }
        else if (e.key === 'Home') { e.preventDefault(); links[0].focus(); }
        else if (e.key === 'End') { e.preventDefault(); links[links.length - 1].focus(); }
        else if (e.key === 'Escape') { e.preventDefault(); closeAll(true); }
        else if (e.key === 'Tab' && !e.shiftKey && idx === links.length - 1) { closeAll(false); }
        else if (e.key === 'Tab' && e.shiftKey && idx === 0) { e.preventDefault(); trigger.focus(); }
      });
      panel.addEventListener('mousedown', (e) => e.stopPropagation());
    });
    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' && trigger.getAttribute('aria-expanded') !== 'true') {
        e.preventDefault();
        trigger.click();
        setTimeout(() => {
          const panel = document.getElementById(trigger.getAttribute('aria-controls'));
          if (panel && panel._links) panel._links[0].focus();
        }, 0);
      } else if (e.key === 'Escape' && trigger.getAttribute('aria-expanded') === 'true') {
        e.preventDefault();
        closeAll(true);
      }
    });
  });
  document.addEventListener('mousedown', () => closeAll(false));
}

export function setupMobileMenu() {
  const button = document.querySelector('[data-open-menu]');
  if (!button) return;
  button.addEventListener('click', () => {
    if (button.getAttribute('aria-expanded') === 'true') { closeMobile(); return; }
    button.setAttribute('aria-expanded', 'true');
    const panel = el('div', {
      class: 'drawer',
      role: 'dialog',
      'aria-label': 'Menu',
    });
    const backdrop = el('div', { class: 'drawer-backdrop' });
    const inner = el('div', { class: 'drawer-panel', style: 'left:auto;right:0;border-radius:20px 0 0 20px' });
    const close = () => closeMobile();
    backdrop.addEventListener('click', close);
    inner.addEventListener('mousedown', (e) => e.stopPropagation());
    for (const [name, label] of [['products', 'Products'], ['solutions', 'Solutions'], ['resources', 'Resources'], ['about', 'About']]) {
      const group = el('details', {});
      const summary = el('summary', { text: label, style: 'padding:12px 16px;cursor:pointer;font-weight:600' });
      group.append(summary);
      for (const [linkLabel, href] of MENUS[name]) {
        group.append(el('a', { href, text: linkLabel, style: 'display:block;padding:10px 28px' }));
      }
      inner.append(group);
    }
    panel.append(backdrop, inner);
    document.body.append(panel);
    panel._button = button;
    panel._inner = inner;
    const handler = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeMobile(); }
      if (e.key === 'Tab') {
        const focusables = Array.from(inner.querySelectorAll('a[href], summary'));
        if (focusables.length === 0) return;
        const first = focusables[0], last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    inner.addEventListener('keydown', handler);
    panel._handler = handler;
    firstFocus(inner);
  });
  function closeMobile() {
    const panel = document.querySelector('.drawer');
    if (panel && panel._button) {
      panel._button.setAttribute('aria-expanded', 'false');
      panel._button.focus();
    }
    panel?.remove();
  }
  function firstFocus(inner) {
    const first = inner.querySelector('summary');
    if (first) first.focus();
  }
}

// ---------- pricing ----------

export function setupPricing() {
  const toggle = document.querySelector('[data-annual-toggle]');
  if (!toggle) return;
  const plans = [
    ['Tallwind', 0, 0],
    ['Tallwind Plus', 2390, 29590],
    ['Tallwind Pro', 34990, 239990],
  ];
  const priceEls = Array.from(document.querySelectorAll('[data-plan-price]'));
  const showPeriod = (period, { announceIt = false, push = false } = {}) => {
    for (let i = 0; i < priceEls.length; i++) {
      const [name, monthly, annual] = plans[i] || [null, 0, 0];
      const cents = period === 'annual' ? annual : monthly;
      const isAnnual = period === 'annual';
      const text = isAnnual ? `$${fmt(cents)}` : `$${fmt(cents)}/mo.`;
      priceEls[i].textContent = text;
      if (priceEls[i]._interval) clearInterval(priceEls[i]._interval);
      countUp(priceEls[i], cents, isAnnual);
    }
    toggle.setAttribute('aria-checked', String(period === 'annual'));
    const q = new URLSearchParams(window.location.search);
    if (period === 'annual') q.set('billing', 'annual');
    else q.delete('billing');
    const s = q.toString();
    const url = s ? `/pricing?${s}` : '/pricing';
    if (push) window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
    // Jump links keep the billing period.
    document.querySelectorAll('[data-jump-link]').forEach((a) => {
      const target = a.getAttribute('href').split('?')[0];
      a.setAttribute('href', period === 'annual' ? `${target}?billing=annual` : target);
    });
    if (announceIt) {
      const region = document.querySelector('[role="status"]');
      if (region) announce(region, period === 'annual' ? 'Showing annual prices' : 'Showing monthly prices');
    }
  };

  const initial = new URLSearchParams(window.location.search).get('billing');
  if (initial === 'annual') {
    showPeriod('annual');
  } else if (initial !== null && initial !== '' && initial !== 'monthly') {
    const q = new URLSearchParams(window.location.search);
    q.delete('billing');
    const s = q.toString();
    window.history.replaceState(null, '', s ? `/pricing?${s}` : '/pricing');
    showPeriod('monthly');
  }

  toggle.addEventListener('click', () => {
    const current = toggle.getAttribute('aria-checked') === 'true';
    showPeriod(current ? 'monthly' : 'annual', { announceIt: true, push: true });
  });
  window.addEventListener('popstate', () => {
    const p = new URLSearchParams(window.location.search).get('billing');
    showPeriod(p === 'annual' ? 'annual' : 'monthly', { announceIt: true });
  });
}

function fmt(cents) {
  const whole = Math.floor(cents / 100);
  const frac = String(cents % 100).padStart(2, '0');
  return `${whole.toLocaleString('en-US')}.${frac}`;
}

function countUp(elTarget, cents, isAnnual) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { elTarget.textContent = isAnnual ? `$${fmt(cents)}` : `$${fmt(cents)}/mo.`; return; }
  const duration = 900;
  const start = performance.now();
  const suffix = isAnnual ? '' : '/mo.';
  const interval = setInterval(() => {
    const t = Math.min(1, (performance.now() - start) / duration);
    const value = Math.round(cents * t);
    elTarget.textContent = `$${fmt(value)}${suffix}`;
    if (t >= 1) clearInterval(interval);
  }, 40);
  elTarget._interval = interval;
}

// ---------- home page scroll reveal ----------

export function setupScrollReveal() {
  const section = document.querySelector('[data-reveal-section]');
  if (!section) return;
  const still = section.querySelector('[data-reveal-still]');
  const cover = section.querySelector('[data-reveal-cover]');
  if (!still || !cover) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduce.matches) { cover.style.width = '0%'; return; }
  let ticking = false;
  const update = () => {
    const rect = still.getBoundingClientRect();
    const vh = window.innerHeight;
    const start = vh;               // still top at the bottom of the window
    const end = vh / 2;             // still top at the middle of the window
    let t = (start - rect.top) / (start - end);
    t = Math.max(0, Math.min(1, t));
    cover.style.width = `${(1 - t) * 100}%`;
    ticking = false;
  };
  const onScroll = () => {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  update();
}

// ---------- contact form ----------

export function setupContact() {
  const form = document.querySelector('[data-contact-form]');
  if (!form) return;
  const message = form.querySelector('#message');
  const counter = form.querySelector('[data-counter]');
  const status = document.querySelector('[role="status"]');
  const nfcCount = (text) => {
    const trimmed = text.trim();
    const normalised = trimmed.normalize('NFC');
    let n = 0;
    for (const _ of normalised) n++;
    return trimmed === '' ? 0 : n;
  };
  message.addEventListener('input', () => {
    counter.textContent = `${nfcCount(message.value)} / 5000`;
  });
  counter.textContent = `${nfcCount(message.value)} / 5000`;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    if (button.dataset.pending) return;
    const fields = {};
    const value = (id) => form.querySelector('#' + id).value;
    const setError = (id, msg) => {
      const input = form.querySelector('#' + id);
      const err = form.querySelector(`[data-error-for="${id}"]`);
      if (msg) {
        input.setAttribute('aria-invalid', 'true');
        if (err) err.textContent = msg;
        fields[id] = true;
      } else {
        input.removeAttribute('aria-invalid');
        if (err) err.textContent = '';
      }
    };
    for (const id of ['email', 'first_name', 'last_name', 'company', 'message']) setError(id, '');
    const email = value('email').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || Array.from(email).length > 254) setError('email', 'Enter a valid email');
    const nameChecks = [['first_name', 'Enter your first name'], ['last_name', 'Enter your last name'], ['company', 'Enter your company']];
    for (const [id, msg] of nameChecks) {
      const v = value(id).trim();
      if (v === '') setError(id, msg);
      else if (nfcCount(v) > 120) setError(id, 'Keep this to 120 characters or fewer');
    }
    const msgText = value('message');
    if (msgText.trim() === '') setError('message', 'Enter a message');
    else if (nfcCount(msgText) > 5000) setError('message', 'Keep your message to 5,000 characters or fewer');
    const first = form.querySelector('[aria-invalid="true"]');
    if (first) { first.focus(); return; }
    button.dataset.pending = '1';
    button.disabled = true;
    button.textContent = 'Sending…';
    try {
      const res = await fetch('/api/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email, first_name: value('first_name'), last_name: value('last_name'),
          company: value('company'), message: msgText, source: 'contact',
        }),
      });
      if (res.status === 429) {
        if (status) announce(status, 'You\'ve sent several inquiries recently. Please try again in a few minutes.');
        return;
      }
      if (res.status === 413) {
        if (status) announce(status, 'Your message is too long to send.');
        return;
      }
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const fields2 = (body && body.fields) || {};
        const map = {
          email: 'Enter a valid email',
          first_name: 'Enter your first name',
          last_name: 'Enter your last name',
          company: 'Enter your company',
          message: 'Enter a message',
        };
        for (const id of Object.keys(fields2)) setError(id, map[id] || 'Enter a valid value');
        const bad = form.querySelector('[aria-invalid="true"]');
        if (bad) bad.focus();
        return;
      }
      form.textContent = '';
      form.append(el('h2', { text: 'Thanks for reaching out, our team will get back to you shortly.' }));
      if (status) announce(status, 'Thanks for reaching out, our team will get back to you shortly.');
    } catch {
      if (status) announce(status, "Tallwind can't be reached right now. Try again in a moment.");
    } finally {
      delete button.dataset.pending;
      button.disabled = false;
      button.textContent = 'Send inquiry';
    }
  });
}

// ---------- login and signup ----------

const SAFE_FIRST_SEGMENT = ['app', 'payments', 'approvals', 'invoices', 'loans'];

function safeNext(raw) {
  let value = raw;
  try { value = decodeURIComponent(raw); } catch { return '/app'; }
  if (!value.startsWith('/') || value.length < 2) return '/app';
  if (value[1] === '/') return '/app';
  if (/[\\]/.test(value)) return '/app';
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(value)) return '/app';
  const path = value.split('?')[0];
  if (/%2f/i.test(path) || /%5c/i.test(path) || /%2e/i.test(path)) return '/app';
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) return '/app';
  for (const seg of segments) {
    if (seg === '.' || seg === '..') return '/app';
  }
  const first = segments[0];
  if (!SAFE_FIRST_SEGMENT.includes(first)) return '/app';
  return value;
}

export { safeNext };

export async function setupAuth(kind) {
  const form = document.querySelector('[data-auth-form]');
  if (!form) return;
  const status = document.querySelector('[role="status"]');
  const isLogin = kind === 'login';
  if (localStorage.getItem('tallwind_token')) {
    // A signed-in user opening Log in or Sign up is replaced by the cockpit.
    const q = new URLSearchParams(window.location.search);
    const nextRaw = q.get('next');
    const target = isLogin && nextRaw ? safeNext(nextRaw) : '/app';
    window.location.replace(target);
    return;
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    if (button.dataset.pending) return;
    const setError = (id, msg) => {
      const input = form.querySelector('#' + id);
      const err = form.querySelector(`[data-error-for="${id}"]`);
      if (msg) { input.setAttribute('aria-invalid', 'true'); if (err) err.textContent = msg; }
      else { input.removeAttribute('aria-invalid'); if (err) err.textContent = ''; }
    };
    for (const id of isLogin ? ['email', 'password'] : ['name', 'email', 'password']) setError(id, '');
    const email = form.querySelector('#email').value.trim().toLowerCase();
    const password = form.querySelector('#password').value;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) setError('email', isLogin ? 'Email or password is incorrect.' : 'Enter a valid email');
    if (password.length < (isLogin ? 1 : 8)) setError('password', isLogin ? 'Email or password is incorrect.' : 'Password must be at least 8 characters');
    if (!isLogin) {
      const name = form.querySelector('#name').value.trim();
      if (name === '') setError('name', 'Enter your name');
    }
    const firstBad = form.querySelector('[aria-invalid="true"]');
    if (firstBad) { firstBad.focus(); return; }
    button.dataset.pending = '1';
    button.disabled = true;
    button.textContent = isLogin ? 'Logging in…' : 'Opening account…';
    try {
      const path = isLogin ? '/api/auth/login' : '/api/auth/signup';
      const body = isLogin ? { email, password } : { email, password, name: form.querySelector('#name').value.trim() };
      const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (data && data.error === 'invalid_credentials') {
          setError('email', 'Email or password is incorrect.');
          if (status) announce(status, 'Email or password is incorrect.');
        } else if (data && data.error === 'too_many_attempts') {
          setError('email', 'Too many attempts. Try again later.');
          if (status) announce(status, 'Too many attempts. Try again later.');
        } else if (data && data.error === 'email_taken') {
          setError('email', 'An account with this email already exists');
          if (status) announce(status, 'An account with this email already exists');
        } else if (data && data.error === 'validation' && data.fields) {
          for (const [id, msg] of Object.entries(data.fields)) setError(id, String(msg));
        } else if (res.status >= 500) {
          if (status) announce(status, "Tallwind can't be reached right now. Try again in a moment.");
        } else {
          setError('email', isLogin ? 'Email or password is incorrect.' : 'Enter a valid email');
        }
        const bad = form.querySelector('[aria-invalid="true"]');
        if (bad) bad.focus();
        return;
      }
      localStorage.setItem('tallwind_token', data.token);
      localStorage.removeItem('tallwind_last_account');
      let target = '/app';
      if (isLogin) {
        const q = new URLSearchParams(window.location.search);
        const nextRaw = q.get('next');
        if (nextRaw) target = safeNext(nextRaw);
      }
      window.location.replace(target);
    } catch {
      if (status) announce(status, "Tallwind can't be reached right now. Try again in a moment.");
    } finally {
      delete button.dataset.pending;
      button.disabled = false;
      button.textContent = isLogin ? 'Log in' : 'Open account';
    }
  });
}

// ---------- transcript toggle ----------

export function setupTranscript() {
  const button = document.querySelector('[data-transcript-button]');
  const region = document.querySelector('[data-transcript]');
  if (!button || !region) return;
  button.addEventListener('click', () => {
    const open = region.hidden;
    region.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  });
}
