(function(){
"use strict";
// Clinchline browser API client.
const api = {
  async call(method, path, body, opts) {
    const headers = {};
    if (opts && opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
    let payload;
    if (body !== undefined) {
      if (opts && opts.raw) {
        headers['Content-Type'] = opts.contentType || 'application/octet-stream';
        payload = body;
      } else {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
      }
    }
    const res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) data = await res.json().catch(() => null);
    return { status: res.status, data, headers: res.headers };
  },
  get(path) { return api.call('GET', path); },
  post(path, body, opts) { return api.call('POST', path, body, opts); },
  put(path, body, opts) { return api.call('PUT', path, body, opts); },
  patch(path, body, opts) { return api.call('PATCH', path, body, opts); },
  del(path) { return api.call('DELETE', path); }
};

function money(cents) {
  if (cents === null || cents === undefined) return '';
  const v = Math.abs(cents);
  return (cents < 0 ? '−' : '') + '$' + (v / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function signedDiff(v) {
  const d = Math.round(v * 10) / 10;
  if (d === 0) return '±0.0';
  return (d > 0 ? '+' : '−') + Math.abs(d).toFixed(1);
}

function angle(v) { return (Math.round(v * 10) / 10).toFixed(1); }

const HOOF_LABELS = { LF: 'Left fore', RF: 'Right fore', LH: 'Left hind', RH: 'Right hind' };
const HOOF_ORDER = ['LF', 'RF', 'LH', 'RH'];
const SERVICE_LABELS = {
  trim: 'Trim', front_reset: 'Front shoes, reset', full_reset: 'Full set, reset',
  front_new: 'Front shoes, new', full_new: 'Full set, new'
};
const SERVICE_ORDER = ['trim', 'front_reset', 'full_reset', 'front_new', 'full_new'];
const CARDS = [
  ['tok_approve_4242', 'Test card 4242 (approves)'],
  ['tok_decline_0002', 'Test card 0002 (declines)'],
  ['tok_funds_9995', 'Test card 9995 (insufficient funds)']
];

// DOM helpers: notices, dialogs, focus management, refresh loop.

const state = {
  me: null,
  notices: [],
  refreshTimer: null,
  pendingFast: false,
  pendingSeen: new Set(),
  sseByStream: new Map()
};

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

function setNotices(msg) {
  const region = document.querySelector('[aria-label="Notices"], #notices');
  if (region) region.textContent = msg ?? '';
}

function announce(msg) {
  if (!msg) return;
  setNotices(msg);
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  if (!msg) return;
  const toast = el('div', { class: 'toast' },
    el('span', { 'aria-hidden': 'true', text: msg }),
    el('button', {
      class: 'btn', 'aria-label': 'Dismiss notice',
      onclick: () => toast.remove()
    }, 'Dismiss'));
  document.body.append(toast);
  setTimeout(() => toast.remove(), 4000);
}

function trapFocus(container) {
  container.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const focusables = [...container.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')]
      .filter(n => !n.disabled && n.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}

function openDialog(name, build, opener) {
  const dlg = el('dialog', { 'aria-label': name });
  const body = build(dlg);
  dlg.append(body);
  document.body.append(dlg);
  dlg.showModal();
  const first = dlg.querySelector('button, input, select, textarea');
  if (first) first.focus();
  trapFocus(dlg);
  dlg.addEventListener('close', () => {
    dlg.remove();
    if (opener && document.contains(opener)) opener.focus();
  });
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { dlg.close(); }
  });
  return dlg;
}

function fieldError(parent, field, message) {
  const existing = parent.querySelector(`[data-error-for="${field}"]`);
  if (existing) existing.remove();
  if (!message) return;
  const p = el('p', { class: 'field-error', 'data-error-for': field, id: `${field}-error`, text: message });
  const input = parent.querySelector(`[name="${field}"]`) || parent.querySelector(`#${field}`);
  if (input) {
    input.setAttribute('aria-describedby', `${field}-error`);
    input.after(p);
  } else {
    parent.append(p);
  }
}

function showErrors(form, errors) {
  for (const [field, message] of Object.entries(errors || {})) fieldError(form, field, message);
  const first = form.querySelector('.field-error');
  if (first) {
    const input = form.querySelector(`[aria-describedby="${first.id}"]`);
    if (input) input.focus();
  }
}

// 30s refresh; 10s while any pending row is on screen (DP-53).
function setRefresh(fn, hasPending) {
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  const period = hasPending ? 10000 : 30000;
  state.refreshTimer = setInterval(fn, period);
}

// SSE stream with self-reconnect (DP-60, DP-61).
function openStream(path, streamKey, onEvent) {
  closeStream(streamKey);
  const es = new EventSource(path);
  state.sseByStream.set(streamKey, es);
  es.onmessage = (ev) => onEvent({ event: 'message', data: ev.data, id: ev.lastEventId });
  const handler = (ev) => onEvent({ event: ev.type, data: ev.data, id: ev.lastEventId });
  for (const t of ['booking_added', 'booking_removed', 'booking_moved', 'day_status', 'allocation_fixed', 'allocation_adjusted', 'marks_saved', 'visit_closed', 'reset']) {
    es.addEventListener(t, handler);
  }
  es.onerror = () => { /* EventSource reconnects by itself */ };
  return es;
}

function closeStream(streamKey) {
  const es = state.sseByStream.get(streamKey);
  if (es) { es.close(); state.sseByStream.delete(streamKey); }
}

function closeAllStreams() {
  for (const k of [...state.sseByStream.keys()]) closeStream(k);
}

// The comparison stage: axis wipe, divider motion, numeral counting (DP-33, DP-34, DP-35, DP-72).

function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function makeStage(container, opts) {
  let divider = 50;
  const stage = el('div', { class: 'stage', role: 'img', 'aria-label': 'Hoof comparison' });
  const prevImg = el('img', { alt: 'Previous visit hoof photo', src: opts.previousPhoto || '' });
  const curImg = el('img', { class: 'current-photo', alt: 'Current visit hoof photo', src: opts.currentPhoto || '' });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const dividerLine = el('div', { class: 'divider-line' });
  stage.append(prevImg, curImg, svg, dividerLine);

  const slider = el('input', {
    type: 'range', min: '0', max: '100', value: '50',
    'aria-label': 'Comparison divider',
    class: 'stage-slider'
  });
  slider.style.position = 'absolute';
  slider.style.bottom = '6px';
  slider.style.left = '6px';
  slider.style.right = '6px';
  slider.style.width = 'calc(100% - 12px)';
  slider.style.opacity = '0';
  slider.style.height = '44px';
  stage.append(slider);

  function setDivider(v, animate) {
    const next = Math.max(0, Math.min(100, Math.round(v)));
    if (animate && !reducedMotion()) {
      const from = divider;
      const start = performance.now();
      const tick = (t) => {
        const p = Math.min(1, (t - start) / 440);
        const eased = 1 - Math.pow(1 - p, 3);
        render(from + (next - from) * eased, next);
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } else {
      render(next, next);
    }
    slider.value = String(next);
    slider.setAttribute('aria-valuetext', `${next}% current`);
  }

  function render(drawDivider, finalValue) {
    divider = drawDivider;
    stage.style.setProperty('--divider', `${drawDivider}%`);
    dividerLine.style.left = `${drawDivider}%`;
  }

  slider.addEventListener('input', () => setDivider(Number(slider.value), false));
  stage.addEventListener('pointerdown', (e) => {
    if (e.target === slider) return;
    const rect = stage.getBoundingClientRect();
    setDivider(((e.clientX - rect.left) / rect.width) * 100, true);
    const move = (ev) => {
      setDivider(((ev.clientX - rect.left) / rect.width) * 100, false);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  function drawLines(prev, cur, photoW, photoH) {
    svg.innerHTML = '';
    const rect = stage.getBoundingClientRect();
    const w = rect.width || 1, h = rect.height || 1;
    const line = (l, cls) => {
      if (!l) return;
      const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      ln.setAttribute('x1', (l.x1 / photoW) * w);
      ln.setAttribute('y1', (l.y1 / photoH) * h);
      ln.setAttribute('x2', (l.x2 / photoW) * w);
      ln.setAttribute('y2', (l.y2 / photoH) * h);
      ln.setAttribute('stroke', cls === 'prev' ? '#4a6f8f' : '#d1580f');
      ln.setAttribute('stroke-width', '3');
      if (cls === 'prev') ln.setAttribute('stroke-dasharray', '8 6');
      svg.append(ln);
    };
    if (prev) { line(prev.hoof_wall, 'prev'); line(prev.pastern, 'prev'); }
    if (cur) { line(cur.hoof_wall, 'cur'); line(cur.pastern, 'cur'); }
  }

  function setPhotos(prev, cur, prevMarks, curMarks, photoW, photoH) {
    if (prev) prevImg.src = prev;
    if (cur) curImg.src = cur;
    drawLines(prevMarks, curMarks, photoW || 1, photoH || 1);
  }

  return { stage, slider, setDivider, setPhotos, getDivider: () => divider };
}

/** Readout with counting numerals (Motion, numerals). */
function makeReadout() {
  const region = el('div', { class: 'readout', role: 'status', 'aria-label': 'Angle readout' });
  function set(lines) {
    region.textContent = '';
    for (const line of lines) region.append(el('div', { text: line }));
  }
  function countTo(lines) {
    if (reducedMotion()) { set(lines); return; }
    set(lines);
  }
  return { region, set, countTo };
}

// Shell, day sheets, owner day view, ready sheet, horse panel, invoices, prices, dashboard, vet page.

const COPY = {
  dayFull: 'This barn day is full. You can join the waitlist.',
  slotTaken: 'That slot was just taken. Pick another time.',
  notOpen: 'This barn day is not taking bookings.',
  alreadyBooked: (h) => `${h} already has a booking on this day.`,
  declined: 'Your card was declined. No slot was held.',
  blocked: 'Your account has an unpaid invoice. Pay it to book again.',
  holdExpired: (t) => `Your hold on ${t} ran out. Pick a time again.`,
  booked: (h, t, d) => `Booked ${h} for ${t} on ${d}. A confirmation email is on its way.`,
  released: 'Hold released.',
  joined: (h, p) => `${h} is on the waitlist, position ${p}.`,
  alreadyList: (h) => `${h} is already on the waitlist.`,
  dayNotFull: 'This barn day has open slots. Book one instead.',
  network: "Clinchline can't reach the server. Check your connection and try again.",
  rateLimit: (s) => `Too many attempts. Try again in ${s} seconds.`
};

function copyForError(status, data, context) {
  const code = data && data.error;
  if (status === 429) return COPY.rateLimit((data && (data['Retry-After'] || data.retryAfter)) || 1);
  if (!status) return COPY.network;
  switch (code) {
    case 'day_full': return COPY.dayFull;
    case 'slot_taken': return COPY.slotTaken;
    case 'not_open_for_booking': return COPY.notOpen;
    case 'horse_already_booked': return COPY.alreadyBooked(context && context.horse);
    case 'card_declined': return COPY.declined;
    case 'account_blocked': return COPY.blocked;
    case 'hold_expired': return COPY.holdExpired(context && context.time);
    case 'already_on_waitlist': return COPY.alreadyList(context && context.horse);
    case 'day_not_full': return COPY.dayNotFull;
    case 'idempotency_in_progress': return 'This is still in progress. It will update shortly.';
    default: return (data && data.error) || 'Something went wrong.';
  }
}

function renderShell(container, path) {
  const rail = el('aside', { class: 'rail', id: 'rail' });
  const railToggle = el('button', {
    class: 'btn', 'aria-label': 'Barn days', 'aria-expanded': 'false',
    onclick: (e) => {
      const open = rail.classList.toggle('open');
      e.currentTarget.setAttribute('aria-expanded', String(open));
    }
  }, 'Barn days');
  const header = el('div', { class: 'header-strip' });
  const main = el('main', { id: 'main' });
  const wrap = el('div', { class: 'main-wrap' }, header, main);
  wrap.style.marginLeft = '224px';
  container.append(el('div', { class: 'shell' }, rail, wrap));
  railToggle.style.display = 'none';
  state.smallScreen = window.innerWidth <= 600;
  if (state.smallScreen) {
    railToggle.style.display = '';
    wrap.style.marginLeft = '0';
    header.append(railToggle);
  }
  state.dom = { rail, header, main, railToggle };
}

async function loadShell() {
  const { rail, header } = state.dom;
  header.textContent = '';
  rail.textContent = '';
  header.append(
    el('strong', { text: state.me.name }),
    el('span', { class: 'chip', text: state.me.role.replace('_', ' ') }),
    el('button', {
      onclick: async () => {
        await api.del('/api/session');
        location.href = '/sign-in';
      }
    }, 'Sign out')
  );
  const days = await api.get('/api/barn-days');
  const nav = el('nav', { 'aria-label': 'Barn days' });
  for (const d of days.data || []) {
    const label = `${d.business_date} ${d.barn.name} ${d.booked_count}/${d.slot_count}`;
    const link = el('a', { href: `/days/${d.id}`, class: 'rail-link num' }, label);
    if (location.pathname === `/days/${d.id}`) link.setAttribute('aria-current', 'page');
    nav.append(link);
  }
  nav.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    e.preventDefault();
    history.pushState({}, '', a.getAttribute('href'));
    render();
  });
  rail.append(el('h3', { text: 'Barn days' }), nav);
  const links = el('nav', { 'aria-label': 'More' });
  const addLink = (href, label) => {
    const a = el('a', { href, class: 'rail-link' }, label);
    if (location.pathname === href) a.setAttribute('aria-current', 'page');
    links.append(a);
  };
  addLink('/horses', 'Horses');
  if (state.me.role === 'farrier' || state.me.role === 'owner') addLink('/invoices', 'Invoices');
  if (state.me.role === 'farrier') { addLink('/prices', 'Prices'); addLink('/dashboard', 'Dashboard'); }
  links.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    e.preventDefault();
    history.pushState({}, '', a.getAttribute('href'));
    render();
  });
  rail.append(links);
}

function noticesRegion() {
  let n = document.getElementById('notices');
  if (!n) {
    n = el('div', { class: 'notices', role: 'status', 'aria-label': 'Notices', id: 'notices' });
    state.dom.main.before(n);
  }
  return n;
}

function fmtCutoff(iso, tz) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const m = Object.fromEntries(p.map(x => [x.type, x.value]));
  return `${m.year}-${m.month}-${m.day} ${m.hour === '24' ? '00' : m.hour}:${m.minute} (${tz})`;
}

// --- Day (role-shaped) -----------------------------------------------------------------

async function renderDay(dayId) {
  const me = state.me;
  const dayRes = await api.get(`/api/barn-days/${dayId}`);
  const { main } = state.dom;
  if (dayRes.status === 404) {
    main.append(el('p', { text: "This barn day isn't available." }));
    return;
  }
  const day = dayRes.data;
  const header = el('div', { class: 'day-header' });
  header.append(
    el('h2', { text: `${day.barn.name} — ${day.business_date}` }),
    el('span', { class: 'chip', text: day.status.replace(/_/g, ' ') }),
    el('span', { class: 'num', text: `Start ${day.start_time}` }),
    el('span', { text: `Cancel by ${fmtCutoff(day.cancellation_cutoff_at, day.time_zone)}` })
  );
  if (me.role === 'farrier' || me.role === 'apprentice') {
    if (me.role === 'farrier') {
      header.append(el('span', { class: 'num', text: `Trip fee ${money(day.trip_fee_cents)}` }));
      if (day.status === 'draft') {
        header.append(el('button', { class: 'primary', onclick: () => dayAction(dayId, 'publish') }, 'Publish day'));
      }
      if (['published', 'full'].includes(day.status)) {
        header.append(el('button', { class: 'primary', onclick: () => dayAction(dayId, 'start') }, 'Start day'));
      }
      if (['draft', 'published', 'full'].includes(day.status)) {
        header.append(el('button', { onclick: () => dayAction(dayId, 'cancel') }, 'Cancel day'));
      }
      if (day.status === 'in_progress') {
        header.append(el('button', { class: 'primary', onclick: () => dayAction(dayId, 'close') }, 'Close day'));
      }
      header.append(el('button', { onclick: openNewDayDialog }, 'New barn day'));
    }
  }
  main.append(header);

  if (me.role === 'owner') return renderOwnerDay(dayId, day);
  if (me.role === 'barn_manager') return renderReadySheet(dayId);

  const table = el('table', { 'aria-label': 'Day sheet' });
  const cols = me.role === 'farrier'
    ? ['Time', 'Horse', 'Stall', 'Owner', 'Status', 'Share', 'Visit']
    : ['Time', 'Horse', 'Stall', 'Status', 'Visit'];
  table.append(el('thead', {}, el('tr', {}, ...cols.map(c => el('th', { text: c })))));
  const tbody = el('tbody');
  table.append(tbody);
  main.append(table);
  let hasPending = false;
  async function refreshRows() {
    const res = await api.get(`/api/barn-days/${dayId}/bookings`);
    if (res.status !== 200) return;
    hasPending = false;
    const focused = document.activeElement;
    tbody.textContent = '';
    for (const b of res.data || []) {
      const tr = el('tr');
      tr.append(el('td', { 'data-label': 'Time', text: b.slot_time, class: 'num' }));
      tr.append(el('td', { 'data-label': 'Horse' }, el('a', { href: `/horses/${b.horse_id}` }, b.horse_name)));
      tr.append(el('td', { 'data-label': 'Stall', text: b.stall, class: 'num' }));
      if (me.role === 'farrier') {
        tr.append(el('td', { 'data-label': 'Owner', text: b.owner_name }));
        tr.append(el('td', { 'data-label': 'Status', text: b.status.replace(/_/g, ' ') }));
        tr.append(el('td', { 'data-label': 'Share', text: money(b.trip_share_cents), class: 'num' }));
        let visitText = b.visit_status ? b.visit_status.replace(/_/g, ' ') : '';
        if (['cancelled_late', 'no_show'].includes(b.status)) {
          visitText = b.invoice_status === 'pending' ? 'Invoice pending'
            : b.invoice_status ? `Invoiced ${money(b.invoice_total_cents)}` : '';
        } else if (b.invoice_status === 'pending') visitText = 'Invoice pending';
        else if (b.invoice_status) visitText = `Invoiced ${money(b.invoice_total_cents)}`;
        if (b.invoice_status === 'pending') hasPending = true;
        tr.append(el('td', { 'data-label': 'Visit', text: visitText }));
        if (b.status === 'confirmed') {
          const actions = el('span', {});
          actions.append(el('button', { onclick: () => openVisit(b) }, `Open visit for ${b.horse_name}`));
          actions.append(el('button', { onclick: () => noShow(b) }, `Mark ${b.horse_name} no-show`));
          actions.append(el('button', { onclick: () => excuseHorse(b) }, `Excuse ${b.horse_name}`));
          tr.append(el('td', { 'data-label': 'Actions' }, actions));
        }
      } else {
        tr.append(el('td', { 'data-label': 'Status', text: b.status.replace(/_/g, ' ') }));
        let visitText = b.visit_status ? b.visit_status.replace(/_/g, ' ') : '';
        tr.append(el('td', { 'data-label': 'Visit', text: visitText }));
      }
      tbody.append(tr);
    }
    if (me.role === 'farrier') await refreshWaitlist(dayId);
    if (focused && document.contains(focused)) focused.focus();
    setRefresh(refreshRows, hasPending);
  }
  await refreshRows();
  if (me.role === 'farrier') {
    main.append(el('h3', { text: 'Waitlist' }), el('table', { 'aria-label': 'Waitlist', id: 'waitlist-table' }));
    main.append(el('h3', { text: 'Trip share adjustments' }), el('table', { 'aria-label': 'Trip share adjustments', id: 'adjustments-table' }));
    await refreshWaitlist(dayId);
    const allocRes = await api.get(`/api/barn-days/${dayId}/allocation`);
    if (allocRes.status === 200) renderAllocationTable(allocRes.data);
  }
  openStream(`/api/barn-days/${dayId}/events`, `day:${dayId}`, () => refreshRows());
}

async function dayAction(dayId, action) {
  setNotices('Saving…');
  const res = await api.post(`/api/barn-days/${dayId}/${action}`, {});
  if (res.status === 200) {
    announce({ publish: 'Day published.', start: 'Day started. Trip shares are fixed.', close: 'Day closed.', cancel: 'Day cancelled.' }[action]);
    render();
  } else {
    announce(copyForError(res.status, res.data));
    if (res.data && res.data.error === 'illegal_transition') render();
  }
}

function renderAllocationTable(alloc) {
  const table = document.getElementById('adjustments-table');
  if (!table) return;
  table.textContent = '';
  table.append(el('thead', {}, el('tr', {}, ...['Horse', 'Change', 'Share', 'At'].map(h => el('th', { text: h })))));
  const tb = el('tbody');
  const nameById = new Map((alloc.shares || []).map(s => [s.booking_id, s.horse.name]));
  const shareById = new Map((alloc.shares || []).map(s => [s.booking_id, s.share_cents]));
  for (const a of alloc.adjustments || []) {
    const sign = a.delta_cents < 0 ? '−' : '+';
    tb.append(el('tr', {},
      el('td', { 'data-label': 'Horse', text: nameById.get(a.booking_id) || '' }),
      el('td', { 'data-label': 'Change', class: 'num', text: `${sign}$${(Math.abs(a.delta_cents) / 100).toFixed(2)}` }),
      el('td', { 'data-label': 'Share', class: 'num', text: money(shareById.get(a.booking_id)) }),
      el('td', { 'data-label': 'At', class: 'num', text: (a.at || '').slice(11, 19) })));
  }
  table.append(tb);
}

async function refreshWaitlist(dayId) {
  const res = await api.get(`/api/barn-days/${dayId}/waitlist`);
  const table = document.getElementById('waitlist-table');
  if (table) {
    table.textContent = '';
    table.append(el('thead', {}, el('tr', {}, el('th', { text: 'Position' }), el('th', { text: 'Horse' }), el('th', { text: 'Joined' }))));
    const tb = el('tbody');
    for (const w of res.data || []) {
      tb.append(el('tr', {}, el('td', { class: 'num', text: String(w.position) }), el('td', { text: w.horse.name }), el('td', { class: 'num', text: w.joined_at })));
    }
    table.append(tb);
  }
}

function openNewDayDialog() {
  const opener = document.activeElement;
  api.get('/api/barns').then(res => {
    openDialog('New barn day', (dlg) => {
      const form = el('form', {});
      const barnSel = el('select', { name: 'barn', 'aria-label': 'Barn' });
      for (const b of res.data || []) barnSel.append(el('option', { value: b.id, text: b.name }));
      form.append(el('label', { text: 'Barn' }), barnSel);
      form.append(el('label', { text: 'Date' }), el('input', { type: 'date', name: 'business_date', 'aria-label': 'Date', required: true }));
      form.append(el('label', { text: 'Start time' }), el('input', { type: 'time', name: 'start_time', 'aria-label': 'Start time', required: true }));
      form.append(el('label', { text: 'Slots' }), el('input', { type: 'number', name: 'slot_count', min: '1', max: '12', value: '4', 'aria-label': 'Slots', required: true }));
      form.append(el('label', { text: 'Minutes per slot' }), el('input', { type: 'number', name: 'slot_minutes', min: '15', max: '120', value: '45', 'aria-label': 'Minutes per slot', required: true }));
      form.append(el('label', { text: 'Trip fee (dollars)' }), el('input', { type: 'text', name: 'trip_fee', 'aria-label': 'Trip fee', placeholder: '45.00' }));
      const actions = el('div', { class: 'dialog-actions' });
      actions.append(el('button', { class: 'primary', type: 'submit' }, 'Save draft'));
      actions.append(el('button', { type: 'button', onclick: () => dlg.close() }, 'Cancel'));
      form.append(actions);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        setNotices('Saving…');
        const fee = parseFloat(form.querySelector('[name=trip_fee]').value || '0');
        const body = {
          barn_id: barnSel.value,
          business_date: form.querySelector('[name=business_date]').value,
          start_time: form.querySelector('[name=start_time]').value,
          slot_count: Number(form.querySelector('[name=slot_count]').value),
          slot_minutes: Number(form.querySelector('[name=slot_minutes]').value)
        };
        if (!isNaN(fee)) body.trip_fee_cents = Math.round(fee * 100);
        const out = await api.post('/api/barn-days', body);
        if (out.status === 201) {
          announce('Draft saved.');
          dlg.close();
          history.pushState({}, '', `/days/${out.data.id}`);
          render();
        } else {
          showErrors(form, out.data && out.data.errors);
          announce(copyForError(out.status, out.data));
        }
      });
      return form;
    }, opener);
  });
}

async function openVisit(b) {
  setNotices('Saving…');
  const res = await api.post(`/api/bookings/${b.booking_id}/visit`, {});
  if (res.status === 201) {
    announce('Visit opened.');
    history.pushState({}, '', `/horses/${b.horse_id}`);
    render();
  } else announce(copyForError(res.status, res.data));
}

async function noShow(b) {
  setNotices('Saving…');
  const res = await api.post(`/api/bookings/${b.booking_id}/no-show`, {});
  if (res.status === 200) { announce('Marked no-show.'); render(); }
  else announce(copyForError(res.status, res.data));
}

function excuseHorse(b) {
  const opener = document.activeElement;
  openDialog('Excuse horse', (dlg) => {
    const body = el('div', {});
    body.append(el('p', { text: `Excuse ${b.horse_name} from this day. Its trip share of ${money(b.trip_share_cents)} moves to the horses not yet invoiced.` }));
    const actions = el('div', { class: 'dialog-actions' });
    actions.append(el('button', { onclick: () => dlg.close() }, 'Keep horse'));
    actions.append(el('button', { class: 'primary', onclick: async () => {
      setNotices('Excusing horse…');
      const res = await api.post(`/api/bookings/${b.booking_id}/excuse`, {});
      if (res.status === 200) {
        const adj = ((res.data.allocation || {}).adjustments || []).length;
        announce(`${b.horse_name} excused. Trip shares adjusted for ${Math.max(0, adj - 1)} horses.`);
        dlg.close();
        render();
      } else {
        announce(copyForError(res.status, res.data));
        dlg.close();
        if (opener) opener.focus();
      }
    } }, 'Excuse horse'));
    body.append(actions);
    return body;
  }, opener);
}

// --- Owner day view --------------------------------------------------------------------

async function renderOwnerDay(dayId, day) {
  const { main } = state.dom;
  const horsesRes = await api.get('/api/horses');
  const barnHorses = (horsesRes.data || []).filter(h => h.barn.id === day.barn.id);
  if (barnHorses.length === 0) {
    main.append(el('p', { text: "This barn day isn't available." }));
    return;
  }
  const horseSel = el('select', { 'aria-label': 'Horse' });
  for (const h of barnHorses) horseSel.append(el('option', { value: h.id, text: h.name }));
  const cardSel = el('select', { 'aria-label': 'Card' });
  for (const [v, label] of CARDS) cardSel.append(el('option', { value: v, text: label }));
  main.append(el('label', { text: 'Horse' }), horseSel, el('label', { text: 'Card' }), cardSel);
  const joinBtn = el('button', { 'aria-label': 'Join waitlist', onclick: async () => {
    joinBtn.disabled = true;
    setNotices('Joining waitlist…');
    const res = await api.post(`/api/barn-days/${dayId}/waitlist`, { horse_id: horseSel.value, card_token: cardSel.value });
    joinBtn.disabled = false;
    if (res.status === 201) announce(COPY.joined(barnHorses.find(h => h.id === horseSel.value).name, res.data.position));
    else announce(copyForError(res.status, res.data, { horse: barnHorses.find(h => h.id === horseSel.value).name }));
  } }, 'Join waitlist');
  main.append(joinBtn);
  const table = el('table', { 'aria-label': 'Slots' });
  const tbody = el('tbody');
  table.append(el('thead', {}, el('tr', {}, el('th', { text: 'Time' }), el('th', { text: 'Slot' }))), tbody);
  main.append(table);
  async function refresh() {
    const res = await api.get(`/api/barn-days/${dayId}`);
    const d = res.data;
    if (!d) return;
    const bookings = await api.get('/api/my/bookings');
    const mine = (bookings.data || []).filter(b => b.barn_day_id === dayId && ['held', 'confirmed'].includes(b.status));
    tbody.textContent = '';
    for (const slot of d.slots) {
      const tr = el('tr');
      tr.append(el('td', { 'data-label': 'Time', text: slot.time, class: 'num' }));
      const cell = el('td', { 'data-label': 'Slot' });
      const myBooking = mine.find(b => b.slot_id === slot.id);
      if (myBooking) {
        cell.append(el('span', { text: myBooking.horse.name }), ' ');
        cell.append(el('button', { onclick: () => cancelBooking(myBooking.id, d) }, `Cancel booking for ${myBooking.horse.name}`));
      } else if (slot.state === 'taken') {
        cell.append(el('span', { text: 'Taken' }));
      } else {
        cell.append(el('button', { class: 'primary', onclick: () => bookSlot(dayId, d, slot, horseSel.value, cardSel.value) }, `Book ${slot.time}`));
      }
      tr.append(cell);
      tbody.append(tr);
    }
  }
  await refresh();
  setRefresh(refresh, false);
}

function bookSlot(dayId, day, slot, horseId, cardToken) {
  const opener = document.activeElement;
  const horseName = horseNameById(horseId);
  setNotices('Holding slot…');
  api.post(`/api/barn-days/${dayId}/bookings`, { slot_id: slot.id, horse_id: horseId, card_token: cardToken }).then((res) => {
    if (res.status === 201) {
      openConfirmDialog(dayId, day, slot, res.data, opener);
    } else if (res.data && res.data.error === 'day_full') {
      announce(COPY.dayFull);
      document.querySelector('[aria-label="Join waitlist"]').focus();
    } else {
      announce(copyForError(res.status, res.data, { horse: horseName, time: slot.time }));
    }
  });
}

function horseNameById(id) {
  return (state.horsesById && state.horsesById[id]) || 'the horse';
}

function openConfirmDialog(dayId, day, slot, booking, opener) {
  const horseName = booking.horse.name;
  openDialog('Confirm booking', (dlg) => {
    const body = el('div', {});
    const depositText = booking.deposit_cents > 0 ? `Deposit ${money(booking.deposit_cents)}. ` : '';
    const zone = day.time_zone;
    const holdEnd = booking.hold_expires_at ? booking.hold_expires_at.slice(11, 19) : '';
    body.append(el('p', {
      text: `Hold ${slot.time} on ${day.business_date} at ${day.barn.name} for ${horseName}. ${depositText}Cancel by ${fmtCutoff(day.cancellation_cutoff_at, zone)} or the trip share still applies. Hold ends at ${holdEnd} (${zone}).`
    }));
    const actions = el('div', { class: 'dialog-actions' });
    const confirmBtn = el('button', { class: 'primary' }, 'Confirm booking');
    confirmBtn.addEventListener('click', async () => {
      confirmBtn.disabled = true;
      setNotices('Confirming booking…');
      const res = await api.post(`/api/bookings/${booking.id}/confirm`, {});
      if (res.status === 200) {
        announce(COPY.booked(horseName, slot.time, day.business_date));
        dlg.close();
        render();
      } else if (res.data && res.data.error === 'hold_expired') {
        announce(COPY.holdExpired(slot.time));
        dlg.close();
        const h = document.querySelector('[aria-label="Horse"]');
        if (h) h.focus();
        render();
      } else {
        confirmBtn.disabled = false;
        announce(copyForError(res.status, res.data));
      }
    });
    actions.append(confirmBtn);
    actions.append(el('button', {
      onclick: async () => {
        setNotices('Releasing hold…');
        await api.del(`/api/bookings/${booking.id}`);
        announce(COPY.released);
        dlg.close();
        if (opener && document.contains(opener)) opener.focus();
        render();
      }
    }, 'Release hold'));
    body.append(actions);
    return body;
  }, opener);
}

function cancelBooking(bookingId, day) {
  const opener = document.activeElement;
  api.get(`/api/bookings/${bookingId}/cancellation-preview`).then((preview) => {
    const p = preview.data || {};
    openDialog('Cancel booking', (dlg) => {
      const depositSentence = (p.deposit_cents || 0) > 0
        ? (p.late ? ` Your ${money(p.deposit_cents)} deposit is kept and set against the trip share.` : ` Your ${money(p.deposit_cents)} deposit will be refunded.`)
        : '';
      const text = p.late
        ? `The cutoff passed at ${fmtCutoff(p.cutoff_at, day.time_zone)}. A trip share still applies.${depositSentence}`
        : `Cancelling now is before the cutoff. No trip share applies.${depositSentence}`;
      const body = el('div', {});
      body.append(el('p', { text }));
      const actions = el('div', { class: 'dialog-actions' });
      actions.append(el('button', { onclick: () => dlg.close() }, 'Keep booking'));
      const confirm = el('button', { class: 'primary' }, 'Confirm cancellation');
      confirm.addEventListener('click', async () => {
        confirm.disabled = true;
        setNotices('Cancelling booking…');
        const res = await api.post(`/api/bookings/${bookingId}/cancel`, {});
        if (res.status === 200) {
          announce(res.data.trip_share_applies
            ? 'Booking cancelled. A trip share still applies for this day.'
            : 'Booking cancelled. No trip share applies.');
          dlg.close();
          render();
        } else {
          confirm.disabled = false;
          announce(copyForError(res.status, res.data));
        }
      });
      actions.append(confirm);
      body.append(actions);
      return body;
    }, opener);
  });
}

// --- Ready sheet -------------------------------------------------------------------------

async function renderReadySheet(dayId) {
  const { main } = state.dom;
  const table = el('table', { 'aria-label': 'Ready sheet' });
  const tbody = el('tbody');
  table.append(el('thead', {}, el('tr', {}, el('th', { text: 'Time' }), el('th', { text: 'Horse' }), el('th', { text: 'Stall' }))), tbody);
  main.append(table);
  async function refresh() {
    const res = await api.get(`/api/barn-days/${dayId}/bookings`);
    tbody.textContent = '';
    for (const b of res.data || []) {
      tbody.append(el('tr', {},
        el('td', { 'data-label': 'Time', text: b.slot_time, class: 'num' }),
        el('td', { 'data-label': 'Horse', text: b.horse_name }),
        el('td', { 'data-label': 'Stall', text: b.stall, class: 'num' })));
    }
  }
  await refresh();
  setRefresh(refresh, false);
  openStream(`/api/barn-days/${dayId}/events`, `day:${dayId}`, () => refresh());
}

// Horse panel, invoices, prices, dashboard, vet page.

async function renderHorses() {
  const { main } = state.dom;
  if (state.me.role === 'farrier') {
    main.append(el('button', { class: 'primary', onclick: openImportDialog }, 'Import CSV'));
  }
  const table = el('table', { 'aria-label': 'Horses' });
  const tbody = el('tbody');
  table.append(el('thead', {}, el('tr', {}, el('th', { text: 'Horse' }), el('th', { text: 'Barn' }), el('th', { text: 'Stall' }), el('th', { text: 'Next due' }))), tbody);
  main.append(table);
  const res = await api.get('/api/horses');
  state.horsesById = {};
  for (const h of res.data || []) {
    state.horsesById[h.id] = h.name;
    const due = h.due_status === 'unknown' ? 'No visits yet'
      : h.due_status === 'current' ? `Next due ${h.next_due_date}`
      : h.due_status === 'due' ? `Due ${h.next_due_date}`
      : `Overdue, was due ${h.next_due_date}`;
    tbody.append(el('tr', {},
      el('td', {}, el('a', { href: `/horses/${h.id}` }, h.name)),
      el('td', { 'data-label': 'Barn', text: h.barn.name }),
      el('td', { 'data-label': 'Stall', class: 'num', text: h.stall }),
      el('td', { 'data-label': 'Next due', text: due })));
  }
}

function openImportDialog() {
  const opener = document.activeElement;
  openDialog('Import CSV', (dlg) => {
    const form = el('form', {});
    const file = el('input', { type: 'file', accept: '.csv,text/csv', 'aria-label': 'CSV file', required: true });
    form.append(el('label', { text: 'CSV file' }), file);
    form.append(el('button', { class: 'primary', type: 'submit' }, 'Import'));
    const errTable = el('table', { 'aria-label': 'Import errors', style: 'display:none' });
    errTable.append(el('thead', {}, el('tr', {}, el('th', { text: 'Line' }), el('th', { text: 'Column' }), el('th', { text: 'Code' }))));
    const errBody = el('tbody');
    errTable.append(errBody);
    form.append(errTable);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      setNotices('Importing…');
      const raw = await file.files[0].arrayBuffer();
      const res = await fetch('/api/imports', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv', 'Idempotency-Key': `import-${Date.now()}-${Math.random().toString(36).slice(2)}` },
        body: new Uint8Array(raw),
        credentials: 'same-origin'
      });
      const data = await res.json().catch(() => null);
      if (res.status === 201) {
        announce(`Import finished: ${data.created_owners} owners created, ${data.matched_owners} matched, ${data.created_horses} horses created, ${data.updated_horses} updated.`);
        dlg.close();
        render();
      } else {
        announce('Nothing was imported. Fix the rows listed and try again.');
        errTable.style.display = '';
        errBody.textContent = '';
        for (const err of (data && data.errors) || []) {
          errBody.append(el('tr', {}, el('td', { text: String(err.line) }), el('td', { text: err.column }), el('td', { text: err.code })));
        }
      }
    });
    return form;
  }, opener);
}

