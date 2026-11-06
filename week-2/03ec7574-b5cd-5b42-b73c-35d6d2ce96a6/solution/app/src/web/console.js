import { formatAmount } from '../lib/core.js';
import { attr, html, trusted } from './html.js';
import { icon } from './icons.js';
import { consolePage } from './layout.js';
import { STATUS_LABELS, hours, money, short, when } from './format.js';

// ---------------------------------------------------------------- shared pieces
const csrf = (frame) => html`<input type="hidden" name="_csrf" value="${frame.csrf}">`;
const badge = (status) => html`<span class="badge badge--${status}">${status}</span>`;

function pageHead(title, { crumb, actions, icon: glyph } = {}) {
  return html`<div class="page-head">
  <div>${crumb ? html`<p class="crumb"><a href="${crumb[1]}">${crumb[0]}</a></p>` : ''}<h1>${glyph ? icon(glyph) : ''}${title}</h1></div>
  ${actions ? html`<div class="page-head__actions">${actions}</div>` : ''}
</div>`;
}

export function progress(approved, required) {
  const pct = required ? Math.round((Math.min(approved, required) / required) * 100) : 0;
  return html`<div class="progress" role="progressbar" aria-label="Approvals" aria-valuemin="0" aria-valuemax="${required}" aria-valuenow="${approved}">
  <span class="progress__fill w-${pct}"></span></div><span class="progress__text">${approved} of ${required} approvals</span>`;
}

// A form's refusal as it shows on one field: marked invalid, described by the message under it.
function fieldState(form, name) {
  const field = form?.error?.details?.field;
  if (field !== name) return { attrs: '', message: '' };
  const id = `err-${name.replace(/[^a-z0-9]/gi, '-')}-${form.key || 'f'}`;
  return { attrs: html` aria-invalid="true" aria-describedby="${id}"`, message: html`<p class="field__error" id="${id}">${form.error.message}</p>` };
}

function input(form, name, label, { value = '', type = 'text', hint = '', extra = '' } = {}) {
  const state = fieldState(form, name);
  const id = `${form.key}-${name.replace(/[^a-z0-9]/gi, '-')}`;
  return html`<div class="field">
  <label for="${id}">${label}</label>
  <input id="${id}" name="${name}" type="${type}" value="${value}" autocomplete="off"${state.attrs}${trusted(extra)}>
  ${hint ? html`<p class="hint">${hint}</p>` : ''}${state.message}
</div>`;
}

function select(form, name, label, options, chosen) {
  const state = fieldState(form, name);
  const id = `${form.key}-${name}`;
  return html`<div class="field">
  <label for="${id}">${label}</label>
  <select id="${id}" name="${name}"${state.attrs}>
    ${options.map(([value, text]) => html`<option value="${value}"${attr('selected', String(chosen ?? '') === String(value))}>${text}</option>`)}
  </select>${state.message}
</div>`;
}

const resultLine = (form) => html`<p class="form-result${form.result?.kind === 'error' ? ' form-result--error' : ''}" role="status" data-result>${form.result?.text || ''}</p>`;

function emptyRow(colspan, text) {
  return html`<tr><td colspan="${colspan}" class="empty-cell"><p class="empty">${text}</p></td></tr>`;
}

// ---------------------------------------------------------------- overview
const WALLET_COLUMNS = ['Name', 'Chain', 'Asset', 'Balance', 'Available', 'Pending', 'Policy', 'Quorum', 'Status'];

function createRow(frame, data) {
  const form = { key: 'create', ...data.create };
  const v = form.values || {};
  const options = (list) => [['', 'None'], ...list.map((x) => [x.id, x.name])];
  return html`<tr class="create-row" data-create-row>
  <td colspan="${WALLET_COLUMNS.length}">
    <form class="create-form" method="post" action="/console/wallets" data-fetch="create-wallet" aria-label="Create wallet">
      ${csrf(frame)}
      ${input(form, 'name', 'Name', { value: v.name, extra: ' maxlength="60" data-autofocus' })}
      ${select(form, 'chain', 'Chain', [['base', 'base'], ['ethereum', 'ethereum']], v.chain)}
      ${select(form, 'asset', 'Asset', [['usdc', 'usdc'], ['eth', 'eth']], v.asset)}
      ${input(form, 'approval_floor', 'Approval floor', { value: v.approval_floor ?? '0', extra: ' inputmode="decimal"' })}
      ${select(form, 'policy_id', 'Policy', options(data.policies), v.policy_id)}
      ${select(form, 'quorum_id', 'Quorum', options(data.quorums), v.quorum_id)}
      <div class="create-form__actions">
        <button class="pill pill--dark pill--small" type="submit">Save wallet</button>
        <a class="pill pill--light pill--small" href="/console" data-discard>Discard</a>
      </div>
      ${form.error && !form.error.details?.field ? html`<p class="form-alert" role="alert">${form.error.message}</p>` : ''}
    </form>
  </td>
</tr>`;
}

export function walletsTable(frame, data) {
  return html`<table class="table table--stack" aria-label="Wallets">
  <thead>
    <tr>${WALLET_COLUMNS.map((c) => html`<th scope="col">${c}</th>`)}</tr>
  </thead>
  <tbody>
    ${frame.isOwner ? (data.create?.open ? createRow(frame, data) : html`<template id="create-row-template">${createRow(frame, { ...data, create: {} })}</template>`) : ''}
    ${data.wallets.length ? data.wallets.map((w) => html`<tr>
      <td data-label="Name"><a class="row-link" href="/console/wallets/${w.id}">${icon('card')}<span>${w.name}</span></a></td>
      <td data-label="Chain">${w.chain}</td>
      <td data-label="Asset">${w.asset.toUpperCase()}</td>
      <td data-label="Balance" class="num">${money(w.balance_raw, w.asset)}</td>
      <td data-label="Available" class="num">${money(w.available_raw, w.asset)}</td>
      <td data-label="Pending" class="num">${money(w.reserved_raw, w.asset)}</td>
      <td data-label="Policy">${data.names.policies[w.policy_id] || 'No policy'}</td>
      <td data-label="Quorum">${data.names.quorums[w.quorum_id] || 'No quorum'}</td>
      <td data-label="Status">${badge(w.status)}</td>
    </tr>`) : emptyRow(WALLET_COLUMNS.length, 'No wallets yet')}
  </tbody>
</table>`;
}

