// Public site enhancements: header menus, pricing questions, hero scroll
// scrub, section motion, and the contact and login forms.

const notifications = () => document.getElementById('notifications');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function toast(message, isError = false) {
  const region = notifications();
  if (!region) return;
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' toast-error' : '');
  el.textContent = message;
  region.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

function announce(message) {
  toast(message);
}

// ---- header menus -----------------------------------------------------------
const menuButtons = [...document.querySelectorAll('.menu-btn[aria-controls^="menu-"]')];
let openMenu = null;
function closeMenus(except = null) {
  for (const btn of menuButtons) {
    const panel = document.getElementById(btn.getAttribute('aria-controls'));
    if (btn !== except) {
      btn.setAttribute('aria-expanded', 'false');
      if (panel) panel.hidden = true;
    }
  }
  if (except !== openMenu && openMenu) {
    const btn = openMenu;
    const panel = document.getElementById(btn.getAttribute('aria-controls'));
    btn.setAttribute('aria-expanded', 'false');
    if (panel) panel.hidden = true;
  }
}
for (const btn of menuButtons) {
  const panel = document.getElementById(btn.getAttribute('aria-controls'));
  const toggle = () => {
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    closeMenus();
    btn.setAttribute('aria-expanded', String(!expanded));
    panel.hidden = expanded;
    openMenu = expanded ? null : btn;
  };
  btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
  panel.addEventListener('click', (e) => e.stopPropagation());
}
document.addEventListener('click', () => { closeMenus(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openMenu) {
    const btn = openMenu;
    closeMenus();
    btn.focus();
    openMenu = null;
  }
});

// phone sheet
const phoneBtn = document.querySelector('.phone-menu-btn[aria-controls="phone-sheet"]');
if (phoneBtn) {
  const sheet = document.getElementById('phone-sheet');
  phoneBtn.addEventListener('click', () => {
    const open = !sheet.hidden;
    sheet.hidden = open;
    phoneBtn.setAttribute('aria-expanded', String(!open));
    if (!open) sheet.querySelector('a, button')?.focus();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sheet.hidden) {
      sheet.hidden = true;
      phoneBtn.setAttribute('aria-expanded', 'false');
      phoneBtn.focus();
    }
  });
}

// ---- pricing questions --------------------------------------------------------
const faqButtons = [...document.querySelectorAll('.faq-btn')];
for (const btn of faqButtons) {
  btn.addEventListener('click', () => {
    const panel = document.getElementById(btn.getAttribute('aria-controls'));
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    for (const other of faqButtons) {
      other.setAttribute('aria-expanded', 'false');
      document.getElementById(other.getAttribute('aria-controls')).hidden = true;
    }
    if (!expanded) {
      btn.setAttribute('aria-expanded', 'true');
      panel.hidden = false;
    }
  });
}

// ---- motion --------------------------------------------------------------------
if (!reduceMotion) {
  // blur-in: each word of the headline sharpens from a soft blur
  for (const el of document.querySelectorAll('.blur-words')) {
    const words = el.textContent.split(' ');
    el.textContent = '';
    words.forEach((word, i) => {
      const span = document.createElement('span');
      span.className = 'word';
      span.textContent = word;
      span.style.animationDelay = `${i * 50}ms`;
      el.appendChild(span);
      el.appendChild(document.createTextNode(' '));
    });
  }
  const sections = document.querySelectorAll('.section-rise');
  const seen = new WeakSet();
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting && entry.intersectionRatio >= 0.2 && !seen.has(entry.target)) {
        seen.add(entry.target);
        entry.target.classList.add('risen');
      }
    }
  }, { threshold: [0.2] });
  for (const s of sections) io.observe(s);

  // hero scrub
  const hero = document.getElementById('hero-approval');
  if (hero) {
    const bar = document.getElementById('hero-progress');
    const count = document.getElementById('hero-approval-count');
    const badge = hero.querySelector('.badge');
    const secondDot = document.getElementById('hero-second-dot');
    const update = () => {
      const y = window.scrollY;
      const pct = Math.min(100, 50 + (y / 400) * 50);
      bar.style.setProperty('--fill', `${pct}%`);
      const val = Math.round((pct / 100) * 2);
      bar.setAttribute('aria-valuenow', String(val));
      count.textContent = `${val} of 2 approvals`;
      if (y > 200) {
        badge.textContent = 'executed';
        badge.className = 'badge badge-executed';
        if (secondDot) secondDot.classList.add('on');
      } else {
        badge.textContent = 'pending_approval';
        badge.className = 'badge badge-pending_approval';
        if (secondDot) secondDot.classList.remove('on');
      }
    };
    window.addEventListener('scroll', update, { passive: true });
    update();
  }
} else {
  for (const s of document.querySelectorAll('.section-rise')) s.classList.add('risen');
}

// ---- shared fetch helper --------------------------------------------------------
async function api(url, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const res = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  let body = null;
  const text = await res.text();
  try { body = JSON.parse(text); } catch { body = null; }
  if (!res.ok || (body && body.success === false)) {
    const err = new Error((body && body.error && body.error.message) || 'Something went wrong');
    err.code = body && body.error && body.error.code;
    err.details = (body && body.error && body.error.details) || {};
    err.status = res.status;
    throw err;
  }
  return body.data;
}