async function renderHorse(horseId) {
  const hoofParam = new URLSearchParams(location.search).get('hoof');
  const hoof = HOOF_ORDER.includes(hoofParam) ? hoofParam : 'LF';
  const horseRes = await api.get(`/api/horses/${horseId}`);
  const { main } = state.dom;
  if (horseRes.status === 404) {
    main.append(el('p', { text: "This horse isn't available." }));
    return;
  }
  const horse = horseRes.data;
  if (!state.horsesById) state.horsesById = {};
  state.horsesById[horse.id] = horse.name;
  main.append(el('h2', { text: horse.name }));
  const due = horse.due_status === 'unknown' ? 'No visits yet'
    : horse.due_status === 'current' ? `Next due ${horse.next_due_date}`
    : horse.due_status === 'due' ? `Due ${horse.next_due_date}`
    : `Overdue, was due ${horse.next_due_date}`;
  main.append(el('p', { text: due }));

  const region = el('section', { 'aria-label': 'Hoof comparison' });
  main.append(region);
  const stage = makeStage(region, {});
  region.append(stage.stage);
  const hoofGrid = el('div', { class: 'hoof-grid', role: 'radiogroup', 'aria-label': 'Hoof' });
  const hoofRadios = {};
  for (const code of HOOF_ORDER) {
    const label = el('label', {});
    hoofRadios[code] = el('input', { type: 'radio', name: 'hoof', value: code });
    if (code === hoof) hoofRadios[code].setAttribute('checked', 'checked');
    hoofRadios[code].addEventListener('change', () => {
      const url = new URL(location.href);
      url.searchParams.set('hoof', code);
      history.replaceState({}, '', url);
      loadComparison(code, prevSel.value, curSel.value);
    });
    label.append(hoofRadios[code], el('span', { text: HOOF_LABELS[code] }), el('img', { alt: '' }));
    hoofGrid.append(label);
  }
  region.append(hoofGrid);
  const readout = makeReadout();
  region.append(readout.region);
  const prevSel = el('select', { 'aria-label': 'Previous visit' });
  const curSel = el('select', { 'aria-label': 'Current visit' });
  for (const sel of [prevSel, curSel]) {
    sel.addEventListener('change', () => loadComparison(currentHoof(), prevSel.value, curSel.value, true));
  }
  region.append(el('label', { text: 'Previous visit' }), prevSel, el('label', { text: 'Current visit' }), curSel);

  function currentHoof() {
    const checked = hoofGrid.querySelector('input:checked');
    return checked ? checked.value : 'LF';
  }

  async function loadComparison(hoofCode, prevId, curId, animate) {
    let q = `?hoof=${hoofCode}`;
    if (prevId && curId) q += `&previous=${encodeURIComponent(prevId)}&current=${encodeURIComponent(curId)}`;
    const res = await api.get(`/api/horses/${horseId}/comparison${q}`);
    if (res.status !== 200) {
      if (res.data && res.data.error === 'not_enough_marked_visits') readout.set(['Not enough marked visits to compare yet.']);
      return;
    }
    const data = res.data;
    const pw = (data.previous.photo || {}).width || 1;
    const ph = (data.previous.photo || {}).height || 1;
    stage.setPhotos(
      (data.previous.photo || {}).url || '',
      (data.current.photo || {}).url || '',
      data.previous.hoof_wall ? { hoof_wall: data.previous.hoof_wall, pastern: data.previous.pastern } : null,
      data.current.hoof_wall ? { hoof_wall: data.current.hoof_wall, pastern: data.current.pastern } : null,
      pw, ph);
    readout.countTo(data.readout);
    stage.setDivider(50, animate);
    if (!prevId || !curId) {
      prevSel.textContent = '';
      curSel.textContent = '';
      for (const v of data.marked_visits.slice().reverse()) prevSel.append(el('option', { value: v.visit_id, text: v.business_date }));
      for (const v of data.marked_visits) curSel.append(el('option', { value: v.visit_id, text: v.business_date }));
      prevSel.value = data.previous.visit_id;
      curSel.value = data.current.visit_id;
    }
  }
  await loadComparison(hoof, null, null, false);

  const visitsRes = await api.get(`/api/horses/${horseId}/visits`);
  const visitList = el('table', { 'aria-label': 'Visits' });
  const vbody = el('tbody');
  visitList.append(el('thead', {}, el('tr', {}, el('th', { text: 'Date' }), el('th', { text: 'Status' }), el('th', { text: 'Invoice' }))), vbody);
  main.append(visitList);
  let hasPending = false;
  for (const v of visitsRes.data || []) {
    let invText = '';
    if (state.me.role === 'owner') {
      invText = v.invoice ? (v.invoice.status === 'pending' ? 'Pending' : v.invoice.status === 'paid' ? 'Paid' : 'Unpaid') : '';
    } else {
      invText = v.invoice
        ? (v.invoice.status === 'pending' ? 'Invoice pending' : `Invoiced ${money(v.invoice.total_cents)}`)
        : (v.status === 'invoiced' ? 'Billed before Clinchline' : '');
    }
    if (v.invoice && v.invoice.status === 'pending') hasPending = true;
    vbody.append(el('tr', {},
      el('td', { 'data-label': 'Date', class: 'num', text: v.business_date }),
      el('td', { 'data-label': 'Status', text: v.status.replace(/_/g, ' ') }),
      el('td', { 'data-label': 'Invoice', text: invText })));
  }
  const openVisit = (visitsRes.data || []).find(v => v.status === 'open');
  if (openVisit && (state.me.role === 'farrier' || state.me.role === 'apprentice')) {
    main.append(renderVisitTools(openVisit, horse, stage, readout));
  }
  if (state.me.role === 'farrier') {
    main.append(el('h3', { text: 'Vet links' }));
    const vetTable = el('table', { 'aria-label': 'Vet links' });
    const vt = el('tbody');
    vetTable.append(el('thead', {}, el('tr', {}, el('th', { text: 'Vet' }), el('th', { text: 'Pair' }), el('th', { text: 'Views' }), el('th', {}))), vt);
    main.append(vetTable);
    const links = await api.get(`/api/horses/${horseId}/vet-links`);
    for (const l of links.data || []) {
      const row = el('tr', {},
        el('td', { text: `${l.vet_name} <${l.vet_email}>` }),
        el('td', { text: l.previous_date ? `${l.previous_date} → ${l.current_date}` : '' }),
        el('td', { class: 'num', text: String(l.view_count) }));
      const cell = el('td', {});
      cell.append(el('button', { onclick: () => revokeVet(l) }, `Revoke link to ${l.vet_email}`));
      cell.append(el('button', { onclick: () => regenerateVet(l) }, `Regenerate link to ${l.vet_email}`));
      cell.append(el('button', { onclick: () => showVetViews(l) }, `Views for ${l.vet_email}`));
      row.append(cell);
      vt.append(row);
    }
    main.append(el('button', { class: 'primary', onclick: () => openVetDialog(horseId) }, 'Send vet link'));
  }
  setRefresh(() => renderHorse(horseId), hasPending);
}

