// Console interactions. The server enforces every rule; these handlers only
// call the API and reflect its answers.

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

async function api(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Corvo-Org': document.body.dataset.appId };
  const res = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const text = await res.text();
  let body = null;
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
  btn.innerHTML = reduceMotion ? '<span class="busy-label"></span>' : '<span class="spinner" aria-hidden="true"></span>';
  return () => { btn.disabled = false; btn.innerHTML = original; };
}

// sign out
for (const btn of document.querySelectorAll('[data-signout]')) {
  btn.addEventListener('click', async () => {
    try { await api('/api/v1/auth/logout', { method: 'POST', body: '{}' }); } catch {}
    window.location.href = '/';
  });
}

// console sheet (phone)
const sheetBtn = document.querySelector('.console-menu-btn');
if (sheetBtn) {
  const sheet = document.getElementById('console-sheet');
  sheetBtn.addEventListener('click', () => {
    const open = !sheet.hidden;
    sheet.hidden = open;
    sheetBtn.setAttribute('aria-expanded', String(!open));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sheet.hidden) {
      sheet.hidden = true;
      sheetBtn.setAttribute('aria-expanded', 'false');
      sheetBtn.focus();
    }
  });
}

// ---- inline create wallet row -------------------------------------------------
const createWalletBtn = document.getElementById('create-wallet-btn');
if (createWalletBtn) {
  const row = document.getElementById('wallet-create-row');
  const form = document.getElementById('wallet-create-form');
  const discard = document.getElementById('wallet-discard');
  createWalletBtn.addEventListener('click', () => {
    row.hidden = false;
    document.getElementById('new-wallet-name').focus();
  });
  const close = () => { row.hidden = true; createWalletBtn.focus(); };
  discard.addEventListener('click', close);
  form.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const unbusy = busy(form.querySelector('button[type="submit"]'));
    const body = {
      name: document.getElementById('new-wallet-name').value,
      chain: document.getElementById('new-wallet-chain').value,
      asset: document.getElementById('new-wallet-asset').value,
    };
    const policyId = document.getElementById('new-wallet-policy').value;
    const quorumId = document.getElementById('new-wallet-quorum').value;
    if (policyId) body.policy_id = policyId;
    if (quorumId) body.quorum_id = quorumId;
    body.approval_floor = document.getElementById('new-wallet-floor').value || '0';
    try {
      await api('/api/v1/wallets', { method: 'POST', body: JSON.stringify(body) });
      toast('Wallet created');
      window.location.reload();
    } catch (err) {
      toast(err.message, true);
      unbusy();
    }
  });
}

// ---- wallet page -----------------------------------------------------------------
const copyBtn = document.getElementById('copy-address');
if (copyBtn) {
  copyBtn.addEventListener('click', async () => {
    const text = document.getElementById('wallet-address').textContent;
    await navigator.clipboard.writeText(text).catch(() => {});
    toast('Address copied');
  });
}

const freezeBtn = document.getElementById('freeze-btn');
if (freezeBtn) {
  const dialog = document.getElementById('freeze-dialog');
  freezeBtn.addEventListener('click', () => {
    dialog.showModal();
    dialog.querySelector('[data-dialog-cancel]').focus();
  });
  dialog.querySelector('[data-dialog-cancel]').addEventListener('click', () => {
    dialog.close();
    freezeBtn.focus();
  });
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); dialog.close(); freezeBtn.focus(); }
  });
  document.getElementById('freeze-confirm').addEventListener('click', async () => {
    const unbusy = busy(document.getElementById('freeze-confirm'));
    try {
      await api(`/api/v1/wallets/${document.body.dataset.walletId}/freeze`, { method: 'POST', body: '{}' });
      toast('Wallet frozen');
      window.location.reload();
    } catch (err) { toast(err.message, true); unbusy(); }
  });
}
const unfreezeBtn = document.getElementById('unfreeze-btn');
if (unfreezeBtn) {
  unfreezeBtn.addEventListener('click', async () => {
    const unbusy = busy(unfreezeBtn);
    try {
      await api(`/api/v1/wallets/${document.body.dataset.walletId}/unfreeze`, { method: 'POST', body: '{}' });
      toast('Wallet unfrozen');
      window.location.reload();
    } catch (err) { toast(err.message, true); unbusy(); }
  });
}

function sendOutcomeText(data) {
  if (data.status === 'executed') return 'Transfer executed';
  return `Waiting for approval: ${data.approvals.length} of ${data.required_approvals} approvals`;
}