export function overviewView(frame, data) {
  const cards = [['Total wallets', data.stats.wallets], ['Pending intents', data.stats.pending],
    ['Awaiting your approval', data.stats.awaiting], ['Executed in 24 hours', data.stats.executed]];
  const create = frame.isOwner
    ? html`<form method="get" action="/console" data-create-open><input type="hidden" name="create" value="1">
      <button class="pill pill--dark pill--small" type="submit" aria-expanded="${data.create?.open ? 'true' : 'false'}" data-create-toggle>Create wallet</button></form>`
    : '';
  return consolePage(frame, { title: 'Overview', main: html`
${pageHead('Overview')}
<ul class="stat-cards">
  ${cards.map(([label, value]) => html`<li class="stat-card"><span class="stat-card__label">${icon('chart')}${label}</span><span class="stat-card__value">${value}</span></li>`)}
</ul>
<section class="panel" aria-labelledby="wallets-heading" id="create">
  <div class="panel__head"><h2 id="wallets-heading">Wallets</h2>${create}</div>
  <div class="table-wrap" data-wallets>${walletsTable(frame, data)}</div>
</section>` });
}

// ---------------------------------------------------------------- wallet page
function sendForm(frame, wallet, form) {
  const v = form.values || {};
  return html`<section class="panel" aria-labelledby="send-heading">
  <h2 id="send-heading">${icon('transfer')}Send</h2>
  <form class="stack" method="post" action="/console/wallets/${wallet.id}/send" data-fetch="send" aria-labelledby="send-heading" novalidate>
    ${csrf(frame)}
    ${input(form, 'destination_address', 'Destination address', { value: v.destination_address, extra: ' spellcheck="false"' })}
    ${input(form, 'amount', 'Amount', { value: v.amount, hint: `In ${wallet.asset.toUpperCase()}, for example 1250 or 0.5`, extra: ' inputmode="decimal"' })}
    ${input(form, 'memo', 'Memo', { value: v.memo, extra: ' maxlength="140"' })}
    <button class="pill pill--dark" type="submit">Send</button>
    ${resultLine(form)}
  </form>
</section>`;
}

function depositForm(frame, wallet, form) {
  const v = form.values || {};
  return html`<section class="panel" aria-labelledby="deposit-heading">
  <h2 id="deposit-heading">${icon('coin')}Deposit</h2>
  <form class="stack" method="post" action="/console/wallets/${wallet.id}/deposit" data-fetch="deposit" aria-labelledby="deposit-heading" novalidate>
    ${csrf(frame)}
    ${input(form, 'amount', 'Amount', { value: v.amount, extra: ' inputmode="decimal"' })}
    ${input(form, 'reference', 'Reference', { value: v.reference, extra: ' maxlength="64"' })}
    <button class="pill pill--outline" type="submit">Record deposit</button>
    ${resultLine(form)}
  </form>
</section>`;
}

function batchLine(form, line, k, count) {
  const prefix = `items.${k - 1}`;
  const state = (part) => fieldState(form, `${prefix}.${part}`);
  const box = (part, label, value, extra = '') => {
    const s = state(part);
    const id = `batch-${k}-${part}`;
    return html`<div class="field"><label for="${id}">Line ${k} ${label}</label>
      <input id="${id}" name="${prefix}.${part}" value="${value || ''}" autocomplete="off" data-part="${part}"${s.attrs}${trusted(extra)}>${s.message}</div>`;
  };
  return html`<fieldset class="batch-line" data-line>
  <legend>Line ${k}</legend>
  ${box('destination_address', 'destination', line.destination_address, ' spellcheck="false"')}
  ${box('amount', 'amount', line.amount, ' inputmode="decimal"')}
  ${box('memo', 'memo', line.memo, ' maxlength="140"')}
  <button class="pill pill--light pill--small" type="submit" name="op" value="remove:${k - 1}"${attr('disabled', count === 1)}>Remove line ${k}</button>
</fieldset>`;
}

function batchForm(frame, wallet, form) {
  const lines = form.lines?.length ? form.lines : [{}];
  const total = lines.reduce((sum, l) => {
    try {
      return sum + BigInt(validAmount(l.amount, wallet.asset) ?? 0n);
    } catch {
      return sum;
    }
  }, 0n);
  return html`<section class="panel" aria-labelledby="batch-heading">
  <h2 id="batch-heading">${icon('list')}Payroll batch</h2>
  <form class="stack" method="post" action="/console/wallets/${wallet.id}/batch" data-fetch="batch" aria-labelledby="batch-heading"
    data-asset="${wallet.asset}" novalidate>
    ${csrf(frame)}
    <div class="batch-lines" data-lines>${lines.map((l, i) => batchLine(form, l, i + 1, lines.length))}</div>
    <button class="pill pill--light pill--small" type="submit" name="op" value="add" data-add-line>Add line</button>
    <p class="batch-total" role="status" aria-label="Batch total" data-total>Total: ${formatAmount(total, wallet.asset)} ${wallet.asset.toUpperCase()}</p>
    <button class="pill pill--dark" type="submit" name="op" value="submit">Submit batch</button>
    ${resultLine(form)}
  </form>
</section>`;
}

// An amount the parser accepts, or null.
function validAmount(value, asset) {
  const places = asset === 'eth' ? 18 : 6;
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > places) return null;
  return BigInt(whole) * 10n ** BigInt(places) + BigInt(fraction.padEnd(places, '0') || '0');
}

function activityTable(data) {
  const rows = data.activity;
  return html`<table class="table table--stack" aria-label="Activity">
  <thead><tr><th scope="col">When</th><th scope="col">Type</th><th scope="col">Detail</th><th scope="col">Amount</th><th scope="col">Status</th></tr></thead>
  <tbody>
    ${rows.length ? rows.map((r) => (r.type === 'deposit'
    ? html`<tr><td data-label="When"><span class="stamp">${when(r.at)}</span></td><td data-label="Type">Deposit</td>
        <td data-label="Detail"><span class="memo">${r.deposit.reference}</span><span class="muted">by ${r.by}</span></td>
        <td data-label="Amount" class="num">${money(r.deposit.raw_amount, data.wallet.asset)}</td><td data-label="Status">${badge('executed')}</td></tr>`
    : html`<tr><td data-label="When"><span class="stamp">${when(r.at)}</span></td>
        <td data-label="Type"><span class="kind">${icon('transfer')}${r.intent.kind}</span></td>
        <td data-label="Detail">${r.intent.kind === 'batch' ? `${r.intent.items.length} lines` : html`<span title="${r.intent.destination_address}">${short(r.intent.destination_address)}</span>`}
          ${r.intent.memo ? html`<span class="memo">${r.intent.memo}</span>` : ''}</td>
        <td data-label="Amount" class="num">${money(r.intent.raw_amount, data.wallet.asset)}</td>
        <td data-label="Status">${badge(r.intent.status)}</td></tr>`))
    : emptyRow(5, 'No deposits or intents yet')}
  </tbody>
</table>`;
}