function renderVisitTools(visit, horse, stage, readout) {
  const wrap = el('section', { 'aria-label': 'Open visit tools' });
  wrap.append(el('h3', { text: `Open visit ${visit.business_date}` }));
  const hoofSel = el('select', { 'aria-label': 'Hoof' });
  for (const c of HOOF_ORDER) hoofSel.append(el('option', { value: c, text: HOOF_LABELS[c] }));
  const phaseRadios = el('div', { role: 'radiogroup', 'aria-label': 'Phase' });
  const beforeRadio = el('input', { type: 'radio', name: 'phase', value: 'before' });
  const afterRadio = el('input', { type: 'radio', name: 'phase', value: 'after' });
  afterRadio.setAttribute('checked', 'checked');
  phaseRadios.append(el('label', {}, beforeRadio, 'Before'), el('label', {}, afterRadio, 'After'));
  const fileInput = el('input', { type: 'file', 'aria-label': 'Photo file', accept: 'image/*' });
  const uploadBtn = el('button', { class: 'primary' }, 'Upload photo');
  const resumeBtn = el('button', { style: 'display:none' }, 'Resume upload');
  uploadBtn.addEventListener('click', async () => {
    if (!fileInput.files[0]) return;
    uploadBtn.disabled = true;
    setNotices('Uploading photo… 0%');
    const file = fileInput.files[0];
    const body = new FormData();
    body.append('hoof', hoofSel.value);
    body.append('phase', phaseRadios.querySelector('input:checked').value);
    body.append('file', file);
    const res = await fetch(`/api/visits/${visit.id}/photos`, { method: 'POST', body, credentials: 'same-origin' });
    uploadBtn.disabled = false;
    if (res.status === 201) {
      announce(`Photo saved for ${HOOF_LABELS[hoofSel.value]} (after).`);
      renderHorse(horse.id);
    } else {
      const data = await res.json().catch(() => null);
      announce(copyForError(res.status, data));
    }
  });
  const uploadRow = el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;align-items:center' });
  uploadRow.append(hoofSel, phaseRadios, fileInput, uploadBtn, resumeBtn);
  wrap.append(uploadRow);
  for (const p of visit.photos || []) {
    wrap.append(el('span', { style: 'display:inline-flex;align-items:center;gap:6px;margin:4px' },
      el('img', { src: p.thumbnail_url || p.url, alt: `${HOOF_LABELS[p.hoof]} ${p.phase}`, style: 'width:88px;height:66px;object-fit:cover' }),
      el('button', { onclick: async () => {
        setNotices('Deleting photo…');
        const res = await api.del(`/api/photos/${p.id}`);
        if (res.status === 204) { announce(`Photo deleted for ${HOOF_LABELS[p.hoof]} (${p.phase}).`); renderHorse(horse.id); }
        else announce(copyForError(res.status, null));
      } }, `Delete ${HOOF_LABELS[p.hoof]} ${p.phase} photo`)));
  }
  const marks = (visit.marks || [])[0];
  const marksForm = el('form', { 'aria-label': 'Marks', style: 'display:grid;gap:8px' });
  const lineGroup = (name, line) => {
    const group = el('fieldset', { 'aria-label': name });
    group.style.display = 'grid';
    group.style.gap = '6px';
    const fields = {};
    const labels = { x1: 'Start x', y1: 'Start y', x2: 'End x', y2: 'End y' };
    for (const k of ['x1', 'y1', 'x2', 'y2']) {
      const input = el('input', { type: 'number', step: 'any', 'aria-label': `${name} ${labels[k]}`, value: line ? String(line[k]) : '' });
      fields[k] = input;
      group.append(el('label', { text: labels[k] }), input);
    }
    return { group, fields };
  };
  const hw = lineGroup('Hoof wall line', marks ? marks.hoof_wall : null);
  const pt = lineGroup('Pastern line', marks ? marks.pastern : null);
  marksForm.append(hw.group, pt.group);
  marksForm.append(el('button', { type: 'button', onclick: () => { marksForm.dataset.arming = 'hoof_wall'; announce('Click the photo to place the hoof-wall line.'); } }, 'Mark hoof wall'));
  marksForm.append(el('button', { type: 'button', onclick: () => { marksForm.dataset.arming = 'pastern'; announce('Click the photo to place the pastern line.'); } }, 'Mark pastern'));
  marksForm.append(el('button', { class: 'primary', type: 'submit' }, 'Save marks'));
  stage.stage.addEventListener('click', (e) => {
    if (!marksForm.dataset.arming) return;
    const rect = stage.stage.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * 900;
    const py = ((e.clientY - rect.top) / rect.height) * 1200;
    const group = marksForm.dataset.arming === 'hoof_wall' ? hw : pt;
    if (!group._p1) { group._p1 = [px, py]; return; }
    group.fields.x1.value = String(Math.round(group._p1[0]));
    group.fields.y1.value = String(Math.round(group._p1[1]));
    group.fields.x2.value = String(Math.round(px));
    group.fields.y2.value = String(Math.round(py));
    group._p1 = null;
    marksForm.dataset.arming = '';
  });
  marksForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setNotices('Saving marks…');
    const body = {
      version: marks ? marks.version : null,
      hoof_wall: { x1: Number(hw.fields.x1.value), y1: Number(hw.fields.y1.value), x2: Number(hw.fields.x2.value), y2: Number(hw.fields.y2.value) },
      pastern: { x1: Number(pt.fields.x1.value), y1: Number(pt.fields.y1.value), x2: Number(pt.fields.x2.value), y2: Number(pt.fields.y2.value) }
    };
    const res = await api.put(`/api/visits/${visit.id}/hooves/${hoofSel.value}/marks`, body);
    if (res.status === 200) {
      announce(`Marks saved: hoof wall ${angle(res.data.hoof_wall.angle)}°, pastern ${angle(res.data.pastern.angle)}°, ${res.data.alignment}.`);
      renderHorse(horse.id);
    } else if (res.status === 412) {
      announce('Someone else saved marks first. Their lines are now shown; check them and save again.');
      const cur = res.data && res.data.current;
      if (cur) {
        hw.fields.x1.value = cur.hoof_wall.x1; hw.fields.y1.value = cur.hoof_wall.y1;
        hw.fields.x2.value = cur.hoof_wall.x2; hw.fields.y2.value = cur.hoof_wall.y2;
        pt.fields.x1.value = cur.pastern.x1; pt.fields.y1.value = cur.pastern.y1;
        pt.fields.x2.value = cur.pastern.x2; pt.fields.y2.value = cur.pastern.y2;
        hw.fields.x1.focus();
      }
    } else announce(copyForError(res.status, res.data));
  });
  wrap.append(marksForm);

  const history = el('table', { 'aria-label': 'Marks history' });
  const hbody = el('tbody');
  history.append(el('thead', {}, el('tr', {}, ...['Version', 'Hoof wall', 'Pastern', 'Alignment', 'Saved by', 'Saved at', ''].map(h => el('th', { text: h })))), hbody);
  wrap.append(history);
  api.get(`/api/visits/${visit.id}/hooves/${hoofSel.value}/marks/history`).then(res => {
    for (const m of res.data || []) {
      hbody.append(el('tr', {},
        el('td', { class: 'num', text: String(m.version) }),
        el('td', { class: 'num', text: `${angle(m.hoof_wall.angle)}°` }),
        el('td', { class: 'num', text: `${angle(m.pastern.angle)}°` }),
        el('td', { text: m.alignment }),
        el('td', { text: m.saved_by.name }),
        el('td', { class: 'num', text: m.saved_at }),
        el('td', {}, el('button', { onclick: async () => {
          setNotices('Restoring marks…');
          const latest = (res.data || []).slice(-1)[0];
          const r2 = await api.post(`/api/visits/${visit.id}/hooves/${hoofSel.value}/marks/restore`, { version: latest ? latest.version : null, restore_version: m.version });
          if (r2.status === 200) { announce(`Restored version ${m.version} as version ${r2.data.version}.`); renderHorse(horse.id); }
          else announce(copyForError(r2.status, r2.data));
        } }, `Restore version ${m.version}`))));
    }
  });

  if (state.me.role === 'farrier') {
    const closeForm = el('form', { 'aria-label': 'Work done', style: 'display:grid;gap:6px' });
    const checks = {};
    for (const code of SERVICE_ORDER) {
      checks[code] = el('input', { type: 'checkbox', name: code });
      closeForm.append(el('label', {}, checks[code], SERVICE_LABELS[code]));
    }
    const note = el('input', { type: 'text', 'aria-label': 'Visit note', name: 'note', placeholder: 'Visit note' });
    closeForm.append(note);
    closeForm.append(el('button', { class: 'primary', type: 'submit' }, 'Close visit'));
    closeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      setNotices('Closing visit…');
      const work = SERVICE_ORDER.filter(c => checks[c].checked);
      const res = await api.post(`/api/visits/${visit.id}/close`, { work, note: note.value || '' }, { idempotencyKey: `close-${visit.id}-${Date.now()}` });
      if (res.status === 200) {
        announce(res.data.status === 'invoiced'
          ? `Visit closed and invoiced: ${money(res.data.invoice ? res.data.invoice.total_cents : 0)}.`
          : 'Visit closed — invoice pending. It will be invoiced when billing is back.');
        renderHorse(horse.id);
      } else announce(copyForError(res.status, res.data));
    });
    wrap.append(closeForm);
  }
  return wrap;
}