const sendForm = document.getElementById('send-form');
if (sendForm) {
  sendForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const result = document.getElementById('send-result');
    const unbusy = busy(sendForm.querySelector('button[type="submit"]'));
    try {
      const key = crypto.randomUUID();
      const data = await api(`/api/v1/wallets/${document.body.dataset.walletId}/transfers`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify({
          destination_address: document.getElementById('send-destination').value,
          amount: document.getElementById('send-amount').value,
          memo: document.getElementById('send-memo').value,
        }),
      });
      const text = sendOutcomeText(data);
      result.textContent = text;
      result.className = 'form-result';
      toast(text);
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      result.textContent = sendErrorText(err);
      result.className = 'form-result error';
      toast(err.message, true);
      const field = err.details && err.details.field;
      if (field === 'amount') {
        const el = document.getElementById('send-amount');
        const errEl = document.getElementById('send-amount-error');
        errEl.textContent = err.message; errEl.hidden = false;
        el.setAttribute('aria-invalid', 'true');
        el.setAttribute('aria-describedby', 'send-amount-error');
      } else if (field === 'destination_address') {
        const el = document.getElementById('send-destination');
        const errEl = document.getElementById('send-dest-error');
        errEl.textContent = err.message; errEl.hidden = false;
        el.setAttribute('aria-invalid', 'true');
        el.setAttribute('aria-describedby', 'send-dest-error');
      }
      unbusy();
    }
  });
}

function sendErrorText(err) {
  if (err.code === 'POLICY_DENIED') {
    return err.details && err.details.rule
      ? `Blocked by policy rule ${err.details.rule}`
      : 'Blocked by policy: no rule allowed this transfer';
  }
  if (err.code === 'INSUFFICIENT_FUNDS') return 'Not enough available balance';
  return err.message;
}

const depositForm = document.getElementById('deposit-form');
if (depositForm) {
  depositForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const result = document.getElementById('deposit-result');
    const unbusy = busy(depositForm.querySelector('button[type="submit"]'));
    try {
      const key = crypto.randomUUID();
      await api(`/api/v1/wallets/${document.body.dataset.walletId}/deposits`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify({
          amount: document.getElementById('deposit-amount').value,
          reference: document.getElementById('deposit-reference').value,
        }),
      });
      toast('Deposit recorded');
      window.location.reload();
    } catch (err) {
      result.textContent = err.message;
      result.className = 'form-result error';
      toast(err.message, true);
      unbusy();
    }
  });
}