function freezeControls(frame, wallet, confirm) {
  if (!frame.isOwner) return '';
  if (wallet.status === 'frozen') {
    return html`<form method="post" action="/console/wallets/${wallet.id}/unfreeze" data-fetch="unfreeze">${csrf(frame)}
      <button class="pill pill--outline pill--small" type="submit">Unfreeze wallet</button></form>`;
  }
  return html`<form method="get" action="/console/wallets/${wallet.id}" data-dialog-opener="freeze-dialog">
    <input type="hidden" name="confirm" value="freeze">
    <button class="pill pill--outline pill--small" type="submit">Freeze wallet</button>
  </form>
  <dialog class="dialog" id="freeze-dialog" aria-labelledby="freeze-title" aria-describedby="freeze-text"${attr('open', confirm)}>
    <h2 id="freeze-title">Freeze wallet</h2>
    <p id="freeze-text">Freezing pauses new transfers and approvals. Deposits, rejections and cancellations still work.</p>
    <div class="dialog__actions">
      <form method="get" action="/console/wallets/${wallet.id}"><button class="pill pill--light" type="submit" data-dialog-close autofocus>Keep active</button></form>
      <form method="post" action="/console/wallets/${wallet.id}/freeze" data-fetch="freeze">${csrf(frame)}
        <button class="pill pill--danger" type="submit">Freeze</button></form>
    </div>
  </dialog>`;
}

export function walletPageView(frame, data) {
  const { wallet } = data;
  const forms = data.forms;
  const fact = (label, value) => html`<div><dt>${label}</dt><dd>${value}</dd></div>`;
  const movers = frame.canMove ? html`
    ${wallet.status === 'frozen'
    ? html`<section class="banner banner--frozen" aria-label="Frozen wallet"><p>This wallet is frozen. New transfers and approvals are paused.</p></section>`
    : sendForm(frame, wallet, { key: 'send', ...forms.send })}
    ${depositForm(frame, wallet, { key: 'deposit', ...forms.deposit })}
    ${wallet.status === 'frozen' ? '' : batchForm(frame, wallet, { key: 'batch', ...forms.batch })}` : '';
  return consolePage(frame, { title: wallet.name, main: html`
${pageHead(wallet.name, { crumb: ['Overview', '/console'], icon: 'card', actions: freezeControls(frame, wallet, data.confirm) })}
<div class="wallet-layout">
  <div class="wallet-layout__main">
    <section class="panel" aria-labelledby="facts-heading">
      <h2 id="facts-heading">Wallet facts</h2>
      <div class="address"><span class="address__label">Address</span><code class="address__value" id="wallet-address">${wallet.address}</code>
        <button class="pill pill--light pill--small" type="button" data-copy="#wallet-address" data-copied="Address copied" aria-label="Copy address">${icon('copy')}<span>Copy</span></button></div>
      <dl class="facts">
        ${fact('Balance', money(wallet.balance_raw, wallet.asset))}
        ${fact('Available', money(wallet.available_raw, wallet.asset))}
        ${fact('Pending', money(wallet.reserved_raw, wallet.asset))}
        ${fact('Approval floor', money(wallet.approval_floor_raw, wallet.asset))}
        ${fact('Chain', wallet.chain)}
        ${fact('Asset', wallet.asset.toUpperCase())}
        ${fact('Policy', data.policyName ? html`<a href="/console/policies/${wallet.policy_id}">${data.policyName}</a>` : 'No policy')}
        ${fact('Quorum', data.quorumName || 'No quorum')}
        ${fact('Status', badge(wallet.status))}
      </dl>
    </section>
    <section class="panel" aria-labelledby="activity-heading">
      <h2 id="activity-heading">Activity</h2>
      <div class="table-wrap">${activityTable(data)}</div>
    </section>
  </div>
  ${movers ? html`<div class="wallet-layout__side">${movers}</div>` : ''}
</div>` });
}

// ---------------------------------------------------------------- approvals inbox
function decision(intent) {
  const d = intent.policy_decision;
  if (!d.policy_id) return 'ALLOW: no policy';
  return `${d.action}: ${d.rule || 'no rule matched'}, revision ${d.policy_revision}`;
}

export function approvalsView(frame, data) {
  const { items } = data;
  return consolePage(frame, { title: 'Approvals', main: html`
${pageHead('Approvals', { icon: 'checklist' })}
<section class="panel" aria-labelledby="inbox-heading">
  <h2 id="inbox-heading">Waiting for your signature</h2>
  ${items.length ? html`<div class="table-wrap"><table class="table table--stack table--inbox" aria-label="Approvals inbox">
    <thead><tr><th scope="col">Wallet</th><th scope="col">Destination</th><th scope="col">Amount</th><th scope="col">Memo</th>
      <th scope="col">Initiator</th><th scope="col">Expires</th><th scope="col">Policy decision</th><th scope="col">Approvals</th><th scope="col">Decide</th></tr></thead>
    ${items.map((i) => html`<tbody role="group" aria-label="Intent ${i.id}" id="row-${i.id}" data-intent="${i.id}"><tr>
      <td data-label="Wallet">${i.walletName}</td>
      <td data-label="Destination">${i.kind === 'batch' ? `${i.items.length} lines`
    : html`<span aria-describedby="dest-${i.id}">${short(i.destination_address)}</span><span class="sr-only" id="dest-${i.id}">${i.destination_address}</span>`}</td>
      <td data-label="Amount" class="num">${money(i.raw_amount, i.asset)}</td>
      <td data-label="Memo">${i.memo || html`<span class="muted">No memo</span>`}</td>
      <td data-label="Initiator">${i.initiator}</td>
      <td data-label="Expires"><span class="stamp">${when(i.expires_at)}</span></td>
      <td data-label="Policy decision">${decision(i)}</td>
      <td data-label="Approvals" data-progress>${progress(i.approved, i.required_approvals)}</td>
      <td data-label="Decide" class="decide">
        <form method="post" action="/console/intents/${i.id}/approve" data-fetch="approve">${csrf(frame)}
          <button class="pill pill--dark pill--small" type="submit">Approve</button></form>
        <button class="pill pill--light pill--small js-only" type="button" aria-expanded="false" aria-controls="reject-${i.id}" data-reject>Reject</button>
        <form class="reject-panel" id="reject-${i.id}" method="post" action="/console/intents/${i.id}/reject" data-fetch="reject" novalidate>${csrf(frame)}
          <label for="reason-${i.id}">Reason for rejecting</label>
          <input id="reason-${i.id}" name="reason" maxlength="280" autocomplete="off">
          <p class="field__error" id="reason-error-${i.id}" data-reason-error hidden>Enter a reason to reject</p>
          <button class="pill pill--danger pill--small" type="submit">Confirm reject</button>
        </form>
        <p class="row-error" role="alert" data-row-error>${data.rowError?.id === i.id ? data.rowError.message : ''}</p>
      </td>
    </tr></tbody>`)}
  </table></div>` : html`<p class="empty" tabindex="-1" data-empty>${icon('checklist')}Nothing waiting for your approval</p>`}
</section>` });
}