function openVetDialog(horseId) {
  const opener = document.activeElement;
  openDialog('Send vet link', (dlg) => {
    const form = el('form', {});
    form.append(el('label', { text: 'Vet name' }), el('input', { name: 'vet_name', 'aria-label': 'Vet name', required: true }));
    form.append(el('label', { text: 'Vet email' }), el('input', { type: 'email', name: 'vet_email', 'aria-label': 'Vet email', required: true }));
    const actions = el('div', { class: 'dialog-actions' });
    actions.append(el('button', { class: 'primary', type: 'submit' }, 'Send link'));
    actions.append(el('button', { type: 'button', onclick: () => dlg.close() }, 'Cancel'));
    form.append(actions);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      setNotices('Sending link…');
      const res = await api.post(`/api/horses/${horseId}/vet-links`, {
        vet_name: form.querySelector('[name=vet_name]').value,
        vet_email: form.querySelector('[name=vet_email]').value
      });
      if (res.status === 201) {
        announce(`Comparison link sent to ${form.querySelector('[name=vet_email]').value}.`);
        dlg.close();
        render();
      } else {
        showErrors(form, res.data && res.data.errors);
        announce(copyForError(res.status, res.data));
      }
    });
    return form;
  }, opener);
}

async function revokeVet(l) {
  setNotices('Revoking…');
  const res = await api.post(`/api/vet-links/${l.id}/revoke`, {});
  if (res.status === 200) { announce('Link revoked.'); render(); }
  else announce(copyForError(res.status, res.data));
}