// ---- payroll batch builder ------------------------------------------------------
const batchForm = document.getElementById('batch-form');
if (batchForm) {
  const lines = document.getElementById('batch-lines');
  const asset = document.body.dataset.walletAsset || 'USDC';
  const decimals = asset.toLowerCase() === 'eth' ? 18 : 6;
  const totalEl = document.getElementById('batch-total');

  function parseAmountText(text) {
    if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(text)) return null;
    const [w, f = ''] = text.split('.');
    if (f.length > decimals) return null;
    let raw = BigInt(w) * 10n ** BigInt(decimals);
    if (f) raw += BigInt(f) * 10n ** BigInt(decimals - f.length);
    return raw;
  }

  function refresh() {
    let sum = 0n;
    for (const line of [...lines.querySelectorAll('.batch-line')]) {
      const amountInput = line.querySelector('.line-amount');
      const errEl = line.querySelector('[data-amount-error]');
      const raw = parseAmountText(amountInput.value);
      if (amountInput.value === '' || raw !== null) { errEl.hidden = true; amountInput.removeAttribute('aria-invalid'); }
      if (raw !== null) sum += raw;
    }
    let display = sum.toString();
    if (decimals > 0) {
      const neg = sum < 0n; let n = neg ? -sum : sum;
      const whole = n / 10n ** BigInt(decimals);
      let frac = (n % 10n ** BigInt(decimals)).toString().padStart(decimals, '0').replace(/0+$/, '');
      display = frac ? `${whole}.${frac}` : `${whole}`;
      if (neg) display = `-${display}`;
    }
    totalEl.textContent = `Total: ${display} ${asset.toUpperCase()}`;
  }

  function wireLine(line) {
    const k = [...lines.children].indexOf(line) + 1;
    const removeBtn = line.querySelector('.remove-line');
    removeBtn.textContent = `Remove line ${k}`;
    removeBtn.disabled = lines.children.length <= 1;
    line.querySelector('.line-amount').addEventListener('input', refresh);
    line.querySelector('.line-amount').addEventListener('blur', () => {
      const input = line.querySelector('.line-amount');
      const errEl = line.querySelector('[data-amount-error]');
      if (input.value !== '' && parseAmountText(input.value) === null) {
        errEl.textContent = 'Enter an amount like 1250 or 0.5';
        errEl.hidden = false;
        input.setAttribute('aria-invalid', 'true');
      } else if (input.value === '' || parseAmountText(input.value) === null) {
        errEl.hidden = true;
        input.removeAttribute('aria-invalid');
      }
    });
    removeBtn.addEventListener('click', () => {
      const idx = [...lines.children].indexOf(line);
      line.remove();
      const rest = [...lines.children];
      for (let i = 0; i < rest.length; i++) relabel(rest[i], i + 1);
      refresh();
      const next = rest[idx] || rest[idx - 1];
      if (next) next.querySelector('.line-destination').focus();
      else document.getElementById('add-line-btn').focus();
    });
    relabel(line, k);
  }

  function relabel(line, k) {
    line.dataset.line = String(k);
    line.querySelector('.line-destination').id = `line-${k}-destination`;
    line.querySelector('label[for$="-destination"]').setAttribute('for', `line-${k}-destination`);
    line.querySelector('label[for$="-destination"]').textContent = `Line ${k} destination`;
    line.querySelector('.line-amount').id = `line-${k}-amount`;
    line.querySelector('label[for$="-amount"]').setAttribute('for', `line-${k}-amount`);
    line.querySelector('label[for$="-amount"]').textContent = `Line ${k} amount`;
    line.querySelector('.line-memo').id = `line-${k}-memo`;
    line.querySelector('label[for$="-memo"]').setAttribute('for', `line-${k}-memo`);
    line.querySelector('label[for$="-memo"]').textContent = `Line ${k} memo`;
    const removeBtn = line.querySelector('.remove-line');
    removeBtn.textContent = `Remove line ${k}`;
    removeBtn.disabled = lines.children.length <= 1;
  }

  document.getElementById('add-line-btn').addEventListener('click', () => {
    const k = lines.children.length + 1;
    const div = document.createElement('div');
    div.className = 'batch-line';
    div.innerHTML = `
      <div class="field"><label for="line-${k}-destination">Line ${k} destination</label>
        <input id="line-${k}-destination" class="line-destination" type="text"></div>
      <div class="field"><label for="line-${k}-amount">Line ${k} amount</label>
        <input id="line-${k}-amount" class="line-amount" type="text" inputmode="decimal">
        <p class="field-error" data-amount-error hidden></p></div>
      <div class="field"><label for="line-${k}-memo">Line ${k} memo</label>
        <input id="line-${k}-memo" class="line-memo" type="text"></div>
      <button type="button" class="capsule capsule-outline remove-line">Remove line ${k}</button>`;
    lines.appendChild(div);
    wireLine(div);
    const rest = [...lines.children];
    for (let i = 0; i < rest.length; i++) relabel(rest[i], i + 1);
    refresh();
    div.querySelector('.line-destination').focus();
  });

  for (const line of [...lines.querySelectorAll('.batch-line')]) wireLine(line);
  refresh();

  batchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const result = document.getElementById('batch-result');
    const unbusy = busy(batchForm.querySelector('button[type="submit"]'));
    const items = [];
    for (const line of lines.querySelectorAll('.batch-line')) {
      items.push({
        destination_address: line.querySelector('.line-destination').value,
        amount: line.querySelector('.line-amount').value,
        memo: line.querySelector('.line-memo').value,
      });
    }
    try {
      const key = crypto.randomUUID();
      const data = await api(`/api/v1/wallets/${document.body.dataset.walletId}/batches`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify({ items }),
      });
      const text = data.status === 'executed'
        ? 'Batch executed'
        : `Batch waiting for approval: ${data.approvals.length} of ${data.required_approvals} approvals`;
      result.textContent = text;
      result.className = 'form-result';
      toast(text);
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      let text = err.message;
      if (err.code === 'POLICY_DENIED') {
        const idx = err.details && err.details.index;
        text = err.details && err.details.rule
          ? `Line ${(idx || 0) + 1} blocked by policy rule ${err.details.rule}`
          : `Line ${(idx || 0) + 1} blocked by policy: no rule allowed it`;
      } else if (err.code === 'INSUFFICIENT_FUNDS') {
        text = 'Not enough available balance';
      } else if (err.code === 'AMOUNT_PRECISION' || err.code === 'INVALID_AMOUNT' || err.code === 'AMOUNT_NOT_POSITIVE' || err.code === 'AMOUNT_TOO_LARGE') {
        text = 'Enter an amount like 1250 or 0.5';
      }
      result.textContent = text;
      result.className = 'form-result error';
      toast(text, true);
      const field = err.details && err.details.field;
      if (field && /^items\.\d+\./.test(field)) {
        const idx = Number(field.split('.')[1]);
        const fieldName = field.split('.')[2];
        const line = lines.querySelectorAll('.batch-line')[idx];
        if (line) {
          const input = line.querySelector(`.line-${fieldName === 'amount' ? 'amount' : 'destination'}`);
          const errEl = fieldName === 'amount' ? line.querySelector('[data-amount-error]') : null;
          if (errEl) { errEl.textContent = err.message; errEl.hidden = false; }
          input.setAttribute('aria-invalid', 'true');
          input.focus();
        }
      }
      unbusy();
    }
  });
}

