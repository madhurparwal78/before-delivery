// Mela: behaviour layered over pages the server has already rendered.
(() => {
  'use strict';

  const OUTAGE = 'Mela is taking a short break. Your change was not saved. Please try again in a moment.';
  const WAIT_MS = 10000;
  const TOAST_MS = 5000;
  const TOAST_LIMIT = 3;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const member = () => document.body.dataset.member === '1';
  const signInFor = (path) => `/signin?next=${encodeURIComponent(path)}`;

  // Requests. An action fails on a 503, a network error, or no answer within ten seconds.
  class Outage extends Error {}

  async function call(method, path, body, headers = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WAIT_MS);
    try {
      const response = await fetch(path, {
        method, credentials: 'same-origin', signal: controller.signal,
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.status === 503) throw new Outage();
      const data = response.status === 204 ? null : await response.json();
      return { status: response.status, ok: response.ok, data: data || {} };
    } catch (error) {
      throw error instanceof Outage ? error : new Outage();
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchPage(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WAIT_MS);
    try {
      const response = await fetch(url, { credentials: 'same-origin', signal: controller.signal, headers: { Accept: 'text/html' } });
      if (!response.ok) throw new Outage();
      return new DOMParser().parseFromString(await response.text(), 'text/html');
    } catch {
      throw new Outage();
    } finally {
      clearTimeout(timer);
    }
  }

  // Replace each [data-live] region with the server's fresh render of it.
  function swapLive(doc, names) {
    for (const name of names) {
      const fresh = doc.querySelector(`[data-live="${name}"]`);
      const current = document.querySelector(`[data-live="${name}"]`);
      if (fresh && current) current.replaceWith(document.importNode(fresh, true));
    }
  }

  // The in-page outage alert, shown beside the control that failed.
  function showAlert(control, text = OUTAGE) {
    let alert = control.parentElement.querySelector(':scope > [data-outage-alert]');
    if (!alert) {
      alert = document.createElement('p');
      alert.className = 'form-alert';
      alert.dataset.outageAlert = '';
      alert.setAttribute('role', 'alert');
      control.after(alert);
    }
    alert.textContent = text;
  }

  function clearAlert(control) {
    control?.parentElement?.querySelector(':scope > [data-outage-alert]')?.remove();
  }

  function joinNames(names) {
    return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }

  function withPromoted(text, promoted) {
    return promoted && promoted.length ? `${text} · ${joinNames(promoted.map((p) => p.name))} moved up from the waitlist` : text;
  }

  // Toasts: polite, never focused, at most three, newest last. Each leaves after about five seconds;
  // the whole stack waits while the pointer or focus is on it.
  const toasts = {
    live: new Set(),
    held: false,
    bind(region) {
      if (region.dataset.bound) return;
      region.dataset.bound = '1';
      const update = () => {
        const held = region.matches(':hover') || region.contains(document.activeElement);
        if (held === toasts.held) return;
        toasts.held = held;
        toasts.live.forEach((entry) => (held ? entry.pause() : entry.run()));
      };
      region.addEventListener('mouseenter', update);
      region.addEventListener('mouseleave', update);
      region.addEventListener('focusin', update);
      region.addEventListener('focusout', () => setTimeout(update));
    },
    show(text) {
      const region = document.querySelector('[data-toasts]');
      if (!region || !text) return;
      toasts.bind(region);
      const toast = document.createElement('div');
      toast.className = 'toast';
      toast.innerHTML = '<span class="toast-mark" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M12 1.5c.8 6.3 4.2 9.7 10.5 10.5-6.3.8-9.7 4.2-10.5 10.5C11.2 16.2 7.8 12.8 1.5 12 7.8 11.2 11.2 7.8 12 1.5Z"/></svg></span><span class="toast-text"></span><button type="button" class="icon-button" aria-label="Dismiss notification"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>';
      toast.querySelector('.toast-text').textContent = text;
      const entry = {
        remaining: TOAST_MS, started: 0, timer: 0,
        run() { clearTimeout(entry.timer); entry.started = Date.now(); entry.timer = setTimeout(() => entry.remove(true), entry.remaining); },
        pause() { clearTimeout(entry.timer); entry.remaining -= Date.now() - entry.started; },
        remove(animate) {
          if (!toasts.live.delete(entry)) return;
          clearTimeout(entry.timer);
          if (!animate || reduced()) { toast.remove(); return; }
          toast.classList.add('leaving');
          toast.addEventListener('animationend', () => toast.remove(), { once: true });
          setTimeout(() => toast.remove(), 400);
        },
      };
      toast.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.stopPropagation(); entry.remove(false); } });
      toast.querySelector('button').addEventListener('click', () => entry.remove(false));
      region.append(toast);
      toasts.live.add(entry);
      while (toasts.live.size > TOAST_LIMIT) toasts.live.values().next().value.remove(false);
      if (!toasts.held) entry.run();
    },
    // A toast for the next page this tab opens, such as after a redirect.
    carry(text) { sessionStorage.setItem('mela.toast', text); },
    takeCarried() {
      const text = sessionStorage.getItem('mela.toast');
      sessionStorage.removeItem('mela.toast');
      return text;
    },
  };

  // A card action pressed by a visitor is remembered across sign-in.
  const intent = {
    save(path, action) { sessionStorage.setItem('mela.intent', JSON.stringify({ path, action })); },
    peek() {
      try { return JSON.parse(sessionStorage.getItem('mela.intent') || 'null'); } catch { return null; }
    },
    takeFor(path) {
      const saved = intent.peek();
      if (!saved || saved.path !== path) return null;
      sessionStorage.removeItem('mela.intent');
      return saved.action;
    },
  };

  // The header clock: the viewer's local time and offset, updated each minute.
  function startClock() {
    const el = document.querySelector('[data-clock]');
    if (!el) return;
    const render = () => {
      const now = new Date();
      const offset = -now.getTimezoneOffset();
      const hours = Math.floor(Math.abs(offset) / 60), minutes = Math.abs(offset) % 60;
      const zone = offset === 0 ? 'GMT' : `GMT${offset < 0 ? '-' : '+'}${hours}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}`;
      const h = now.getHours();
      el.textContent = `${h % 12 || 12}:${String(now.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'} ${zone}`;
      el.dateTime = now.toISOString();
    };
    render();
    setTimeout(() => { render(); setInterval(render, 60000); }, 60000 - (Date.now() % 60000));
  }

  // Countdown: correct from the server, then ticking every second.
  function countdownText(start, end, now) {
    if (now >= end) return null;
    let seconds = Math.floor((start - now) / 1000);
    if (seconds <= 0) return 'Happening now';
    const days = Math.floor(seconds / 86400); seconds -= days * 86400;
    const hours = Math.floor(seconds / 3600); seconds -= hours * 3600;
    const minutes = Math.floor(seconds / 60); seconds -= minutes * 60;
    const units = days ? [[days, 'day', 'days'], [hours, 'hr', 'hrs'], [minutes, 'min', 'min']]
      : [[hours, 'hr', 'hrs'], [minutes, 'min', 'min'], [seconds, 'sec', 'sec']];
    while (units.length > 1 && units[0][0] === 0) units.shift();
    return units.map(([value, one, many], i) => [i === 0 ? String(value) : String(value).padStart(2, '0'), value === 1 ? one : many]);
  }

  function startCountdown(el) {
    const start = Date.parse(el.dataset.start), end = Date.parse(el.dataset.end);
    let last = [];
    const render = () => {
      const parts = countdownText(start, end, Date.now());
      if (parts === null) { el.closest('.countdown').hidden = true; return; }
      if (typeof parts === 'string') { el.textContent = parts; el.closest('.countdown').querySelector('.countdown-label')?.remove(); return; }
      const numbers = parts.map((p) => p[0]);
      el.replaceChildren(...parts.flatMap(([value, word], i) => {
        const num = document.createElement('span');
        num.className = 'num';
        num.textContent = value;
        if (!reduced() && last.length === numbers.length && last[i] !== value) {
          num.animate([{ transform: 'translateY(-40%)', opacity: 0 }, { transform: 'none', opacity: 1 }],
            { duration: 260, easing: 'cubic-bezier(.34,1.56,.64,1)' });
        }
        return [num, document.createTextNode(` ${word}${i < parts.length - 1 ? ' ' : ''}`)];
      }));
      last = numbers;
    };
    render();
    setInterval(render, 1000);
  }

  // Celebration: one aria-hidden layer of confetti, or fireworks on the night theme, gone within three seconds.
  function celebrate(origin) {
    if (reduced()) return;
    const theme = document.body.dataset.theme;
    const style = getComputedStyle(document.body);
    const accent = style.getPropertyValue('--t-accent').trim() || '#d6136c';
    const strong = style.getPropertyValue('--t-strong').trim() || '#b45c00';
    const layer = document.createElement('div');
    layer.className = 'celebration';
    layer.setAttribute('aria-hidden', 'true');
    document.body.append(layer);
    const W = innerWidth, H = innerHeight, rand = (a, b) => a + Math.random() * (b - a);
    const animations = [];
    const fly = (x, y, frames, { color, kind = '', duration, delay = 0 }) => {
      const piece = document.createElement('span');
      piece.className = `piece ${kind}`;
      piece.style.background = color;
      piece.style.color = color;
      layer.append(piece);
      animations.push(piece.animate(frames(x, y), { duration, delay, easing: 'cubic-bezier(.1,.6,.3,1)', fill: 'both' }));
    };
    const box = origin.getBoundingClientRect();
    const ox = box.left + box.width / 2, oy = box.top + Math.min(box.height / 2, H * 0.6);
    const toss = (dx, dy, spin) => (x, y) => [
      { transform: `translate(${x}px, ${y}px) rotate(0deg) scale(.6)`, opacity: 1 },
      { transform: `translate(${x + dx * 0.7}px, ${y + dy}px) rotate(${spin / 2}deg) scale(1)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${x + dx}px, ${y + dy + H * 0.55}px) rotate(${spin}deg) scale(1)`, opacity: 0 },
    ];
    if (theme === 'night') {
      const colors = [accent, '#ffd36e', '#ff7ab5', '#ffffff', '#7cf0d0'];
      for (let shell = 0; shell < 5; shell++) {
        const cx = rand(W * 0.15, W * 0.85), cy = rand(H * 0.12, H * 0.42), color = colors[shell];
        for (let i = 0; i < 14; i++) {
          const angle = (Math.PI * 2 * i) / 14, reach = rand(70, 130);
          fly(cx, cy, (x, y) => [
            { transform: `translate(${x}px, ${y}px) scale(.3)`, opacity: 0 },
            { transform: `translate(${x}px, ${y}px) scale(1)`, opacity: 1, offset: 0.08 },
            { transform: `translate(${x + Math.cos(angle) * reach}px, ${y + Math.sin(angle) * reach + 40}px) scale(.6)`, opacity: 0 },
          ], { color, kind: 'spark', duration: 1300, delay: shell * 240 });
        }
      }
      for (let i = 0; i < 20; i++) {
        fly(ox, oy, toss(rand(-W * 0.2, W * 0.2), rand(-H * 0.55, -H * 0.3), 0), { color: colors[i % colors.length], kind: 'spark', duration: rand(1400, 1900) });
      }
    } else {
      const colors = [accent, strong, '#d6136c', '#ffb02e', '#5b8cff'];
      for (let i = 0; i < 36; i++) {
        fly(ox, oy, toss(rand(-W * 0.35, W * 0.35), rand(-H * 0.5, -H * 0.2), rand(-540, 540)),
          { color: colors[i % colors.length], kind: i % 3 ? '' : 'round', duration: rand(1500, 2200) });
      }
      for (const side of [0, 1]) {
        for (let i = 0; i < 22; i++) {
          const dx = (side ? -1 : 1) * rand(W * 0.15, W * 0.45);
          fly(side ? W - 10 : 10, H - 10, toss(dx, rand(-H * 0.85, -H * 0.5), rand(-720, 720)),
            { color: colors[(i + side) % colors.length], kind: i % 4 ? '' : 'round', duration: rand(1600, 2200), delay: rand(0, 200) });
        }
      }
      for (let i = 0; i < 24; i++) {
        fly(rand(0, W), -20, (x, y) => [
          { transform: `translate(${x}px, ${y}px) rotate(0deg)`, opacity: 1 },
          { transform: `translate(${x + rand(-60, 60)}px, ${y + H + 40}px) rotate(${rand(-400, 400)}deg)`, opacity: 0.9 },
        ], { color: colors[i % colors.length], duration: rand(1500, 2300), delay: rand(0, 400) });
      }
    }
    const done = () => layer.remove();
    Promise.all(animations.map((a) => a.finished)).then(done, done);
    setTimeout(done, 2900);
  }

  // Follow buttons anywhere on the page.
  function plural(count, word) { return `${count} ${count === 1 ? word : `${word}s`}`; }

  async function follow(button) {
    if (button.disabled) return;
    if (!member()) { location.assign(signInFor(location.pathname + location.search)); return; }
    const slug = button.dataset.follow, name = button.dataset.name;
    const following = button.getAttribute('aria-pressed') === 'true';
    button.disabled = true;
    button.closest('li, header, .presenter, .community-card')?.setAttribute('aria-busy', 'true');
    try {
      const result = await call(following ? 'DELETE' : 'PUT', `/api/calendars/${slug}/follow`);
      if (result.status === 401) { location.assign(signInFor(location.pathname + location.search)); return; }
      clearAlert(button);
      for (const other of document.querySelectorAll(`[data-follow="${slug}"]`)) {
        other.setAttribute('aria-pressed', String(result.data.following));
        other.classList.toggle('is-on', result.data.following);
        other.querySelector('[data-follow-label]').textContent = result.data.following ? 'Following' : 'Follow';
      }
      for (const count of document.querySelectorAll(`[data-followers="${slug}"]`)) count.textContent = plural(result.data.follower_count, 'Follower');
      toasts.show(result.data.following ? `Following ${name}` : `Unfollowed ${name}`);
    } catch {
      showAlert(button);
    } finally {
      button.disabled = false;
      button.closest('[aria-busy]')?.setAttribute('aria-busy', 'false');
    }
  }

  // Landing: the floating covers scatter with the scroll position and gather again on the way back.
  // Each cover's drift and fade is one Web Animation that never plays on its own: the scroll position seeks it.
  // Its second half holds the scattered pose and it repeats forever, so it has no end a finish() could jump to.
  function startScatter() {
    const hero = document.querySelector('[data-scatter]');
    if (!hero || reduced()) return;
    const covers = [...hero.querySelectorAll('.float')];
    const span = 1000;
    let moves = [];
    const place = () => {
      for (const move of moves) move.cancel();
      const title = hero.querySelector('.hero-title').getBoundingClientRect();
      const cx = title.left + title.width / 2, cy = title.top + title.height / 2;
      moves = covers.map((cover) => {
        const box = cover.getBoundingClientRect();
        const dx = box.left + box.width / 2 - cx, dy = box.top + box.height / 2 - cy;
        const length = Math.hypot(dx, dy) || 1, reach = box.width / 3;
        const out = { transform: `translate(${(dx / length) * reach}px, ${(dy / length) * reach}px)`, opacity: 0.5 };
        const move = cover.animate([{ transform: 'translate(0px, 0px)', opacity: 1 }, { ...out, offset: 0.5 }, out],
          { duration: 2 * span, iterations: Infinity, fill: 'both' });
        move.pause();
        return move;
      });
      shown = -1;
    };
    // Read the scroll position each frame, so the covers follow it exactly and never lag a scroll event.
    let shown = -1;
    const scroll = () => {
      const progress = Math.min(Math.max(scrollY / innerHeight, 0), 1);
      if (progress !== shown) { shown = progress; for (const move of moves) move.currentTime = progress * span; }
    };
    const frame = () => { scroll(); requestAnimationFrame(frame); };
    place();
    requestAnimationFrame(frame);
    addEventListener('resize', place);
  }

  // Landing: the first hero word swaps every two and a half seconds, each rising into place.
  function startWordCycle() {
    const holder = document.querySelector('[data-words]');
    if (!holder || reduced()) return;
    const words = [...holder.children];
    let at = 0;
    setInterval(() => {
      const leaving = words[at];
      at = (at + 1) % words.length;
      words.forEach((word) => word.classList.remove('is-leaving'));
      leaving.classList.replace('is-current', 'is-leaving');
      words[at].classList.add('is-current');
    }, 2500);
  }

  // A focus trap for modal dialogs: Tab and Shift+Tab stay inside.
  function trapFocus(dialog, event) {
    if (event.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll('button, [href], input, select, textarea')].filter((el) => !el.disabled && el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
  }

  function newKey() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  const CARD_TOASTS = { approved: 'Registered. See you there!', pending: 'Request sent to the host', waitlisted: 'Added to the waitlist' };
  const CANCEL_TOASTS = { approved: 'Registration cancelled', pending: 'Request withdrawn', waitlisted: 'Left the waitlist' };
  const CODE_ERRORS = { invalid_access_code: 'That code is not valid', access_code_required: 'Enter your access code' };

  document.addEventListener('alpine:init', () => {
    const Alpine = window.Alpine;

    Alpine.data('accountMenu', () => ({
      open: false,
      items() { return [...this.$refs.menu.querySelectorAll('[role="menuitem"]')]; },
      toggle() { if (this.open) this.close(true); else this.show(0); },
      show(index) {
        this.open = true;
        this.$nextTick(() => { const items = this.items(); items[(index + items.length) % items.length].focus(); });
      },
      move(step) {
        const items = this.items();
        const at = items.indexOf(document.activeElement);
        items[(at + step + items.length) % items.length].focus();
      },
      close(focusButton) {
        if (!this.open) return;
        this.open = false;
        if (focusButton) this.$refs.button.focus();
      },
      async signOut() {
        try {
          await call('POST', '/api/auth/signout');
          toasts.carry('Signed out');
          location.assign('/');
        } catch {
          this.close(true);
          toasts.show(OUTAGE);
        }
      },
    }));

    Alpine.data('tabs', (initial, syncUrl = false) => ({
      current: initial,
      select(key) {
        this.current = key;
        if (syncUrl) history.replaceState(null, '', key === 'upcoming' ? location.pathname : `${location.pathname}?tab=${key}`);
      },
      step(by) {
        const tabs = [...this.$root.querySelectorAll('[data-tab]')];
        const at = tabs.findIndex((tab) => tab.dataset.tab === this.current);
        const next = tabs[(at + by + tabs.length) % tabs.length];
        this.select(next.dataset.tab);
        next.focus();
      },
    }));

    Alpine.data('signIn', () => ({
      step: 'email', email: '', name: '', password: '', errors: {}, failed: false, outage: false, busy: false,
      outageMessage: OUTAGE,
      get label() { return { email: 'Continue with Email', password: 'Sign In', create: 'Create Account' }[this.step]; },
      reset() { this.step = 'email'; this.password = ''; this.errors = {}; this.failed = false; this.outage = false; },
      finish(text) {
        toasts.carry(text);
        location.assign(this.$root.dataset.target);
      },
      async submit() {
        if (this.busy) return;
        this.busy = true;
        this.errors = {}; this.failed = false; this.outage = false;
        try {
          if (this.step === 'email') {
            const result = await call('POST', '/api/auth/check', { email: this.email.trim() });
            if (result.ok) this.step = result.data.exists ? 'password' : 'create';
            else this.errors = result.data.errors || {};
          } else if (this.step === 'password') {
            const result = await call('POST', '/api/auth/signin', { email: this.email.trim(), password: this.password });
            if (result.ok) { this.finish(`Signed in as ${result.data.user.name}`); return; }
            if (result.status === 401) this.failed = true; else this.errors = result.data.errors || {};
          } else {
            const result = await call('POST', '/api/auth/signup', { name: this.name, email: this.email.trim(), password: this.password });
            if (result.ok) { this.finish(`Welcome, ${result.data.user.name.split(/\s+/)[0]}! Your account is ready.`); return; }
            if (result.status === 409) { this.step = 'password'; this.errors = { email: 'That email already has an account. Enter its password to sign in.' }; }
            else this.errors = result.data.errors || {};
          }
        } catch {
          this.outage = true;
        }
        this.busy = false;
      },
    }));

    Alpine.data('discover', () => ({
      init() {
        this.$root.addEventListener('click', (event) => {
          const more = event.target.closest('[data-view-all]');
          if (more) {
            this.$root.querySelectorAll('[data-more]').forEach((row) => { row.hidden = false; });
            more.setAttribute('aria-expanded', 'true');
            more.disabled = true;
            return;
          }
          const link = event.target.closest('[data-region="categories"] a, [data-region="cities"] a');
          if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
          event.preventDefault();
          this.go(link.href, true, link);
        });
        addEventListener('popstate', () => this.go(location.href, false));
      },
      async go(url, push, control) {
        const listing = this.$root.querySelector('[data-region="listing"]');
        listing.setAttribute('aria-busy', 'true');
        listing.querySelector('[data-skeleton]').hidden = false;
        try {
          const doc = await fetchPage(url);
          for (const name of ['listing', 'categories', 'cities']) {
            this.$root.querySelector(`[data-region="${name}"]`).replaceWith(document.importNode(doc.querySelector(`[data-region="${name}"]`), true));
          }
          if (push) history.pushState(null, '', url);
        } catch {
          listing.setAttribute('aria-busy', 'false');
          listing.querySelector('[data-skeleton]').hidden = true;
          showAlert(listing.querySelector('.band-head'));
          if (control) control.focus();
        }
      },
    }));

    Alpine.data('eventPage', () => ({
      init() {
        this.$root.querySelectorAll('[data-countdown]').forEach(startCountdown);
      },
    }));

    Alpine.data('registrationCard', () => ({
      busy: false,
      slug: '',
      init() {
        this.slug = this.$root.closest('[data-slug]').dataset.slug;
        this.$root.addEventListener('click', (event) => {
          const button = event.target.closest('[data-action]');
          if (button) this.press(button);
        });
        this.$root.addEventListener('submit', (event) => {
          event.preventDefault();
          const form = event.target;
          this.act('POST', { access_code: form.querySelector('input').value }, form.querySelector('button'), form.querySelector('input'));
        });
        const path = `/${this.slug}`;
        const wanted = member() ? intent.takeFor(path) : null;
        const button = wanted && this.$root.querySelector(`[data-action="${wanted}"]`);
        if (button) { toasts.takeCarried(); this.press(button); }
        else toasts.show(toasts.takeCarried());
        if (this.body().hasAttribute('data-celebrate')) celebrate(this.$root);
      },
      body() { return this.$root.querySelector('[data-live="card"]'); },
      press(button) {
        if (this.busy || button.disabled) return;
        const action = button.dataset.action;
        if (!member()) { intent.save(`/${this.slug}`, action); location.assign(signInFor(`/${this.slug}`)); return; }
        if (action === 'reveal') {
          const form = this.$root.querySelector('[data-code-form]');
          form.hidden = false;
          button.hidden = true;
          form.querySelector('input').focus();
          return;
        }
        if (action === 'register') this.act('POST', {}, button);
        else this.act('DELETE', undefined, button);
      },
      fieldError(field, text) {
        const error = this.$root.querySelector(`#${field.getAttribute('aria-describedby')}`);
        error.textContent = text;
        error.hidden = false;
        field.setAttribute('aria-invalid', 'true');
        field.focus();
      },
      async act(method, payload, control, field) {
        if (this.busy) return;
        this.busy = true;
        this.$root.setAttribute('aria-busy', 'true');
        control.disabled = true;
        const before = this.body().dataset.state;
        const share = this.$root.querySelector('.meter-fill')?.dataset.share;
        let result;
        try {
          result = await call(method, `/api/events/${this.slug}/register`, payload);
        } catch {
          this.done(control);
          showAlert(control);
          return;
        }
        clearAlert(control);
        if (result.status === 401) { intent.save(`/${this.slug}`, method === 'POST' ? 'register' : 'cancel'); location.assign(signInFor(`/${this.slug}`)); return; }
        if (field && (CODE_ERRORS[result.data.error] || result.status === 429)) {
          const minutes = Math.ceil((result.data.retry_after || 60) / 60);
          this.fieldError(field, CODE_ERRORS[result.data.error] || `Too many attempts. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`);
          this.done(control);
          return;
        }
        if (result.ok) {
          const text = method === 'POST' ? CARD_TOASTS[result.data.status] : CANCEL_TOASTS[before];
          if (text && (result.status === 201 || method === 'DELETE')) toasts.show(withPromoted(text, result.data.promoted));
        }
        try {
          swapLive(await fetchPage(location.pathname), ['card', 'location-row', 'location', 'guests']);
        } catch {
          location.reload();
          return;
        }
        this.done(control);
        if (result.data.error === 'event_full') {
          const error = this.$root.querySelector('[data-card-error]');
          error.textContent = 'This event just filled up';
          error.setAttribute('role', 'alert');
          error.hidden = false;
        }
        this.settle(share);
      },
      done(control) {
        this.busy = false;
        this.$root.setAttribute('aria-busy', 'false');
        if (control.isConnected) control.disabled = false;
      },
      settle(previousShare) {
        const body = this.body();
        const status = this.$root.querySelector('[data-card-status]');
        status.textContent = body.dataset.announce;
        (body.querySelector('button:not([hidden]), input, a') || this.$root).focus();
        const fill = this.$root.querySelector('.meter-fill');
        if (!reduced()) {
          this.$root.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.012)' }, { transform: 'scale(1)' }],
            { duration: 360, easing: 'cubic-bezier(.34,1.56,.64,1)' });
          if (fill && previousShare !== undefined) {
            fill.style.transition = 'none';
            fill.style.setProperty('--share', previousShare);
            fill.getBoundingClientRect();
            fill.style.transition = '';
            fill.style.setProperty('--share', fill.dataset.share);
          }
        }
        if (body.hasAttribute('data-celebrate')) celebrate(this.$root);
      },
    }));

    Alpine.data('sendDialog', (kind) => ({
      fields: kind === 'contact' ? { message: '' } : { reason: 'spam', details: '' },
      errors: {}, outage: false, busy: false, key: '', opener: null, outageMessage: OUTAGE,
      init() {
        const dialog = this.$root;
        document.querySelectorAll(`[data-open-dialog="${dialog.id}"]`).forEach((link) => link.addEventListener('click', (event) => {
          event.preventDefault();
          this.open(link);
        }));
        dialog.addEventListener('keydown', (event) => trapFocus(dialog, event));
        dialog.addEventListener('close', () => this.opener?.focus());
      },
      open(opener) {
        this.opener = opener;
        this.key = newKey();
        this.errors = {};
        this.outage = false;
        this.$root.showModal();
        this.$root.querySelector('[data-first]').focus();
      },
      close() { this.$root.close(); },
      async send() {
        if (this.busy) return;
        this.busy = true;
        this.errors = {}; this.outage = false;
        const slug = document.querySelector('[data-slug]').dataset.slug;
        try {
          const result = await call('POST', `/api/events/${slug}/${kind}`, { ...this.fields }, { 'Idempotency-Key': this.key });
          if (result.status === 201) {
            this.fields = kind === 'contact' ? { message: '' } : { reason: 'spam', details: '' };
            this.close();
            toasts.show(kind === 'contact' ? 'Message sent to the host' : 'Report sent. Thank you.');
          } else {
            this.errors = result.data.errors || { [kind === 'contact' ? 'message' : 'reason']: 'Please check this and try again.' };
          }
        } catch {
          this.outage = true;
        }
        this.busy = false;
      },
    }));

    Alpine.data('eventForm', (mode, slug) => ({
      theme: '', name: '', locationType: 'offline', busy: false, outage: false, outageMessage: OUTAGE, saved: {},
      init() {
        const form = this.$root;
        this.theme = form.querySelector('[data-field="theme"]').value;
        this.name = form.querySelector('[data-field="name"]').value;
        this.locationType = form.querySelector('[data-field="location_type"]').value;
        this.saved = this.collect();
        const preview = this.$refs.preview.querySelector('.cover');
        this.$watch('theme', (value) => { preview.dataset.theme = value; });
        this.$watch('name', (value) => { preview.dataset.name = value || 'Your event'; });
        if (!this.name) preview.dataset.name = 'Your event';
      },
      shuffle() {
        const themes = this.$root.dataset.themes.split(',');
        this.theme = themes[(themes.indexOf(this.theme) + 1) % themes.length];
      },
      instant(prefix) {
        const date = this.$root.querySelector(`[data-part="${prefix}-date"]`).value;
        const time = this.$root.querySelector(`[data-part="${prefix}-time"]`).value;
        const zone = this.$root.querySelector('[data-field="timezone"]');
        return date && time ? `${date}T${time}:00${zone.selectedOptions[0].dataset.offset}` : '';
      },
      collect() {
        const body = {};
        for (const el of this.$root.querySelectorAll('[data-field]')) {
          const key = el.dataset.field;
          if (el.type === 'checkbox') body[key] = el.checked;
          else if (key === 'capacity') body[key] = el.value.trim() === '' ? null : /^\d+$/.test(el.value.trim()) ? Number(el.value.trim()) : el.value;
          else if (key === 'calendar') body[key] = el.value || null;
          else body[key] = el.value;
        }
        body.start_at = this.instant('start');
        body.end_at = this.instant('end');
        return body;
      },
      showErrors(errors) {
        const form = this.$root;
        form.querySelectorAll('[aria-invalid="true"]').forEach((el) => el.removeAttribute('aria-invalid'));
        form.querySelectorAll('[data-error]').forEach((el) => { el.hidden = true; el.textContent = ''; });
        let first = null;
        for (const [key, message] of Object.entries(errors)) {
          const slot = form.querySelector(`[data-error="${key}"]`);
          if (!slot) continue;
          slot.textContent = message;
          slot.hidden = false;
          const fields = key === 'start_at' || key === 'end_at'
            ? form.querySelectorAll(`[data-part^="${key.split('_')[0]}-"]`) : form.querySelectorAll(`[data-field="${key}"]`);
          fields.forEach((el) => el.setAttribute('aria-invalid', 'true'));
          first = first || fields[0];
        }
        first?.focus();
      },
      async submit() {
        if (this.busy) return;
        const current = this.collect();
        const body = mode === 'create' ? current : Object.fromEntries(Object.entries(current)
          .filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(this.saved[key])));
        this.busy = true;
        this.outage = false;
        try {
          const result = await call(mode === 'create' ? 'POST' : 'PATCH', mode === 'create' ? '/api/events' : `/api/events/${slug}`, body);
          if (result.ok) {
            this.showErrors({});
            if (mode === 'create') { toasts.carry('Your event is live'); location.assign(`/${result.data.slug}`); return; }
            this.saved = current;
            toasts.show('Changes saved');
            swapLive(await fetchPage(location.pathname), ['summary', 'guests']);
            this.$dispatch('guests-changed');
          } else {
            this.showErrors(result.data.errors || {});
          }
        } catch {
          this.outage = true;
        }
        this.busy = false;
      },
    }));

    Alpine.data('manage', () => ({
      filter: 'all', slug: '',
      init() {
        this.slug = this.$root.dataset.slug;
        this.$root.addEventListener('click', (event) => {
          const decide = event.target.closest('[data-decide]');
          if (decide) this.decide(decide);
          const registration = event.target.closest('[data-registration]');
          if (registration) this.setRegistration(registration);
        });
        this.$root.addEventListener('guests-changed', () => this.apply());
        this.apply();
      },
      apply() {
        const rows = [...this.$root.querySelectorAll('[data-live="guests"] tbody tr')];
        let shown = 0;
        for (const row of rows) {
          row.hidden = this.filter !== 'all' && row.dataset.status !== this.filter;
          if (!row.hidden) shown++;
        }
        this.$root.querySelector('[data-no-guests]').hidden = shown > 0;
        this.$root.querySelector('.guest-table')?.toggleAttribute('hidden', shown === 0);
      },
      async refresh() {
        swapLive(await fetchPage(location.pathname), ['guests', 'summary']);
        this.apply();
      },
      async decide(button) {
        if (button.disabled) return;
        const action = button.dataset.decide;
        const name = button.closest('tr').querySelector('.guest-name').textContent.trim();
        const error = button.closest('td').querySelector('[data-row-error]');
        button.disabled = true;
        button.closest('tr').setAttribute('aria-busy', 'true');
        try {
          const result = await call('POST', `/api/events/${this.slug}/guests/${button.dataset.guest}`, { action });
          clearAlert(error);
          if (result.ok) {
            const verb = { approve: 'Approved', decline: 'Declined', remove: 'Removed' }[action];
            toasts.show(withPromoted(`${verb} ${name}`, result.data.promoted));
            await this.refresh();
            return;
          }
          if (result.data.error === 'event_full') {
            error.textContent = 'Event is at capacity';
            error.setAttribute('role', 'alert');
            error.hidden = false;
          } else {
            await this.refresh();
          }
        } catch {
          showAlert(error);
        }
        if (button.isConnected) {
          button.disabled = false;
          button.closest('tr').setAttribute('aria-busy', 'false');
        }
      },
      async setRegistration(button) {
        if (button.disabled) return;
        const value = button.dataset.registration;
        button.disabled = true;
        try {
          const result = await call('PATCH', `/api/events/${this.slug}`, { registration_status: value });
          if (!result.ok) throw new Outage();
          toasts.show(value === 'closed' ? 'Registration closed' : 'Registration reopened');
          await this.refresh();
          this.$root.querySelector('[data-registration]')?.focus();
        } catch {
          button.disabled = false;
          showAlert(button.parentElement.querySelector('[data-registration-error]'));
        }
      },
    }));
  });

  document.addEventListener('DOMContentLoaded', () => {
    startClock();
    startScatter();
    startWordCycle();
    document.addEventListener('click', (event) => {
      const button = event.target.closest('[data-follow]');
      if (button) follow(button);
    });
    // On an event page the Registration card decides which carried toast to show.
    if (!document.querySelector('[data-live="card"]')) toasts.show(toasts.takeCarried());
  });
})();