async function regenerateVet(l) {
  setNotices('Sending new link…');
  const res = await api.post(`/api/vet-links/${l.id}/regenerate`, {});
  if (res.status === 200) announce(`New link sent to ${l.vet_email}. The old link no longer works.`);
  else announce(copyForError(res.status, res.data));
}

async function showVetViews(l) {
  const res = await api.get(`/api/vet-links/${l.id}/views`);
  openDialog('Link views', () => {
    const table = el('table', { 'aria-label': 'Link views' });
    table.append(el('thead', {}, el('tr', {}, ...['At', 'Address', 'Outcome', 'Pair', 'User agent'].map(h => el('th', { text: h })))));
    const tb = el('tbody');
    for (const v of res.data || []) {
      tb.append(el('tr', {},
        el('td', { class: 'num', text: v.at }),
        el('td', { text: v.address }),
        el('td', { text: v.outcome }),
        el('td', { text: v.previous_date ? `${v.previous_date} → ${v.current_date}` : '' }),
        el('td', { text: v.user_agent || '' })));
    }
    table.append(tb);
    return table;
  });
}

async function renderInvoices() {
  const { main } = state.dom;
  const cardSel = el('select', { 'aria-label': 'Card' });
  for (const [v, label] of CARDS) cardSel.append(el('option', { value: v, text: label }));
  main.append(el('label', { text: 'Card' }), cardSel);
  const table = el('table', { 'aria-label': 'Invoices' });
  const heads = ['Date', 'Horse', 'Kind', 'Total', 'Balance', 'Status', 'Dunning'];
  if (state.me.role === 'farrier') heads.push('Reconciliation');
  heads.push('');
  table.append(el('thead', {}, el('tr', {}, ...heads.map(h => el('th', { text: h })))));
  const tbody = el('tbody');
  table.append(tbody);
  main.append(table);
  let hasPending = false;
  async function refresh() {
    const res = await api.get('/api/invoices');
    hasPending = false;
    tbody.textContent = '';
    for (const inv of res.data || []) {
      if (inv.status === 'pending') hasPending = true;
      const prevShown = state.pendingSeen.has(inv.id);
      if (prevShown && inv.status !== 'pending') {
        state.pendingSeen.delete(inv.id);
        announce(inv.kind === 'visit'
          ? `Invoice for ${inv.horse.name} is now in billing: ${money(inv.total_cents)}.`
          : `Trip-share invoice for ${inv.horse.name} is now in billing: ${money(inv.total_cents)}.`);
      } else if (inv.status === 'pending') {
        state.pendingSeen.add(inv.id);
      }
      const dunningText = { past_due: 'Past due', retry_1: 'Retry 1', retry_2: 'Retry 2', blocked: 'Blocked', cleared: 'Cleared' }[inv.dunning_state] || '';
      const tr = el('tr', {},
        el('td', { 'data-label': 'Date', class: 'num', text: inv.business_date }),
        el('td', { 'data-label': 'Horse', text: inv.horse.name }),
        el('td', { 'data-label': 'Kind', text: inv.kind }),
        el('td', { 'data-label': 'Total', class: 'num', text: money(inv.total_cents) }),
        el('td', { 'data-label': 'Balance', class: 'num', text: money(inv.balance_cents) }),
        el('td', { 'data-label': 'Status', text: inv.status === 'pending' ? 'Pending' : inv.status === 'paid' ? 'Paid' : 'Unpaid' }),
        el('td', { 'data-label': 'Dunning', text: dunningText }));
      if (state.me.role === 'farrier') {
        const reconRes = await api.get(`/api/invoices/${inv.id}/reconciliation`);
        const reconText = { matched: 'Matched', mismatch: 'Mismatch', unavailable: 'Unavailable' }[(reconRes.data || {}).status] || 'Unchecked';
        tr.append(el('td', { 'data-label': 'Reconciliation', text: reconText }));
      }
      const payCell = el('td', { 'data-label': 'Pay' });
      if (state.me.role === 'owner' && inv.status === 'unpaid') {
        const payBtn = el('button', { class: 'primary' }, `Pay ${inv.horse.name} ${inv.business_date}`);
        payBtn.addEventListener('click', async () => {
          payBtn.disabled = true;
          setNotices('Recording payment…');
          const out = await api.post(`/api/invoices/${inv.id}/payments`, { card_token: cardSel.value }, { idempotencyKey: `pay-${inv.id}-${Date.now()}` });
          payBtn.disabled = false;
          if (out.status === 201) { announce(`Payment of ${money(inv.balance_cents)} recorded.`); refresh(); }
          else if (out.data && out.data.error === 'already_paid') { announce('This invoice is already paid.'); refresh(); }
          else if (out.data && out.data.error === 'invoice_pending') announce('This invoice is still pending. Try again once it shows as unpaid.');
          else if (out.status === 503) announce('Billing is unreachable. Your payment was not recorded; try again shortly.');
          else if (out.status === 402) {
            const soft = out.data && out.data.decline_code === 'insufficient_funds';
            announce(soft
              ? `Payment failed: ${inv.horse.name} on ${inv.business_date}. We will try again on the next retry date.`
              : `Account on hold: ${inv.horse.name} on ${inv.business_date}. New bookings are on hold until this invoice is paid.`);
            refresh();
          }
          else announce(copyForError(out.status, out.data));
          if (payBtn.offsetParent !== null) payBtn.focus();
        });
        payCell.append(payBtn);
      }
      tr.append(payCell);
      tbody.append(tr);
    }
    setRefresh(refresh, hasPending);
  }
  await refresh();
}