// ---- approvals inbox -----------------------------------------------------------
const inboxList = document.getElementById('inbox-list');
if (inboxList) {
  inboxList.addEventListener('click', async (e) => {
    const row = e.target.closest('.inbox-row');
    if (!row) return;
    const intentId = row.dataset.intentId;

    if (e.target.classList.contains('approve-btn')) {
      const unbusy = busy(e.target);
      try {
        const data = await api(`/api/v1/intents/${intentId}/approve`, { method: 'POST', body: '{}' });
        const text = data.status === 'executed'
          ? (data.kind === 'batch' ? 'Batch executed' : 'Transfer executed')
          : `Approved: ${data.approvals.length} of ${data.required_approvals} approvals`;
        toast(text);
        removeRowAndMoveFocus(row);
      } catch (err) {
        showRowMessage(row, err.message);
        unbusy();
      }
      return;
    }
    if (e.target.classList.contains('reject-btn')) {
      const panel = row.querySelector('.reject-panel');
      panel.hidden = false;
      panel.querySelector('.reject-reason').focus();
      return;
    }
    if (e.target.classList.contains('confirm-reject')) {
      const input = row.querySelector('.reject-reason');
      const errEl = row.querySelector('.field-error');
      if (!input.value.trim()) {
        errEl.hidden = false;
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return;
      }
      errEl.hidden = true;
      const unbusy = busy(e.target);
      try {
        await api(`/api/v1/intents/${intentId}/reject`, {
          method: 'POST', body: JSON.stringify({ reason: input.value }),
        });
        toast('Intent rejected');
        removeRowAndMoveFocus(row);
      } catch (err) {
        showRowMessage(row, err.message);
        unbusy();
      }
      return;
    }
  });

  inboxList.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const row = e.target.closest('.inbox-row');
    if (!row) return;
    const panel = row.querySelector('.reject-panel');
    if (!panel.hidden && panel.contains(e.target)) {
      panel.hidden = true;
      row.querySelector('.reject-btn').focus();
    }
  });

  function showRowMessage(row, message) {
    const el = row.querySelector('.row-message');
    el.textContent = message;
    el.hidden = false;
  }

  function removeRowAndMoveFocus(row) {
    const rows = [...inboxList.querySelectorAll('.inbox-row')];
    const idx = rows.indexOf(row);
    row.remove();
    const nextRow = rows[idx + 1] || rows[idx - 1];
    if (nextRow && nextRow.isConnected) {
      nextRow.querySelector('.approve-btn').focus();
    } else {
      let empty = inboxList.querySelector('.inbox-empty');
      if (!empty) {
        empty = document.createElement('p');
        empty.className = 'empty-state inbox-empty';
        empty.tabIndex = -1;
        empty.textContent = 'Nothing waiting for your approval';
        inboxList.appendChild(empty);
      }
      empty.hidden = false;
      empty.focus();
    }
    decrementRailCount();
  }

  function decrementRailCount() {
    for (const el of document.querySelectorAll('[data-inbox-count]')) {
      const n = Math.max(0, Number(el.dataset.inboxCount || '0') - 1);
      el.dataset.inboxCount = String(n);
      const badge = el.querySelector('.rail-count');
      if (badge) {
        badge.textContent = String(n);
        if (n === 0) badge.remove();
      }
    }
  }
}

// ---- intents list --------------------------------------------------------------
const statusFilter = document.getElementById('status-filter');
if (statusFilter) {
  statusFilter.addEventListener('change', () => {
    const status = statusFilter.value;
    window.location.href = status ? `/console/intents?status=${encodeURIComponent(status)}` : '/console/intents';
  });
}