function busy(btn) {
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? '<span class="busy-label"></span>' : '<span class="spinner" aria-hidden="true"></span>';
  return () => { btn.disabled = false; btn.innerHTML = original; };
}

// ---- login --------------------------------------------------------------------
const loginForm = document.getElementById('login-form');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const alertBox = document.getElementById('login-alert');
    const btn = loginForm.querySelector('button[type="submit"]');
    const unbusy = busy(btn);
    try {
      const data = await api('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: document.getElementById('email').value,
          password: document.getElementById('password').value,
        }),
      });
      window.sessionStorage.setItem('corvo_token', data.token);
      const next = loginForm.querySelector('input[name="next"]').value;
      window.location.href = (next && /^\/console(\/|$)/.test(next)) ? next : '/console';
    } catch (err) {
      alertBox.hidden = false;
      alertBox.textContent = err.code === 'BAD_CREDENTIALS' ? 'Email or password is incorrect' : (err.message || 'Email or password is incorrect');
    } finally { unbusy(); }
  });
}

// ---- contact -------------------------------------------------------------------
const contactForm = document.getElementById('contact-form');
if (contactForm) {
  const messages = {
    full_name: 'Enter your full name (2 to 80 characters)',
    work_email: 'Enter a valid email address',
    company: 'Enter your company name (2 to 120 characters)',
    monthly_volume: 'Choose a monthly volume',
    message: 'Tell us a little more (10 to 2000 characters)',
  };
  contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const values = {
      full_name: document.getElementById('full_name').value,
      work_email: document.getElementById('work_email').value,
      company: document.getElementById('company').value,
      monthly_volume: document.getElementById('monthly_volume').value,
      message: document.getElementById('message').value,
    };
    let firstInvalid = null;
    // The route reports the first invalid field in this order; the page checks
    // every field and shows all refusals at once.
    const replies = await validateAll(values).catch(() => null);
    if (replies) {
      for (const [field, error] of Object.entries(replies)) {
        const input = document.getElementById(field);
        const errEl = document.getElementById(`err-${field}`);
        if (error) {
          errEl.textContent = error;
          errEl.hidden = false;
          input.setAttribute('aria-invalid', 'true');
          input.setAttribute('aria-describedby', `err-${field}`);
          if (!firstInvalid) firstInvalid = input;
        } else {
          errEl.hidden = true;
          input.removeAttribute('aria-invalid');
        }
      }
      if (firstInvalid) {
        announce('Fix the highlighted fields');
        firstInvalid.focus();
        return;
      }
    }
    const btn = contactForm.querySelector('button[type="submit"]');
    const unbusy = busy(btn);
    try {
      await api('/api/v1/contact', { method: 'POST', body: JSON.stringify(values) });
      contactForm.hidden = true;
      const thanks = document.getElementById('contact-thanks');
      thanks.hidden = false;
      thanks.focus();
      announce('Message sent');
    } catch (err) {
      const field = err.details && err.details.field;
      const input = document.getElementById(field);
      const errEl = document.getElementById(`err-${field}`);
      if (input && errEl) {
        errEl.textContent = err.message;
        errEl.hidden = false;
        input.setAttribute('aria-invalid', 'true');
        input.focus();
      } else {
        announce(err.message, true);
      }
    } finally { unbusy(); }
  });
}

async function validateAll(values) {
  const errors = {};
  const cp = (s) => [...s.normalize('NFC')].length;
  const control = (s) => /[\u0000-\u001f\u007f-\u009f]/.test(s);
  const fields = ['full_name', 'work_email', 'company', 'monthly_volume', 'message'];
  const labels = { full_name: 'Full name', work_email: 'Work email', company: 'Company', monthly_volume: 'Monthly volume', message: 'How can we help?' };
  if (control(values.full_name) || control(values.work_email) || control(values.company) || control(values.monthly_volume)) {
    for (const f of fields.slice(0, 4)) {
      if (control(values[f])) errors[f] = 'Remove control characters from this field';
    }
  }
  if (!errors.full_name) {
    const v = values.full_name.trim();
    if (cp(v) < 2 || cp(v) > 80) errors.full_name = 'Enter your full name (2 to 80 characters)';
  }
  if (!errors.work_email) {
    const v = values.work_email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errors.work_email = 'Enter a valid email address';
    else if (['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com'].includes(v.split('@')[1].toLowerCase())) errors.work_email = 'Use your work email';
  }
  if (!errors.company) {
    const v = values.company.trim();
    if (cp(v) < 2 || cp(v) > 120) errors.company = 'Enter your company name (2 to 120 characters)';
  }
  if (!errors.monthly_volume) {
    if (!['Under $1M', '$1M to $10M', '$10M to $100M', 'Over $100M'].includes(values.monthly_volume)) {
      errors.monthly_volume = 'Choose a monthly volume';
    }
  }
  if (!errors.message) {
    const v = values.message.replace(/\r\n/g, '\n');
    if (/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(v)) errors.message = 'Remove control characters from this field';
    else if (cp(v) < 10 || cp(v) > 2000) errors.message = 'Tell us a little more (10 to 2000 characters)';
  }
  return errors;
}