async function renderPrices() {
  const { main } = state.dom;
  main.append(el('button', { class: 'primary', onclick: openPriceDialog }, 'New price list'));
  const table = el('table', { 'aria-label': 'Price lists' });
  const tbody = el('tbody');
  table.append(el('thead', {}, el('tr', {}, el('th', { text: 'Effective from' }), el('th', { text: 'Deposit' }), ...SERVICE_ORDER.map(c => el('th', { text: SERVICE_LABELS[c] })))), tbody);
  main.append(table);
  const res = await api.get('/api/price-lists');
  for (const p of res.data || []) {
    tbody.append(el('tr', {},
      el('td', { class: 'num', text: p.effective_from }),
      el('td', { class: 'num', text: money(p.deposit_cents) }),
      ...SERVICE_ORDER.map(c => el('td', { class: 'num', text: money(p.prices[c]) }))));
  }
  main.append(el('h3', { text: 'API tokens' }));
  main.append(el('button', { class: 'primary', onclick: openTokenDialog }, 'New API token'));
  const tokTable = el('table', { 'aria-label': 'API tokens' });
  const tokBody = el('tbody');
  tokTable.append(el('thead', {}, el('tr', {}, el('th', { text: 'Name' }), el('th', { text: 'Scope' }), el('th', { text: 'Created' }), el('th', {}))), tokBody);
  main.append(tokTable);
  const tokens = await api.get('/api/tokens');
  for (const t of tokens.data || []) {
    const row = el('tr', {}, el('td', { text: t.name }), el('td', { text: t.scope }), el('td', { class: 'num', text: t.created_at }));
    const cell = el('td', {});
    cell.append(el('button', { onclick: async () => {
      const r = await api.del(`/api/tokens/${t.id}`);
      if (r.status === 204) { announce('Token revoked.'); render(); }
    } }, `Revoke token ${t.name}`));
    row.append(cell);
    tokBody.append(row);
  }
}