const loadMoreBtn = document.getElementById('load-more-btn');
if (loadMoreBtn) {
  loadMoreBtn.addEventListener('click', async () => {
    const cursor = document.getElementById('next-cursor').value;
    const status = statusFilter ? statusFilter.value : '';
    const params = new URLSearchParams({ limit: '20', cursor });
    if (status) params.set('status', status);
    const unbusy = busy(loadMoreBtn);
    try {
      const data = await api(`/api/v1/intents?${params}`);
      const tbody = document.getElementById('intents-tbody');
      const emptyEl = document.getElementById('intents-empty');
      if (emptyEl) emptyEl.hidden = true;
      const count = tbody.querySelectorAll('.intent-row').length;
      for (const intent of data.items) {
        tbody.insertAdjacentHTML('beforeend', intentRowHtml(intent));
      }
      if (data.next_cursor) {
        document.getElementById('next-cursor').value = data.next_cursor;
        unbusy();
      } else {
        loadMoreBtn.remove();
        const firstNew = tbody.querySelectorAll('.intent-row')[count];
        if (firstNew) firstNew.querySelector('[data-details]').focus();
      }
    } catch (err) {
      toast(err.message, true);
      unbusy();
    }
  });
}

document.addEventListener('click', async (e) => {
  if (e.target.matches('[data-details]')) {
    const detailsRow = e.target.closest('tr').nextElementSibling;
    detailsRow.hidden = !detailsRow.hidden;
    e.target.setAttribute('aria-expanded', String(!detailsRow.hidden));
    return;
  }
  if (e.target.matches('[data-cancel]')) {
    const row = e.target.closest('tr');
    const intentId = row.dataset.intentId;
    const unbusy = busy(e.target);
    try {
      await api(`/api/v1/intents/${intentId}/cancel`, { method: 'POST', body: '{}' });
      toast('Intent cancelled');
      window.location.reload();
    } catch (err) {
      toast(err.message, true);
      unbusy();
    }
  }
});

function intentRowHtml(intent) {
  const badges = { pending_approval: 'badge-pending_approval', executed: 'badge-executed', rejected: 'badge-rejected', cancelled: 'badge-cancelled', expired: 'badge-expired' };
  return `<tr class="intent-row" data-intent-id="${intent.id}">
    <td>${intent.id}</td><td>${intent.wallet_name}</td><td>${intent.kind}</td>
    <td>${intent.kind === 'batch' ? `${intent.items.length} lines` : intent.destination_address}</td>
    <td class="num">${intent.amount} ${intent.wallet_asset ? intent.wallet_asset.toUpperCase() : ''}</td>
    <td><span class="badge ${badges[intent.status] || ''}">${intent.status}</span></td>
    <td>${intent.initiator_name || ''}</td><td></td>
    <td>${intent.approvals.length} of ${intent.required_approvals}</td>
    <td><button type="button" class="table-btn" data-details>Details for ${intent.id}</button></td>
  </tr>
  <tr class="details-row" hidden><td colspan="10">
    <dl class="details-list">
      <div><dt>Policy decision</dt><dd>${intent.policy_decision ? `${intent.policy_decision.action} by ${intent.policy_decision.rule || 'no rule'} · Decided under revision ${intent.policy_decision.policy_revision}` : 'No policy'}</dd></div>
      ${intent.tx_hash ? `<div><dt>Transaction hash</dt><dd class="mono">${intent.tx_hash}</dd></div>` : ''}
      ${intent.rejection_reason ? `<div><dt>Rejection reason</dt><dd>${intent.rejection_reason}</dd></div>` : ''}
    </dl>
  </td></tr>`;
}

// ---- simulate -------------------------------------------------------------------
const simulateForm = document.getElementById('simulate-form');
if (simulateForm) {
  simulateForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const policyId = document.body.dataset.policyId;
    const unbusy = busy(simulateForm.querySelector('button[type="submit"]'));
    try {
      const result = await api(`/api/v1/policies/${policyId}/evaluate`, {
        method: 'POST',
        body: JSON.stringify({
          method: document.getElementById('simulate-method').value,
          wallet_id: document.getElementById('simulate-wallet').value,
          destination_address: document.getElementById('simulate-destination').value,
          amount: document.getElementById('simulate-amount').value,
        }),
      });
      const box = document.getElementById('simulation-result');
      box.hidden = false;
      const aggNames = JSON.parse(document.body.dataset.aggregations || '{}');
      const aggs = Object.entries(result.aggregations || {}).map(([id, v]) =>
        `<span class="chip">${aggNames[id] || id}: ${v}</span>`).join('');
      const trace = (result.trace || []).map((t) =>
        `<li>${t.rule}: ${t.considered ? (t.matched ? 'matched' : 'not matched') : 'skipped (method)'}</li>`).join('');
      box.innerHTML = `
        <p class="simulation-decision ${result.action === 'ALLOW' ? 'allow' : 'deny'}">${result.action} · ${result.rule || 'no rule matched'}</p>
        <p>Evaluated against revision ${result.policy_revision}</p>
        <p class="agg-line">${aggs}</p>
        <ul class="trace-list">${trace}</ul>`;
    } catch (err) {
      toast(err.message, true);
    } finally { unbusy(); }
  });
}