// ---------------------------------------------------------------- intents list
const STATUS_FILTERS = [['', 'All'], ...Object.entries(STATUS_LABELS)];

function intentDetails(frame, i) {
  const d = i.policy_decision;
  return html`<dl class="details-list">
  <div><dt>Policy decision</dt><dd>${d.action}: ${d.rule || (d.reason === 'no_policy' ? 'no policy' : 'no rule matched')}.
    ${d.policy_revision === null ? 'No policy' : `Decided under revision ${d.policy_revision}`}</dd></div>
  <div><dt>Approvals</dt><dd>${i.approvals.length
    ? html`<ul class="plain">${i.approvals.map((a) => html`<li>${a.name}: ${a.decision === 'approve' ? 'approved' : 'rejected'} at ${when(a.created_at)}</li>`)}</ul>`
    : 'None yet'}</dd></div>
  ${i.rejection_reason ? html`<div><dt>Rejection reason</dt><dd>${i.rejection_reason}</dd></div>` : ''}
  ${i.destination_address ? html`<div><dt>Destination</dt><dd><code>${i.destination_address}</code></dd></div>` : ''}
  ${i.memo ? html`<div><dt>Memo</dt><dd>${i.memo}</dd></div>` : ''}
  ${i.expires_at ? html`<div><dt>Expires</dt><dd>${when(i.expires_at)}</dd></div>` : ''}
  <div><dt>Transaction hash</dt><dd>${i.tx_hash ? html`<code class="hash">${i.tx_hash}</code>` : 'Not executed'}</dd></div>
  ${i.items.length ? html`<div><dt>Lines</dt><dd><ol class="lines">${i.items.map((l) => html`<li><code title="${l.destination_address}">${short(l.destination_address)}</code> ${money(l.raw_amount, i.asset)}${l.memo ? ` · ${l.memo}` : ''}</li>`)}</ol></dd></div>` : ''}
</dl>
${i.canCancel ? html`<form method="post" action="/console/intents/${i.id}/cancel" data-fetch="cancel">${csrf(frame)}
  <button class="pill pill--outline pill--small" type="submit">Cancel request</button></form>` : ''}
<p class="row-error" role="alert" data-row-error></p>`;
}

export function intentRows(frame, items) {
  return items.map((i) => html`<tr data-intent="${i.id}">
  <td data-label="Intent"><button class="link-button" type="button" aria-expanded="false" aria-controls="details-${i.id}" data-details aria-label="Details for ${i.id}">${icon('chevron')}<code>${i.id}</code></button></td>
  <td data-label="Wallet">${i.walletName}</td>
  <td data-label="Kind"><span class="kind">${icon('transfer')}${i.kind}</span></td>
  <td data-label="Destination">${i.kind === 'batch' ? `${i.items.length} lines` : html`<span title="${i.destination_address}">${short(i.destination_address)}</span>`}</td>
  <td data-label="Amount" class="num">${money(i.raw_amount, i.asset)}</td>
  <td data-label="Status">${badge(i.status)}</td>
  <td data-label="Initiator">${i.initiator}</td>
  <td data-label="Created"><span class="stamp">${when(i.created_at)}</span></td>
  <td data-label="Approvals" class="num">${i.approved} of ${i.required_approvals}</td>
</tr>
<tr class="details-row" id="details-${i.id}" data-details-row><td colspan="9">${intentDetails(frame, i)}</td></tr>`);
}

export function loadMore(nextUrl) {
  return nextUrl ? html`<form class="load-more" method="get" action="/console/intents" data-load-more>
    ${Object.entries(nextUrl).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}
    <button class="pill pill--light" type="submit">Load more</button></form>` : '';
}

export function intentsView(frame, data) {
  const csv = `/console/intents/export${data.status ? `?status=${data.status}` : ''}`;
  return consolePage(frame, { title: 'Intents', main: html`
${pageHead('Intents', { icon: 'transfer', actions: html`<a class="pill pill--light pill--small" href="${csv}" download data-csv>Download CSV</a>` })}
<section class="panel" aria-labelledby="intents-heading">
  <div class="panel__head">
    <h2 id="intents-heading">Every intent, newest first</h2>
    <form class="inline-form" method="get" action="/console/intents" data-filter>
      <label for="status-filter">Status</label>
      <select id="status-filter" name="status">
        ${STATUS_FILTERS.map(([value, label]) => html`<option value="${value}"${attr('selected', data.status === value)}>${label}</option>`)}
      </select>
      <button class="pill pill--light pill--small js-hide" type="submit">Show</button>
    </form>
  </div>
  <div data-intents-list>
    <div class="table-wrap"><table class="table table--stack table--intents" aria-label="Intents">
      <thead><tr><th scope="col">Intent</th><th scope="col">Wallet</th><th scope="col">Kind</th><th scope="col">Destination</th>
        <th scope="col">Amount</th><th scope="col">Status</th><th scope="col">Initiator</th><th scope="col">Created</th><th scope="col">Approvals</th></tr></thead>
      <tbody id="intent-rows">${data.items.length ? intentRows(frame, data.items) : emptyRow(9, 'No intents yet')}</tbody>
    </table></div>
    ${loadMore(data.next)}
  </div>
</section>` });
}

// ---------------------------------------------------------------- policies
export function policiesView(frame, data) {
  return consolePage(frame, { title: 'Policies', main: html`
${pageHead('Policies', { icon: 'policy' })}
<section class="panel" aria-labelledby="policies-heading">
  <h2 id="policies-heading">Spending policies</h2>
  <div class="table-wrap"><table class="table table--stack" aria-label="Policies">
    <thead><tr><th scope="col">Name</th><th scope="col">Rules</th><th scope="col">Revision</th><th scope="col">Wallets</th><th scope="col">Updated</th></tr></thead>
    <tbody>${data.policies.length ? data.policies.map((p) => html`<tr>
      <td data-label="Name"><a class="row-link" href="/console/policies/${p.id}">${icon('policy')}<span>${p.name}</span></a></td>
      <td data-label="Rules" class="num">${p.rules.length}</td>
      <td data-label="Revision" class="num">${p.revision}</td>
      <td data-label="Wallets">${p.wallets.length ? p.wallets.join(', ') : 'None'}</td>
      <td data-label="Updated"><span class="stamp">${when(p.updated_at)}</span></td>
    </tr>`) : emptyRow(5, 'No policies yet')}</tbody>
  </table></div>
</section>` });
}