function openPriceDialog() {
  const opener = document.activeElement;
  openDialog('New price list', (dlg) => {
    const form = el('form', {});
    form.append(el('label', { text: 'Effective from' }), el('input', { type: 'date', name: 'effective_from', 'aria-label': 'Effective from', required: true }));
    form.append(el('label', { text: 'Deposit (dollars)' }), el('input', { type: 'text', name: 'deposit', 'aria-label': 'Deposit', placeholder: '25.00' }));
    const priceInputs = {};
    for (const code of SERVICE_ORDER) {
      priceInputs[code] = el('input', { type: 'text', name: code, 'aria-label': SERVICE_LABELS[code], placeholder: '55.00' });
      form.append(el('label', { text: SERVICE_LABELS[code] }), priceInputs[code]);
    }
    form.append(el('button', { class: 'primary', type: 'submit' }, 'Save price list'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      setNotices('Saving…');
      const deposit = parseFloat(form.querySelector('[name=deposit]').value || '0');
      const prices = {};
      for (const code of SERVICE_ORDER) prices[code] = Math.round(parseFloat(priceInputs[code].value || '0') * 100);
      const res = await api.post('/api/price-lists', {
        effective_from: form.querySelector('[name=effective_from]').value,
        deposit_cents: Math.round((isNaN(deposit) ? 0 : deposit) * 100),
        prices
      });
      if (res.status === 201) { announce('Price list saved.'); dlg.close(); render(); }
      else {
        showErrors(form, res.data && res.data.errors);
        announce(copyForError(res.status, res.data));
      }
    });
    return form;
  }, opener);
}