// ---- policy editor ----------------------------------------------------------------
const savePolicyBtn = document.getElementById('save-policy-btn');
if (savePolicyBtn) {
  const rulesTbody = document.getElementById('rules-tbody');
  const collectRules = () => {
    const rows = [...rulesTbody.querySelectorAll('tr')];
    const rules = [];
    let current = null;
    for (const row of rows) {
      const nameInput = row.querySelector('.rule-name');
      if (nameInput) {
        current = {
          name: nameInput.value,
          method: row.querySelector('.rule-method').value,
          action: row.querySelector('.rule-action').value,
          conditions: [],
        };
        rules.push(current);
        continue;
      }
      const cond = row.querySelector('.cond-field');
      if (cond && current) {
        let value = row.querySelector('.cond-value').value;
        try { value = JSON.parse(value); } catch { /* keep string */ }
        current.conditions.push({
          field_source: row.querySelector('.cond-source').value,
          field: cond.value,
          operator: row.querySelector('.cond-operator').value,
          value,
        });
      }
    }
    return rules;
  };

  const renumber = () => {
    const rows = [...rulesTbody.querySelectorAll('tr[data-rule]')];
    const seen = new Set();
    rows.forEach((row, i) => {
      if (seen.has(row)) return;
      seen.add(row);
      const k = i + 1;
      row.dataset.rule = String(i);
      for (const btn of row.querySelectorAll('.table-btn')) {
        const label = btn.textContent.replace(/rule \d+/, `rule ${k}`);
        btn.textContent = label;
        btn.setAttribute('data-move-up', String(i));
        btn.setAttribute('data-move-down', String(i));
        btn.setAttribute('data-remove-rule', String(i));
        btn.setAttribute('data-add-cond', String(i));
      }
      const rowspan = row.getAttribute('data-rowspan');
    });
  };

  rulesTbody.addEventListener('click', (e) => {
    const btn = e.target.closest('.table-btn');
    if (!btn) return;
    const ruleRows = [...rulesTbody.querySelectorAll('tr[data-rule]')];
    if (btn.hasAttribute('data-move-up')) {
      const i = Number(btn.getAttribute('data-move-up'));
      if (i > 0) {
        const group = groupRows(ruleRows, i);
        const prev = groupRows(ruleRows, i - 1);
        prev[prev.length - 1].after(...group);
        renumber();
      }
      return;
    }
    if (btn.hasAttribute('data-move-down')) {
      const i = Number(btn.getAttribute('data-move-down'));
      if (i < ruleRows.length - 1) {
        const group = groupRows(ruleRows, i);
        const next = groupRows(ruleRows, i + 1);
        group[0].before(...next);
        renumber();
      }
      return;
    }
    if (btn.hasAttribute('data-remove-rule')) {
      const i = Number(btn.getAttribute('data-remove-rule'));
      const group = groupRows(ruleRows, i);
      group.forEach((r) => r.remove());
      renumber();
      return;
    }
    if (btn.hasAttribute('data-add-cond')) {
      const i = Number(btn.getAttribute('data-add-cond'));
      const ruleRow = ruleRows[i];
      const k = i + 1;
      const condRow = document.createElement('tr');
      condRow.innerHTML = `
        <td><select class="cond-source" aria-label="Field source"><option value="request_body">request_body</option><option value="system">system</option><option value="reference">reference</option></select></td>
        <td><input class="cond-field" aria-label="Field" value="source.amount"></td>
        <td><input class="cond-operator" aria-label="Operator" value="gte"></td>
        <td><input class="cond-value" aria-label="Value" value="0"></td>
        <td></td>`;
      const editCell = ruleRow.querySelector('td:last-child');
      if (editCell && editCell.colSpan === 1) {
        editCell.setAttribute('rowspan', String(Number(editCell.getAttribute('rowspan') || '1') + 1));
      }
      ruleRow.after(condRow);
      condRow.querySelector('.cond-field').focus();
      return;
    }
  });

  function groupRows(ruleRows, i) {
    const start = ruleRows[i];
    const group = [start];
    let sib = start.nextElementSibling;
    while (sib && !sib.hasAttribute('data-rule') && sib.querySelector('.cond-field')) {
      group.push(sib);
      sib = sib.nextElementSibling;
    }
    return group;
  }

  const addRuleBtn = document.getElementById('add-rule-btn');
  if (addRuleBtn) {
    addRuleBtn.addEventListener('click', () => {
      const row = document.createElement('tr');
      row.setAttribute('data-rule', String(rulesTbody.querySelectorAll('tr[data-rule]').length));
      row.innerHTML = `
        <td><input class="rule-name" aria-label="Rule name" value="New rule"></td>
        <td><input class="rule-method" aria-label="Method" value="*"></td>
        <td><input class="rule-action" aria-label="Action" value="ALLOW"></td>
        <td colspan="4" class="muted-cell">no conditions</td>
        <td>
          <button type="button" class="table-btn" data-move-up>Move rule up</button>
          <button type="button" class="table-btn" data-move-down>Move rule down</button>
          <button type="button" class="table-btn" data-remove-rule>Remove rule</button>
          <button type="button" class="table-btn" data-add-cond>Add condition</button>
        </td>`;
      rulesTbody.appendChild(row);
      renumber();
      row.querySelector('.rule-name').focus();
    });
  }

  savePolicyBtn.addEventListener('click', async () => {
    const policyId = document.body.dataset.policyId;
    const result = document.getElementById('policy-result');
    const unbusy = busy(savePolicyBtn);
    try {
      const rules = collectRules();
      const data = await api(`/api/v1/policies/${policyId}`, {
        method: 'PATCH', body: JSON.stringify({ rules }),
      });
      result.textContent = `Policy saved, revision ${data.revision}`;
      result.className = 'form-result';
      toast(`Policy saved, revision ${data.revision}`);
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      const path = err.details && err.details.path;
      result.textContent = path ? `${err.message} at ${path}` : err.message;
      result.className = 'form-result error';
      toast(err.message, true);
      const match = /^rules\[(\d+)\](?:\.conditions\[(\d+)\])?\.(.+)$/.exec(path || '');
      if (match) {
        const ruleRows = [...rulesTbody.querySelectorAll('tr')].filter((r) => r.querySelector('.rule-name'));
        const ruleRow = ruleRows[Number(match[1])];
        if (ruleRow) {
          const fieldClass = { name: '.rule-name', method: '.rule-method', action: '.rule-action' }[match[3]];
          if (fieldClass) ruleRow.querySelector(fieldClass).focus();
          else if (match[2] !== undefined) {
            const condRows = [...rulesTbody.querySelectorAll('tr')].filter((r) => r.querySelector('.cond-field'));
            const condRow = condRows[Number(match[2])];
            if (condRow) condRow.querySelector(`.cond-${match[3] === 'operator' ? 'operator' : match[3] === 'field' ? 'field' : 'value'}`)?.focus();
          }
        }
      }
      unbusy();
    }
  });
}

