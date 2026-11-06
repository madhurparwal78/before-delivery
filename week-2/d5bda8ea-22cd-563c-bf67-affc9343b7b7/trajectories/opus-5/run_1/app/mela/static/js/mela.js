/* Mela in the browser: Alpine components and the small bits of motion.
   Every screen already reads correctly without this file. */
(() => {
  'use strict';

  const TIMEOUT_MS = 10000;
  const OUTAGE_TEXT =
    'Mela is taking a short break. Your change was not saved. Please try again in a moment.';
  const ACTIVE = ['pending', 'approved', 'declined', 'waitlisted'];
  const ZONE_OFFSETS = { 'Asia/Kolkata': '+05:30', 'Asia/Tokyo': '+09:00' };
  const THEMES = ['amber', 'harbor', 'moss', 'plum', 'ember', 'night'];
  const HERO_WORDS = ['Joyful', 'Cozy', 'Lively', 'Bright'];
  const TOAST_LIMIT = 3;
  const TOAST_MS = 5000;

  const reduced = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  class Outage extends Error {}

  /* ---------- talking to the API ---------- */

  async function request(method, url, body, headers) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: Object.assign(
          body === undefined ? {} : { 'Content-Type': 'application/json' },
          headers || {}
        ),
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin',
        signal: controller.signal,
      });
    } catch (error) {
      throw new Outage(OUTAGE_TEXT);
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 503) throw new Outage(OUTAGE_TEXT);
    if (response.status === 204) return { ok: true, status: 204, data: {} };
    let data = {};
    try {
      data = await response.json();
    } catch (error) {
      data = {};
    }
    return { ok: response.ok, status: response.status, data };
  }

  function firstFieldError(data) {
    if (data && data.errors) {
      const key = Object.keys(data.errors)[0];
      return { field: key, message: data.errors[key] };
    }
    return null;
  }

  /* ---------- notifications ---------- */

  function toast(text) {
    window.dispatchEvent(new CustomEvent('mela:toast', { detail: text }));
  }

  function queueToast(text) {
    sessionStorage.setItem('mela:toast', text);
  }

  function flushQueuedToast() {
    const text = sessionStorage.getItem('mela:toast');
    if (text) {
      sessionStorage.removeItem('mela:toast');
      toast(text);
    }
  }

  function joinNames(names) {
    if (names.length <= 1) return names.join('');
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }

  function withPromoted(text, promoted) {
    if (!promoted || !promoted.length) return text;
    const names = joinNames(promoted.map((item) => item.name));
    return `${text} · ${names} moved up from the waitlist`;
  }

  /* ---------- wording mirrored from the server ---------- */

  function ordinal(number) {
    const tail = number % 100;
    if (tail === 11 || tail === 12 || tail === 13) return `${number}th`;
    const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[number % 10] || 'th';
    return `${number}${suffix}`;
  }

  function unit(value, singular, plural, pad) {
    const text = pad ? String(value).padStart(2, '0') : String(value);
    return `${text} ${value === 1 ? singular : plural}`;
  }

  function countdownText(startMs, endMs, now) {
    if (now >= endMs) return null;
    let rest = Math.floor((startMs - now) / 1000);
    if (rest <= 0) return 'Happening now';
    const days = Math.floor(rest / 86400);
    rest -= days * 86400;
    const hours = Math.floor(rest / 3600);
    rest -= hours * 3600;
    const minutes = Math.floor(rest / 60);
    const seconds = rest - minutes * 60;
    if (days >= 1) {
      return [
        unit(days, 'day', 'days', false),
        unit(hours, 'hr', 'hrs', true),
        unit(minutes, 'min', 'min', true),
      ].join(' ');
    }
    return [
      unit(hours, 'hr', 'hrs', false),
      unit(minutes, 'min', 'min', true),
      unit(seconds, 'sec', 'sec', true),
    ].join(' ');
  }

  function cardState(ev) {
    if (ev.is_host) return 'host';
    if (Date.parse(ev.end_at) <= Date.now()) return 'past';
    if (ACTIVE.includes(ev.viewer_status)) return ev.viewer_status;
    if (ev.registration_status === 'closed') return 'closed';
    if (ev.registration_status === 'code_only') return 'code_only';
    if (ev.capacity !== null && ev.going_count >= ev.capacity) return 'full';
    return 'open';
  }

  function isFull(ev) {
    return ev.capacity !== null && ev.going_count >= ev.capacity;
  }

  function placesLeftText(ev) {
    if (!isFull(ev)) {
      return ev.places_left === 1 ? '1 place left' : `${ev.places_left} places left`;
    }
    if (ev.waitlist_count) return `Full · ${ev.waitlist_count} waiting`;
    return ev.waitlist ? 'Full · waitlist open' : 'Full';
  }

  /* ---------- celebration ---------- */

  function celebrate(theme, anchor) {
    if (reduced()) return;
    const layer = document.createElement('div');
    layer.className = 'celebration';
    layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);
    const box = anchor ? anchor.getBoundingClientRect() : null;
    const originX = box ? box.left + box.width / 2 : window.innerWidth / 2;
    const originY = box ? box.top + box.height / 2 : window.innerHeight / 3;
    const palettes = {
      night: ['#8ec5ff', '#ffd98a', '#ff93c9', '#ffffff', '#b8f2e6'],
      base: ['#d81b8c', '#f5a524', '#6d4ae0', '#15a05b', '#1552d6'],
    };
    const colours = palettes[theme === 'night' ? 'night' : 'base'];
    const firework = theme === 'night';
    const pieces = 56;
    for (let index = 0; index < pieces; index += 1) {
      const piece = document.createElement('span');
      piece.className = firework ? 'spark' : 'confetto';
      piece.style.background = colours[index % colours.length];
      piece.style.left = `${originX}px`;
      piece.style.top = `${originY}px`;
      layer.appendChild(piece);
      const angle = (index / pieces) * Math.PI * 2 + Math.random();
      const reach = 120 + Math.random() * 260;
      const driftX = Math.cos(angle) * reach;
      const driftY = firework
        ? Math.sin(angle) * reach
        : Math.sin(angle) * reach * 0.4 + window.innerHeight * 0.6;
      piece.animate(
        [
          { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
          {
            transform: `translate(calc(-50% + ${driftX}px), calc(-50% + ${driftY}px)) rotate(${
              Math.random() * 720 - 360
            }deg) scale(${firework ? 0.2 : 0.9})`,
            opacity: 0,
          },
        ],
        { duration: 1600 + Math.random() * 900, easing: 'cubic-bezier(.2,.7,.3,1)' }
      );
    }
    setTimeout(() => layer.remove(), 2800);
  }

  /* ---------- decorations ---------- */

  function startClock() {
    const nodes = document.querySelectorAll('[data-mela-clock]');
    if (!nodes.length) return;
    const paint = () => {
      const now = new Date();
      const minutes = -now.getTimezoneOffset();
      const sign = minutes < 0 ? '-' : '+';
      const hours = Math.floor(Math.abs(minutes) / 60);
      const rest = Math.abs(minutes) % 60;
      const label =
        now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) +
        ` GMT${sign}${hours}` +
        (rest ? `:${String(rest).padStart(2, '0')}` : '');
      nodes.forEach((node) => {
        node.textContent = label;
      });
    };
    paint();
    setInterval(paint, 60000);
  }

  function startCountdowns() {
    const nodes = document.querySelectorAll('[data-mela-countdown]');
    if (!nodes.length) return;
    const tick = () => {
      const now = Date.now();
      nodes.forEach((node) => {
        const value = node.querySelector('[data-mela-countdown-value]');
        const text = countdownText(
          Date.parse(node.dataset.start),
          Date.parse(node.dataset.end),
          now
        );
        if (text === null) {
          node.hidden = true;
        } else if (value) {
          value.textContent = text;
        }
      });
    };
    tick();
    setInterval(tick, 1000);
  }

  function startHeroWords() {
    const node = document.querySelector('[data-mela-hero-word]');
    if (!node || reduced()) return;
    let index = 0;
    setInterval(() => {
      index = (index + 1) % HERO_WORDS.length;
      node.textContent = HERO_WORDS[index];
      node.parentElement.classList.remove('rise');
      void node.parentElement.offsetWidth;
      node.parentElement.classList.add('rise');
    }, 2500);
  }

  function startCoverScatter() {
    const hero = document.querySelector('.hero');
    if (!hero) return;
    const paint = () => {
      const travel = reduced()
        ? 0
        : Math.min(1, window.scrollY / Math.max(1, window.innerHeight));
      hero.style.setProperty('--scatter', String(travel));
    };
    paint();
    window.addEventListener('scroll', paint, { passive: true });
    window.addEventListener('resize', paint);
  }

  /* ---------- Alpine components ---------- */

  document.addEventListener('alpine:init', () => {
    const Alpine = window.Alpine;

    Alpine.data('toastShelf', () => ({
      toasts: [],
      init() {
        window.addEventListener('mela:toast', (event) => this.push(event.detail));
        flushQueuedToast();
      },
      push(text) {
        const item = { id: Date.now() + Math.random(), text, timer: null };
        this.toasts.push(item);
        while (this.toasts.length > TOAST_LIMIT) this.toasts.shift();
        this.resume(item);
      },
      resume(item) {
        this.hold(item);
        item.timer = setTimeout(() => this.dismiss(item), TOAST_MS);
      },
      hold(item) {
        if (item.timer) clearTimeout(item.timer);
        item.timer = null;
      },
      dismiss(item) {
        this.hold(item);
        this.toasts = this.toasts.filter((one) => one.id !== item.id);
      },
    }));

    Alpine.data('accountMenu', () => ({
      open: false,
      toggle() {
        this.open = !this.open;
      },
      close() {
        this.open = false;
        this.$refs.trigger.focus();
      },
      items() {
        return Array.from(this.$refs.menu.querySelectorAll('[role="menuitem"]'));
      },
      move(step) {
        const items = this.items();
        const at = items.indexOf(document.activeElement);
        items[(at + step + items.length) % items.length].focus();
      },
      async signOut() {
        try {
          await request('POST', '/api/auth/signout');
          queueToast('Signed out');
          window.location.assign('/');
        } catch (error) {
          toast(OUTAGE_TEXT);
        }
      },
    }));

    Alpine.data('followButton', () => ({
      following: false,
      label: '',
      slug: '',
      signedIn: false,
      busy: false,
      init() {
        const data = this.$root.dataset;
        this.following = data.following === 'true';
        this.label = data.name;
        this.slug = data.slug;
        this.signedIn = data.signedIn === 'true';
      },
      async toggle() {
        if (!this.signedIn) {
          window.location.assign(
            '/signin?next=' + encodeURIComponent(window.location.pathname)
          );
          return;
        }
        if (this.busy) return;
        this.busy = true;
        const wanted = !this.following;
        try {
          const result = await request(
            wanted ? 'PUT' : 'DELETE',
            `/api/calendars/${this.slug}/follow`
          );
          if (result.ok) {
            this.following = result.data.following;
            const counter = document.querySelector('[data-mela-follower-count]');
            if (counter) counter.textContent = String(result.data.follower_count);
            toast(
              `${this.following ? 'Following' : 'Unfollowed'} ${this.label}`
            );
          }
        } catch (error) {
          toast(OUTAGE_TEXT);
        } finally {
          this.busy = false;
        }
      },
    }));

    Alpine.data('discoverList', (config) => ({
      place: config.place,
      category: config.category,
      cities: config.cities,
      tags: config.tags,
      expanded: false,
      matches(index) {
        const cityName = this.cityName();
        return (
          (cityName === null || this.cities[index] === cityName) &&
          (this.category === null || this.tags[index].includes(this.category))
        );
      },
      cityName() {
        const names = {
          'new-delhi': 'New Delhi',
          gurugram: 'Gurugram',
          noida: 'Noida',
          bengaluru: 'Bengaluru',
          mumbai: 'Mumbai',
          tokyo: 'Tokyo',
        };
        return this.place ? names[this.place] : null;
      },
      matchCount() {
        let total = 0;
        for (let index = 0; index < this.cities.length; index += 1) {
          if (this.matches(index)) total += 1;
        }
        return total;
      },
      visible(index) {
        if (!this.matches(index)) return false;
        if (this.expanded) return true;
        let seen = 0;
        for (let other = 0; other < index; other += 1) {
          if (this.matches(other)) seen += 1;
        }
        return seen < 6;
      },
      choose(kind, value) {
        if (kind === 'place') this.place = this.place === value ? null : value;
        else this.category = this.category === value ? null : value;
        this.expanded = false;
        const params = new URLSearchParams();
        if (this.place) params.set('place', this.place);
        if (this.category) params.set('category', this.category);
        const query = params.toString();
        history.pushState({}, '', query ? `/discover?${query}` : '/discover');
        this.paintLabel();
      },
      paintLabel() {
        const node = document.querySelector('[data-mela-filter-label]');
        if (!node) return;
        const city = this.cityName();
        const tile = this.category
          ? document.querySelector(
              `a[href="/discover?category=${this.category}"] .tile-name`
            )
          : null;
        const categoryName = tile ? tile.textContent.trim() : null;
        if (city && categoryName) node.textContent = `${categoryName} in ${city}`;
        else if (city) node.textContent = city;
        else if (categoryName) node.textContent = categoryName;
        else node.textContent = 'All cities';
      },
      init() {
        window.addEventListener('popstate', () => {
          const params = new URLSearchParams(window.location.search);
          this.place = params.get('place');
          this.category = params.get('category');
          this.expanded = false;
          this.paintLabel();
        });
      },
    }));

    Alpine.data('signInCard', () => ({
      step: 'email',
      email: '',
      name: '',
      password: '',
      failure: '',
      busy: false,
      next: '',
      init() {
        this.next = this.$root.dataset.next || '';
      },
      get buttonLabel() {
        if (this.step === 'email') return 'Continue with Email';
        return this.step === 'new' ? 'Create Account' : 'Sign In';
      },
      async submit() {
        if (this.busy) return;
        this.busy = true;
        this.failure = '';
        try {
          if (this.step === 'email') await this.checkEmail();
          else await this.authenticate();
        } catch (error) {
          this.failure = OUTAGE_TEXT;
        } finally {
          this.busy = false;
        }
      },
      async checkEmail() {
        const result = await request('POST', '/api/auth/check', { email: this.email });
        if (!result.ok) {
          this.failure = 'Incorrect email or password';
          return;
        }
        this.step = result.data.exists ? 'password' : 'new';
        this.$nextTick(() =>
          (this.step === 'new' ? this.$refs.name : this.$refs.password).focus()
        );
      },
      async authenticate() {
        const signup = this.step === 'new';
        const body = signup
          ? { name: this.name, email: this.email, password: this.password }
          : { email: this.email, password: this.password };
        const result = await request(
          'POST',
          signup ? '/api/auth/signup' : '/api/auth/signin',
          body
        );
        if (!result.ok) {
          const field = firstFieldError(result.data);
          this.failure = field ? field.message : 'Incorrect email or password';
          return;
        }
        const target = this.next || '/home';
        const intent = sessionStorage.getItem('mela:intent');
        if (!intent) {
          queueToast(
            signup
              ? `Welcome, ${result.data.user.name.split(' ')[0]}! Your account is ready.`
              : `Signed in as ${result.data.user.name}`
          );
        }
        window.location.assign(target);
      },
    }));

    Alpine.data('eventCard', () => ({
      ev: {},
      state: 'open',
      slug: '',
      signedIn: false,
      busy: false,
      error: '',
      codeOpen: false,
      code: '',
      codeError: '',
      announcement: '',
      ordinal: '',
      movedUp: false,
      showMeter: false,
      message: '',
      reason: 'spam',
      details: '',
      dialogError: '',
      dialogKind: null,
      dialogKey: null,
      init() {
        const data = this.$root.dataset;
        this.ev = JSON.parse(data.event);
        this.state = data.state;
        this.slug = data.slug;
        this.signedIn = data.signedIn === 'true';
        this.ordinal = data.position;
        this.movedUp = data.movedUp === 'true';
        this.showMeter = data.showMeter === 'true';
        this.announcement = '';
        this.rememberOrForget();
        this.runPendingIntent();
      },
      get canSeeAddress() {
        return this.ev.is_host || this.ev.viewer_status === 'approved';
      },
      get street() {
        return this.ev.street_address || '';
      },
      get virtualLink() {
        return this.ev.virtual_link || '';
      },
      get mapsLink() {
        const parts = [this.street, this.ev.city].filter(Boolean).join(', ');
        return parts ? 'geo:0,0?q=' + encodeURIComponent(parts) : '';
      },
      get meterLine() {
        return `${this.ev.going_count} of ${this.ev.capacity} places taken`;
      },
      get placesLeft() {
        return placesLeftText(this.ev);
      },
      get meterPercent() {
        if (!this.ev.capacity) return 0;
        return Math.min(100, (100 * this.ev.going_count) / this.ev.capacity);
      },
      celebrationKey() {
        return `mela:celebrated:${this.slug}`;
      },
      rememberOrForget() {
        if (this.ev.viewer_status === 'approved') {
          if (!localStorage.getItem(this.celebrationKey())) {
            localStorage.setItem(this.celebrationKey(), '1');
            celebrate(this.ev.theme, this.$root.querySelector('.reg-card'));
          }
        } else {
          localStorage.removeItem(this.celebrationKey());
        }
      },
      async runPendingIntent() {
        const raw = sessionStorage.getItem('mela:intent');
        if (!raw || !this.signedIn) return;
        const intent = JSON.parse(raw);
        if (intent.slug !== this.slug) return;
        sessionStorage.removeItem('mela:intent');
        await this.act(intent.action);
      },
      openState() {
        return Array.from(this.$root.querySelectorAll('.card-state')).find(
          (node) => !node.hidden
        );
      },
      cardLine() {
        const state = this.openState();
        if (!state) return '';
        const line = state.querySelector('h3') || state.querySelector('p');
        return line ? line.textContent.trim() : '';
      },
      focusCard() {
        const state = this.openState();
        const control = state && state.querySelector('button, a');
        if (control) control.focus();
        else this.$root.querySelector('.reg-card').focus();
      },
      applyResult(data, toastText) {
        this.ev = data.event;
        this.state = cardState(this.ev);
        this.movedUp = false;
        this.showMeter =
          this.ev.capacity !== null &&
          !['declined', 'closed', 'code_only', 'past'].includes(this.state);
        this.ordinal = this.ev.viewer_waitlist_position
          ? ordinal(this.ev.viewer_waitlist_position)
          : '';
        toast(withPromoted(toastText, data.promoted));
        this.$nextTick(() => {
          this.announcement = this.cardLine();
          this.focusCard();
        });
      },
      async act(action) {
        if (!this.signedIn) {
          sessionStorage.setItem(
            'mela:intent',
            JSON.stringify({ slug: this.slug, action })
          );
          window.location.assign('/signin?next=' + encodeURIComponent('/' + this.slug));
          return;
        }
        if (this.busy) return;
        this.busy = true;
        this.error = '';
        try {
          const cancelling = action === 'cancel';
          const result = await request(
            cancelling ? 'DELETE' : 'POST',
            `/api/events/${this.slug}/register`,
            cancelling ? undefined : {}
          );
          if (!result.ok) {
            this.error = this.refusalText(result.data);
            return;
          }
          const before = this.state;
          this.applyResult(result.data, this.toastFor(action, before, result.data));
          if (result.data.status === 'approved') {
            localStorage.setItem(this.celebrationKey(), '1');
            celebrate(this.ev.theme, this.$root.querySelector('.reg-card'));
          } else {
            localStorage.removeItem(this.celebrationKey());
          }
        } catch (error) {
          this.error = OUTAGE_TEXT;
        } finally {
          this.busy = false;
        }
      },
      toastFor(action, before, data) {
        if (action === 'cancel') {
          if (before === 'pending') return 'Request withdrawn';
          if (before === 'waitlisted') return 'Left the waitlist';
          return 'Registration cancelled';
        }
        if (data.status === 'waitlisted') return 'Added to the waitlist';
        if (data.status === 'pending') return 'Request sent to the host';
        return 'Registered. See you there!';
      },
      refusalText(data) {
        if (data.error === 'event_full') return 'This event just filled up';
        const field = firstFieldError(data);
        if (field) return field.message;
        return 'That change could not be saved';
      },
      openCode() {
        this.codeOpen = true;
        this.$nextTick(() => this.$refs.code.focus());
      },
      async submitCode() {
        if (this.busy) return;
        if (!this.code.trim()) {
          this.codeError = 'Enter your access code';
          return;
        }
        this.busy = true;
        this.codeError = '';
        try {
          const result = await request('POST', `/api/events/${this.slug}/register`, {
            access_code: this.code,
          });
          if (!result.ok) {
            this.codeError =
              result.status === 429
                ? lockoutText(result.data.retry_after)
                : 'That code is not valid';
            return;
          }
          this.codeOpen = false;
          this.code = '';
          this.applyResult(result.data, 'Registered. See you there!');
          localStorage.setItem(this.celebrationKey(), '1');
          celebrate(this.ev.theme, this.$root.querySelector('.reg-card'));
        } catch (error) {
          this.codeError = OUTAGE_TEXT;
        } finally {
          this.busy = false;
        }
      },
      dialogFor(kind) {
        return kind === 'contact' ? this.$refs.contactDialog : this.$refs.reportDialog;
      },
      openDialog(kind) {
        this.dialogKind = kind;
        this.dialogError = '';
        this.dialogKey = newKey();
        this.dialogFor(kind).showModal();
      },
      closeDialog() {
        if (this.dialogKind) this.dialogFor(this.dialogKind).close();
      },
      afterClose() {
        const opener =
          this.dialogKind === 'report' ? this.$refs.reportOpener : this.$refs.contactOpener;
        this.dialogKind = null;
        if (opener) opener.focus();
      },
      async send(kind) {
        if (this.busy) return;
        this.busy = true;
        this.dialogError = '';
        const body =
          kind === 'contact'
            ? { message: this.message }
            : { reason: this.reason, details: this.details };
        try {
          const result = await request(
            'POST',
            `/api/events/${this.slug}/${kind}`,
            body,
            { 'Idempotency-Key': this.dialogKey }
          );
          if (!result.ok) {
            const field = firstFieldError(result.data);
            this.dialogError = field ? field.message : 'That message could not be sent';
            return;
          }
          if (kind === 'contact') this.message = '';
          else this.details = '';
          this.closeDialog();
          toast(
            kind === 'contact'
              ? 'Message sent to the host'
              : 'Report sent. Thank you.'
          );
        } catch (error) {
          this.dialogError = OUTAGE_TEXT;
        } finally {
          this.busy = false;
        }
      },
    }));

    Alpine.data('eventForm', () => ({
      mode: 'create',
      slug: '',
      theme: 'amber',
      name: '',
      description: '',
      startDate: '',
      startTime: '',
      endDate: '',
      endTime: '',
      timezone: 'Asia/Kolkata',
      locationType: 'offline',
      venueName: '',
      streetAddress: '',
      city: '',
      virtualLink: '',
      visibility: 'public',
      requireApproval: false,
      capacity: '',
      waitlist: false,
      calendar: '',
      registrationStatus: 'open',
      hasAccessCode: false,
      errors: {},
      formError: '',
      busy: false,
      dirty: {},
      init() {
        const form = JSON.parse(this.$root.dataset.form);
        this.mode = this.$root.dataset.mode;
        this.slug = this.$root.dataset.slug;
        this.theme = form.theme;
        this.name = form.name;
        this.description = form.description;
        this.startDate = form.start_date;
        this.startTime = form.start_time;
        this.endDate = form.end_date;
        this.endTime = form.end_time;
        this.timezone = form.timezone;
        this.locationType = form.location_type;
        this.venueName = form.venue_name;
        this.streetAddress = form.street_address;
        this.city = form.city;
        this.virtualLink = form.virtual_link;
        this.visibility = form.visibility;
        this.requireApproval = form.require_approval;
        this.capacity = String(form.capacity);
        this.waitlist = form.waitlist;
        this.calendar = form.calendar || '';
        this.registrationStatus = form.registration_status;
        this.hasAccessCode = form.has_access_code;
      },
      mark(field) {
        this.dirty[field] = true;
      },
      shuffleTheme() {
        this.theme = THEMES[(THEMES.indexOf(this.theme) + 1) % THEMES.length];
        this.mark('theme');
      },
      instant(date, time) {
        return `${date}T${time || '00:00'}:00${ZONE_OFFSETS[this.timezone]}`;
      },
      fullBody() {
        return {
          name: this.name,
          description: this.description,
          start_at: this.instant(this.startDate, this.startTime),
          end_at: this.instant(this.endDate, this.endTime),
          timezone: this.timezone,
          location_type: this.locationType,
          venue_name: this.venueName,
          street_address: this.streetAddress,
          city: this.city,
          virtual_link: this.virtualLink,
          visibility: this.visibility,
          require_approval: this.requireApproval,
          capacity: this.capacity.trim() === '' ? null : Number(this.capacity),
          waitlist: this.waitlist,
          theme: this.theme,
          calendar: this.calendar || null,
        };
      },
      changedBody() {
        const full = this.fullBody();
        const body = {};
        Object.keys(this.dirty).forEach((field) => {
          body[field] = full[field];
        });
        return body;
      },
      async submit() {
        if (this.busy) return;
        this.busy = true;
        this.errors = {};
        this.formError = '';
        try {
          const creating = this.mode === 'create';
          const result = await request(
            creating ? 'POST' : 'PATCH',
            creating ? '/api/events' : `/api/events/${this.slug}`,
            creating ? this.fullBody() : this.changedBody()
          );
          if (!result.ok) {
            this.showErrors(result.data);
            return;
          }
          if (creating) {
            queueToast('Your event is live');
            window.location.assign(`/${result.data.slug}`);
            return;
          }
          this.dirty = {};
          toast('Changes saved');
        } catch (error) {
          this.formError = OUTAGE_TEXT;
        } finally {
          this.busy = false;
        }
      },
      showErrors(data) {
        if (data.errors) {
          this.errors = data.errors;
          const unseen = Object.keys(data.errors).filter(
            (key) =>
              ![
                'name',
                'start_at',
                'end_at',
                'city',
                'virtual_link',
                'capacity',
              ].includes(key)
          );
          if (unseen.length) this.formError = data.errors[unseen[0]];
        } else {
          this.formError = 'That change could not be saved';
        }
      },
      async toggleRegistration() {
        if (this.busy) return;
        this.busy = true;
        const closing = this.registrationStatus !== 'closed';
        const wanted = closing ? 'closed' : this.hasAccessCode ? 'code_only' : 'open';
        try {
          const result = await request('PATCH', `/api/events/${this.slug}`, {
            registration_status: wanted,
          });
          if (!result.ok) {
            this.showErrors(result.data);
            return;
          }
          this.registrationStatus = result.data.registration_status;
          toast(closing ? 'Registration closed' : 'Registration reopened');
        } catch (error) {
          this.formError = OUTAGE_TEXT;
        } finally {
          this.busy = false;
        }
      },
    }));

    Alpine.data('guestTable', () => ({
      filter: '',
      rowError: {},
      slug: '',
      busy: false,
      init() {
        this.slug = this.$root.dataset.slug;
        this.filter = new URLSearchParams(window.location.search).get('status') || '';
      },
      apply() {
        const query = this.filter ? `?status=${this.filter}` : '';
        window.location.assign(`/manage/${this.slug}${query}`);
      },
      onClick(event) {
        const button = event.target.closest('[data-mela-action]');
        if (!button) return;
        this.decide(
          Number(button.dataset.melaGuest),
          button.dataset.melaAction,
          button
        );
      },
      async decide(guestId, action, button) {
        if (this.busy) return;
        this.busy = true;
        this.rowError = {};
        const guestName = button.dataset.guestName;
        try {
          const result = await request(
            'POST',
            `/api/events/${this.slug}/guests/${guestId}`,
            { action }
          );
          if (!result.ok) {
            this.rowError = {
              [guestId]:
                result.data.error === 'event_full'
                  ? 'Event is at capacity'
                  : 'That change could not be saved',
            };
            return;
          }
          paintGuestRow(guestId, result.data.status);
          result.data.promoted.forEach((one) => paintGuestRow(one.id, 'approved'));
          paintGuestCounts();
          const words = { approve: 'Approved', decline: 'Declined', remove: 'Removed' };
          toast(withPromoted(`${words[action]} ${guestName}`, result.data.promoted));
        } catch (error) {
          this.rowError = { [guestId]: OUTAGE_TEXT };
        } finally {
          this.busy = false;
        }
      },
    }));
  });

  const STATUS_WORDS = {
    pending: 'Pending',
    approved: 'Going',
    waitlisted: 'Waitlist',
    declined: 'Declined',
  };

  const ROW_ACTIONS = {
    pending: ['approve', 'decline'],
    waitlisted: ['approve', 'decline'],
    approved: ['remove'],
    declined: [],
  };

  function paintGuestRow(guestId, status) {
    const row = document.querySelector(`tr[data-guest-id="${guestId}"]`);
    if (!row) return;
    row.dataset.status = status;
    row.querySelector('.pill-status').textContent = STATUS_WORDS[status];
    const queued = row.querySelector('[data-mela-queue-place]');
    if (queued) queued.hidden = status !== 'waitlisted';
    const cell = row.querySelector('.row-actions');
    const name = row.dataset.guestName;
    cell.querySelectorAll('button').forEach((button) => button.remove());
    const words = { approve: 'Approve', decline: 'Decline', remove: 'Remove' };
    ROW_ACTIONS[status].forEach((action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'quiet-button';
      button.textContent = words[action];
      button.setAttribute('aria-label', `${words[action]} ${name}`);
      button.dataset.guestName = name;
      button.dataset.melaAction = action;
      button.dataset.melaGuest = String(guestId);
      cell.prepend(button);
    });
  }

  function paintGuestCounts() {
    const totals = { pending: 0, approved: 0, waitlisted: 0, declined: 0 };
    document.querySelectorAll('tr[data-guest-id]').forEach((row) => {
      if (row.dataset.status in totals) totals[row.dataset.status] += 1;
    });
    Object.keys(totals).forEach((status) => {
      const node = document.querySelector(`[data-count="${status}"]`);
      if (node) node.textContent = String(totals[status]);
    });
  }

  function newKey() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function lockoutText(retryAfter) {
    const minutes = Math.ceil((retryAfter || 60) / 60);
    return `Too many attempts. Try again in ${
      minutes === 1 ? '1 minute' : `${minutes} minutes`
    }.`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    startClock();
    startCountdowns();
    startHeroWords();
    startCoverScatter();
    document.querySelectorAll('[data-mela-intent]').forEach((button) => {
      button.addEventListener('click', () => {
        const root = button.closest('[data-slug]');
        sessionStorage.setItem(
          'mela:intent',
          JSON.stringify({ slug: root.dataset.slug, action: button.dataset.melaIntent })
        );
      });
    });
  });
})();