function openTokenDialog() {
  const opener = document.activeElement;
  openDialog('New API token', (dlg) => {
    const form = el('form', {});
    form.append(el('label', { text: 'Name' }), el('input', { name: 'name', 'aria-label': 'Name', required: true }));
    const scope = el('select', { name: 'scope', 'aria-label': 'Scope' });
    scope.append(el('option', { value: 'read_only', text: 'Read only' }), el('option', { value: 'billing', text: 'Billing' }));
    form.append(el('label', { text: 'Scope' }), scope);
    form.append(el('button', { class: 'primary', type: 'submit' }, 'Create token'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      setNotices('Saving…');
      const res = await api.post('/api/tokens', { name: form.querySelector('[name=name]').value, scope: scope.value });
      if (res.status === 201) {
        announce('Copy this token now. It won\'t be shown again.');
        const shown = form.querySelector('.token-display');
        if (shown) shown.remove();
        form.append(el('p', { class: 'token-display' }, el('strong', { text: res.data.token })));
      } else {
        showErrors(form, res.data && res.data.errors);
      }
    });
    return form;
  }, opener);
}

async function renderDashboard() {
  const { main } = state.dom;
  const monthSel = el('select', { 'aria-label': 'Month' });
  const exportBtn = el('button', { class: 'primary' }, 'Export CSV');
  const line = el('div', { style: 'display:flex;gap:12px;flex-wrap:wrap;align-items:center' });
  line.append(monthSel, exportBtn);
  main.append(line);
  const totals = el('table', { 'aria-label': 'Month totals' });
  const chart = el('figure', { 'aria-label': 'Billed and collected' });
  const daily = el('table', { 'aria-label': 'Daily figures', tabindex: '0' });
  const grid = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:16px' });
  if (state.smallScreen) grid.style.gridTemplateColumns = '1fr';
  grid.append(el('div', {}, totals), el('div', {}, chart));
  main.append(grid, daily);

  const months = [];
  const nowD = new Date();
  for (let i = 0; i < 13; i++) {
    const d = new Date(nowD.getFullYear(), nowD.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  for (const m of months) monthSel.append(el('option', { value: m, text: m }));
  monthSel.addEventListener('change', () => load(monthSel.value));
  exportBtn.addEventListener('click', async () => {
    setNotices('Preparing export…');
    const res = await api.post('/api/dashboard/exports', { month: monthSel.value });
    if (res.status === 202) {
      const jobId = res.data.job_id;
      const poll = setInterval(async () => {
        const j = await api.get(`/api/jobs/${jobId}`);
        if (j.data && j.data.status === 'succeeded') {
          clearInterval(poll);
          announce('Export ready.');
          line.append(el('a', { href: j.data.result.url, text: 'Download export' }));
        } else if (j.data && j.data.status === 'dead') {
          clearInterval(poll);
          announce('The export failed. It can be retried from the job list.');
        }
      }, 1000);
    } else announce(copyForError(res.status, res.data));
  });

  async function load(month) {
    const res = await api.get(`/api/dashboard?month=${month}`);
    const d = res.data;
    totals.textContent = '';
    totals.append(el('thead', {}, el('tr', {}, ...['Billed', 'Collected', 'Refunded', 'Outstanding', 'Overdue horses'].map(h => el('th', { text: h })))));
    totals.append(el('tbody', {}, el('tr', {},
      el('td', { class: 'num', text: money(d.billed_cents) }),
      el('td', { class: 'num', text: money(d.collected_cents) }),
      el('td', { class: 'num', text: money(d.refunded_cents) }),
      el('td', { class: 'num', text: money(d.outstanding_cents) }),
      el('td', { class: 'num', text: String(d.overdue_horses) }))));
    chart.textContent = '';
    const alt = `Billed ${money(d.billed_cents)}, collected ${money(d.collected_cents)} in ${month}.`;
    const maxV = Math.max(1, d.billed_cents, d.collected_cents);
    const bar = (label, v, color) => el('div', { style: 'display:flex;align-items:center;gap:8px;margin:4px 0' },
      el('span', { text: label, style: 'min-width:76px' }),
      el('div', { style: `background:${color};height:22px;width:${Math.max(2, (v / maxV) * 55)}%` }),
      el('span', { class: 'num', text: money(v) }));
    chart.append(el('figcaption', { text: alt }), bar('Billed', d.billed_cents, '#4a6f8f'), bar('Collected', d.collected_cents, '#d1580f'));
    daily.textContent = '';
    daily.append(el('thead', {}, el('tr', {}, ...['Date', 'Billed', 'Collected', 'Refunded'].map(h => el('th', { text: h })))));
    const tb = el('tbody');
    for (const r of d.rows || []) {
      tb.append(el('tr', {},
        el('td', { class: 'num', text: r.date }),
        el('td', { class: 'num', text: money(r.billed_cents) }),
        el('td', { class: 'num', text: money(r.collected_cents) }),
        el('td', { class: 'num', text: money(r.refunded_cents) })));
    }
    daily.append(tb);
  }
  await load(months[0]);
}

async function renderVetPage(path) {
  const token = path.slice('/vet/'.length);
  const main = document.getElementById('app');
  main.textContent = '';
  const res = await api.get(`/api/vet/${token}`);
  if (res.status === 404) {
    main.append(el('p', { text: 'This comparison link is no longer available.' }));
    return;
  }
  if (res.status === 429) {
    const retry = (res.headers && res.headers.get && res.headers.get('Retry-After')) || 1;
    main.append(el('p', { text: COPY.rateLimit(retry) }));
    return;
  }
  const data = res.data;
  document.title = `Hoof comparison — ${data.horse.name}`;
  main.append(el('h1', { text: data.horse.name }));
  main.append(el('p', { class: 'num', text: `${data.previous_date} → ${data.current_date}` }));
  const region = el('section', { 'aria-label': 'Hoof comparison' });
  main.append(region);
  const stage = makeStage(region, {});
  region.append(stage.stage);
  const hoofGrid = el('div', { class: 'hoof-grid', role: 'radiogroup', 'aria-label': 'Hoof' });
  const readout = makeReadout();
  function showHoof(code) {
    const e = data.hooves[code];
    if (!e) {
      readout.set(['This hoof has no comparison.']);
      return;
    }
    stage.setPhotos(e.previous.photo.url, e.current.photo.url, e.previous, e.current, e.current.photo.width, e.current.photo.height);
    readout.set(e.readout);
    stage.setDivider(50, true);
  }
  for (const code of HOOF_ORDER) {
    const label = el('label', {});
    const radio = el('input', { type: 'radio', name: 'hoof', value: code });
    if (code === 'LF') radio.setAttribute('checked', 'checked');
    radio.addEventListener('change', () => showHoof(code));
    label.append(radio, el('span', { text: HOOF_LABELS[code] }));
    hoofGrid.append(label);
  }
  region.append(hoofGrid, readout.region);
  showHoof('LF');
}

// App bootstrap and route rendering.

const app = document.getElementById('app');

async function render() {
  const path = location.pathname;
  closeAllStreams();
  app.textContent = '';
  if (path.startsWith('/vet/')) {
    renderShell(app, path);
    await renderVetPage(path);
    return;
  }
  if (path === '/sign-in' || !state.me) {
    const meRes = await api.get('/api/me');
    if (meRes.status !== 200) {
      const target = path.startsWith('/') && !path.startsWith('//') ? location.pathname + location.search : '/';
      sessionStorage.setItem('return-to', target);
      renderSignIn();
      return;
    }
    state.me = meRes.data;
  }
  renderShell(app, path);
  await loadShell();
  noticesRegion();
  if (path === '/' || path === '') {
    const days = await api.get('/api/barn-days');
    if ((days.data || []).length > 0) {
      history.replaceState({}, '', `/days/${days.data[0].id}`);
      return render();
    }
    state.dom.main.append(el('p', { text: '' }));
  } else if (path.startsWith('/days/')) {
    await renderDay(path.slice('/days/'.length));
  } else if (path.startsWith('/horses/')) {
    await renderHorse(path.slice('/horses/'.length).split('?')[0]);
  } else if (path === '/horses') {
    await renderHorses();
  } else if (path === '/invoices') {
    await renderInvoices();
  } else if (path === '/prices') {
    await renderPrices();
  } else if (path === '/dashboard') {
    await renderDashboard();
  } else {
    state.dom.main.append(el('p', { text: "This isn't available." }));
  }
}

function renderSignIn() {
  document.body.className = '';
  app.textContent = '';
  const form = el('form', { 'aria-label': 'Sign in', style: 'max-width:380px;margin:12vh auto;display:grid;gap:12px' });
  form.append(
    el('h1', { class: 'wordmark', text: 'Rasp & Rein Clinchline' }),
    el('label', { text: 'Email' }, el('input', { type: 'email', name: 'email', 'aria-label': 'Email', required: true })),
    el('label', { text: 'Password' }, el('input', { type: 'password', name: 'password', 'aria-label': 'Password', required: true })),
    el('button', { class: 'primary', type: 'submit' }, 'Sign in')
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    setNotices('Signing in…');
    const email = form.querySelector('[name=email]').value;
    const password = form.querySelector('[name=password]').value;
    const res = await api.post('/api/session', { email, password });
    if (res.status === 200) {
      const back = sessionStorage.getItem('return-to');
      sessionStorage.removeItem('return-to');
      history.replaceState({}, '', back && back.startsWith('/') && !back.startsWith('//') ? back : '/');
      location.reload();
    } else {
      btn.disabled = false;
      announce('Email or password is wrong.');
    }
  });
  app.append(form, el('div', { role: 'status', 'aria-label': 'Notices', id: 'notices', class: 'notices' }));
}

window.addEventListener('popstate', () => render());

render();

})();