// ---- settings ---------------------------------------------------------------
const addMemberBtn = document.getElementById('add-member-btn');
if (addMemberBtn) {
  addMemberBtn.addEventListener('click', () => {
    const form = document.getElementById('member-create-form');
    form.hidden = !form.hidden;
    if (!form.hidden) document.getElementById('new-member-name').focus();
  });
  document.getElementById('member-create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const unbusy = busy(e.target.querySelector('button[type="submit"]'));
    try {
      await api('/api/v1/members', {
        method: 'POST',
        body: JSON.stringify({
          name: document.getElementById('new-member-name').value,
          email: document.getElementById('new-member-email').value,
          role: document.getElementById('new-member-role').value,
          password: document.getElementById('new-member-password').value,
        }),
      });
      toast('Member added');
      window.location.reload();
    } catch (err) { toast(err.message, true); unbusy(); }
  });
  for (const select of document.querySelectorAll('.role-select')) {
    select.addEventListener('change', async () => {
      try {
        await api(`/api/v1/members/${select.dataset.member}`, {
          method: 'PATCH', body: JSON.stringify({ role: select.value }),
        });
        toast('Member updated');
      } catch (err) {
        toast(err.message, true);
        window.location.reload();
      }
    });
  }
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-remove-member]');
    if (!btn) return;
    const dialog = document.getElementById('remove-member-dialog');
    if (!dialog.open) {
      dialog.dataset.memberId = btn.dataset.removeMember;
      dialog.dataset.memberName = btn.dataset.memberName;
      dialog.showModal();
      dialog.querySelector('.keep-member').focus();
      return;
    }
  });
  const removeDialog = document.getElementById('remove-member-dialog');
  if (removeDialog) {
    removeDialog.querySelector('.keep-member').addEventListener('click', () => {
      removeDialog.close();
      document.querySelector(`[data-remove-member="${removeDialog.dataset.memberId}"]`)?.focus();
    });
    removeDialog.querySelector('.remove-member').addEventListener('click', async () => {
      const unbusy = busy(removeDialog.querySelector('.remove-member'));
      try {
        await api(`/api/v1/members/${removeDialog.dataset.memberId}`, { method: 'DELETE' });
        toast('Member removed');
        window.location.reload();
      } catch (err) { toast(err.message, true); unbusy(); }
    });
  }
}