const METHODS = [['transfer', 'transfer'], ['batch_payout', 'batch_payout'], ['*', '*']];
const SOURCES = [['request_body', 'request_body'], ['system', 'system'], ['reference', 'reference']];
const OPS = ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in'].map((o) => [o, o]);

function ruleEditor(frame, data) {
  const owner = frame.isOwner;
  const rules = data.rules;
  const err = data.saveError;
  const errPath = err?.details?.path;
  const marked = (path) => (errPath === path ? html` aria-invalid="true" aria-describedby="save-error"` : '');
  const field = (path, name, label, value, options) => {
    const id = `ed-${name}`;
    if (!owner) return html`<span class="cell-value">${Array.isArray(value) ? value.join(', ') : String(value)}</span>`;
    if (options) {
      return html`<label class="sr-only" for="${id}">${label}</label><select id="${id}" name="${name}" data-path="${path}"${marked(path)}>
        ${options.map(([v, t]) => html`<option value="${v}"${attr('selected', String(value) === v)}>${t}</option>`)}</select>`;
    }
    return html`<label class="sr-only" for="${id}">${label}</label><input id="${id}" name="${name}" value="${Array.isArray(value) ? value.join(', ') : value}" data-path="${path}" autocomplete="off"${marked(path)}>`;
  };
  const rows = rules.map((rule, i) => {
    const k = i + 1;
    const at = `rules[${i}]`;
    return html`<tr class="rule-row">
    <td data-label="#" class="num">${k}</td>
    <td data-label="Name">${field(`${at}.name`, `r${i}_name`, `Rule ${k} name`, rule.name)}</td>
    <td data-label="Method">${field(`${at}.method`, `r${i}_method`, `Rule ${k} method`, rule.method, METHODS)}</td>
    <td data-label="Action">${field(`${at}.action`, `r${i}_action`, `Rule ${k} action`, rule.action, [['ALLOW', 'ALLOW'], ['DENY', 'DENY']])}</td>
    <td data-label="Conditions">
      <input type="hidden" name="r${i}_cond_count" value="${rule.conditions.length}">
      ${rule.conditions.length ? html`<ol class="conditions">${rule.conditions.map((c, j) => {
    const cat = `${at}.conditions[${j}]`;
    const n = `r${i}_c${j}_`;
    return html`<li class="condition">
          <span class="condition__part"><span class="condition__label">Field source</span>${field(`${cat}.field_source`, `${n}field_source`, `Rule ${k} condition ${j + 1} field source`, c.field_source, SOURCES)}</span>
          <span class="condition__part"><span class="condition__label">Field</span>${field(`${cat}.field`, `${n}field`, `Rule ${k} condition ${j + 1} field`, c.field)}</span>
          <span class="condition__part"><span class="condition__label">Operator</span>${field(`${cat}.operator`, `${n}operator`, `Rule ${k} condition ${j + 1} operator`, c.operator, OPS)}</span>
          <span class="condition__part condition__part--wide"><span class="condition__label">Value</span>${field(`${cat}.value`, `${n}value`, `Rule ${k} condition ${j + 1} value`, c.value)}</span>
          ${owner ? html`<button class="pill pill--light pill--small" type="submit" name="op" value="remove-cond:${i}:${j}">Remove condition ${j + 1} of rule ${k}</button>` : ''}
        </li>`;
  })}</ol>` : html`<span class="muted">No conditions: always matches</span>`}
      ${owner ? html`<button class="pill pill--light pill--small" type="submit" name="op" value="add-cond:${i}">Add condition to rule ${k}</button>` : ''}
    </td>
    ${owner ? html`<td data-label="Order" class="rule-tools">
      <button class="pill pill--light pill--small" type="submit" name="op" value="up:${i}"${attr('disabled', i === 0)}>Move rule ${k} up</button>
      <button class="pill pill--light pill--small" type="submit" name="op" value="down:${i}"${attr('disabled', i === rules.length - 1)}>Move rule ${k} down</button>
      <button class="pill pill--light pill--small" type="submit" name="op" value="remove-rule:${i}">Remove rule ${k}</button>
    </td>` : ''}
  </tr>`;
  });
  const table = html`<div class="table-wrap"><table class="table table--stack table--rules" aria-label="Rules">
    <thead><tr><th scope="col">#</th><th scope="col">Name</th><th scope="col">Method</th><th scope="col">Action</th><th scope="col">Conditions</th>${owner ? html`<th scope="col">Order</th>` : ''}</tr></thead>
    <tbody>${rows}</tbody></table></div>`;
  if (!owner) return table;
  return html`<form method="post" action="/console/policies/${data.policy.id}" data-fetch="policy" id="rule-editor" novalidate>
  ${csrf(frame)}<input type="hidden" name="rule_count" value="${rules.length}">
  ${table}
  ${err ? html`<p class="form-alert" id="save-error" role="alert">${err.message}${errPath ? ` at ${errPath}` : ''}</p>` : ''}
  <div class="editor__foot">
    <button class="pill pill--light" type="submit" name="op" value="add-rule">Add rule</button>
    <button class="pill pill--dark" type="submit" name="op" value="save">Save policy</button>
  </div>
</form>`;
}

function simulation(data) {
  const { sim } = data;
  const v = sim.values || {};
  const form = { key: 'sim', error: sim.error };
  const r = sim.result;
  const aggName = Object.fromEntries(data.aggregations.map((a) => [a.id, a]));
  const aggValue = (id, raw) => {
    const agg = aggName[id];
    return agg.metric === 'count' ? raw : money(raw, agg.asset);
  };
  return html`<section class="panel" aria-labelledby="sim-heading" id="simulate">
  <h2 id="sim-heading">Simulate</h2>
  <form class="simulate" method="post" action="/console/policies/${data.policy.id}/simulate" data-fetch="simulate" aria-labelledby="sim-heading" novalidate>
    <input type="hidden" name="_csrf" value="${data.csrf}">
    ${select(form, 'method', 'Method', [['transfer', 'transfer'], ['batch_payout', 'batch_payout']], v.method)}
    ${select(form, 'wallet_id', 'Wallet', data.wallets.map((w) => [w.id, w.name]), v.wallet_id)}
    ${input(form, 'destination_address', 'Destination address', { value: v.destination_address, extra: ' spellcheck="false"' })}
    ${input(form, 'amount', 'Amount', { value: v.amount, extra: ' inputmode="decimal"' })}
    <button class="pill pill--dark" type="submit">Simulate</button>
  </form>
  <div class="sim-result" role="status" aria-label="Simulation result">
    ${r ? html`<p class="decision decision--${r.action.toLowerCase()}"><strong>${r.action}</strong><span>${r.rule || 'no rule matched'}</span></p>
      <p class="muted">Evaluated against revision ${r.policy_revision}</p>
      ${Object.keys(r.aggregations).length ? html`<ul class="plain">${Object.entries(r.aggregations).map(([id, raw]) => html`<li>${aggName[id].name}: ${aggValue(id, raw)}</li>`)}</ul>` : ''}
      <ol class="trace">${r.trace.map((t) => html`<li class="trace__${t.considered ? (t.matched ? 'match' : 'miss') : 'skip'}">${t.rule}: ${t.considered ? (t.matched ? 'matched' : 'not matched') : 'skipped (method)'}</li>`)}</ol>`
    : html`<p class="muted">Simulate evaluates the saved revision and writes nothing.</p>`}
  </div>
</section>`;
}

