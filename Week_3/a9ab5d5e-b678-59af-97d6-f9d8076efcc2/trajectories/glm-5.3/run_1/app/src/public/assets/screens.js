/* Twohouse screens: Requests, Costs, Plan, Records. */
(() => {
  'use strict';
  const $app = document.getElementById('app');
  if (!$app) return;
  window.twohouseScreens = {
    renderRequests, renderCosts, renderPlan, renderRecords,
  };
  const token = () => localStorage.getItem('twohouse_token');
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function screenDate(s) {
    const [y, m, d] = s.split('-').map(Number);
    const j = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return `${WD[j === 0 ? 7 : j - 1]} ${d} ${MO[m - 1]} ${y}`;
  }
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
    if (res.status === 401) {
      const next = encodeURIComponent(location.pathname + location.search);
      location.href = '/?next=' + next;
      throw new Error('unauthenticated');
    }
    const text = await res.text();
    return { status: res.status, ok: res.ok, body: text ? JSON.parse(text) : null, headers: res.headers };
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

  // ---- Requests ----
  async function renderRequests(state) {
    const hid = state.me.household.id;
    const [swaps, costs] = await Promise.all([
      api(`/households/${hid}/swaps`),
      api(`/households/${hid}/costs`),
    ]);
    const waiting = [];
    const sent = [];
    for (const s of swaps.ok ? swaps.body.items : []) {
      const answerer = s.createdBy === 'planning' ? 'other' : 'planning';
      if (s.state === 'sent' && answerer === state.me.role) waiting.push({ kind: 'swap', r: s });
      else if (s.state === 'sent' && s.createdBy === state.me.role) sent.push({ kind: 'swap', r: s });
    }
    for (const c of costs.ok ? costs.body.items : []) {
      const answerer = c.paidBy === 'planning' ? 'other' : 'planning';
      if (c.state === 'sent' && answerer === state.me.role) waiting.push({ kind: 'cost', r: c });
      else if (c.state === 'sent' && c.paidBy === state.me.role) sent.push({ kind: 'cost', r: c });
    }
    const main = document.querySelector('main.page');
    main.innerHTML = `
      <div class="row">
        <section class="card col">
          <h2>Waiting for you</h2>
          <ul class="plain" aria-label="Waiting for you">
            ${waiting.length === 0 ? '<li class="empty"><span class="display-line">Nothing to answer.</span></li>' : ''}
            ${waiting.map(({ kind, r }, i) => requestItem(kind, r, i, true)).join('')}
          </ul>
        </section>
        <section class="card col">
          <h2>Sent by you</h2>
          <ul class="plain" aria-label="Sent by you">
            ${sent.length === 0 ? '<li class="empty"><span class="display-line">Nothing to answer.</span></li>' : ''}
            ${sent.map(({ kind, r }, i) => requestItem(kind, r, i, false)).join('')}
          </ul>
        </section>
      </div>`;
    waiting.forEach(({ kind, r }, i) => bindWaiting(main, kind, r, i, state));
    sent.forEach(({ kind, r }, i) => bindSent(main, kind, r, i, state));
  }

  function requestItem(kind, r, i, isWaiting) {
    const range = kind === 'swap'
      ? `${screenDate(r.nights.split('/')[0])} until ${screenDate(r.nights.split('/')[1])}`
      : money(r.amountMinor, state0.me.household.currency, state0.me.household.currencyExponent);
    const answerBy = r.answerBy ? `Answer by ${instantScreen(r.answerBy, r.answerZone || 'UTC')}` : '';
    const stateWord = STATE_WORDS[r.state] || r.state;
    return `<li class="req-item" data-kind="${kind}" data-idx="${i}" data-waiting="${isWaiting}">
      <span class="state">${stateWord}</span>
      <span>${range}</span>
      ${r.state === 'lapsed' ? `<span>This request lapsed at ${instantScreen(r.answerBy, r.answerZone || 'UTC')}</span>` : ''}
      <span>${answerBy}</span>
      ${isWaiting
        ? `<button class="act-accept">Accept</button><button class="act-decline">Decline</button>`
        : `<button class="act-withdraw">Withdraw</button>`}
    </li>`;
  }
  var state0 = window.twohouseDebug ? window.twohouseDebug.state : null;

  function bindWaiting(main, kind, r, i, state) {
    const li = main.querySelector(`li[data-kind="${kind}"][data-idx="${i}"][data-waiting="true"]`);
    if (!li) return;
    const hid = state.me.household.id;
    li.querySelector('.act-accept').addEventListener('click', async () => {
      const res = await api(`/households/${hid}/${kind === 'swap' ? 'swaps' : 'costs'}/${r.id}/accept`, {
        method: 'POST', headers: { 'Idempotency-Key': 'accept-' + r.id }, body: JSON.stringify({}),
      });
      if (res.ok) {
        announce(kind === 'swap' ? 'Swap accepted. The calendar now shows it.' : 'Reimbursement accepted.');
        renderRequests(state);
      } else {
        announce(copyFor(res.body));
      }
    });
    li.querySelector('.act-decline').addEventListener('click', () => openDeclineDialog(kind, r, state));
  }
  function bindSent(main, kind, r, i, state) {
    const li = main.querySelector(`li[data-kind="${kind}"][data-idx="${i}"][data-waiting="false"]`);
    if (!li) return;
    const hid = state.me.household.id;
    li.querySelector('.act-withdraw').addEventListener('click', async () => {
      const res = await api(`/households/${hid}/${kind === 'swap' ? 'swaps' : 'costs'}/${r.id}/withdraw`, {
        method: 'POST', headers: { 'Idempotency-Key': 'withdraw-' + r.id }, body: JSON.stringify({}),
      });
      if (res.ok) { announce('Request withdrawn.'); renderRequests(state); }
      else announce(copyFor(res.body));
    });
  }
  function copyFor(body) {
    switch (body.code) {
      case 'request_lapsed': return `This request lapsed at ${instantScreen(body.at || '', '')}`;
      case 'swap_overlaps': return 'Those nights are already in another request.';
      case 'swap_nights_changed': return "Those nights changed when the plan was amended. This request can't be accepted.";
      default: return 'Something went wrong. Try again.';
    }
  }
  function openDeclineDialog(kind, r, state) {
    const dlg = el(`<dialog aria-label="Decline request">
      <h2>Decline request</h2>
      <form onsubmit="return false">
        <label for="decline-reason">Reason</label><input id="decline-reason">
        <div class="dialog-actions">
          <button type="button" class="green" id="do-decline">Decline</button>
          <button type="button" id="do-cancel">Cancel</button>
        </div>
        <p class="alert" id="decline-alert" role="alert"></p>
      </form>
    </dialog>`);
    document.body.appendChild(dlg);
    const opener = document.activeElement;
    dlg.showModal();
    dlg.querySelector('#decline-reason').focus();
    const close = () => { dlg.close(); dlg.remove(); if (opener && opener.isConnected) opener.focus(); };
    dlg.querySelector('#do-cancel').addEventListener('click', close);
    dlg.addEventListener('keydown', (e) => { if (e.key === 'Escape') setTimeout(close, 0); });
    dlg.querySelector('#do-decline').addEventListener('click', async () => {
      const reason = dlg.querySelector('#decline-reason').value;
      const res = await api(`/households/${state.me.household.id}/${kind === 'swap' ? 'swaps' : 'costs'}/${r.id}/decline`, {
        method: 'POST', headers: { 'Idempotency-Key': 'decline-' + r.id }, body: JSON.stringify({ reason }),
      });
      if (res.ok) { close(); announce('Request declined.'); renderRequests(state); }
      else dlg.querySelector('#decline-alert').textContent = Object.values(res.body.errors || {}).join(' ') || copyFor(res.body);
    });
  }

  // ---- Costs ----
  async function renderCosts(state) {
    const hid = state.me.household.id;
    const [costs, statement] = await Promise.all([
      api(`/households/${hid}/costs`),
      api(`/households/${hid}/statement`),
    ]);
    state.costs = costs.ok ? costs.body : { items: [] };
    state.statement = statement.ok ? statement.body : null;
    const me = state.me.household;
    const cur = me.currency;
    const exp = me.currencyExponent;
    const rows = state.costs.items.map((c, i) => `
      <tr data-idx="${i}">
        <td>${c.incurredAt.slice(0, 10).split('-').reverse().map((n, j) => j === 2 ? n : String(n).padStart(2, '0')).join('/')}</td>
        <td>${c.custodyDay.split('-').reverse().map((n, j) => j === 2 ? n : String(n).padStart(2, '0')).join('/')}</td>
        <td>${esc(c.description)}</td>
        <td>${money(c.amountMinor, cur, exp)}</td>
        <td>${esc(c.paidBy === 'planning' ? me.planningName : me.otherName)}</td>
        <td>${Math.floor(c.splitBp.planning / 100)}/${Math.floor(c.splitBp.other / 100)}</td>
        <td>${money(c.shares.planning, cur, exp)}</td>
        <td>${money(c.shares.other, cur, exp)}</td>
        <td>${STATE_WORDS[c.state] || c.state}</td>
        <td>${costButtons(c, state)}</td>
      </tr>`).join('');
    const balance = state.statement && state.statement.balance
      ? `<p>${esc(state.statement.balance.owedBy === 'planning' ? me.planningName : me.otherName)} owes ${esc(state.statement.balance.owedTo === 'planning' ? me.planningName : me.otherName)} ${money(state.statement.balance.minor, cur, exp)}</p>`
      : '<p>All square.</p>';
    const mine = state.statement && state.statement.balance
      ? (state.statement.balance.owedBy === state.me.role
        ? `Your balance: ${money(-state.statement.balance.minor, cur, exp)}`
        : `Your balance: ${money(state.statement.balance.minor, cur, exp)}`)
      : 'All square.';
    const main = document.querySelector('main.page');
    main.innerHTML = `
      <section class="card"><button class="green" id="log-cost">Log a cost</button></section>
      <div class="row">
        <section class="card col ledger-scroller">
          <h2>Cost ledger</h2>
          <table class="ledger" aria-label="Cost ledger">
            <thead><tr><th>Incurred</th><th>Custody day</th><th>Description</th><th>Amount</th><th>Paid by</th><th>Split</th><th>${esc(me.planningName)}'s share</th><th>${esc(me.otherName)}'s share</th><th>Status</th><th></th></tr></thead>
            <tbody>${rows || '<tr><td colspan="10" class="empty">No shared costs yet.</td></tr>'}</tbody>
          </table>
        </section>
        <section class="card col" role="region" aria-label="Balance">
          <h2>Balance</h2>
          ${balance}
          <p>${mine}</p>
        </section>
      </div>`;
    document.getElementById('log-cost').addEventListener('click', () => openCostDialog(null, state));
    state.costs.items.forEach((c, i) => bindCostRow(main, c, i, state));
  }
  function costButtons(c, state) {
    const mine = c.paidBy === state.me.role;
    const other = state.me.role === 'planning' ? 'other' : 'planning';
    const btn = (label, cls) => `<button class="rowbtn ${cls || ''}">${label}</button>`;
    let out = '';
    if (c.state === 'draft' && mine) {
      out += btn('Edit draft', 'act-edit') + btn('Send', 'act-send') + btn('Delete draft', 'act-delete danger');
    }
    if (c.state === 'draft' || c.state === 'sent') out += btn('Edit split', 'act-split');
    if (c.state === 'sent') out += btn('Attach receipt', 'act-receipt');
    if (c.state === 'sent' && c.paidBy === other) out += btn('Accept', 'act-accept') + btn('Decline', 'act-decline');
    if (c.state === 'sent' && mine) out += btn('Withdraw', 'act-withdraw');
    if (c.state === 'accepted' && mine) out += btn('Settle', 'act-settle');
    out += c.receipts.map((r, i) => `<a href="#" class="receipt-link" data-rid="${r.id}">Receipt ${i + 1}</a>`).join(' ');
    return out;
  }
  function bindCostRow(main, c, i, state) {
    const tr = main.querySelector(`tr[data-idx="${i}"]`);
    if (!tr) return;
    const hid = state.me.household.id;
    const doAction = async (action) => {
      const res = await api(`/households/${hid}/costs/${c.id}/${action}`, {
        method: 'POST', headers: { 'Idempotency-Key': action + '-' + c.id }, body: JSON.stringify({}),
      });
      if (res.ok) {
        announce(action === 'send' ? 'Request sent. An email notice is on its way.'
          : action === 'accept' ? 'Reimbursement accepted.'
          : action === 'withdraw' ? 'Request withdrawn.'
          : action === 'settle' ? 'Marked as settled.' : 'Done.');
        renderCosts(state);
      } else {
        announce(Object.values(res.body.errors || {}).join(' ') || 'Something went wrong. Try again.');
      }
    };
    const bind = (sel, fn) => {
      const b = tr.querySelector(sel);
      if (b) b.addEventListener('click', fn);
    };
    bind('.act-send', () => doAction('send'));
    bind('.act-withdraw', () => doAction('withdraw'));
    bind('.act-accept', () => doAction('accept'));
    bind('.act-settle', () => doAction('settle'));
    bind('.act-delete', async () => {
      const get = await api(`/households/${hid}/costs/${c.id}`);
      const res = await api(`/households/${hid}/costs/${c.id}`, {
        method: 'DELETE', headers: { 'If-Match': get.headers.get('etag') },
      });
      if (res.ok) { announce('Draft deleted.'); renderCosts(state); }
      else announce(res.body.code === 'storage_unavailable'
        ? "Couldn't reach storage – nothing was deleted. Try again."
        : 'This changed while you were looking. It now shows the latest version.');
    });
    bind('.act-edit', () => openCostDialog(c, state));
    bind('.act-split', () => openSplitDialog(c, state));
    bind('.act-receipt', () => openReceiptDialog(c, state));
    bind('.act-decline', () => openDeclineCostDialog(c, state));
    tr.querySelectorAll('.receipt-link').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        location.href = `/api/households/${hid}/costs/${c.id}/receipts/${a.dataset.rid}`;
      });
    });
  }
  function openDeclineCostDialog(c, state) {
    const dlg = el(`<dialog aria-label="Decline request">
      <h2>Decline request</h2>
      <form onsubmit="return false">
        <label for="decline-reason">Reason</label><input id="decline-reason">
        <div class="dialog-actions"><button type="button" class="green" id="do">Decline</button><button type="button" id="cancel">Cancel</button></div>
        <p class="alert" id="alert" role="alert"></p>
      </form></dialog>`);
    document.body.appendChild(dlg);
    dlg.showModal();
    dlg.querySelector('#decline-reason').focus();
    const close = () => { dlg.close(); dlg.remove(); };
    dlg.querySelector('#cancel').addEventListener('click', close);
    dlg.addEventListener('keydown', (e) => { if (e.key === 'Escape') setTimeout(close, 0); });
    dlg.querySelector('#do').addEventListener('click', async () => {
      const reason = dlg.querySelector('#decline-reason').value;
      const res = await api(`/households/${state.me.household.id}/costs/${c.id}/decline`, {
        method: 'POST', headers: { 'Idempotency-Key': 'decline-' + c.id }, body: JSON.stringify({ reason }),
      });
      if (res.ok) { close(); announce('Request declined.'); renderCosts(state); }
      else dlg.querySelector('#alert').textContent = Object.values(res.body.errors || {}).join(' ') || 'Something went wrong. Try again.';
    });
  }
  function openCostDialog(existing, state) {
    const me = state.me.household;
    const c = existing || { description: '', category: 'other', amountMinor: null, incurredAt: '', note: '', state: 'draft' };
    const dlg = el(`<dialog aria-label="Log a cost">
      <h2>Log a cost</h2>
      <form onsubmit="return false">
        <label for="cost-desc">Description</label><input id="cost-desc" value="${esc(c.description)}">
        <label for="cost-cat">Category</label>
        <select id="cost-cat">${Object.entries(CAT_WORDS).map(([k, v]) => `<option value="${k}" ${c.category === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <label for="cost-amount">Amount</label><input id="cost-amount" inputmode="decimal">
        <label for="cost-date">Date</label><input id="cost-date" placeholder="YYYY-MM-DD">
        <label for="cost-time">Time</label><input id="cost-time" value="12:00">
        <label for="cost-note">Note</label><input id="cost-note" value="${esc(c.note || '')}">
        <p class="status" id="cost-split" role="status" aria-label="Cost split"></p>
        <div class="dialog-actions">
          <button type="button" class="green" id="do-send">Send request</button>
          <button type="button" id="do-save">Save draft</button>
          <button type="button" id="do-cancel">Cancel</button>
        </div>
        <p class="alert" id="cost-alert" role="alert"></p>
      </form></dialog>`);
    document.body.appendChild(dlg);
    dlg.showModal();
    dlg.querySelector('#cost-desc').focus();
    const close = () => { dlg.close(); dlg.remove(); };
    dlg.querySelector('#do-cancel').addEventListener('click', close);
    dlg.addEventListener('keydown', (e) => { if (e.key === 'Escape') setTimeout(close, 0); });

    // live quote: the server computes every share
    const amountEl = dlg.querySelector('#cost-amount');
    const dateEl = dlg.querySelector('#cost-date');
    const timeEl = dlg.querySelector('#cost-time');
    let quoteSeq = 0;
    const requestQuote = async () => {
      const amount = parseMoneyInput(amountEl.value, me.currencyExponent);
      if (amount === null || !dateEl.value || !timeEl.value) return;
      const [y, m, d] = dateEl.value.split('-').map(Number);
      const [hh, mm] = timeEl.value.split(':').map(Number);
      if ([y, m, d, hh, mm].some((n) => Number.isNaN(n))) return;
      const iso = `${dateEl.value}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00${offsetNow()}`;
      const seq = ++quoteSeq;
      const res = await api(`/households/${me.id}/costs/quote`, {
        method: 'POST', body: JSON.stringify({ amountMinor: amount, incurredAt: iso }),
      });
      if (seq !== quoteSeq) return; // a newer input arrived: discard this reply
      const box = dlg.querySelector('#cost-split');
      if (res.ok) {
        box.textContent = `${me.planningName} pays ${money(res.body.shares.planning, me.currency, me.currencyExponent)}, ${me.otherName} pays ${money(res.body.shares.other, me.currency, me.currencyExponent)}`;
      } else {
        box.textContent = Object.values(res.body.errors || {})[0] || '';
      }
    };
    let quoteTimer = null;
    [amountEl, dateEl, timeEl].forEach((input) => {
      input.addEventListener('input', () => {
        clearTimeout(quoteTimer);
        quoteTimer = setTimeout(requestQuote, 280);
      });
    });
    async function submit(send) {
      const alertEl = dlg.querySelector('#cost-alert');
      const amount = parseMoneyInput(amountEl.value, me.currencyExponent);
      if (amount === null) {
        alertEl.textContent = `Enter the amount using a decimal comma, with at most ${me.currencyExponent} decimal places.`;
        amountEl.focus();
        return;
      }
      const body = {
        description: dlg.querySelector('#cost-desc').value,
        category: dlg.querySelector('#cost-cat').value,
        amountMinor: amount,
        incurredAt: `${dateEl.value}T${timeEl.value}:00${offsetNow()}`,
        note: dlg.querySelector('#cost-note').value || null,
      };
      let res;
      if (existing) {
        const get = await api(`/households/${me.id}/costs/${existing.id}`);
        res = await api(`/households/${me.id}/costs/${existing.id}`, {
          method: 'PATCH', headers: { 'If-Match': get.headers.get('etag') }, body: JSON.stringify(body),
        });
      } else {
        res = await api(`/households/${me.id}/costs`, { method: 'POST', body: JSON.stringify(body) });
      }
      if (!res.ok) {
        alertEl.textContent = Object.values(res.body.errors || {}).join(' ') || 'Something went wrong. Try again.';
        return;
      }
      const cost = res.body;
      if (send) {
        const sres = await api(`/households/${me.id}/costs/${cost.id}/send`, {
          method: 'POST', headers: { 'Idempotency-Key': 'send-' + cost.id }, body: JSON.stringify({}),
        });
        if (!sres.ok) {
          alertEl.textContent = Object.values(sres.body.errors || {}).join(' ') || 'Something went wrong. Try again.';
          return;
        }
        announce('Request sent. An email notice is on its way.');
      } else {
        announce('Draft saved.');
      }
      close();
      renderCosts(state);
    }
    dlg.querySelector('#do-send').addEventListener('click', () => submit(true));
    dlg.querySelector('#do-save').addEventListener('click', () => submit(false));
  }
  function parseMoneyInput(v, exp) {
    const m = /^(-?)([\d\u202f ]+)(?:,(\d{1,${exp}}))?$/.exec(v.trim());
    if (!m) return null;
    const digits = m[2].replace(/[\u202f ]/g, '');
    const frac = m[3] ? m[3].padEnd(exp, '0') : '';
    const sign = m[1] === '-' ? -1 : 1;
    return sign * Number(digits + frac);
  }
  function offsetNow() {
    const off = -new Date().getTimezoneOffset();
    const sign = off >= 0 ? '+' : '-';
    const a = Math.abs(off);
    return `${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
  }
  function openSplitDialog(c, state) {
    const me = state.me.household;
    const dlg = el(`<dialog aria-label="Edit split">
      <h2>Edit split</h2>
      <form onsubmit="return false">
        <label for="split-share">Agreed share for ${esc(me.planningName)} (%)</label><input id="split-share" inputmode="decimal">
        <div class="dialog-actions">
          <button type="button" class="green" id="do-save">Save split</button>
          <button type="button" id="do-plan">Use plan split</button>
          <button type="button" id="do-cancel">Cancel</button>
        </div>
        <p class="alert" id="split-alert" role="alert"></p>
      </form></dialog>`);
    document.body.appendChild(dlg);
    dlg.showModal();
    dlg.querySelector('#split-share').focus();
    const close = () => { dlg.close(); dlg.remove(); };
    dlg.querySelector('#do-cancel').addEventListener('click', close);
    dlg.addEventListener('keydown', (e) => { if (e.key === 'Escape') setTimeout(close, 0); });
    const save = async (share) => {
      const get = await api(`/households/${me.id}/costs/${c.id}`);
      const res = await api(`/households/${me.id}/costs/${c.id}`, {
        method: 'PATCH',
        headers: { 'If-Match': get.headers.get('etag') },
        body: JSON.stringify({ agreedSplitBp: share === null ? null : { planning: share, other: 10000 - share } }),
      });
      if (res.ok) { close(); announce('Split saved.'); renderCosts(state); }
      else {
        dlg.querySelector('#split-alert').textContent = res.body.code === 'precondition_failed'
          ? 'This changed while you were looking. It now shows the latest version.'
          : Object.values(res.body.errors || {}).join(' ') || 'Something went wrong. Try again.';
      }
    };
    dlg.querySelector('#do-save').addEventListener('click', () => {
      const v = dlg.querySelector('#split-share').value.trim().replace(',', '.');
      const n = Number(v);
      if (Number.isNaN(n) || n < 0 || n > 100) {
        dlg.querySelector('#split-alert').textContent = 'Enter a share from 0 to 100 with at most two decimals, using a comma.';
        return;
      }
      save(Math.round(n * 100));
    });
    dlg.querySelector('#do-plan').addEventListener('click', () => save(null));
  }
  function openReceiptDialog(c, state) {
    const me = state.me.household.id;
    const dlg = el(`<dialog aria-label="Attach receipt">
      <h2>Attach receipt</h2>
      <form onsubmit="return false">
        <input type="file" id="receipt-file">
        <div class="dialog-actions"><button type="button" class="green" id="do">Attach</button><button type="button" id="cancel">Cancel</button></div>
        <p class="alert" id="receipt-alert" role="alert"></p>
      </form></dialog>`);
    document.body.appendChild(dlg);
    dlg.showModal();
    dlg.querySelector('#receipt-file').focus();
    const close = () => { dlg.close(); dlg.remove(); };
    dlg.querySelector('#cancel').addEventListener('click', close);
    dlg.addEventListener('keydown', (e) => { if (e.key === 'Escape') setTimeout(close, 0); });
    dlg.querySelector('#do').addEventListener('click', async () => {
      const file = dlg.querySelector('#receipt-file').files[0];
      if (!file) { dlg.querySelector('#receipt-alert').textContent = 'Choose a receipt file.'; return; }
      if (file.size > 5 * 1024 * 1024) { dlg.querySelector('#receipt-alert').textContent = 'Receipts can be up to 5 MiB.'; return; }
      const buf = await file.arrayBuffer();
      const get = await api(`/households/${me}/costs/${c.id}`);
      const etag = get.headers.get('etag');
      announce('Uploading receipt...');
      const res = await fetch(`/api/households/${me}/costs/${c.id}/receipts?filename=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token(), Origin: location.origin, 'If-Match': etag, 'Content-Type': 'application/octet-stream' },
        body: buf,
      });
      if (res.ok) { close(); announce('Receipt stored.'); renderCosts(state); }
      else {
        const body = await res.json();
        dlg.querySelector('#receipt-alert').textContent = res.status === 503
          ? "Couldn't reach storage – nothing was saved. Try again."
          : Object.values(body.errors || {}).join(' ') || 'Something went wrong. Try again.';
      }
    });
  }

  // ---- Plan ----
  async function renderPlan(state) {
    const hid = state.me.household.id;
    const plan = await api(`/households/${hid}/plan`);
    state.plan = plan.ok ? plan.body : { versions: [] };
    const draft = state.plan.versions.find((v) => v.status === 'draft');
    const adopted = state.plan.versions.filter((v) => v.status === 'adopted');
    if (state.me.role === 'planning') {
      if (!draft) {
        // start a first-plan draft or an amendment copy
        const base = adopted.length > 0 ? adopted[0] : {
          effectiveFrom: state.me.household.today,
          exchangeZone: state.me.household.zone,
          firstExchangeAt: null,
          base: { pattern: 'PO', anchor: state.me.household.today },
          splitBp: { planning: 5000, other: 5000 },
          maxConsecutiveNights: null,
          rules: [],
        };
        state.planDraft = { ...base, effectiveFrom: adopted.length > 0 ? null : base.effectiveFrom };
      } else {
        state.planDraft = draft;
      }
    } else {
      state.planDraft = draft;
    }
    const main = document.querySelector('main.page');
    main.innerHTML = `
      ${state.plan.versions.length === 0 ? '<p class="empty"><span class="display-line">No plan yet.</span></p>' : ''}
      <div class="row">
        <section class="card col">
          <h2>Rule order</h2>
          <ol class="rulebox" id="rule-order" role="listbox" aria-label="Rule order" tabindex="0"></ol>
          <div class="rule-move">
            <button id="rule-up">Move up</button>
            <button id="rule-down">Move down</button>
          </div>
          <p class="status" id="rule-note" role="status"></p>
        </section>
        <section class="card col" role="region" aria-label="Rule editor">
          <h2>Rule editor</h2>
          <form id="rule-form" onsubmit="return false">
            <label for="rule-name">Rule name</label><input id="rule-name">
            <label for="rule-kind">Kind</label>
            <select id="rule-kind"><option value="holiday">Holiday</option><option value="school_break">School break</option><option value="vacation">Vacation</option></select>
            <label for="rule-dtype">Date type</label>
            <select id="rule-dtype"><option value="fixed">Fixed date</option><option value="nth_weekday">Weekday of month</option><option value="easter">Easter</option></select>
            <span data-for="holiday">
              <label for="rule-month">Month</label><input type="number" id="rule-month" min="1" max="12">
              <label for="rule-day">Day of month</label><input type="number" id="rule-day" min="1" max="31">
              <label for="rule-weekday">Weekday</label><input type="number" id="rule-weekday" min="1" max="7">
              <label for="rule-nth">Week of month</label><input type="number" id="rule-nth" min="-1" max="5">
              <label for="rule-offset">Start offset (days)</label><input type="number" id="rule-offset" min="-7" max="7">
              <label for="rule-nights">Nights</label><input type="number" id="rule-nights" min="1" max="14">
            </span>
            <label for="rule-first">First night</label><input id="rule-first" placeholder="YYYY-MM-DD">
            <label for="rule-last">Last night</label><input id="rule-last" placeholder="YYYY-MM-DD">
            <div class="dialog-actions">
              <button type="button" id="rule-save">Save rule</button>
              <button type="button" id="rule-add">Add rule</button>
            </div>
            <p class="alert" id="rule-alert" role="alert"></p>
          </form>
        </section>
        <section class="card col">
          <h2>Plan</h2>
          <form id="plan-form" onsubmit="return false">
            <label for="eff-from">Effective from</label><input id="eff-from" placeholder="YYYY-MM-DD">
            <label for="exch-time">Exchange time</label><input id="exch-time" value="17:00">
            <label for="exch-zone">Exchange time zone</label><input id="exch-zone" list="zones">
            <label for="base-pattern">Base pattern</label><input id="base-pattern">
            <label for="base-anchor">Base anchor</label><input id="base-anchor" placeholder="YYYY-MM-DD">
            <label for="split-plan">Cost share for ${esc(state.me.household.planningName)} (%)</label><input id="split-plan" inputmode="decimal">
            <label for="max-nights">Most nights in a row</label><input type="number" id="max-nights" min="2" max="60">
            <div class="dialog-actions">
              <button type="button" id="plan-save">Save draft</button>
              ${state.me.role === 'planning' ? '<button type="button" class="green" id="plan-adopt">Adopt plan</button>' : ''}
            </div>
          </form>
          <p class="status" id="plan-preview" role="status" aria-label="Plan preview"></p>
          <h2>Versions</h2>
          <ul class="plain" aria-label="Versions">
            ${state.plan.versions.map((v) => `<li>Version ${v.number} — ${v.status === 'adopted' ? 'Adopted' : 'Draft'}, from ${screenDate(v.effectiveFrom)}</li>`).join('') || '<li>No versions yet.</li>'}
          </ul>
        </section>
      </div>`;
    fillPlanForm(state);
    renderRuleOrder(state);
    bindPlanHandlers(state);
  }
  function fillPlanForm(state) {
    const d = state.planDraft || {};
    document.getElementById('eff-from').value = d.effectiveFrom || '';
    document.getElementById('exch-time').value = d.firstExchangeAt ? d.firstExchangeAt.slice(11, 16) : '17:00';
    document.getElementById('exch-zone').value = d.exchangeZone || state.me.household.zone;
    document.getElementById('base-pattern').value = d.base ? d.base.pattern : '';
    document.getElementById('base-anchor').value = d.base ? d.base.anchor : '';
    document.getElementById('split-plan').value = d.splitBp ? String(d.splitBp.planning / 100).replace('.', ',') : '50';
    document.getElementById('max-nights').value = d.maxConsecutiveNights != null ? String(d.maxConsecutiveNights) : '';
  }
  function planBodyFromForm(state) {
    const effFrom = document.getElementById('eff-from').value;
    const time = document.getElementById('exch-time').value;
    const zone = document.getElementById('exch-zone').value;
    const pattern = document.getElementById('base-pattern').value;
    const anchor = document.getElementById('base-anchor').value;
    const share = Number(document.getElementById('split-plan').value.replace(',', '.'));
    const maxNightsRaw = document.getElementById('max-nights').value;
    const [hh, mm] = time.split(':').map(Number);
    const fx = `${effFrom}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00${tzOffsetFor(zone)}`;
    return {
      effectiveFrom: effFrom,
      exchangeZone: zone,
      firstExchangeAt: fx,
      base: { pattern, anchor },
      splitBp: { planning: Math.round(share * 100), other: 10000 - Math.round(share * 100) },
      maxConsecutiveNights: maxNightsRaw === '' ? null : Number(maxNightsRaw),
      rules: state.planDraft ? state.planDraft.rules || [] : [],
    };
  }
  function tzOffsetFor(zone) {
    // wall clock in the plan's zone; compute the offset via Intl
    const now = new Date();
    const dtf = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' });
    const parts = dtf.formatToParts(now);
    const tz = parts.find((p) => p.type === 'timeZoneName');
    const m = /GMT([+-]\d{1,2}(?::\d{2})?)/.exec(tz ? tz.value : 'GMT+0');
    if (!m) return '+00:00';
    const raw = m[1];
    const [h, min] = raw.split(':');
    const sign = raw[0] === '-' ? '-' : '+';
    return `${sign}${String(Math.abs(Number(h))).padStart(2, '0')}:${String(min ? Number(min) : 0).padStart(2, '0')}`;
  }
  function renderRuleOrder(state) {
    const box = document.getElementById('rule-order');
    const rules = state.planDraft ? state.planDraft.rules || [] : [];
    const groups = { holiday: 'Holidays', school_break: 'School breaks', vacation: 'Vacations' };
    let html = '';
    for (const [kind, label] of Object.entries(groups)) {
      const inKind = rules.filter((r) => r.kind === kind);
      if (inKind.length === 0) continue;
      html += `<li class="group">${label}</li>`;
      inKind.forEach((r, i) => {
        html += `<li role="option" aria-selected="false" data-kind="${kind}" data-idx="${rules.indexOf(r)}" data-local="${i}">${esc(r.name)}</li>`;
      });
    }
    box.innerHTML = html || '<li class="group">No rules yet</li>';
  }
  let selectedRule = null;
  function bindPlanHandlers(state) {
    if (state.me.role !== 'planning') return;
    const hid = state.me.household.id;
    let previewSeq = 0;
    const requestPreview = async () => {
      if (!document.getElementById('eff-from').value || !document.getElementById('base-pattern').value) return;
      const body = planBodyFromForm(state);
      const seq = ++previewSeq;
      const res = await api(`/households/${hid}/plan/preview`, { method: 'POST', body: JSON.stringify(body) });
      if (seq !== previewSeq) return;
      const box = document.getElementById('plan-preview');
      if (res.ok) {
        box.textContent = `${state.me.household.planningName}: ${res.body.nights.planning} nights, ${state.me.household.otherName}: ${res.body.nights.other} nights in ${res.body.year}`;
      } else {
        box.textContent = Object.values(res.body.errors || {})[0] || '';
      }
    };
    document.querySelectorAll('#plan-form input, #plan-form select').forEach((input) => {
      input.addEventListener('input', () => { clearTimeout(input.__t); input.__t = setTimeout(requestPreview, 280); });
    });
    requestPreview();

    document.getElementById('plan-save').addEventListener('click', async () => {
      const body = planBodyFromForm(state);
      const versions = await api(`/households/${hid}/plan`);
      const draft = versions.ok ? versions.body.versions.find((v) => v.status === 'draft') : null;
      const headers = draft ? { 'If-Match': draft.__etag } : { 'If-None-Match': '*' };
      const res = await api(`/households/${hid}/plan/draft`, { method: 'PUT', headers, body: JSON.stringify(body) });
      if (res.ok) {
        state.planDraft = res.body;
        state.planDraft.__etag = res.headers.get('etag');
        announce('Draft saved.');
        requestPreview();
      } else {
        announce(Object.values(res.body.errors || {}).join(' ') || 'Something went wrong. Try again.');
      }
    });
    const adoptBtn = document.getElementById('plan-adopt');
    if (adoptBtn) adoptBtn.addEventListener('click', async () => {
      const res = await api(`/households/${hid}/plan/draft/adopt`, { method: 'POST', body: JSON.stringify({}) });
      if (res.ok) {
        const firstAdoption = state.plan.versions.filter((v) => v.status === 'adopted').length === 0;
        announce(firstAdoption ? 'Plan adopted. The calendar now uses it.' : `Amendment recorded. It applies from ${screenDate(res.body.effectiveFrom)}.`);
        renderPlan(state);
      } else {
        announce(res.body.code === 'costs_logged_after_effective_date'
          ? 'Costs are already sent on or after that date. Choose a later date.'
          : Object.values(res.body.errors || {}).join(' ') || 'Something went wrong. Try again.');
      }
    });

    const box = document.getElementById('rule-order');
    box.addEventListener('click', (e) => {
      const li = e.target.closest('li[role="option"]');
      if (!li) return;
      box.querySelectorAll('li').forEach((x) => x.setAttribute('aria-selected', 'false'));
      li.setAttribute('aria-selected', 'true');
      selectedRule = { kind: li.dataset.kind, idx: Number(li.dataset.idx) };
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' && e.altKey) { e.preventDefault(); moveRule(-1, state); }
      if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); moveRule(1, state); }
    });
    document.getElementById('rule-up').addEventListener('click', () => moveRule(-1, state));
    document.getElementById('rule-down').addEventListener('click', () => moveRule(1, state));
  }
  async function moveRule(delta, state) {
    if (!selectedRule) return;
    const rules = state.planDraft.rules;
    const idx = selectedRule.idx;
    const kind = rules[idx].kind;
    const sameKind = rules.map((r, i) => ({ r, i })).filter((x) => x.r.kind === kind);
    const posInKind = sameKind.findIndex((x) => x.i === idx);
    const newPos = posInKind + delta;
    if (newPos < 0 || newPos >= sameKind.length) {
      document.getElementById('rule-note').textContent = 'A rule moves only within its own kind.';
      return;
    }
    // apply the swap locally, save with the previous reply's ETag
    const other = sameKind[newPos].i;
    const rulesNext = [...rules];
    const tmp = rulesNext[idx];
    rulesNext[idx] = rulesNext[other];
    rulesNext[other] = tmp;
    const body = { ...state.planDraft, rules: rulesNext };
    const hid = state.me.household.id;
    const headers = state.planDraft.__etag ? { 'If-Match': state.planDraft.__etag } : { 'If-None-Match': '*' };
    const res = await api(`/households/${hid}/plan/draft`, { method: 'PUT', headers, body: JSON.stringify(body) });
    if (res.ok) {
      state.planDraft = res.body;
      state.planDraft.__etag = res.headers.get('etag');
      selectedRule.idx = other;
      renderRuleOrder(state);
      document.getElementById('rule-note').textContent = 'Draft saved.';
    } else {
      // restore the server's order with the stale copy
      const versions = await api(`/households/${hid}/plan`);
      const draft = versions.ok ? versions.body.versions.find((v) => v.status === 'draft') : null;
      if (draft) { state.planDraft = draft; state.planDraft.__etag = versions.headers.get('etag'); }
      renderRuleOrder(state);
      document.getElementById('rule-note').textContent = 'This changed while you were looking. It now shows the latest version.';
    }
  }

  // ---- Records ----
  async function renderRecords(state) {
    const hid = state.me.household.id;
    const [records, links, notices, log] = await Promise.all([
      api(`/households/${hid}/records`),
      api(`/households/${hid}/share-links`),
      api(`/households/${hid}/notices`),
      api(`/households/${hid}/log?limit=10`),
    ]);
    state.records = records.ok ? records.body : { items: [] };
    state.links = links.ok ? links.body : { items: [] };
    state.notices = notices.ok ? notices.body : { items: [], mail: 'ok' };
    state.log = log.ok ? log.body : { items: [] };
    const main = document.querySelector('main.page');
    main.innerHTML = `
      <div class="row">
        <section class="card col" role="region" aria-label="Year records">
          <h2>Year records</h2>
          <form onsubmit="return false" class="row">
            <select id="rec-year" aria-label="Year">${Array.from({ length: 101 }, (_, i) => 2000 + i).map((y) => `<option value="${y}" ${y === new Date().getFullYear() ? 'selected' : ''}>${y}</option>`).join('')}</select>
            <button type="button" class="green" id="rec-make">Make year record</button>
          </form>
          <ul class="plain" aria-label="Year record list">
            ${state.records.items.length === 0 ? '<li class="empty"><span class="display-line">No year records yet.</span></li>' : ''}
            ${state.records.items.map((r) => `
              <li data-id="${r.id}">
                <strong>${r.year}</strong> — ${RECORD_WORDS[r.state] || r.state}
                ${r.state === 'stored' ? `<a href="#" class="pdf-link">Download PDF</a>` : ''}
                ${r.state === 'failed' ? '<button class="act-retry">Try again</button>' : ''}
                ${r.state === 'requested' || r.state === 'rendering' ? '<button class="act-cancel">Cancel record</button>' : ''}
              </li>`).join('')}
          </ul>
          <p class="status" id="record-status" role="status" aria-label="Record status"></p>
        </section>
        <section class="card col" role="region" aria-label="Share links">
          <h2>Share links</h2>
          ${state.me.role === 'planning' ? `
          <form onsubmit="return false">
            <label for="link-label">Label</label><input id="link-label">
            <label for="link-expires">Expires</label><input id="link-expires" placeholder="YYYY-MM-DD HH:MM">
            <div class="dialog-actions"><button type="button" class="green" id="link-make">Create share link</button></div>
            <p class="alert" id="link-alert" role="alert"></p>
          </form>` : ''}
          <ul class="plain" aria-label="Share links">
            ${state.links.items.map((l) => `
              <li data-id="${l.id}">${esc(l.label)} — expires ${instantScreen(l.expiresAt, state.me.household.zone)}
                <button class="act-copy">Copy link</button>
                <button class="act-regen">Regenerate</button>
                <button class="act-revoke">Revoke</button>
              </li>`).join('')}
          </ul>
          <p class="status" id="link-status" role="status"></p>
        </section>
        <section class="card col" role="region" aria-label="Notices">
          <h2>Notices</h2>
          ${state.notices.mail === 'degraded' ? '<p>Email is down. Notices are queued and go out when it is back.</p>' : ''}
          <table class="ledger" aria-label="Notices">
            <thead><tr><th>Sent to</th><th>Subject</th><th>Status</th><th>Queued</th><th>Sent</th></tr></thead>
            <tbody>
              ${state.notices.items.map((n) => `<tr><td>${esc(n.to)}</td><td>${esc(n.subject)}</td><td>${NOTICE_WORDS[n.status] || n.status}</td><td>${esc(n.queuedAt)}</td><td>${n.sentAt ? esc(n.sentAt) : ''}</td></tr>`).join('')}
            </tbody>
          </table>
        </section>
        <section class="card col" role="region" aria-label="Record log">
          <h2>Record log</h2>
          <ul class="plain" aria-label="Log entries">
            ${state.log.items.map((e) => `<li>${e.seq} — ${esc(e.type)} — ${esc(e.at)}</li>`).join('')}
          </ul>
          <button id="log-more">Load more</button>
        </section>
      </div>`;
    bindRecordsHandlers(state);
  }
  function bindRecordsHandlers(state) {
    const hid = state.me.household.id;
    const status = document.getElementById('record-status');
    document.getElementById('rec-make').addEventListener('click', async () => {
      const year = Number(document.getElementById('rec-year').value);
      const res = await api(`/households/${hid}/records`, {
        method: 'POST', headers: { 'Idempotency-Key': 'record-' + year }, body: JSON.stringify({ year }),
      });
      if (res.ok) { announce('Year record requested.'); status.textContent = 'Year record requested.'; pollRecord(res.body.id); }
      else if (res.body.code === 'record_in_progress') {
        status.textContent = 'A record for that year is already being made.';
      } else {
        status.textContent = Object.values(res.body.errors || {}).join(' ') || 'Something went wrong. Try again.';
      }
    });
    state.records.items.forEach((r) => {
      const li = document.querySelector(`li[data-id="${r.id}"]`);
      if (!li) return;
      const retry = li.querySelector('.act-retry');
      if (retry) retry.addEventListener('click', async () => {
        const res = await api(`/households/${hid}/records/${r.id}/retry`, { method: 'POST', body: JSON.stringify({}) });
        if (res.ok) { status.textContent = 'Year record requested.'; pollRecord(r.id); }
      });
      const cancel = li.querySelector('.act-cancel');
      if (cancel) cancel.addEventListener('click', async () => {
        const res = await api(`/households/${hid}/records/${r.id}/cancel`, { method: 'POST', body: JSON.stringify({}) });
        if (res.ok) { status.textContent = 'Year record cancelled.'; renderRecords(state); }
      });
      const pdf = li.querySelector('.pdf-link');
      if (pdf) pdf.addEventListener('click', (e) => {
        e.preventDefault();
        location.href = `/api/households/${hid}/records/${r.id}/pdf`;
      });
    });
    function pollRecord(id) {
      const timer = setInterval(async () => {
        const res = await api(`/households/${hid}/records/${id}`);
        if (!res.ok) { clearInterval(timer); return; }
        const r = res.body;
        if (r.state === 'stored') {
          clearInterval(timer);
          status.textContent = 'Year record stored. Download is ready.';
          renderRecords(state);
        } else if (r.state === 'failed') {
          clearInterval(timer);
          status.textContent = r.failure === 'renderer_unavailable'
            ? 'The PDF service is down. Your record is waiting and will retry.'
            : 'Storage is down. Your record is waiting and will retry.';
        } else if (r.state === 'rendering') {
          status.textContent = 'Rendering the year record...';
        }
      }, 2000);
    }
    const make = document.getElementById('link-make');
    if (make) make.addEventListener('click', async () => {
      const label = document.getElementById('link-label').value;
      const expires = document.getElementById('link-expires').value;
      const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/.exec(expires.trim());
      const alertEl = document.getElementById('link-alert');
      if (!m) { alertEl.textContent = 'Enter an instant as YYYY-MM-DD HH:MM.'; return; }
      const res = await api(`/households/${hid}/share-links`, {
        method: 'POST', body: JSON.stringify({ label, expiresAt: `${m[1]}T${m[2]}:00${tzOffsetFor(state.me.household.zone)}` }),
      });
      if (res.ok) {
        announce('Link created. Anyone with it can see handover times only.');
        renderRecords(state);
      } else {
        alertEl.textContent = Object.values(res.body.errors || {}).join(' ') || 'Something went wrong. Try again.';
      }
    });
    state.links.items.forEach((l) => {
      const li = document.querySelector(`li[data-id="${l.id}"]`);
      if (!li) return;
      const copy = li.querySelector('.act-copy');
      if (copy) copy.addEventListener('click', () => {
        void navigator.clipboard.writeText(l.url);
        document.getElementById('link-status').textContent = 'Link copied.';
      });
      const regen = li.querySelector('.act-regen');
      if (regen) regen.addEventListener('click', async () => {
        const res = await api(`/households/${hid}/share-links/${l.id}/regenerate`, { method: 'POST', body: JSON.stringify({}) });
        if (res.ok) { announce('New link made. The old link no longer works.'); renderRecords(state); }
      });
      const revoke = li.querySelector('.act-revoke');
      if (revoke) revoke.addEventListener('click', async () => {
        const res = await api(`/households/${hid}/share-links/${l.id}`, { method: 'DELETE' });
        if (res.ok) { announce('Link revoked.'); renderRecords(state); }
      });
    });
    document.getElementById('log-more').addEventListener('click', async () => {
      const last = state.log.items.length > 0 ? state.log.items[state.log.items.length - 1].seq : null;
      const res = await api(`/households/${hid}/log?limit=10${last ? `&after=${last}` : ''}`);
      if (res.ok) {
        state.log.items.push(...res.body.items);
        const ul = document.querySelector('ul[aria-label="Log entries"]');
        ul.innerHTML = state.log.items.map((e) => `<li>${e.seq} — ${esc(e.type)} — ${esc(e.at)}</li>`).join('');
      }
    });
  }
  function tzOffsetFor(zone) {
    const now = new Date();
    const dtf = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' });
    const parts = dtf.formatToParts(now);
    const tz = parts.find((p) => p.type === 'timeZoneName');
    const m = /GMT([+-]\d{1,2}(?::\d{2})?)/.exec(tz ? tz.value : 'GMT+0');
    if (!m) return '+00:00';
    const raw = m[1];
    const [h, min] = raw.split(':');
    const sign = raw[0] === '-' ? '-' : '+';
    return `${sign}${String(Math.abs(Number(h))).padStart(2, '0')}:${String(min ? Number(min) : 0).padStart(2, '0')}`;
  }
})();