const createKeyBtn = document.getElementById('create-key-btn');
if (createKeyBtn) {
  createKeyBtn.addEventListener('click', () => {
    const form = document.getElementById('key-create-form');
    form.hidden = !form.hidden;
    if (!form.hidden) document.getElementById('key-name').focus();
  });
  document.getElementById('key-create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const unbusy = busy(e.target.querySelector('button[type="submit"]'));
    try {
      const data = await api('/api/v1/api-keys', {
        method: 'POST',
        body: JSON.stringify({
          name: document.getElementById('key-name').value,
          role: document.getElementById('key-role').value,
        }),
      });
      toast('API key created');
      const p = document.createElement('p');
      p.className = 'secret-reveal';
      p.innerHTML = `<code class="mono"></code> Copy this key now. It will not be shown again.`;
      p.querySelector('code').textContent = data.secret;
      form.after(p);
      form.hidden = true;
    } catch (err) { toast(err.message, true); unbusy(); }
  });
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-revoke-key]');
    if (!btn) return;
    const unbusy = busy(btn);
    try {
      await api(`/api/v1/api-keys/${btn.dataset.revokeKey}`, { method: 'DELETE' });
      toast('API key revoked');
      window.location.reload();
    } catch (err) { toast(err.message, true); unbusy(); }
  });
}

const revealSecretBtn = document.getElementById('reveal-secret-btn');
if (revealSecretBtn) {
  revealSecretBtn.addEventListener('click', async () => {
    try {
      const data = await api('/api/v1/webhooks/secret');
      const input = document.getElementById('signing-secret');
      input.type = 'text';
      input.value = data.secret;
      revealSecretBtn.textContent = 'Revealed';
      revealSecretBtn.disabled = true;
    } catch (err) { toast(err.message, true); }
  });
}
const rotateSecretBtn = document.getElementById('rotate-secret-btn');
if (rotateSecretBtn) {
  rotateSecretBtn.addEventListener('click', async () => {
    const unbusy = busy(rotateSecretBtn);
    try {
      await api('/api/v1/webhooks/secret/rotate', { method: 'POST', body: '{}' });
      toast('Signing secret rotated');
      const result = document.getElementById('secret-result');
      result.textContent = 'Signing secret rotated';
      result.className = 'form-result';
    } catch (err) { toast(err.message, true); unbusy(); }
  });
}

// ---- audit tabs and verify ---------------------------------------------------------
const tabTrail = document.getElementById('tab-trail');
const tabEvents = document.getElementById('tab-events');
if (tabTrail && tabEvents) {
  tabTrail.addEventListener('click', () => {
    tabTrail.setAttribute('aria-selected', 'true');
    tabEvents.setAttribute('aria-selected', 'false');
    document.getElementById('panel-trail').hidden = false;
    document.getElementById('panel-events').hidden = true;
  });
  tabEvents.addEventListener('click', () => {
    tabEvents.setAttribute('aria-selected', 'true');
    tabTrail.setAttribute('aria-selected', 'false');
    document.getElementById('panel-events').hidden = false;
    document.getElementById('panel-trail').hidden = true;
  });
}
const verifyChainBtn = document.getElementById('verify-chain-btn');
if (verifyChainBtn) {
  verifyChainBtn.addEventListener('click', async () => {
    const unbusy = busy(verifyChainBtn);
    try {
      const data = await api('/api/v1/audit/verify');
      const el = document.getElementById('chain-status');
      el.className = 'chain-status ' + (data.valid ? 'ok' : 'broken');
      el.textContent = data.valid
        ? `Chain verified: ${data.events} events`
        : `Chain broken at event ${data.first_broken_seq}`;
    } catch (err) { toast(err.message, true); } finally { unbusy(); }
  });
}