export function policyPageView(frame, data) {
  const { policy } = data;
  return consolePage(frame, { title: policy.name, main: html`
${pageHead(policy.name, { crumb: ['Policies', '/console/policies'], icon: 'policy',
    actions: html`<p class="muted">Revision ${policy.revision}</p>` })}
<section class="panel" aria-labelledby="rules-heading" id="rules">
  <h2 id="rules-heading">Rules in order</h2>
  <p class="hint">Deny rules win over allow rules; the first matching rule of each kind decides. A rule with no conditions always matches.</p>
  ${ruleEditor(frame, data)}
</section>
${simulation({ ...data, csrf: frame.csrf })}
<section class="panel" aria-labelledby="revisions-heading">
  <h2 id="revisions-heading">Revision history</h2>
  <div class="table-wrap"><table class="table table--stack" aria-label="Revisions">
    <thead><tr><th scope="col">Revision</th><th scope="col">Name</th><th scope="col">Rules</th><th scope="col">Saved</th></tr></thead>
    <tbody>${data.revisions.map((r) => html`<tr><td data-label="Revision" class="num">${r.revision}</td><td data-label="Name">${r.name}</td>
      <td data-label="Rules" class="num">${r.rules.length}</td><td data-label="Saved"><span class="stamp">${when(r.created_at)}</span></td></tr>`)}</tbody>
  </table></div>
</section>` });
}

// ---------------------------------------------------------------- quorums and aggregations
function quorumFields(form, data, values) {
  return html`${input(form, 'name', 'Quorum name', { value: values.name })}
  <fieldset class="checks"><legend>Members</legend>
    ${data.signers.map((m) => html`<label class="check"><input type="checkbox" name="member_ids" value="${m.id}"${attr('checked', (values.member_ids || []).includes(m.id))}><span>${m.name} (${m.role})</span></label>`)}
    ${fieldState(form, 'member_ids').message}
  </fieldset>
  ${input(form, 'authorization_threshold', 'Threshold', { value: values.authorization_threshold ?? '', extra: ' inputmode="numeric"' })}
  ${input(form, 'expiry_hours', 'Expiry in hours', { value: values.expiry_hours ?? '', extra: ' inputmode="decimal"' })}`;
}

export function quorumsView(frame, data) {
  const owner = frame.isOwner;
  const qForm = { key: 'quorum', ...data.quorumForm };
  const aForm = { key: 'agg', ...data.aggForm };
  const av = aForm.values || {};
  return consolePage(frame, { title: 'Quorums', main: html`
${pageHead('Quorums and aggregations', { icon: 'people' })}
<section class="panel" aria-labelledby="quorums-heading">
  <div class="panel__head"><h2 id="quorums-heading">Key quorums</h2>
    ${owner ? html`<button class="pill pill--dark pill--small" type="button" aria-expanded="${qForm.open ? 'true' : 'false'}" aria-controls="new-quorum" data-toggle>Create key quorum</button>` : ''}</div>
  ${owner ? html`<form class="create-panel" id="new-quorum" method="post" action="/console/quorums" data-fetch="quorum" novalidate${attr('data-open', qForm.open)}>
    ${csrf(frame)}${quorumFields(qForm, data, qForm.values || {})}
    <button class="pill pill--dark" type="submit">Save key quorum</button>
    ${qForm.error && !qForm.error.details?.field ? html`<p class="form-alert" role="alert">${qForm.error.message}</p>` : ''}
  </form>` : ''}
  <div class="table-wrap"><table class="table table--stack" aria-label="Key quorums">
    <thead><tr><th scope="col">Name</th><th scope="col">Members</th><th scope="col">Threshold</th><th scope="col">Expiry</th><th scope="col">Wallets</th>${owner ? html`<th scope="col">Edit</th>` : ''}</tr></thead>
    <tbody>${data.quorums.length ? data.quorums.map((q) => {
    const editing = data.editForm?.id === q.id;
    const eForm = { key: `edit-${q.id}`, ...(editing ? data.editForm : {}) };
    const values = editing ? data.editForm.values : { name: q.name, member_ids: q.member_ids,
      authorization_threshold: q.authorization_threshold, expiry_hours: q.expiry_seconds / 3600 };
    return html`<tr>
      <td data-label="Name">${q.name}</td>
      <td data-label="Members">${q.names.join(', ')}</td>
      <td data-label="Threshold" class="num">${q.authorization_threshold} of ${q.member_ids.length}</td>
      <td data-label="Expiry">${hours(q.expiry_seconds)}</td>
      <td data-label="Wallets">${q.wallets.length ? q.wallets.join(', ') : 'None'}</td>
      ${owner ? html`<td data-label="Edit">
        <button class="pill pill--light pill--small" type="button" aria-expanded="${editing ? 'true' : 'false'}" aria-controls="edit-${q.id}" data-toggle>Edit ${q.name}</button>
        <form class="create-panel" id="edit-${q.id}" method="post" action="/console/quorums/${q.id}" data-fetch="quorum" novalidate${attr('data-open', editing)}>
          ${csrf(frame)}${quorumFields(eForm, data, values)}
          <p class="hint">Requests already waiting keep the members, threshold and expiry they were created with.</p>
          <button class="pill pill--dark pill--small" type="submit">Save key quorum</button>
          ${eForm.error && !eForm.error.details?.field ? html`<p class="form-alert" role="alert">${eForm.error.message}</p>` : ''}
        </form></td>` : ''}
    </tr>`;
  }) : emptyRow(owner ? 6 : 5, 'No key quorums yet')}</tbody>
  </table></div>
</section>
<section class="panel" aria-labelledby="aggregations-heading">
  <div class="panel__head"><h2 id="aggregations-heading">Aggregations</h2>
    ${owner ? html`<button class="pill pill--dark pill--small" type="button" aria-expanded="${aForm.open ? 'true' : 'false'}" aria-controls="new-aggregation" data-toggle>Create aggregation</button>` : ''}</div>
  ${owner ? html`<form class="create-panel" id="new-aggregation" method="post" action="/console/aggregations" data-fetch="aggregation" novalidate${attr('data-open', aForm.open)}>
    ${csrf(frame)}
    ${input(aForm, 'name', 'Aggregation name', { value: av.name })}
    ${select(aForm, 'metric', 'Metric', [['sum_amount', 'sum_amount'], ['count', 'count']], av.metric)}
    ${input(aForm, 'window_hours', 'Window in hours', { value: av.window_hours ?? '24', extra: ' inputmode="decimal"' })}
    ${select(aForm, 'asset', 'Aggregation asset', [['usdc', 'usdc'], ['eth', 'eth']], av.asset)}
    ${select(aForm, 'group_by', 'Grouping', [['wallet', 'wallet'], ['destination', 'destination']], av.group_by)}
    <button class="pill pill--dark" type="submit">Save aggregation</button>
    ${aForm.error && !aForm.error.details?.field ? html`<p class="form-alert" role="alert">${aForm.error.message}</p>` : ''}
  </form>` : ''}
  <div class="table-wrap"><table class="table table--stack" aria-label="Aggregations">
    <thead><tr><th scope="col">Name</th><th scope="col">Metric</th><th scope="col">Window</th><th scope="col">Asset</th><th scope="col">Grouping</th><th scope="col">Policies</th></tr></thead>
    <tbody>${data.aggregations.length ? data.aggregations.map((a) => html`<tr>
      <td data-label="Name">${a.name}</td><td data-label="Metric">${a.metric}</td><td data-label="Window">${hours(a.window_seconds)}</td>
      <td data-label="Asset">${a.asset.toUpperCase()}</td><td data-label="Grouping">${a.group_by}</td>
      <td data-label="Policies">${a.policies.length ? a.policies.join(', ') : 'None'}</td>
    </tr>`) : emptyRow(6, 'No aggregations yet')}</tbody>
  </table></div>
</section>` });
}

