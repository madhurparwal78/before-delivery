/* Mela front-end: toasts, cards, dialogs, forms, celebration and motion. */

(function () {
  'use strict';

  const MELA = window.MELA || {};

  // ---------- Shared helpers ----------

  function reducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  async function api(method, url, body, extraHeaders) {
    const options = {
      method: method,
      headers: Object.assign({'Content-Type': 'application/json'}, extraHeaders || {}),
      credentials: 'same-origin'
    };
    if (body !== undefined) options.body = JSON.stringify(body);
    const controller = new AbortController();
    options.signal = controller.signal;
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, options);
      const text = await response.text();
      let data = null;
      if (text) { try { data = JSON.parse(text); } catch (err) { data = null; } }
      return {ok: response.ok, status: response.status, data: data, headers: response.headers};
    } finally {
      clearTimeout(timeout);
    }
  }

  function outageAlert(control) {
    const region = control.closest('[data-alert-holder]') || control.closest('.reg-card') || control.parentElement;
    let alertEl = region.querySelector('.in-page-alert');
    if (!alertEl) {
      alertEl = document.createElement('p');
      alertEl.className = 'alert-line in-page-alert';
      alertEl.setAttribute('role', 'alert');
      region.appendChild(alertEl);
    }
    alertEl.textContent = 'Mela is taking a short break. Your change was not saved. Please try again in a moment.';
  }

  function clearOutageAlert(scope) {
    (scope || document).querySelectorAll('.in-page-alert').forEach(function (el) { el.remove(); });
  }

  function ordinal(n) {
    n = Number(n);
    const rem100 = n % 100;
    if (rem100 >= 11 && rem100 <= 13) return n + 'th';
    switch (n % 10) { case 1: return n + 'st'; case 2: return n + 'nd'; case 3: return n + 'rd'; }
    return n + 'th';
  }

  function nameJoin(names) {
    if (names.length === 0) return '';
    if (names.length === 1) return names[0];
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }

  // ---------- Toasts (Notifications) ----------

  const Toasts = {
    list: [],
    push(message) {
      const region = document.getElementById('toasts');
      if (!region) return;
      this.list.push({message: message, el: null, timer: null, paused: false});
      if (this.list.length > 3) this.dismiss(this.list[0]);
      const toast = this.list[this.list.length - 1];
      const el = document.createElement('div');
      el.className = 'toast';
      const text = document.createElement('span');
      text.textContent = message;
      const close = document.createElement('button');
      close.type = 'button';
      close.textContent = '×';
      close.setAttribute('aria-label', 'Dismiss notification');
      close.addEventListener('click', () => this.dismiss(toast));
      el.appendChild(text); el.appendChild(close);
      region.appendChild(el);
      toast.el = el;
      el.addEventListener('mouseenter', () => { toast.paused = true; });
      el.addEventListener('focusin', () => { toast.paused = true; });
      el.addEventListener('mouseleave', () => { toast.paused = false; this.arm(toast); });
      el.addEventListener('focusout', () => { toast.paused = false; this.arm(toast); });
      el.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.dismiss(toast); });
      this.arm(toast);
    },
    arm(toast) {
      clearTimeout(toast.timer);
      if (toast.paused) return;
      toast.timer = setTimeout(() => this.dismiss(toast), 5000);
    },
    dismiss(toast) {
      clearTimeout(toast.timer);
      if (toast.el && toast.el.parentNode) toast.el.parentNode.removeChild(toast.el);
      this.list = this.list.filter((t) => t !== toast);
    }
  };

  function promotedSuffix(promoted) {
    if (!promoted || promoted.length === 0) return '';
    return ' · ' + nameJoin(promoted.map((p) => p.name)) + ' moved up from the waitlist';
  }

  // ---------- Celebration ----------

  const Celebration = {
    play(theme) {
      if (reducedMotion()) return;
      const layer = document.getElementById('celebration-layer');
      if (!layer) return;
      layer.classList.add('active');
      const night = theme === 'night';
      const palette = night
        ? ['#9cc4f5', '#f5d76e', '#eaf2fb', '#c98ef5', '#7ef5d7']
        : ['#d61f69', '#f59e0b', '#1a7f4b', '#7c6cd6', '#1d4ed8'];
      const total = night ? 48 : 46;
      const pieces = [];
      const vw = window.innerWidth, vh = window.innerHeight;
      for (let i = 0; i < total; i++) {
        const bit = document.createElement('div');
        bit.className = 'confetti-bit';
        const size = 6 + Math.random() * 6;
        bit.style.width = size + 'px';
        bit.style.height = (night ? size * 0.5 : size * 1.6) + 'px';
        bit.style.background = palette[i % palette.length];
        bit.style.borderRadius = night ? '50%' : '2px';
        layer.appendChild(bit);
        const originX = night ? 50 + (Math.random() * 60 - 30) : 50;
        const originY = night ? 30 : 60;
        pieces.push({
          el: bit,
          x: originX / 100 * vw,
          y: originY / 100 * vh,
          vx: (Math.random() - 0.5) * (night ? 9 : 7),
          vy: night ? -(6 + Math.random() * 6) : -(3 + Math.random() * 4),
          rot: Math.random() * 360,
          vr: (Math.random() - 0.5) * 540
        });
      }
      const start = performance.now();
      const duration = night ? 2600 : 2800;
      function frame(now) {
        const elapsed = now - start;
        const t = elapsed / duration;
        for (const p of pieces) {
          p.vy += night ? 0.05 : 0.13;
          p.x += p.vx;
          p.y += p.vy;
          p.rot += p.vr / 60;
          p.el.style.transform = 'translate(' + p.x + 'px,' + p.y + 'px) rotate(' + p.rot + 'deg)';
          p.el.style.opacity = String(Math.max(0, 1 - t * 0.9));
        }
        if (elapsed < duration) {
          requestAnimationFrame(frame);
        } else {
          layer.classList.remove('active');
          layer.textContent = '';
        }
      }
      requestAnimationFrame(frame);
    }
  };

  // ---------- Local time in the header ----------

  function startClock() {
    const el = document.querySelector('[data-local-time]');
    if (!el) return;
    function update() {
      const now = new Date();
      let hours = now.getHours() % 12; if (hours === 0) hours = 12;
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const meridiem = now.getHours() < 12 ? 'AM' : 'PM';
      const offset = -now.getTimezoneOffset();
      const sign = offset >= 0 ? '+' : '-';
      const abs = Math.abs(offset);
      const oh = String(Math.floor(abs / 60));
      const om = String(abs % 60).padStart(2, '0');
      el.textContent = hours + ':' + minutes + ' ' + meridiem + ' GMT' + sign + oh + ':' + om;
    }
    update();
    setInterval(update, 30000);
  }

  // ---------- Sign out ----------

  function wireSignout() {
    document.addEventListener('click', async function (event) {
      const btn = event.target.closest('[data-signout]');
      if (!btn) return;
      const result = await api('POST', '/api/auth/signout');
      if (result.ok) {
        localStorage.setItem('mela:signedOut', '1');
        Toasts.push('Signed out');
        setTimeout(() => { window.location.href = '/'; }, 350);
      }
    });
  }

  // ---------- Alpine components ----------

  document.addEventListener('alpine:init', function () {

    window.Alpine.data('accountMenu', function () {
      return {
        open: false,
        toggle() { this.open = !this.open; if (this.open) { this.focusFirst(); } else { this.$refs.button.focus(); } },
        close() { if (this.open) { this.open = false; this.$refs.button && this.$refs.button.focus(); } },
        focusFirst() { this.$nextTick(() => { const item = this.$refs.menu.querySelector('a, button'); item && item.focus(); }); },
        next() { this.move(1); },
        prev() { this.move(-1); },
        move(step) {
          const items = Array.from(this.$refs.menu.querySelectorAll('a, button'));
          const index = items.indexOf(document.activeElement);
          const target = items[(index + step + items.length) % items.length];
          target && target.focus();
        }
      };
    });

    window.Alpine.data('followButton', function (args) {
      return {
        following: args.following,
        count: args.count,
        busy: false,
        async toggle() {
          if (!window.MELA || !window.MELA.signedIn) {
            window.location.href = '/signin?next=' + encodeURIComponent(window.location.pathname);
            return;
          }
          if (this.busy) return;
          this.busy = true;
          const method = this.following ? 'DELETE' : 'PUT';
          const result = await api(method, '/api/calendars/' + args.slug + '/follow');
          this.busy = false;
          if (result.status === 503 || !result.ok && result.status >= 500 || result.status === 0) {
            outageAlert(this.$el);
            return;
          }
          if (!result.ok) return;
          this.following = result.data.following;
          this.count = result.data.follower_count;
          document.querySelectorAll('[data-follower-count]').forEach(function (el) {
            el.textContent = result.data.follower_count + (result.data.follower_count === 1 ? ' Follower' : ' Followers');
          });
          Toasts.push(this.following ? 'Following ' + args.name : 'Unfollowed ' + args.name);
        }
      };
    });

    window.Alpine.data('regCard', function (args) {
      return {
        slug: args.slug,
        state: args.state,
        busy: false,
        codeShown: false,
        codeError: '',
        act: async function (action, event) {
          if (!MELA.signedIn) {
            localStorage.setItem('mela:pendingAction', JSON.stringify({slug: this.slug, action: action, at: Date.now()}));
            window.location.href = '/signin?next=' + encodeURIComponent('/' + this.slug);
            return;
          }
          if (this.busy) return;
          this.busy = true;
          const region = document.getElementById('registration');
          region.setAttribute('aria-busy', 'true');
          clearOutageAlert(region);
          let result;
          if (action === 'cancel' || action === 'cancel_request' || action === 'leave_waitlist') {
            result = await api('DELETE', '/api/events/' + this.slug + '/register');
          } else {
            result = await api('POST', '/api/events/' + this.slug + '/register');
          }
          this.busy = false;
          region.removeAttribute('aria-busy');
          if (result.status === 0 || result.status === 503 || result.status >= 500) {
            outageAlert(event.target);
            return;
          }
          if (!result.ok) {
            if (result.status === 409 && result.data && result.data.error === 'event_full') {
              this.announce('This event just filled up');
            }
            return;
          }
          if (result.data.status === 'declined') {
            this.announce('Registration Declined');
            await this.refresh();
            return;
          }
          await this.applyResponse(action, result.data);
        },
        async applyResponse(action, data) {
          const status = data.status;
          const event = data.event;
          this.announce(announcementFor(action, status, event));
          if (status === 'approved') {
            Celebration.play(document.body.dataset.theme);
            localStorage.setItem('mela:lastStatus:' + this.slug, 'approved');
          }
          this.updateGoingCount(event);
          await this.refresh();
          Toasts.push(actionLabel(action) + promotedSuffix(data.promoted));
        },
        announce(text) {
          const el = document.querySelector('[data-announce]');
          if (el) el.textContent = text;
        },
        updateGoingCount(event) {
          const el = document.querySelector('[data-going-count]');
          if (el && typeof event.going_count === 'number') el.textContent = String(event.going_count);
        },
        async refresh() {
          const response = await fetch(window.location.href, {credentials: 'same-origin'});
          if (!response.ok) return;
          const html = await response.text();
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const freshBody = doc.querySelector('[data-card-body]');
          const freshLocation = doc.querySelector('[data-location-row]');
          const freshSection = doc.querySelector('.location-section');
          const body = document.querySelector('[data-card-body]');
          if (freshBody && body) {
            const announce = document.querySelector('[data-announce]');
            const announced = announce ? announce.textContent : '';
            body.innerHTML = freshBody.innerHTML;
            window.Alpine.initTree(body);
            const announceAgain = document.querySelector('[data-announce]');
            if (announceAgain) announceAgain.textContent = announced;
            this.focusCard();
          }
          if (freshLocation) {
            const location = document.querySelector('[data-location-row]');
            if (location) location.innerHTML = freshLocation.innerHTML;
          }
          if (freshSection) {
            const section = document.querySelector('.location-section');
            if (section) section.innerHTML = freshSection.innerHTML;
          }
        },
        focusCard() {
          const card = document.getElementById('registration');
          const control = card && card.querySelector('button, a, [href]');
          if (control) control.focus();
          else if (card) card.focus();
        },
        showCode() {
          this.codeShown = true;
          this.$nextTick(() => this.$refs.code && this.$refs.code.focus());
        },
        async submitCode() {
          const value = (this.$refs.code.value || '').trim();
          if (!value) {
            this.codeError = 'Enter your access code';
            this.$refs.code.setAttribute('aria-invalid', 'true');
            this.$refs.code.focus();
            return;
          }
          if (this.busy) return;
          this.busy = true;
          this.$refs.code.removeAttribute('aria-invalid');
          const result = await api('POST', '/api/events/' + this.slug + '/register', {access_code: value});
          this.busy = false;
          if (result.status === 0 || result.status === 503 || result.status >= 500) {
            outageAlert(this.$refs.code);
            return;
          }
          if (result.status === 429 && result.data && result.data.retry_after) {
            const minutes = Math.ceil(result.data.retry_after / 60);
            this.codeError = 'Too many attempts. Try again in ' +
              (minutes === 1 ? '1 minute' : minutes + ' minutes') + '.';
            this.$refs.code.setAttribute('aria-invalid', 'true');
            this.$refs.code.focus();
            return;
          }
          if (!result.ok) {
            this.codeError = 'That code is not valid';
            this.$refs.code.setAttribute('aria-invalid', 'true');
            this.$refs.code.focus();
            return;
          }
          this.codeError = '';
          this.announce("You're In");
          Celebration.play(document.body.dataset.theme);
          localStorage.setItem('mela:lastStatus:' + this.slug, 'approved');
          await this.refresh();
          Toasts.push('Registered. See you there!' + promotedSuffix(result.data.promoted));
        }
      };
    });

    function announcementFor(action, status, event) {
      if (status === 'approved') return "You're In";
      if (status === 'pending') return 'Pending Approval';
      if (status === 'waitlisted') return 'On the Waitlist';
      if (status === 'cancelled') {
        if (event && event.registration_status === 'closed') return 'Registration Closed';
        if (event && event.require_approval) return 'Approval Required';
        return 'Save your place below.';
      }
      return '';
    }

    function actionLabel(action) {
      switch (action) {
        case 'request': return 'Request sent to the host';
        case 'register': return 'Registered. See you there!';
        case 'waitlist': return 'Added to the waitlist';
        case 'cancel': return 'Registration cancelled';
        case 'cancel_request': return 'Request withdrawn';
        case 'leave_waitlist': return 'Left the waitlist';
      }
      return 'Saved';
    }

    window.Alpine.data('signinFlow', function (args) {
      return {
        step: 'email',
        email: '',
        password: '',
        name: '',
        busy: false,
        error: '',
        async submit() {
          if (this.busy) return;
          this.error = '';
          if (this.step === 'email') {
            if (!this.email.trim()) { this.error = 'Enter your email'; return; }
            this.busy = true;
            const check = await api('POST', '/api/auth/check', {email: this.email.trim()});
            this.busy = false;
            if (check.status === 0 || check.status === 503) { this.error = 'Mela is taking a short break. Please try again in a moment.'; return; }
            if (!check.ok) {
              this.error = 'Enter a valid email';
              return;
            }
            this.step = check.data.exists ? 'password' : 'signup';
            this.$nextTick(() => {
              const focus = check.data.exists ? this.$refs.password : this.$refs.email;
              focus && focus.focus();
              if (!check.data.exists) {
                const nameInput = document.getElementById('name');
                nameInput && nameInput.focus();
              }
            });
            return;
          }
          this.busy = true;
          const isSignup = this.step === 'signup';
          const path = isSignup ? '/api/auth/signup' : '/api/auth/signin';
          const body = isSignup
            ? {name: this.name.trim(), email: this.email.trim(), password: this.password}
            : {email: this.email.trim(), password: this.password};
          const result = await api('POST', path, body);
          this.busy = false;
          if (result.status === 0 || result.status === 503) {
            this.error = 'Mela is taking a short break. Please try again in a moment.';
            return;
          }
          if (!result.ok) {
            if (result.data && result.data.errors) {
              const key = Object.keys(result.data.errors)[0];
              this.error = result.data.errors[key];
            } else if (result.data && result.data.error === 'email_taken') {
              this.error = 'That email is already in use. Sign in instead.';
              this.step = 'password';
            } else {
              this.error = 'Incorrect email or password';
            }
            return;
          }
          const user = result.data.user;
          const pending = localStorage.getItem('mela:pendingAction');
          let toastMessage = isSignup
            ? ('Welcome, ' + user.name.split(' ')[0] + '! Your account is ready.')
            : ('Signed in as ' + user.name);
          let landing = args.next || '/home';
          if (pending) {
            try {
              const action = JSON.parse(pending);
              if (action.slug && action.at > Date.now() - 10 * 60 * 1000) {
                const register = await api('POST', '/api/events/' + action.slug + '/register');
                if (register.ok) {
                  const status = register.data.status;
                  const labels = {
                    approved: 'Registered. See you there!',
                    pending: 'Request sent to the host',
                    waitlisted: 'Added to the waitlist'
                  };
                  toastMessage = labels[status] || toastMessage;
                  if (register.data.promoted && register.data.promoted.length) {
                    toastMessage += promotedSuffix(register.data.promoted);
                  }
                  landing = '/' + action.slug;
                  localStorage.setItem('mela:lastStatus:' + action.slug, status);
                  if (status === 'approved') sessionStorage.setItem('mela:celebrateNow', '1');
                } else if (register.status === 403 && register.data && register.data.error === 'access_code_required') {
                  landing = '/' + action.slug;
                }
              }
              localStorage.removeItem('mela:pendingAction');
            } catch (err) { /* ignore malformed stored action */ }
          }
          sessionStorage.setItem('mela:toast', toastMessage);
          window.location.href = landing;
        }
      };
    });

    window.Alpine.data('citySwitcher', function (args) {
      return {
        open: false,
        city: args.initial,
        cityLabel: cityNames()[args.initial] || args.initial,
        toggle() { this.open = !this.open; },
        close() { this.open = false; },
        choose(slug, name) {
          this.city = slug;
          this.cityLabel = name;
          this.open = false;
          window.dispatchEvent(new CustomEvent('mela:city', {detail: slug}));
        }
      };
    });

    function cityNames() {
      return {
        'new-delhi': 'New Delhi', 'gurugram': 'Gurugram', 'noida': 'Noida',
        'bengaluru': 'Bengaluru', 'mumbai': 'Mumbai', 'tokyo': 'Tokyo'
      };
    }

    window.Alpine.data('landingCity', function (args) {
      return {
        slug: args.initial,
        init() {
          window.addEventListener('mela:city', (event) => this.reload(event.detail));
        },
        async reload(citySlug) {
          const section = document.querySelector('[data-coming-up]');
          if (!section) return;
          section.querySelectorAll('.loading-row').forEach((el) => el.remove());
          const shimmer = document.createElement('div');
          shimmer.className = 'loading-row';
          shimmer.style.gridColumn = '1 / -1';
          section.appendChild(shimmer);
          const query = '/?city=' + encodeURIComponent(citySlug);
          const response = await fetch(query, {credentials: 'same-origin'});
          if (!response.ok) return;
          const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
          const fresh = doc.querySelector('[data-coming-up]');
          if (fresh) section.innerHTML = fresh.innerHTML;
          window.Alpine.initTree(section);
        }
      };
    });

    window.Alpine.data('discover', function (args) {
      return {
        place: args.place || null,
        category: args.category || null,
        showAll: false,
        all: [],
        init() {
          this.load();
          window.addEventListener('popstate', () => {
            const params = new URLSearchParams(window.location.search);
            this.place = params.get('place') || null;
            this.category = params.get('category') || null;
            this.showAll = false;
            this.load();
          });
        },
        async load() {
          const list = document.querySelector('[data-event-list]');
          if (!list) return;
          list.innerHTML = '<li class="loading-row" style="grid-column:1/-1"></li>';
          const params = new URLSearchParams();
          if (this.place) params.set('place', this.place);
          if (this.category) params.set('category', this.category);
          const query = params.toString();
          const response = await fetch('/api/discover' + (query ? '?' + query : ''), {credentials: 'same-origin'});
          if (!response.ok) return;
          const data = await response.json();
          this.all = data.events;
          this.render();
          const url = query ? '/discover?' + query : '/discover';
          if (window.location.pathname + window.location.search !== url) {
            window.history.pushState({}, '', url);
          }
          document.querySelector('[data-filter-label]').textContent = this.label();
        },
        label() {
          const names = cityNames();
          const catNames = categoryNames();
          if (this.place && this.category) return catNames[this.category] + ' in ' + names[this.place];
          if (this.place) return names[this.place];
          if (this.category) return catNames[this.category];
          return 'All cities';
        },
        render() {
          const list = document.querySelector('[data-event-list]');
          const items = this.showAll ? this.all : this.all.slice(0, 6);
          list.innerHTML = '';
          if (items.length === 0) {
            const li = document.createElement('li');
            li.className = 'empty-line';
            li.textContent = 'No upcoming events here yet ';
            const link = document.createElement('a');
            link.className = 'quiet-link';
            link.href = '/discover';
            link.textContent = 'See all cities';
            li.appendChild(link);
            list.appendChild(li);
            return;
          }
          for (const item of items) {
            const li = document.createElement('li');
            li.className = 'event-row';
            const a = document.createElement('a');
            a.className = 'row-link';
            a.href = '/' + item.slug;
            a.innerHTML = '<div class="cover-card cover-' + item.theme + ' cover-sm">' +
              escapeHtml(item.name) + '</div>' +
              '<span class="row-when">' + escapeHtml(formatShort(item)) + '</span>' +
              '<span class="row-title">' + escapeHtml(item.name) + '</span>' +
              '<span class="row-venue">' + escapeHtml(item.venue_name || '') + '</span>';
            li.appendChild(a);
            list.appendChild(li);
          }
        },
        toggleAll() { this.showAll = !this.showAll; this.render(); },
        pickCity(slug) { this.place = this.place === slug ? null : slug; this.load(); },
        pickCategory(slug) { this.category = this.category === slug ? null : slug; this.load(); }
      };
    });

    function categoryNames() {
      return {
        'family': 'Family', 'books': 'Books', 'games': 'Games', 'tech': 'Tech',
        'food-drink': 'Food & Drink', 'ai': 'AI', 'running': 'Running',
        'arts-culture': 'Arts & Culture', 'climate': 'Climate', 'fitness': 'Fitness',
        'wellness': 'Wellness', 'crypto': 'Crypto'
      };
    }

    function escapeHtml(text) {
      return String(text).replace(/[&<>"']/g, function (ch) {
        return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch];
      });
    }

    function formatShort(item) {
      return new Date(item.start_at).toLocaleString('en-US', {
        timeZone: item.timezone || undefined,
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit'
      });
    }

    window.Alpine.data('homeTabs', function (args) {
      return {
        tab: args.tab || 'upcoming',
        pick(tab) {
          this.tab = tab;
          const panels = this.$el.querySelectorAll('[role="tabpanel"]');
          panels.forEach((panel) => { panel.hidden = panel.getAttribute('aria-labelledby') !== 'tab-' + tab; });
          const url = new URL(window.location);
          url.searchParams.set('tab', tab);
          window.history.replaceState({}, '', url);
        }
      };
    });

    window.Alpine.data('contactDialog', function (args) {
      return {
        open: false, message: '', error: '', fieldError: '', busy: false,
        key: null, returnFocus: null,
        async openDialog(trigger) { /* handled below */ },
        show(trigger) {
          if (!MELA.signedIn) {
            window.location.href = '/signin?next=' + encodeURIComponent(window.location.pathname);
            return;
          }
          this.returnFocus = trigger;
          this.open = true;
          this.key = randomKey();
          this.$nextTick(() => this.$refs.first.focus());
        },
        close() {
          this.open = false;
          if (this.returnFocus) this.returnFocus.focus();
        },
        trap(event) { trapFocus(event, this.$el); },
        async send() {
          if (this.busy) return;
          const text = this.message.trim();
          if (!text) { this.fieldError = 'Write a message first'; return; }
          this.busy = true;
          this.error = '';
          this.fieldError = '';
          const result = await api('POST', '/api/events/' + args.slug + '/contact',
            {message: text}, {'Idempotency-Key': this.key});
          this.busy = false;
          if (result.status === 0 || result.status === 503 || result.status >= 500) {
            this.error = 'Mela is taking a short break. Your change was not saved. Please try again in a moment.';
            return;
          }
          if (!result.ok) {
            if (result.data && result.data.errors && result.data.errors.message) {
              this.fieldError = result.data.errors.message;
            } else if (result.data && result.data.errors && result.data.errors.idempotency_key) {
              this.error = result.data.errors.idempotency_key;
            } else {
              this.error = 'Something went wrong. Please try again.';
            }
            return;
          }
          Toasts.push('Message sent to the host');
          this.message = '';
          this.close();
        }
      };
    });

    window.Alpine.data('reportDialog', function (args) {
      return {
        open: false, reason: 'spam', details: '', error: '', fieldError: '', busy: false,
        key: null, returnFocus: null,
        show(trigger) {
          if (!MELA.signedIn) {
            window.location.href = '/signin?next=' + encodeURIComponent(window.location.pathname);
            return;
          }
          this.returnFocus = trigger;
          this.open = true;
          this.key = randomKey();
          this.$nextTick(() => this.$refs.first.focus());
        },
        close() {
          this.open = false;
          if (this.returnFocus) this.returnFocus.focus();
        },
        trap(event) { trapFocus(event, this.$el); },
        async send() {
          if (this.busy) return;
          this.busy = true;
          this.error = '';
          this.fieldError = '';
          const result = await api('POST', '/api/events/' + args.slug + '/report',
            {reason: this.reason, details: this.details},
            {'Idempotency-Key': this.key});
          this.busy = false;
          if (result.status === 0 || result.status === 503 || result.status >= 500) {
            this.error = 'Mela is taking a short break. Your change was not saved. Please try again in a moment.';
            return;
          }
          if (!result.ok) {
            if (result.data && result.data.errors) {
              const first = Object.keys(result.data.errors)[0];
              this.fieldError = result.data.errors[first];
            } else {
              this.error = 'Something went wrong. Please try again.';
            }
            return;
          }
          Toasts.push('Report sent. Thank you.');
          this.details = '';
          this.close();
        }
      };
    });

    window.Alpine.data('eventForm', function (args) {
      return {
        theme: 'amber',
        name: '',
        calendar: '',
        visibility: 'public',
        startDate: '', startTime: '18:00',
        endDate: '', endTime: '21:00',
        timezone: 'Asia/Kolkata',
        locationType: 'offline',
        venueName: '', streetAddress: '', city: '',
        virtualLink: '', description: '',
        requireApproval: false, capacity: '', waitlist: false,
        errors: {},
        busy: false,
        followed: args.followed || [],
        themes: ['amber', 'harbor', 'moss', 'plum', 'ember', 'night'],
        themeIndex: 0,
        changed: {},
        init() {
          const order = ['amber', 'harbor', 'moss', 'plum', 'ember', 'night'];
          this.themeIndex = order.indexOf(this.theme);
        },
        shuffleTheme() {
          this.themeIndex = (this.themeIndex + 1) % this.themes.length;
          this.theme = this.themes[this.themeIndex];
        },
        touch(field) { this.changed[field] = true; },
        payload() {
          const body = {
            theme: this.theme,
            name: this.name,
            calendar: this.calendar || null,
            visibility: this.visibility,
            start_at: this.startDate + 'T' + this.startTime + ':00+05:30',
            end_at: this.endDate + 'T' + this.endTime + ':00+05:30',
            timezone: this.timezone,
            location_type: this.locationType,
            require_approval: this.requireApproval,
            waitlist: this.waitlist,
            description: this.description
          };
          if (this.locationType === 'offline') {
            body.venue_name = this.venueName;
            body.street_address = this.streetAddress;
            body.city = this.city || null;
          } else {
            body.virtual_link = this.virtualLink;
          }
          body.capacity = this.capacity === '' ? null : Number(this.capacity);
          return body;
        },
        validateLocal() {
          const errors = {};
          if (!this.name.trim()) errors.name = 'Name is required';
          if (!this.startDate || !this.startTime) errors.start_at = 'Choose a start date and time';
          if (!this.endDate || !this.endTime) errors.end_at = 'Choose an end date and time';
          if (this.locationType === 'offline' && !this.city) errors.city = 'City is required for an offline event';
          if (this.locationType === 'virtual' && !this.virtualLink.startsWith('https://')) {
            errors.virtual_link = 'Virtual link must start with https://';
          }
          if (this.capacity !== '' && this.capacity !== null) {
            const value = Number(this.capacity);
            if (!Number.isInteger(value) || value < 1 || value > 10000) {
              errors.capacity = 'Capacity must be a whole number from 1 to 10,000, or empty for unlimited';
            }
          }
          this.errors = errors;
          return Object.keys(errors).length === 0;
        },
        async submit() {
          if (this.busy) return;
          if (!this.validateLocal()) return;
          this.busy = true;
          this.errors = {};
          const result = await api('POST', '/api/events', this.payload());
          this.busy = false;
          if (result.status === 0 || result.status === 503 || result.status >= 500) {
            outageAlert(this.$el.querySelector('button[type="submit"]'));
            return;
          }
          if (!result.ok) {
            if (result.data && result.data.errors) this.errors = result.data.errors;
            return;
          }
          sessionStorage.setItem('mela:toast', 'Your event is live');
          window.location.href = '/' + result.data.slug;
        }
      };
    });

    window.Alpine.data('managePage', function (args) {
      return {
        slug: args.slug,
        registrationStatus: args.registrationStatus,
        guests: [],
        filter: '',
        busy: false,
        busyId: null,
        errors: {},
        rowErrors: {},
        followed: args.followed || [],
        name: '', theme: 'amber', calendar: '', visibility: 'public',
        startDate: '', startTime: '', endDate: '', endTime: '',
        timezone: 'Asia/Kolkata', locationType: 'offline',
        venueName: '', streetAddress: '', city: '', virtualLink: '',
        description: '', requireApproval: false, capacity: '', waitlist: false,
        changed: {},
        themes: ['amber', 'harbor', 'moss', 'plum', 'ember', 'night'],
        init() {
          const initial = args.initial || {};
          this.name = initial.name || '';
          this.theme = initial.theme || 'amber';
          this.calendar = initial.calendar || '';
          this.visibility = initial.visibility || 'public';
          this.startDate = initial.startDate || '';
          this.startTime = initial.startTime || '';
          this.endDate = initial.endDate || '';
          this.endTime = initial.endTime || '';
          this.timezone = initial.timezone || 'Asia/Kolkata';
          this.locationType = initial.locationType || 'offline';
          this.venueName = initial.venueName || '';
          this.streetAddress = initial.streetAddress || '';
          this.city = initial.city || '';
          this.virtualLink = initial.virtualLink || '';
          this.description = initial.description || '';
          this.requireApproval = !!initial.requireApproval;
          this.capacity = initial.capacity === undefined ? '' : initial.capacity;
          this.waitlist = !!initial.waitlist;
          this.loadGuests();
        },
        shuffleTheme() {
          const index = this.themes.indexOf(this.theme);
          this.theme = this.themes[(index + 1) % this.themes.length];
          this.touch('theme');
        },
        ordinal(n) { return ordinal(n); },
        labelFor(status) {
          return {pending: 'Pending', approved: 'Going', waitlisted: 'Waitlist', declined: 'Declined'}[status] || status;
        },
        pillFor(status) {
          return {pending: 'pending', approved: 'going', waitlisted: 'waitlist', declined: 'declined'}[status] || status;
        },
        touch(field) { this.changed[field] = true; },
        async loadGuests() {
          const query = this.filter ? '?status=' + this.filter : '';
          const response = await fetch('/api/events/' + this.slug + '/guests' + query, {credentials: 'same-origin'});
          if (!response.ok) return;
          const data = await response.json();
          this.guests = data.map((g) => Object.assign({}, g, {
            requested: formatRequested(g.requested_at, window.MELA && window.MELA.timezone)
          }));
        },
        applyFilter() { this.loadGuests(); },
        errorFor(id) { return this.rowErrors[id] || ''; },
        async decide(id, action) {
          if (this.busyId) return;
          this.busyId = id;
          this.rowErrors = {};
          const result = await api('POST', '/api/events/' + this.slug + '/guests/' + id, {action: action});
          this.busyId = null;
          if (result.status === 0 || result.status === 503 || result.status >= 500) {
            this.rowErrors[id] = 'Mela is taking a short break. Please try again in a moment.';
            return;
          }
          if (!result.ok) {
            const messages = {event_full: 'Event is at capacity', invalid_transition: 'That change is not allowed'};
            this.rowErrors[id] = (result.data && messages[result.data.error]) || 'Something went wrong';
            return;
          }
          const guest = this.guests.find((g) => g.id === id);
          const name = guest ? guest.name : '';
          const labels = {approve: 'Approved', decline: 'Declined', remove: 'Removed'};
          Toasts.push(labels[action] + ' ' + name + promotedSuffix(result.data.promoted));
          await this.loadGuests();
          this.updateCounts(result.data.event);
        },
        updateCounts(event) {
          const el = document.querySelector('[data-count-going]');
          if (el) el.textContent = event.going_count;
          const waitEl = document.querySelector('[data-count-waitlist]');
          if (waitEl) waitEl.textContent = event.waitlist_count;
        },
        editPayload() {
          const body = {};
          const offset = this.timezone === 'Asia/Tokyo' ? '+09:00' : '+05:30';
          const values = {
            theme: this.theme,
            name: this.name,
            calendar: this.calendar || null,
            visibility: this.visibility,
            timezone: this.timezone,
            location_type: this.locationType,
            require_approval: this.requireApproval,
            waitlist: this.waitlist,
            description: this.description,
            start_at: this.startDate && this.startTime ? this.startDate + 'T' + this.startTime + ':00' + offset : undefined,
            end_at: this.endDate && this.endTime ? this.endDate + 'T' + this.endTime + ':00' + offset : undefined
          };
          for (const field of Object.keys(this.changed)) {
            if (values[field] !== undefined) body[field] = values[field];
          }
          if (this.changed.venue_name !== undefined) body.venue_name = this.venueName;
          if (this.changed.street_address !== undefined) body.street_address = this.streetAddress;
          if (this.changed.city !== undefined) body.city = this.city;
          if (this.changed.virtual_link !== undefined) body.virtual_link = this.virtualLink;
          if (this.changed.capacity !== undefined) {
            body.capacity = this.capacity === '' ? null : Number(this.capacity);
          }
          if (Object.keys(body).length === 0) body.name = this.name;
          return body;
        },
        async save() {
          if (this.busy) return;
          this.busy = true;
          this.errors = {};
          const result = await api('PATCH', '/api/events/' + this.slug, this.editPayload());
          this.busy = false;
          if (result.status === 0 || result.status === 503 || result.status >= 500) {
            outageAlert(this.$el.querySelector('button[type="submit"]'));
            return;
          }
          if (!result.ok) {
            if (result.data && result.data.errors) this.errors = result.data.errors;
            return;
          }
          this.changed = {};
          Toasts.push('Changes saved');
        },
        async toggleRegistration() {
          if (this.busy) return;
          this.busy = true;
          const target = this.registrationStatus === 'closed'
            ? (window.MELA && window.MELA.codeOnly ? 'code_only' : 'open') : 'closed';
          const result = await api('PATCH', '/api/events/' + this.slug, {registration_status: target});
          this.busy = false;
          if (result.status === 0 || result.status === 503 || result.status >= 500) {
            outageAlert(this.$el.querySelector('.quiet-btn'));
            return;
          }
          if (!result.ok) {
            if (result.data && result.data.errors) this.errors = result.data.errors;
            return;
          }
          this.registrationStatus = target;
          Toasts.push(target === 'closed' ? 'Registration closed' : 'Registration reopened');
        }
      };
    });
  });

  function randomKey() {
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let out = '';
    for (let i = 0; i < 22; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
    return out;
  }

  function trapFocus(event, container) {
    const focusables = Array.from(container.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
    )).filter((el) => el.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function formatRequested(iso, timeZone) {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: timeZone || undefined,
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  }

  // ---------- Card dialog triggers ----------

  function wireDialogTriggers() {
    document.querySelectorAll('[data-contact-link]').forEach(function (link) {
      link.addEventListener('click', function (event) {
        event.preventDefault();
        const host = document.querySelector('[x-data^="contactDialog"]');
        if (!host) return;
        const component = window.Alpine.$data(host);
        if (component && component.show) component.show(link);
      });
    });
    document.querySelectorAll('[data-report-link]').forEach(function (link) {
      link.addEventListener('click', function (event) {
        event.preventDefault();
        const host = document.querySelector('[x-data^="reportDialog"]');
        if (!host) return;
        const component = window.Alpine.$data(host);
        if (component && component.show) component.show(link);
      });
    });
  }

  // ---------- Countdown ----------

  function startCountdown() {
    const el = document.querySelector('[data-countdown]');
    if (!el) return;
    const start = new Date(el.dataset.start).getTime();
    const end = new Date(el.dataset.end).getTime();
    function tick() {
      const now = Date.now();
      if (now >= end) { el.closest('.countdown').style.display = 'none'; return; }
      if (now >= start) { el.textContent = 'Happening now'; el.closest('.countdown').textContent = 'Happening now'; return; }
      let seconds = Math.floor((start - now) / 1000);
      el.dataset.seconds = String(seconds);
      const days = Math.floor(seconds / 86400);
      seconds -= days * 86400;
      const hours = Math.floor(seconds / 3600);
      seconds -= hours * 3600;
      const minutes = Math.floor(seconds / 60);
      seconds -= minutes * 60;
      let text;
      if (days > 0) {
        text = days + (days === 1 ? ' day ' : ' days ') + pad(hours) + ' hrs ' + pad(minutes) + ' min';
      } else if (hours > 0) {
        text = hours + (hours === 1 ? ' hr ' : ' hrs ') + pad(minutes) + ' min ' + pad(seconds) + ' sec';
      } else {
        text = minutes + ' min ' + pad(seconds) + ' sec';
      }
      el.textContent = text;
    }
    function pad(n) { return String(n).padStart(2, '0'); }
    tick();
    setInterval(tick, 1000);
  }

  // ---------- Hero word cycle and cover scatter ----------

  function startHero() {
    const word = document.querySelector('[data-hero-word]');
    if (!word) return;
    const words = ['Joyful', 'Cozy', 'Lively', 'Bright'];
    if (reducedMotion()) { word.textContent = 'Joyful'; return; }
    let index = 0;
    setInterval(function () {
      index = (index + 1) % words.length;
      word.textContent = words[index];
      word.style.animation = 'none';
      void word.offsetWidth;
      word.style.animation = 'rise-in 0.6s cubic-bezier(0.2,0.7,0.3,1)';
    }, 2500);

    const covers = document.querySelectorAll('.cover-float');
    if (covers.length === 0) return;
    function scatter() {
      if (reducedMotion()) return;
      const progress = Math.min(1, window.scrollY / window.innerHeight);
      covers.forEach(function (cover, i) {
        const angle = (i / covers.length) * Math.PI * 2;
        const distance = 0.34 * progress;
        const dx = Math.cos(angle) * distance * 100;
        const dy = Math.sin(angle) * distance * 60;
        cover.style.transform = 'rotate(' + (cover.dataset.tilt || 0) + 'deg) translate(' +
          dx + 'px,' + dy + 'px)';
        cover.style.opacity = String(1 - 0.5 * progress);
      });
      if (progress <= 0) requestAnimationFrame(scatterIdle);
    }
    function scatterIdle() { /* nothing; next scroll retriggers */ }
    window.addEventListener('scroll', scatter, {passive: true});
    covers.forEach(function (cover) {
      cover.dataset.tilt = getComputedStyle(cover).getPropertyValue('--cover-tilt').trim();
    });
  }

  // ---------- Boot ----------

  window.addEventListener('DOMContentLoaded', function () {
    startClock();
    wireSignout();
    startCountdown();
    startHero();
    wireDialogTriggers();

    const toast = sessionStorage.getItem('mela:toast');
    if (toast) {
      sessionStorage.removeItem('mela:toast');
      Toasts.push(toast);
    }

    // The celebration after returning from sign-in with a completed registration.
    if (sessionStorage.getItem('mela:celebrateNow')) {
      sessionStorage.removeItem('mela:celebrateNow');
      setTimeout(function () { Celebration.play(document.body.dataset.theme); }, 250);
    }

    // One celebration per confirmed place, seen for the first time.
    if (MELA.eventSlug && MELA.signedIn) {
      const key = 'mela:lastStatus:' + MELA.eventSlug;
      const previous = localStorage.getItem(key);
      if (MELA.viewerStatus === 'approved' && previous !== 'approved') {
        setTimeout(function () { Celebration.play(document.body.dataset.theme); }, 250);
      }
      localStorage.setItem(key, MELA.viewerStatus || 'none');
    }
  });
})();
