/* Twohouse browser app: framework-free, shows the server's answers only. */
(() => {
  'use strict';
  const $app = document.getElementById('app');
  if (!$app) return;
  const TOKEN_KEY = 'twohouse_token';
  const token = () => localStorage.getItem(TOKEN_KEY);

  const state = {
    me: null,
    yearDoc: null,
    year: new Date().getFullYear(),
    tonight: null,
    requests: { waiting: [], sent: [] },
    costs: { items: [] },
    statement: null,
    records: { items: [] },
    links: { items: [] },
    notices: { items: [], mail: 'ok' },
    log: { items: [] },
    plan: { versions: [] },
    month: new Date().getMonth(),
  };

  // ---- formatting: the interface's words, the server's forms ----
  const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; }
  function dowOf(y, m, d) { const j = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); return j === 0 ? 7 : j; }
  function screenDate(s) { const { y, m, d } = parseYmd(s); return `${WD[dowOf(y, m, d) - 1]} ${d} ${MO[m - 1]} ${y}`; }
  function money(minor, currency, exp) {
    const neg = minor < 0; const abs = Math.abs(minor);
    const digits = String(abs).padStart(exp + 1, '0');
    const whole = exp > 0 ? digits.slice(0, -exp) : digits;
    const frac = exp > 0 ? ',' + digits.slice(-exp) : '';
    const groups = [];
    for (let i = whole.length; i > 0; i -= 3) groups.unshift(whole.slice(Math.max(0, i - 3), i));
    return (neg ? '\u2212' : '') + groups.join('\u202f') + frac + ' ' + currency;
  }
  function instantScreen(iso, zone) {
    const m = /^(.{10})T(.{5})/.exec(iso);
    return m ? `${m[2]} on ${screenDate(m[1])} (${zone || ''})` : iso;
  }
  function intervalScreen(iv) {
    const [a, b] = iv.split('/');
    return `${screenDate(a)} until ${screenDate(b)}`;
  }
  const KIND_WORDS = { swap: 'Swap', holiday: 'Holiday', school_break: 'School break', vacation: 'Vacation', base: 'Base rotation' };
  const STATE_WORDS = { draft: 'Draft', sent: 'Waiting for an answer', accepted: 'Accepted', declined: 'Declined', lapsed: 'Lapsed', withdrawn: 'Withdrawn', settled: 'Settled' };
  const RECORD_WORDS = { requested: 'Queued', rendering: 'Being made', stored: 'Ready', failed: 'Failed', cancelled: 'Cancelled' };
  const CAT_WORDS = { medical: 'Medical', school: 'School', activities: 'Activities', child_care: 'Childcare', clothing: 'Clothing', other: 'Other' };
  const NOTICE_WORDS = { queued: 'Waiting to send', sent: 'Sent', superseded: 'Replaced' };

  async function api(path, opts = {}) {
    const headers = {};
    if (token()) headers['Authorization'] = 'Bearer ' + token();
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.method && opts.method !== 'GET') headers['Origin'] = location.origin;
    const res = await fetch('/api' + path, { ...opts, headers });
    if (res.status === 401 && !['/session', '/households', '/join'].some((p) => path.startsWith(p))) {
      const next = encodeURIComponent(location.pathname + location.search);
      location.href = '/?next=' + next;
      throw new Error('unauthenticated');
    }
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    return { status: res.status, ok: res.ok, body, headers: res.headers };
  }
  function announce(text) {
    const act = document.getElementById('activity');
    if (act) { act.textContent = ''; requestAnimationFrame(() => { act.textContent = text; }); }
  }
  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ---- shell ----
  function shell(inner, nav = true) {
    $app.innerHTML = `
      ${nav && state.me ? householdNav() : ''}
      <div class="status-activity" id="activity" role="status" aria-label="Activity"></div>
      <main class="page">${inner}</main>`;
  }
  function householdNav() {
    const waiting = state.requests.waiting.length;
    return `
      <nav class="household" aria-label="Household">
        <a class="wordmark" href="/calendar" data-nav>Twohouse</a>
        <a href="/calendar" data-nav>Calendar</a>
        <a href="/plan" data-nav>Plan</a>
        <a href="/requests" data-nav>Requests<span class="count" aria-hidden="true">${waiting}</span></a>
        <a href="/costs" data-nav>Costs</a>
        <a href="/records" data-nav>Records</a>
        <span class="spacer"></span>
        <button id="signout">Sign out</button>
      </nav>`;
  }
  document.addEventListener('click', async (e) => {
    const a = e.target.closest('a[data-nav]');
    if (a) { e.preventDefault(); history.pushState(null, '', a.getAttribute('href')); route(); return; }
    if (e.target.id === 'signout') {
      await api('/session', { method: 'DELETE' });
      localStorage.removeItem(TOKEN_KEY);
      location.href = '/';
    }
  });
  window.addEventListener('popstate', () => route());

  // ---- router ----
  const PRIVATE = ['/calendar', '/plan', '/requests', '/costs', '/records'];
  async function route() {
    const path = location.pathname;
    if ((path === '/' || path === '/start') && token()) { location.href = '/calendar'; return; }
    if (PRIVATE.includes(path) && !token()) {
      location.replace('/?next=' + encodeURIComponent(path + location.search));
      return;
    }
    if (token()) await loadMe();
    if (path === '/') return renderSignIn();
    if (path === '/start') return renderStart();
    if (path.startsWith('/join/')) return renderJoin(path.split('/')[2]);
    if (path.startsWith('/share/')) return renderSharePage(path.split('/')[2]);
    if (path === '/calendar') return renderCalendar();
    const screens = window.twohouseScreens;
    if (path === '/requests') return screens.renderRequests(state);
    if (path === '/plan') return screens.renderPlan(state);
    if (path === '/costs') return screens.renderCosts(state);
    if (path === '/records') return screens.renderRecords(state);
    return renderNotFound();
  }
  async function loadMe() {
    if (!token()) return;
    const res = await api('/me');
    if (res.status === 401) { localStorage.removeItem(TOKEN_KEY); return; }
    state.me = res.body;
  }

  // ---- sign in ----
  async function renderSignIn() {
    const next = new URLSearchParams(location.search).get('next');
    shell(`
      <section class="hero"><div class="fields"><div class="field mint"></div><div class="field pink"></div></div>
        <div class="headline"><h1>Two houses. One plan.</h1></div></section>
      <section class="card signin-card">
        <h2>Sign in</h2>
        <form id="signin">
          <label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email">
          <label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password">
          <div class="dialog-actions"><button class="green" type="submit">Sign in</button></div>
          <p class="error" id="signin-error" role="alert"></p>
        </form>
        <p><a href="/start" data-nav>Start a household</a></p>
      </section>`);
    document.getElementById('signin').addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await api('/session', { method: 'POST', body: JSON.stringify({
        email: document.getElementById('email').value,
        password: document.getElementById('password').value,
      }) });
      if (!res.ok) {
        document.getElementById('signin-error').textContent =
          res.body.code === 'too_many_attempts'
            ? `Too many tries. Try again in ${res.headers.get('retry-after') || 1} seconds.`
            : "That email and password don't match.";
        return;
      }
      localStorage.setItem(TOKEN_KEY, res.body.token);
      location.href = allowedNext(next);
    });
  }
  function allowedNext(next) {
    if (!next) return '/calendar';
    try {
      const u = new URL(next, location.origin);
      if (u.origin !== location.origin) return '/calendar';
      if (!PRIVATE.includes(u.pathname)) return '/calendar';
      return u.pathname + u.search;
    } catch { return '/calendar'; }
  }

  async function renderStart() {
    shell(`
      <section class="hero"><div class="fields"><div class="field mint"></div><div class="field pink"></div></div>
        <div class="headline"><h1>Start a household</h1></div></section>
      <section class="card start-card">
        <h2>Start a household</h2>
        <form id="start">
          <label for="hh">Household name</label><input id="hh" name="householdName">
          <label for="cur">Currency</label><input id="cur" name="currency">
          <label for="yn">Your name</label><input id="yn" name="yourName">
          <label for="ye">Your email</label><input id="ye" name="email" type="email">
          <label for="pw">Password</label><input id="pw" name="password" type="password">
          <label for="on">Other parent's name</label><input id="on" name="otherParentName">
          <label for="oe">Other parent's email</label><input id="oe" name="otherParentEmail" type="email">
          <div class="dialog-actions"><button class="green" type="submit">Create household</button></div>
          <p class="error" id="start-error" role="alert"></p>
        </form>
      </section>`);
    document.getElementById('start').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const res = await api('/households', { method: 'POST', body: JSON.stringify({
        householdName: f.householdName.value, currency: f.currency.value,
        yourName: f.yourName.value, email: f.email.value, password: f.password.value,
        otherParentName: f.otherParentName.value, otherParentEmail: f.otherParentEmail.value,
      }) });
      if (!res.ok) {
        const errs = Object.values(res.body.errors || {});
        document.getElementById('start-error').textContent = errs.length ? errs.join(' ') : 'Something went wrong. Try again.';
        return;
      }
      localStorage.setItem(TOKEN_KEY, res.body.token);
      announce('Household created. Enter your plan.');
      location.href = '/plan';
    });
  }

  async function renderJoin(joinToken) {
    const res = await fetch('/api/join/' + joinToken);
    const info = await res.json();
    if (!res.ok) {
      shell(`<section class="card"><h1>This link no longer works.</h1></section>`);
      return;
    }
    shell(`
      <section class="card join-card">
        <h2>Join ${esc(info.householdName)}</h2>
        <p>${esc(info.otherParentName)}</p>
        <form id="join">
          <label for="pw">Password</label><input id="pw" name="password" type="password">
          <div class="dialog-actions"><button class="green" type="submit">Join household</button></div>
          <p class="error" id="join-error" role="alert"></p>
        </form>
      </section>`);
    document.getElementById('join').addEventListener('submit', async (e) => {
      e.preventDefault();
      const r = await api('/join', { method: 'POST', body: JSON.stringify({
        token: joinToken, password: document.getElementById('pw').value,
      }) });
      if (!r.ok) {
        if (r.body.code === 'not_found') { shell(`<section class="card"><h1>This link no longer works.</h1></section>`); return; }
        document.getElementById('join-error').textContent = Object.values(r.body.errors || {}).join(' ') || 'Something went wrong. Try again.';
        return;
      }
      localStorage.setItem(TOKEN_KEY, r.body.token);
      location.href = '/calendar';
    });
  }

  async function renderSharePage(tokenId) {
    let year = new URLSearchParams(location.search).get('year');
    if (!year || !/^\d{4}$/.test(year) || Number(year) < 2000 || Number(year) > 2100) {
      year = String(new Date().getFullYear());
      const url = new URL(location.href);
      url.searchParams.set('year', year);
      history.replaceState(null, '', url);
    }
    const res = await fetch(`/api/share/${tokenId}?year=${year}`);
    if (!res.ok) {
      shell(`<section class="card"><h1>This link no longer works.</h1></section>`, false);
      return;
    }
    const d = await res.json();
    shell(`
      <section class="card">
        <h1>${esc(d.householdName)}: handovers in ${d.year}</h1>
        <p>Year digest <span class="digest">${esc(d.yearDigest)}</span></p>
        <p>
          <a href="/share/${esc(tokenId)}?year=${Number(d.year) - 1}" data-nav>Previous year</a>
          <a href="/share/${esc(tokenId)}?year=${Number(d.year) + 1}" data-nav>Next year</a>
        </p>
        <h2>Handovers</h2>
        <ul class="plain" aria-label="Handovers">
          ${d.handovers.map((h) => `<li>${esc(screenDate(h.date))} ${esc(h.exchangeAt.slice(11, 16))} (${esc(h.zone)}): ${esc(h.from)} to ${esc(h.to)}</li>`).join('')}
        </ul>
      </section>`, false);
  }

  function renderNotFound() {
    $app.innerHTML = `<main class="notfound"><div class="card"><h1>We couldn't find that page.</h1></div></main>`;
  }

  // ---- Calendar ----
  async function renderCalendar() {
    const yearParam = new URLSearchParams(location.search).get('year');
    if (yearParam && /^\d{4}$/.test(yearParam)) state.year = Number(yearParam);
    await refreshCalendarData();
    const me = state.me.household;
    const days = state.yearDoc.days;
    const monthDays = days.filter((d) => Number(d.date.slice(5, 7)) === state.month + 1);
    const monthName = `${MONTH_FULL[state.month]} ${state.year}`;
    shell(`
      <section class="stage" id="stage" data-field="split" data-day="${days[0].date}" role="region" aria-label="Year ${state.year}">
        <div class="fields"><div class="field mint"></div><div class="field pink"></div></div>
        <div class="stage-inner">
          <h1>Who has tonight, and why.</h1>
          <div class="counters">
            <div class="counter"><div class="name">Nights with ${esc(me.planningName)}</div><div class="n" id="count-planning">0</div></div>
            <div class="counter"><div class="name">Nights with ${esc(me.otherName)}</div><div class="n" id="count-other">0</div></div>
          </div>
          <div class="stickers" id="stickers"></div>
          <div class="strip-row">
            <input type="range" id="strip" role="slider" aria-label="Year strip"
              aria-valuemin="0" aria-valuemax="${days.length - 1}" aria-valuenow="0"
              aria-valuetext="${screenDate(days[0].date)}" value="0"
              style="width:100%; height:60px; min-height:44px">
          </div>
          <div class="day-box">
            <label for="day">Day</label><input id="day" style="max-width:180px" value="${days[0].date}">
            <button class="green" id="request-swap">Request a swap</button>
          </div>
          <p class="day-answer" id="day-answer" role="status" aria-label="Day answer"></p>
        </div>
      </section>
      <div class="row">
        <section class="card" role="region" aria-label="Tonight">
          <h2>Tonight</h2>
          <p id="tonight-line"></p>
          <p id="tonight-handover"></p>
        </section>
        <section class="card" role="region" aria-label="Requests summary">
          <h2>Requests summary</h2>
          <p>Waiting for you: ${state.requests.waiting.length}</p>
          <p>Sent by you: ${state.requests.sent.length}</p>
          <p><a href="/requests" data-nav>Open requests</a></p>
        </section>
        <section class="card month-grid" role="region" aria-label="Calendar">
          <div class="grid-controls">
            <button id="prev-month">Previous month</button>
            <button id="next-month">Next month</button>
            <strong>${monthName}</strong>
            <span class="digest">Year digest ${esc(state.yearDoc.__digest || '')}</span>
          </div>
          <table role="grid" aria-label="${monthName}">
            <thead><tr>${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d) => `<th scope="col">${d}</th>`).join('')}</tr></thead>
            <tbody>${monthGridHtml(monthDays)}</tbody>
          </table>
          <p class="day-answer" id="grid-answer" role="status"></p>
        </section>
      </div>`);
    document.getElementById('tonight-line').textContent = state.tonight.owner
      ? `Tonight: ${state.tonight.owner === 'planning' ? me.planningName : me.otherName}`
      : 'No plan yet.';
    document.getElementById('tonight-handover').textContent = nextHandoverLine();
    bindCalendar(days);
    applyScroll(reducedMotion ? days.length - 1 : 0);
  }

  function nextHandoverLine() {
    const nh = state.tonight && state.tonight.nextHandover;
    if (!nh) return 'No handover in the next 60 days.';
    const me = state.me.household;
    const from = nh.from === 'planning' ? me.planningName : me.otherName;
    const to = nh.to === 'planning' ? me.planningName : me.otherName;
    return `Next handover: ${instantScreen(nh.at, nh.zone)}, ${from} to ${to}`;
  }
  function monthGridHtml(monthDays) {
    const lead = monthDays.length > 0
      ? dowOf(...(p => [p.y, p.m, p.d])(parseYmd(monthDays[0].date))) - 1
      : 0;
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<td class="day"></td>');
    for (const d of monthDays) {
      const chipClass = d.owner === 'planning' ? 'mint' : d.owner === 'other' ? 'pink' : '';
      const name = d.owner === 'planning' ? state.me.household.planningName : d.owner === 'other' ? state.me.household.otherName : 'no plan';
      cells.push(`<td class="day" role="gridcell" aria-label="${screenDate(d.date)}, ${esc(name)}">
        <button class="day-btn" data-date="${d.date}">
          <span>${Number(d.date.slice(8))}</span>
          <span class="chip ${chipClass}">${esc(name)}</span>
        </button></td>`);
    }
    let rows = '';
    for (let i = 0; i < cells.length; i += 7) rows += `<tr role="row">${cells.slice(i, i + 7).join('')}</tr>`;
    return rows;
  }

  function dayAnswer(d) {
    const me = state.me.household;
    if (!d || !d.owner) return d ? `${screenDate(d.date)}: no plan` : '';
    const name = d.owner === 'planning' ? me.planningName : me.otherName;
    let s = `${screenDate(d.date)}: ${name} — ${d.ruleName} (${KIND_WORDS[d.kind]})`;
    if (d.beats) s += `, beats ${d.beats}`;
    return s;
  }

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  function bindCalendar(days) {
    const strip = document.getElementById('strip');
    const stage = document.getElementById('stage');
    const answer = document.getElementById('day-answer');

    const countsUpTo = (idx) => {
      let p = 0, o = 0;
      for (let i = 0; i <= idx; i++) {
        if (days[i].owner === 'planning') p++;
        if (days[i].owner === 'other') o++;
      }
      return { p, o };
    };

    const runs = overrideRuns(days);
    window.applyScroll = (scrollY) => {
      const N = days.length;
      const idx = reducedMotion.matches ? N - 1 : Math.min(N - 1, Math.floor(scrollY * N / 1200));
      const d = days[idx];
      stage.dataset.field = d.owner === 'planning' ? 'planning' : d.owner === 'other' ? 'other' : 'split';
      stage.dataset.day = d.date;
      const c = countsUpTo(idx);
      document.getElementById('count-planning').textContent = c.p;
      document.getElementById('count-other').textContent = c.o;
      strip.setAttribute('aria-valuenow', String(idx));
      strip.setAttribute('aria-valuetext', screenDate(d.date));
      strip.value = String(idx);
      answer.textContent = dayAnswer(d);
      const box = document.getElementById('stickers');
      box.innerHTML = '';
      runs.filter((r) => r.first <= idx).forEach((r, i) => {
        box.appendChild(el(`<span class="sticker ${r.owner === 'planning' ? 'mint' : 'pink'}" role="img"
          aria-label="${esc(r.ruleName)} beats ${esc(r.beats)}" data-state="${reducedMotion.matches ? 'resting' : 'settling'}"
          style="left:${(i * 20) % 78}%; transform:rotate(${i % 2 === 0 ? 3 : -3}deg)">${esc(r.ruleName)} beats ${esc(r.beats)}</span>`));
      });
    };

    let raf = null;
    window.addEventListener('scroll', () => {
      if (reducedMotion.matches) return;
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = null; window.applyScroll(Math.min(1200, window.scrollY)); });
    }, { passive: true });

    strip.addEventListener('input', () => {
      const idx = Number(strip.value);
      const target = Math.round(idx * 1200 / days.length);
      if (!reducedMotion.matches) window.scrollTo({ top: target });
      window.applyScroll(reducedMotion.matches ? days.length - 1 : Math.min(1200, target));
    });
    document.getElementById('day').addEventListener('input', (e) => {
      const v = e.target.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
      const found = days.findIndex((d) => d.date === v);
      if (found === -1) { answer.textContent = `Choose a day in ${state.year}.`; return; }
      const target = Math.round(found * 1200 / days.length);
      if (!reducedMotion.matches) window.scrollTo({ top: target });
      window.applyScroll(reducedMotion.matches ? days.length - 1 : Math.min(1200, target));
    });
    document.getElementById('request-swap').addEventListener('click', () => openSwapDialog());
    document.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() !== 's' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
      const inRegion = t.closest && (t.closest('.stage') || t.closest('main.page'));
      if (!inField && inRegion && !document.querySelector('dialog[open]')) {
        e.preventDefault();
        openSwapDialog();
      }
    });
    document.querySelectorAll('.day-btn').forEach((b) => {
      b.addEventListener('click', () => {
        const d = days.find((x) => x.date === b.dataset.date);
        document.getElementById('grid-answer').textContent = dayAnswer(d);
        openSwapDialog({ firstNight: d.date });
      });
    });
    document.getElementById('prev-month').addEventListener('click', () => { state.month = (state.month + 11) % 12; renderCalendar(); });
    document.getElementById('next-month').addEventListener('click', () => { state.month = (state.month + 1) % 12; renderCalendar(); });
  }

  function overrideRuns(days) {
    const runs = [];
    let cur = null;
    days.forEach((d, i) => {
      if (d.beats !== null && d.ruleId && d.kind !== 'base' && d.kind !== 'swap') {
        if (cur && cur.ruleId === d.ruleId && cur.beats === d.beats) cur.last = i;
        else {
          if (cur) runs.push(cur);
          cur = { ruleId: d.ruleId, beats: d.beats, first: i, last: i, owner: d.owner, ruleName: d.ruleName };
        }
      } else if (cur) { runs.push(cur); cur = null; }
    });
    if (cur) runs.push(cur);
    return runs;
  }

  async function refreshCalendarData() {
    const hid = state.me.household.id;
    const yearRes = await api(`/households/${hid}/years/${state.year}`);
    if (yearRes.ok) {
      state.yearDoc = yearRes.body;
      state.yearDoc.__digest = (yearRes.headers.get('x-year-digest') || '').trim();
    }
    const t = await api(`/households/${hid}/tonight`);
    if (t.ok) state.tonight = t.body;
    const swaps = await api(`/households/${hid}/swaps`);
    const costs = await api(`/households/${hid}/costs`);
    state.requests = { waiting: [], sent: [] };
    if (swaps.ok) {
      for (const s of swaps.body.items) {
        const answerer = s.createdBy === 'planning' ? 'other' : 'planning';
        if (s.state === 'sent' && answerer === state.me.role) state.requests.waiting.push(s);
        if (s.state === 'sent' && s.createdBy === state.me.role) state.requests.sent.push(s);
      }
    }
    if (costs.ok) {
      for (const c of costs.body.items) {
        const answerer = c.paidBy === 'planning' ? 'other' : 'planning';
        if (c.state === 'sent' && answerer === state.me.role) state.requests.waiting.push(c);
        if (c.state === 'sent' && c.paidBy === state.me.role) state.requests.sent.push(c);
      }
    }
  }

  // ---- swap dialog ----
  function openSwapDialog(pre) {
    if (!state.me) return;
    const dlg = el(`<dialog aria-label="Request a swap">
      <h2>Request a swap</h2>
      <form id="swap-form" onsubmit="return false">
        <label for="swap-first">First night</label><input id="swap-first" placeholder="YYYY-MM-DD">
        <label for="swap-last">Last night</label><input id="swap-last" placeholder="YYYY-MM-DD">
        <label for="swap-mk-first">Make-up first night</label><input id="swap-mk-first" placeholder="YYYY-MM-DD">
        <label for="swap-mk-last">Make-up last night</label><input id="swap-mk-last" placeholder="YYYY-MM-DD">
        <fieldset><legend>Who has the child</legend>
          <label><input type="radio" name="to" value="planning"> ${esc(state.me.household.planningName)}</label>
          <label><input type="radio" name="to" value="other"> ${esc(state.me.household.otherName)}</label>
        </fieldset>
        <label for="swap-note">Note</label><input id="swap-note">
        <div class="dialog-actions">
          <button type="button" class="green" id="swap-send">Send request</button>
          <button type="button" id="swap-save">Save draft</button>
          <button type="button" id="swap-cancel">Cancel</button>
        </div>
        <p class="alert" id="swap-alert" role="alert"></p>
      </form>
    </dialog>`);
    document.body.appendChild(dlg);
    const first = dlg.querySelector('#swap-first');
    if (pre && pre.firstNight) first.value = pre.firstNight;
    const opener = document.activeElement;
    dlg.showModal();
    first.focus();
    const close = () => { dlg.close(); dlg.remove(); if (opener && opener.isConnected) opener.focus(); };
    dlg.querySelector('#swap-cancel').addEventListener('click', close);
    dlg.addEventListener('keydown', (e) => { if (e.key === 'Escape') setTimeout(close, 0); });
    dlg.querySelector('#swap-send').addEventListener('click', () => submitSwap(dlg, true));
    dlg.querySelector('#swap-save').addEventListener('click', () => submitSwap(dlg, false));
  }
  async function submitSwap(dlg, send) {
    const alertEl = dlg.querySelector('#swap-alert');
    const first = dlg.querySelector('#swap-first').value;
    const last = dlg.querySelector('#swap-last').value;
    const mkfirst = dlg.querySelector('#swap-mk-first').value;
    const mklast = dlg.querySelector('#swap-mk-last').value;
    const to = dlg.querySelector('input[name="to"]:checked');
    const note = dlg.querySelector('#swap-note').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(first) || !/^\d{4}-\d{2}-\d{2}$/.test(last)) {
      alertEl.textContent = 'Enter a real date as YYYY-MM-DD.';
      dlg.querySelector('#swap-first').focus();
      return;
    }
    const body = { nights: `${first}/${last}`, toParent: to ? to.value : null, note: note || null };
    if (mkfirst && mklast) body.makeupNights = `${mkfirst}/${mklast}`;
    const res = await api(`/households/${state.me.household.id}/swaps`, { method: 'POST', body: JSON.stringify(body) });
    if (!res.ok) {
      alertEl.textContent = Object.values(res.body.errors || {}).join(' ') || 'Something went wrong. Try again.';
      return;
    }
    if (send) {
      const sres = await api(`/households/${state.me.household.id}/swaps/${res.body.id}/send`, {
        method: 'POST', headers: { 'Idempotency-Key': 'send-' + res.body.id }, body: JSON.stringify({}),
      });
      if (!sres.ok) {
        alertEl.textContent = overlapCopy(sres.body);
        return;
      }
      announce('Request sent. An email notice is on its way.');
    } else {
      announce('Draft saved.');
    }
    dlg.close(); dlg.remove();
    route();
  }
  function overlapCopy(body) {
    const errs = Object.values(body.errors || {});
    if (errs.length) return errs.join(' ');
    switch (body.code) {
      case 'swap_overlaps': return 'Those nights are already in another request.';
      case 'swap_nights_changed': return "Those nights changed when the plan was amended. This request can't be accepted.";
      case 'swap_run_too_long': return 'That swap would keep the child with one parent for more than the plan allows in a row.';
      default: return 'Something went wrong. Try again.';
    }
  }

  window.addEventListener('load', route);
})();

/* Requests, Costs, Plan, Records screens appended by the second bundle. */