// ---------------------------------------------------------------- audit
export function chainLine(chain) {
  return chain.valid ? `Chain verified: ${chain.events} events` : `Chain broken at event ${chain.first_broken_seq}`;
}

export function auditView(frame, data) {
  const signedTab = data.tab === 'signed';
  return consolePage(frame, { title: 'Audit', main: html`
${pageHead('Audit', { icon: 'audit' })}
<section class="panel" aria-labelledby="chain-heading">
  <div class="panel__head">
    <h2 id="chain-heading">Chain status</h2>
    <form method="post" action="/console/audit/verify" data-fetch="verify">${csrf(frame)}
      <button class="pill pill--light pill--small" type="submit">Verify chain</button></form>
  </div>
  <p class="chain-status${data.chain.valid ? '' : ' chain-status--broken'}" role="status" aria-label="Chain status" data-chain-status>${chainLine(data.chain)}</p>
</section>
<section class="panel">
  <div class="tabs" role="tablist" aria-label="Audit records" data-tabs>
    <a role="tab" id="tab-trail" href="/console/audit" aria-controls="panel-trail" aria-selected="${signedTab ? 'false' : 'true'}" tabindex="${signedTab ? '-1' : '0'}">Audit trail</a>
    <a role="tab" id="tab-signed" href="/console/audit?tab=signed" aria-controls="panel-signed" aria-selected="${signedTab ? 'true' : 'false'}" tabindex="${signedTab ? '0' : '-1'}">Signed events</a>
  </div>
  <div role="tabpanel" id="panel-trail" aria-labelledby="tab-trail"${attr('hidden', signedTab)}>
    <div class="table-wrap"><table class="table table--stack" aria-label="Audit trail">
      <thead><tr><th scope="col">Seq</th><th scope="col">Time</th><th scope="col">Type</th><th scope="col">Actor</th><th scope="col">Subject</th><th scope="col">Hash</th></tr></thead>
      <tbody>${data.events.map((e) => html`<tr><td data-label="Seq" class="num">${e.seq}</td><td data-label="Time"><span class="stamp">${when(e.at)}</span></td>
        <td data-label="Type">${e.type}</td><td data-label="Actor">${e.actor}</td><td data-label="Subject"><code>${e.subject_id}</code></td>
        <td data-label="Hash"><code title="${e.hash}">${e.hash.slice(0, 12)}</code></td></tr>`)}</tbody>
    </table></div>
    ${data.total > data.events.length ? html`<p class="hint">Showing the latest ${data.events.length} of ${data.total} events.</p>` : ''}
  </div>
  <div role="tabpanel" id="panel-signed" aria-labelledby="tab-signed"${attr('hidden', !signedTab)}>
    <div class="table-wrap"><table class="table table--stack" aria-label="Signed events">
      <thead><tr><th scope="col">Seq</th><th scope="col">Event</th><th scope="col">Type</th><th scope="col">Time</th><th scope="col">Signature</th></tr></thead>
      <tbody>${data.signed.length ? data.signed.map((e) => html`<tr><td data-label="Seq" class="num">${e.seq}</td><td data-label="Event"><code>${e.id}</code></td>
        <td data-label="Type">${e.type}</td><td data-label="Time"><span class="stamp">${when(e.created_at)}</span></td>
        <td data-label="Signature"><code class="hash">${e.signature}</code></td></tr>`) : emptyRow(5, 'No signed events yet')}</tbody>
    </table></div>
  </div>
</section>` });
}

// ---------------------------------------------------------------- settings
const ROLE_OPTIONS = ['owner', 'operator', 'approver', 'auditor'].map((r) => [r, r]);

export function settingsView(frame, data) {
  const owner = frame.isOwner;
  const mForm = { key: 'member', ...data.memberForm };
  const kForm = { key: 'key', ...data.keyForm };
  const mv = mForm.values || {};
  const kv = kForm.values || {};
  return consolePage(frame, { title: 'Settings', main: html`
${pageHead('Settings', { icon: 'gear' })}
<section class="panel" aria-labelledby="org-heading">
  <h2 id="org-heading">Organization</h2>
  <dl class="facts facts--two">
    <div><dt>Name</dt><dd>${frame.org.name}</dd></div>
    <div><dt>App id</dt><dd class="copyable"><code id="app-id">${frame.org.app_id}</code>
      <button class="pill pill--light pill--small" type="button" data-copy="#app-id" data-copied="App id copied" aria-label="Copy app id">${icon('copy')}<span>Copy</span></button></dd></div>
  </dl>
</section>
<section class="panel" aria-labelledby="members-heading">
  <div class="panel__head"><h2 id="members-heading">Members</h2>
    ${owner ? html`<button class="pill pill--dark pill--small" type="button" aria-expanded="${mForm.open ? 'true' : 'false'}" aria-controls="new-member" data-toggle>Add member</button>` : ''}</div>
  ${owner ? html`<form class="create-panel" id="new-member" method="post" action="/console/members" data-fetch="member" novalidate${attr('data-open', mForm.open)}>
    ${csrf(frame)}
    ${input(mForm, 'name', 'Member name', { value: mv.name })}
    ${input(mForm, 'email', 'Member email', { value: mv.email, type: 'email' })}
    ${select(mForm, 'role', 'Member role', ROLE_OPTIONS, mv.role || 'approver')}
    ${input(mForm, 'password', 'Initial password', { type: 'password', hint: 'At least 12 characters' })}
    <button class="pill pill--dark" type="submit">Save member</button>
  </form>` : ''}
  <div class="table-wrap"><table class="table table--stack" aria-label="Members">
    <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Added</th>${owner ? html`<th scope="col">Remove</th>` : ''}</tr></thead>
    <tbody>${data.members.map((m) => html`<tr data-member="${m.id}">
      <td data-label="Name">${m.name}</td><td data-label="Email">${m.email}</td>
      <td data-label="Role">${owner ? html`<form class="inline-form" method="post" action="/console/members/${m.id}/role" data-fetch="role">${csrf(frame)}
          <label class="sr-only" for="role-${m.id}">Role for ${m.name}</label>
          <select id="role-${m.id}" name="role" data-autosubmit>${ROLE_OPTIONS.map(([v, t]) => html`<option value="${v}"${attr('selected', m.role === v)}>${t}</option>`)}</select>
          <button class="pill pill--light pill--small js-hide" type="submit">Save role</button></form>`
    : html`<span class="badge badge--role">${m.role}</span>`}</td>
      <td data-label="Added"><span class="stamp">${when(m.created_at)}</span></td>
      ${owner ? html`<td data-label="Remove">
        <form method="get" action="/console/settings" data-dialog-opener="remove-${m.id}"><input type="hidden" name="remove" value="${m.id}">
          <button class="pill pill--light pill--small" type="submit">Remove ${m.name}</button></form>
        <dialog class="dialog" id="remove-${m.id}" aria-labelledby="remove-title-${m.id}"${attr('open', data.confirmRemove === m.id)}>
          <h2 id="remove-title-${m.id}">Remove member</h2>
          <p>${m.name} loses access at once. Their sessions end and the API keys they created are revoked.</p>
          <div class="dialog__actions">
            <form method="get" action="/console/settings"><button class="pill pill--light" type="submit" data-dialog-close autofocus>Keep member</button></form>
            <form method="post" action="/console/members/${m.id}/remove" data-fetch="remove-member">${csrf(frame)}
              <button class="pill pill--danger" type="submit">Remove</button></form>
          </div>
        </dialog>
        <p class="row-error" role="alert" data-row-error>${data.rowError?.id === m.id ? data.rowError.message : ''}</p></td>` : ''}
    </tr>`)}</tbody>
  </table></div>
</section>
<section class="panel" aria-labelledby="keys-heading">
  <h2 id="keys-heading">API keys</h2>
  ${data.newKey ? html`<div class="secret-once" role="status"><p><strong>${data.newKey.name}</strong>: <code id="new-secret">${data.newKey.secret}</code>
    <button class="pill pill--light pill--small" type="button" data-copy="#new-secret" data-copied="Key copied" aria-label="Copy key">${icon('copy')}<span>Copy</span></button></p>
    <p>Copy this key now. It will not be shown again.</p></div>` : ''}
  ${owner ? html`<form class="inline-form inline-form--wrap" method="post" action="/console/api-keys" data-fetch="key" novalidate>
    ${csrf(frame)}
    ${input(kForm, 'name', 'Key name', { value: kv.name, extra: ' maxlength="60"' })}
    ${select(kForm, 'role', 'Key role', [['operator', 'operator'], ['auditor', 'auditor']], kv.role)}
    <button class="pill pill--dark pill--small" type="submit">Create API key</button>
  </form>` : ''}
  <div class="table-wrap"><table class="table table--stack" aria-label="API keys">
    <thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Prefix</th><th scope="col">Creator</th><th scope="col">Created</th><th scope="col">Revoked</th>${owner ? html`<th scope="col">Revoke</th>` : ''}</tr></thead>
    <tbody>${data.keys.length ? data.keys.map((k) => html`<tr>
      <td data-label="Name">${k.name}</td><td data-label="Role">${k.role}</td><td data-label="Prefix"><code>${k.prefix}</code></td>
      <td data-label="Creator">${k.creator}</td><td data-label="Created"><span class="stamp">${when(k.created_at)}</span></td>
      <td data-label="Revoked">${k.revoked_at ? html`<span class="stamp">${when(k.revoked_at)}</span>` : 'Live'}</td>
      ${owner ? html`<td data-label="Revoke">${k.revoked_at ? '' : html`<form method="post" action="/console/api-keys/${k.id}/revoke" data-fetch="revoke">${csrf(frame)}
        <button class="pill pill--light pill--small" type="submit">Revoke ${k.name}</button></form>`}</td>` : ''}
    </tr>`) : emptyRow(owner ? 7 : 6, 'No API keys yet')}</tbody>
  </table></div>
</section>
${owner ? html`<section class="panel" aria-labelledby="secret-heading">
  <h2 id="secret-heading">Webhook signing secret</h2>
  <p class="hint">Signs every payment event in the signed event log. Rotating it signs later events with the new secret.</p>
  <div class="secret-row">
    <code data-secret>${data.reveal ? data.secret : `whsec_${'•'.repeat(32)}`}</code>
    <form method="get" action="/console/settings" data-fetch="reveal"><input type="hidden" name="reveal" value="1">
      <button class="pill pill--light pill--small" type="submit">Reveal</button></form>
    <form method="post" action="/console/webhooks/rotate" data-fetch="rotate">${csrf(frame)}
      <button class="pill pill--outline pill--small" type="submit">Rotate</button></form>
  </div>
</section>` : ''}` });
}

// ---------------------------------------------------------------- messages
export function messageView(frame, { title, heading, text }) {
  return consolePage(frame, { title, main: html`<div class="message-panel"><h1>${heading}</h1><p>${text}</p>
    <a class="pill pill--dark pill--small" href="/console">Back to overview</a></div>` });
}
