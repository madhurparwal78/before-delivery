import { page, esc, statusBadge } from './html.js';
import { numToBigInt, rawToDisplay, formatTs, formatTsMinutes } from '../lib/core.js';

const SEND_ICON = '<svg class="icon" aria-hidden="true" viewBox="0 0 16 16"><path d="M13 3L3 7.5l3.8 1.7L8.5 13 13 3z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M6.8 9.2L13 3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
const CARD_ICON = '<svg class="icon" aria-hidden="true" viewBox="0 0 16 16"><rect x="1.5" y="3.5" width="13" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
const LIST_ICON = '<svg class="icon" aria-hidden="true" viewBox="0 0 16 16"><path d="M2 3.5h2m2 0h8M2 8h2m2 0h8M2 12.5h2m2 0h8" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>';
const CHART_ICON = '<svg class="icon" aria-hidden="true" viewBox="0 0 16 16"><path d="M2 14h3V8H2v6zm4.5 0h3V4h-3v10zM11 14h3V2h-3v12z" fill="currentColor"/></svg>';

function consoleFrame({ title, active, viewer, org, inboxCount, body, scripts = ['/assets/console.js'], bodyAttrs = `data-app-id="${esc(org.app_id)}"` }) {
  const role = viewer.role;
  const showAudit = role === 'owner' || role === 'auditor';
  const items = [
    ['Overview', '/console', 'overview', CHART_ICON],
    ['Approvals', '/console/approvals', 'approvals', LIST_ICON],
    ['Intents', '/console/intents', 'intents', SEND_ICON],
    ['Policies', '/console/policies', 'policies', CARD_ICON],
    ['Quorums', '/console/quorums', 'quorums', LIST_ICON],
    ...(showAudit ? [['Audit', '/console/audit', 'audit', LIST_ICON]] : []),
    ['Settings', '/console/settings', 'settings', CARD_ICON],
  ];
  return page({
    title: `${title} — Corvo`,
    active,
    publicHeader: false,
    scripts,
    bodyAttrs,
    body: `
<div class="console-shell">
  <nav class="console-rail" aria-label="Console">
    <a class="wordmark rail-wordmark" href="/"><svg class="brand-mark" aria-hidden="true" viewBox="0 0 24 24"><path d="M12 2l9 10-9 10L3 12z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg><span>Corvo</span></a>
    ${items.map(([label, href, id, icon]) => `
    <a class="rail-item ${active === id ? 'rail-active' : ''}" href="${href}" ${id === 'approvals' ? `data-inbox-count="${inboxCount}"` : ''}>${icon}<span>${label}</span>${id === 'approvals' && inboxCount > 0 ? `<span class="rail-count">${inboxCount}</span>` : ''}</a>`).join('')}
    <button type="button" class="capsule capsule-outline rail-signout" data-signout>Sign out</button>
  </nav>
  <button type="button" class="menu-btn console-menu-btn" aria-expanded="false" aria-controls="console-sheet">Menu</button>
  <div class="console-sheet" id="console-sheet" hidden>
    <nav aria-label="Console mobile">
      ${items.map(([label, href]) => `<a href="${href}">${label}${label === 'Approvals' && inboxCount > 0 ? ` (${inboxCount})` : ''}</a>`).join('')}
      <button type="button" class="capsule capsule-outline" data-signout>Sign out</button>
    </nav>
  </div>
  <div class="console-main">
    <header class="console-topbar">
      <span class="org-name">${esc(org.name)}</span>
      <span class="topbar-member">
        <span>${esc(viewer.name)} · ${esc(viewer.email)}</span>
        <span class="badge badge-role">${esc(viewer.role)}</span>
      </span>
    </header>
    <div class="console-content">
    ${body}
    </div>
  </div>
</div>`,
  });
}

function noAccess() {
  return `<div class="panel access-panel"><h1 class="console-heading">You do not have access to this page</h1><p>Your role does not read this panel.</p></div>`;
}

function notFoundPanel() {
  return `<div class="panel access-panel"><h1 class="console-heading">Not found</h1><p>No such record in your organization.</p></div>`;
}

export function consoleOverview(viewer, org, stats, wallets) {
  const cards = [
    ['Total wallets', stats.totalWallets],
    ['Pending intents', stats.pendingIntents],
    ['Awaiting your approval', stats.awaitingYou],
    ['Executed in 24 hours', stats.executed24h],
  ];
  return consoleFrame({
    title: 'Overview', active: 'overview', viewer, org, inboxCount: stats.awaitingYou,
    body: `
<h1 class="console-heading">Overview</h1>
<div class="stat-cards">
  ${cards.map(([label, value]) => `<div class="stat-card"><span class="stat-value">${esc(String(value))}</span><span class="stat-label">${esc(label)}</span></div>`).join('')}
</div>
<div class="panel">
  <div class="panel-head">
    <h2>Wallets</h2>
    <button type="button" class="capsule capsule-dark" id="create-wallet-btn" data-owner-only>Create wallet</button>
  </div>
  <table class="console-table" aria-label="Wallets">
    <thead><tr><th scope="col">Name</th><th scope="col">Chain</th><th scope="col">Asset</th><th scope="col">Balance</th><th scope="col">Available</th><th scope="col">Pending</th><th scope="col">Policy</th><th scope="col">Quorum</th><th scope="col">Status</th></tr></thead>
    <tbody id="wallets-tbody">
      <tr class="create-row" id="wallet-create-row" hidden>
        <td colspan="9">
          <form class="create-form" id="wallet-create-form">
            <label class="inline-label" for="new-wallet-name">Name</label>
            <input id="new-wallet-name" name="name" type="text">
            <label class="inline-label" for="new-wallet-chain">Chain</label>
            <select id="new-wallet-chain" name="chain" aria-label="Chain"><option value="base">base</option><option value="ethereum">ethereum</option></select>
            <label class="inline-label" for="new-wallet-asset">Asset</label>
            <select id="new-wallet-asset" name="asset" aria-label="Asset"><option value="usdc">usdc</option><option value="eth">eth</option></select>
            <label class="inline-label" for="new-wallet-policy">Policy</label>
            <select id="new-wallet-policy" name="policy_id" aria-label="Policy"><option value="">none</option>${wallets.policies.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>
            <label class="inline-label" for="new-wallet-quorum">Quorum</label>
            <select id="new-wallet-quorum" name="quorum_id" aria-label="Quorum"><option value="">none</option>${wallets.quorums.map((q) => `<option value="${esc(q.id)}">${esc(q.name)}</option>`).join('')}</select>
            <label class="inline-label" for="new-wallet-floor">Approval floor</label>
            <input id="new-wallet-floor" name="approval_floor" type="text" value="0">
            <button type="submit" class="capsule capsule-dark">Save wallet</button>
            <button type="button" class="capsule capsule-outline" id="wallet-discard">Discard</button>
          </form>
        </td>
      </tr>
      ${wallets.rows.map((w) => `
      <tr>
        <td><a class="table-link" href="/console/wallets/${esc(w.id)}">${esc(w.name)}</a></td>
        <td>${esc(w.chain)}</td>
        <td>${esc(w.asset)}</td>
        <td class="num">${esc(w.balance)} ${esc(w.asset.toUpperCase())}</td>
        <td class="num">${esc(w.available)} ${esc(w.asset.toUpperCase())}</td>
        <td class="num">${esc(w.pending)} ${esc(w.asset.toUpperCase())}</td>
        <td>${w.policy_name ? esc(w.policy_name) : '—'}</td>
        <td>${w.quorum_name ? esc(w.quorum_name) : '—'}</td>
        <td>${statusBadge(w.status)}</td>
      </tr>`).join('')}
    </tbody>
  </table>
</div>`,
  });
}

export function walletPage(viewer, org, data) {
  const { wallet, activity, inboxCount, members } = data;
  const walletAttrs = `data-app-id="${esc(org.app_id)}" data-wallet-id="${esc(wallet.id)}" data-wallet-asset="${esc(wallet.asset)}"`;
  const canOperate = viewer.role === 'owner' || viewer.role === 'operator';
  const isOwner = viewer.role === 'owner';
  const asset = wallet.asset.toUpperCase();
  const frozen = wallet.status === 'frozen';
  const forms = frozen
    ? `<div class="panel frozen-banner" role="region" aria-label="Frozen wallet">
        <p class="frozen-text">This wallet is frozen. New transfers and approvals are paused.</p>
      </div>`
    : (canOperate ? `
    <form class="panel stack-form" id="send-form" aria-label="Send">
      <h2>Send</h2>
      <div class="field"><label for="send-destination">Destination address</label>
        <input id="send-destination" name="destination_address" type="text" aria-describedby="send-result">
        <p class="field-error" id="send-dest-error" hidden></p></div>
      <div class="field"><label for="send-amount">Amount</label>
        <input id="send-amount" name="amount" type="text" inputmode="decimal">
        <p class="field-error" id="send-amount-error" hidden></p></div>
      <div class="field"><label for="send-memo">Memo</label>
        <input id="send-memo" name="memo" type="text"></div>
      <button type="submit" class="capsule capsule-dark">Send</button>
      <p class="form-result" id="send-result" aria-live="polite"></p>
    </form>
    <form class="panel stack-form" id="deposit-form" aria-label="Deposit">
      <h2>Deposit</h2>
      <div class="field"><label for="deposit-amount">Amount</label>
        <input id="deposit-amount" name="amount" type="text" inputmode="decimal"></div>
      <div class="field"><label for="deposit-reference">Reference</label>
        <input id="deposit-reference" name="reference" type="text"></div>
      <button type="submit" class="capsule capsule-dark">Record deposit</button>
      <p class="form-result" id="deposit-result" aria-live="polite"></p>
    </form>
    <form class="panel stack-form" id="batch-form" aria-label="Payroll batch">
      <h2>Payroll batch</h2>
      <div id="batch-lines">
        <div class="batch-line" data-line="1">
          <div class="field"><label for="line-1-destination">Line 1 destination</label>
            <input id="line-1-destination" class="line-destination" type="text"></div>
          <div class="field"><label for="line-1-amount">Line 1 amount</label>
            <input id="line-1-amount" class="line-amount" type="text" inputmode="decimal">
            <p class="field-error" data-amount-error hidden></p></div>
          <div class="field"><label for="line-1-memo">Line 1 memo</label>
            <input id="line-1-memo" class="line-memo" type="text"></div>
          <button type="button" class="capsule capsule-outline remove-line" disabled>Remove line 1</button>
        </div>
      </div>
      <button type="button" class="capsule capsule-outline" id="add-line-btn">Add line</button>
      <p class="batch-total" role="status" aria-label="Batch total" id="batch-total">Total: 0 ${esc(asset)}</p>
      <button type="submit" class="capsule capsule-dark">Submit batch</button>
      <p class="form-result" id="batch-result" aria-live="polite"></p>
    </form>`
    : `<div class="panel"><p>Deposits and transfers need the operator or owner role.</p></div>`);
  return consoleFrame({
    title: wallet.name, active: 'overview', viewer, org, inboxCount, bodyAttrs: walletAttrs,
    body: `
<div class="wallet-layout">
  <div class="wallet-main">
    <h1 class="console-heading">${esc(wallet.name)}</h1>
    <div class="panel wallet-facts">
      <dl class="facts">
        <div><dt>Name</dt><dd>${esc(wallet.name)}</dd></div>
        <div><dt>Address</dt><dd><span class="mono" id="wallet-address">${esc(wallet.address)}</span>
          <button type="button" class="capsule capsule-outline small" id="copy-address">Copy address</button></dd></div>
        <div><dt>Chain</dt><dd>${esc(wallet.chain)}</dd></div>
        <div><dt>Asset</dt><dd>${esc(wallet.asset)}</dd></div>
        <div><dt>Balance</dt><dd>${esc(wallet.balance)} ${esc(asset)}</dd></div>
        <div><dt>Available</dt><dd>${esc(wallet.available)} ${esc(asset)}</dd></div>
        <div><dt>Pending</dt><dd>${esc(wallet.reserved)} ${esc(asset)}</dd></div>
        <div><dt>Policy</dt><dd>${esc(wallet.policy_name || 'None')}</dd></div>
        <div><dt>Quorum</dt><dd>${esc(wallet.quorum_name || 'None')}</dd></div>
        <div><dt>Approval floor</dt><dd>${esc(wallet.approval_floor)} ${esc(asset)}</dd></div>
        <div><dt>Status</dt><dd>${statusBadge(wallet.status)}</dd></div>
      </dl>
      ${isOwner ? (frozen
        ? `<button type="button" class="capsule capsule-outline" id="unfreeze-btn">Unfreeze wallet</button>`
        : `<button type="button" class="capsule capsule-outline" id="freeze-btn" aria-haspopup="dialog">Freeze wallet</button>
           <dialog id="freeze-dialog" aria-label="Freeze wallet">
             <p>Freezing pauses new transfers and approvals. Deposits, rejections and cancellations still work.</p>
             <button type="button" class="capsule capsule-outline" data-dialog-cancel>Keep active</button>
             <button type="button" class="capsule capsule-dark" id="freeze-confirm">Freeze</button>
           </dialog>`) : ''}
    </div>
    <div class="panel">
      <h2>Activity</h2>
      <table class="console-table" aria-label="Activity">
        <thead><tr><th scope="col">Type</th><th scope="col">Detail</th><th scope="col">Amount</th><th scope="col">Status</th><th scope="col">When</th></tr></thead>
        <tbody>
          ${activity.length === 0 ? '<tr><td colspan="5" class="empty-state">No deposits or intents yet</td></tr>' : activity.map((a) => `
          <tr>
            <td>${esc(a.type)}</td>
            <td>${esc(a.detail)}</td>
            <td class="num">${esc(a.amount)}</td>
            <td>${a.status ? statusBadge(a.status) : ''}</td>
            <td>${esc(a.when)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>
  <div class="wallet-side">
    ${frozen && canOperate ? `
    <form class="panel stack-form" id="deposit-form" aria-label="Deposit">
      <h2>Deposit</h2>
      <div class="field"><label for="deposit-amount">Amount</label>
        <input id="deposit-amount" name="amount" type="text" inputmode="decimal"></div>
      <div class="field"><label for="deposit-reference">Reference</label>
        <input id="deposit-reference" name="reference" type="text"></div>
      <button type="submit" class="capsule capsule-dark">Record deposit</button>
      <p class="form-result" id="deposit-result" aria-live="polite"></p>
    </form>` : ''}
    ${!frozen && !canOperate ? '' : forms}
  </div>
</div>`,
  });
}

export function approvalsPage(viewer, org, inbox, inboxCount) {
  const rows = inbox.map((intent) => {
    const dest = intent.kind === 'batch'
      ? `${intent.items.length} lines`
      : intent.destination_address;
    const a = intent.approvals.length;
    const pct = Math.round((a / intent.required_approvals) * 100);
    return `
    <div class="inbox-row" data-intent-id="${esc(intent.id)}" role="group" aria-label="Intent ${esc(intent.id)}">
      <div class="inbox-facts">
        <span class="inbox-wallet">${esc(intent.wallet_name)}</span>
        <span class="mono" ${intent.kind === 'transfer' ? `aria-label="${esc(intent.destination_address)}"` : ''}>${esc(intent.kind === 'batch' ? `${intent.items.length} lines` : `${intent.destination_address.slice(0, 6)}…${intent.destination_address.slice(-4)}`)}</span>
        <span class="num">${esc(intent.amount)} ${esc(intent.wallet_asset.toUpperCase())}</span>
        <span>${esc(intent.memo || '')}</span>
        <span>${esc(intent.initiator_name)}</span>
        <span>${esc(formatTsMinutes(new Date(intent.expires_at)))}</span>
        <span>${esc(intent.policy_decision ? `${intent.policy_decision.action} · ${intent.policy_decision.rule || 'no rule matched'} · revision ${intent.policy_decision.policy_revision}` : 'No policy')}</span>
      </div>
      <div class="inbox-progress">
        <div class="progress" role="progressbar" aria-label="Approvals" aria-valuenow="${a}" aria-valuemin="0" aria-valuemax="${intent.required_approvals}" style="--fill: ${pct}%"></div>
        <span class="progress-note"><span class="progress-text">${a} of ${intent.required_approvals} approvals</span></span>
      </div>
      <div class="inbox-actions">
        <button type="button" class="capsule capsule-dark approve-btn">Approve</button>
        <button type="button" class="capsule capsule-outline reject-btn">Reject</button>
      </div>
      <div class="reject-panel" hidden>
        <div class="field">
          <label for="reason-${esc(intent.id)}">Reason for rejecting</label>
          <input id="reason-${esc(intent.id)}" class="reject-reason" type="text">
          <p class="field-error" hidden>Enter a reason to reject</p>
        </div>
        <button type="button" class="capsule capsule-dark confirm-reject">Confirm reject</button>
      </div>
      <p class="row-message" role="status" hidden></p>
    </div>`;
  }).join('');
  return consoleFrame({
    title: 'Approvals', active: 'approvals', viewer, org, inboxCount,
    body: `
<h1 class="console-heading">Approvals inbox</h1>
<div id="inbox-list" class="inbox-list">
  ${rows || ''}
  ${inbox.length === 0 ? '<p class="empty-state inbox-empty" tabindex="-1">Nothing waiting for your approval</p>' : ''}
</div>`,
  });
}

export function intentsPage(viewer, org, intents, nextCursor, status, inboxCount) {
  const rows = intents.map((intent) => {
    const a = intent.approvals.length;
    return `
  <tr class="intent-row" data-intent-id="${esc(intent.id)}">
    <td>${esc(intent.id)}</td>
    <td>${esc(intent.wallet_name)}</td>
    <td>${esc(intent.kind)}</td>
    <td>${esc(intent.kind === 'batch' ? `${intent.items.length} lines` : intent.destination_address)}</td>
    <td class="num">${esc(intent.amount)} ${esc(intent.wallet_asset.toUpperCase())}</td>
    <td>${statusBadge(intent.status)}</td>
    <td>${esc(intent.initiator_name)}</td>
    <td>${esc(formatTsMinutes(new Date(intent.created_at)))}</td>
    <td>${a} of ${intent.required_approvals}</td>
    <td><button type="button" class="table-btn" data-details>Details for ${esc(intent.id)}</button>
        ${intent.status === 'pending_approval' && (viewer.role === 'owner' || intent.created_by === viewer.id) ? `<button type="button" class="table-btn" data-cancel>Cancel request</button>` : ''}</td>
  </tr>
  <tr class="details-row" hidden>
    <td colspan="10">
      <dl class="details-list">
        <div><dt>Policy decision</dt><dd>${intent.policy_decision ? `${esc(intent.policy_decision.action)} by ${esc(intent.policy_decision.rule || 'no rule')} · Decided under revision ${intent.policy_decision.policy_revision}` : 'No policy'}</dd></div>
        ${intent.approvals.map((ap) => `<div><dt>Approval</dt><dd>${esc(ap.name || ap.member_id)} · ${esc(ap.decision)} · ${esc(formatTsMinutes(new Date(ap.created_at)))}</dd></div>`).join('')}
        ${intent.rejection_reason ? `<div><dt>Rejection reason</dt><dd>${esc(intent.rejection_reason)}</dd></div>` : ''}
        ${intent.tx_hash ? `<div><dt>Transaction hash</dt><dd class="mono">${esc(intent.tx_hash)}</dd></div>` : ''}
        ${intent.items.map((it) => `<div><dt>Line ${it.position + 1}</dt><dd>${esc(it.destination_address)} · ${esc(it.amount)} ${esc(intent.wallet_asset.toUpperCase())} · ${esc(it.memo || '')}</dd></div>`).join('')}
      </dl>
    </td>
  </tr>`;
  }).join('');
  return consoleFrame({
    title: 'Intents', active: 'intents', viewer, org, inboxCount,
    body: `
<h1 class="console-heading">Intents</h1>
<div class="panel">
  <div class="panel-head">
    <div class="field inline-field">
      <label for="status-filter">Status</label>
      <select id="status-filter" aria-label="Status">
        <option value="">All</option>
        <option value="pending_approval" ${status === 'pending_approval' ? 'selected' : ''}>Pending approval</option>
        <option value="executed" ${status === 'executed' ? 'selected' : ''}>Executed</option>
        <option value="rejected" ${status === 'rejected' ? 'selected' : ''}>Rejected</option>
        <option value="cancelled" ${status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
        <option value="expired" ${status === 'expired' ? 'selected' : ''}>Expired</option>
      </select>
    </div>
    <a class="capsule capsule-outline" id="export-csv" href="/api/v1/intents/export${status ? `?status=${esc(status)}` : ''}">Download CSV</a>
  </div>
  <table class="console-table" aria-label="Intents" id="intents-table">
    <thead><tr><th scope="col">Id</th><th scope="col">Wallet</th><th scope="col">Kind</th><th scope="col">Destination</th><th scope="col">Amount</th><th scope="col">Status</th><th scope="col">Initiator</th><th scope="col">Created</th><th scope="col">Approvals</th><th scope="col">Actions</th></tr></thead>
    <tbody id="intents-tbody">
    ${rows || ''}
    </tbody>
  </table>
  ${intents.length === 0 ? '<p class="empty-state" tabindex="-1" id="intents-empty">No intents yet</p>' : ''}
  ${nextCursor ? '<button type="button" class="capsule capsule-outline" id="load-more-btn">Load more</button>' : ''}
  <input type="hidden" id="next-cursor" value="${esc(nextCursor || '')}">
</div>`,
  });
}

export function policiesPage(viewer, org, policies, inboxCount) {
  return consoleFrame({
    title: 'Policies', active: 'policies', viewer, org, inboxCount,
    body: `
<h1 class="console-heading">Policies</h1>
<div class="panel">
  <table class="console-table" aria-label="Policies">
    <thead><tr><th scope="col">Name</th><th scope="col">Chain type</th><th scope="col">Revision</th><th scope="col">Rules</th><th scope="col">Updated</th></tr></thead>
    <tbody>
    ${policies.map((p) => `<tr>
      <td><a class="table-link" href="/console/policies/${esc(p.id)}">${esc(p.name)}</a></td>
      <td>${esc(p.chain_type)}</td><td>${p.revision}</td><td>${p.rules.length}</td>
      <td>${esc(formatTsMinutes(new Date(p.updated_at)))}</td>
    </tr>`).join('') || '<tr><td colspan="5" class="empty-state">No policies yet</td></tr>'}
    </tbody>
  </table>
</div>`,
  });
}

function condCells(cond, isOwner) {
  if (isOwner) {
    return `<td><select class="cond-source" aria-label="Field source">
      <option value="request_body" ${cond.field_source === 'request_body' ? 'selected' : ''}>request_body</option>
      <option value="system" ${cond.field_source === 'system' ? 'selected' : ''}>system</option>
      <option value="reference" ${cond.field_source === 'reference' ? 'selected' : ''}>reference</option>
    </select></td>
    <td><input class="cond-field" aria-label="Field" value="${esc(cond.field)}"></td>
    <td><input class="cond-operator" aria-label="Operator" value="${esc(cond.operator)}"></td>
    <td><input class="cond-value" aria-label="Value" value='${esc(JSON.stringify(cond.value))}'></td>`;
  }
  return `<td>${esc(cond.field_source)}</td><td>${esc(cond.field)}</td><td>${esc(cond.operator)}</td><td>${esc(JSON.stringify(cond.value))}</td>`;
}

function ruleEditCells(i, isOwner) {
  if (!isOwner) return '';
  return `<td>
    <button type="button" class="table-btn" data-move-up="${i}">Move rule ${i + 1} up</button>
    <button type="button" class="table-btn" data-move-down="${i}">Move rule ${i + 1} down</button>
    <button type="button" class="table-btn" data-remove-rule="${i}">Remove rule ${i + 1}</button>
    <button type="button" class="table-btn" data-add-cond="${i}">Add condition to rule ${i + 1}</button>
  </td>`;
}

function rulesTableHtml(policy, isOwner) {
  const rows = [];
  for (let i = 0; i < policy.rules.length; i++) {
    const rule = policy.rules[i];
    const conds = rule.conditions;
    const span = conds.length > 1 ? ` rowspan="${conds.length}"` : '';
    const nameCell = isOwner
      ? `<input class="rule-name" aria-label="Rule name" value="${esc(rule.name)}">`
      : esc(rule.name);
    const methodCell = isOwner
      ? `<input class="rule-method" aria-label="Method" value="${esc(rule.method)}">`
      : esc(rule.method);
    const actionCell = isOwner
      ? `<input class="rule-action" aria-label="Action" value="${esc(rule.action)}">`
      : esc(rule.action);
    if (conds.length === 0) {
      rows.push(`<tr data-rule="${i}"><td${span}>${nameCell}</td><td${span}>${methodCell}</td><td${span}>${actionCell}</td><td colspan="4" class="muted-cell">no conditions</td>${ruleEditCells(i, isOwner)}</tr>`);
      continue;
    }
    for (let j = 0; j < conds.length; j++) {
      const lead = j === 0 ? `<td${span}>${nameCell}</td><td${span}>${methodCell}</td><td${span}>${actionCell}</td>` : '';
      const edit = j === 0 ? ruleEditCells(i, isOwner) : '';
      rows.push(`<tr data-rule="${i}" class="rule-row">${lead}${condCells(conds[j], isOwner)}${isOwner ? `<td>${j === 0 ? `<button type="button" class="table-btn" data-remove-cond="${i}.${j}">Remove condition ${j + 1} from rule ${i + 1}</button>` : `<button type="button" class="table-btn" data-remove-cond="${i}.${j}">Remove condition ${j + 1} from rule ${i + 1}</button>`}</td>` : ''}${edit}</tr>`);
    }
  }
  return `<table class="console-table" aria-label="Rules">
    <thead><tr><th scope="col">Name</th><th scope="col">Method</th><th scope="col">Action</th><th scope="col">Field source</th><th scope="col">Field</th><th scope="col">Operator</th><th scope="col">Value</th>${isOwner ? '<th scope="col">Edit</th>' : ''}</tr></thead>
    <tbody id="rules-tbody">${rows.join('')}</tbody>
  </table>`;
}

function simulateHtml(result) {
  const aggs = Object.entries(result.aggregations || {}).map(([id, v]) => `<span class="chip">${esc(result.aggregation_names[id] || id)}: ${esc(v)}</span>`).join('');
  const trace = (result.trace || []).map((t) => `<li>${esc(t.rule)}: ${t.considered ? (t.matched ? 'matched' : 'not matched') : 'skipped (method)'}</li>`).join('');
  return `
  <p class="simulation-decision ${result.action === 'ALLOW' ? 'allow' : 'deny'}">${esc(result.action)} · ${esc(result.rule || 'no rule matched')}</p>
  <p>Evaluated against revision ${esc(String(result.policy_revision))}</p>
  <p class="agg-line">${aggs}</p>
  <ul class="trace-list">${trace}</ul>`;
}

export function policyPage(viewer, org, policy, revisions, wallets, aggregations, inboxCount, simulate) {
  const isOwner = viewer.role === 'owner';
  const rulesTable = rulesTableHtml(policy, isOwner);
  const aggNames = JSON.stringify(Object.fromEntries(aggregations.map((a) => [a.id, a.name])));
  const attrs = `data-app-id="${esc(org.app_id)}" data-policy-id="${esc(policy.id)}" data-aggregations="${esc(aggNames)}"`;
  return consoleFrame({
    title: policy.name, active: 'policies', viewer, org, inboxCount, bodyAttrs: attrs,
    body: `
<h1 class="console-heading">${esc(policy.name)}</h1>
<div class="panel">
  <div class="panel-head"><h2>Rules</h2>${isOwner ? '<span><button type="button" class="capsule capsule-outline" id="add-rule-btn">Add rule</button> <button type="button" class="capsule capsule-dark" id="save-policy-btn">Save policy</button></span>' : ''}</div>
  ${rulesTable}
  <p class="form-result" id="policy-result" aria-live="polite"></p>
</div>
<div class="panel">
  <h2>Revisions</h2>
  <table class="console-table" aria-label="Revisions">
    <thead><tr><th scope="col">Revision</th><th scope="col">Name</th><th scope="col">Saved</th></tr></thead>
    <tbody>${revisions.map((r) => `<tr><td>${r.revision}</td><td>${esc(r.name)}</td><td>${esc(formatTsMinutes(new Date(r.created_at)))}</td></tr>`).join('')}</tbody>
  </table>
</div>
<div class="panel">
  <h2>Simulate</h2>
  <form id="simulate-form" aria-label="Simulate">
    <div class="field inline-field">
      <label for="simulate-method">Method</label>
      <select id="simulate-method" aria-label="Method"><option value="transfer">transfer</option><option value="batch_payout">batch_payout</option></select>
    </div>
    <div class="field inline-field">
      <label for="simulate-wallet">Wallet</label>
      <select id="simulate-wallet" aria-label="Wallet">
        ${wallets.map((w) => `<option value="${esc(w.id)}" ${simulate && simulate.wallet_id === w.id ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}
      </select>
    </div>
    <div class="field inline-field">
      <label for="simulate-destination">Destination address</label>
      <input id="simulate-destination" type="text" value="${esc(simulate ? simulate.destination_address : '')}">
    </div>
    <div class="field inline-field">
      <label for="simulate-amount">Amount</label>
      <input id="simulate-amount" type="text" inputmode="decimal" value="${esc(simulate ? simulate.amount : '')}">
    </div>
    <button type="submit" class="capsule capsule-dark">Simulate</button>
  </form>
  <div id="simulation-result" class="simulation-result" role="status" aria-label="Simulation result" ${simulate ? '' : 'hidden'}>
    ${simulate ? simulateHtml(simulate) : ''}
  </div>
</div>`,
  });
}

export function quorumsPage(viewer, org, quorums, aggregations, wallets, members, inboxCount) {
  const memberName = (id) => {
    const m = members.find((x) => x.id === id);
    return m ? m.name : id;
  };
  return consoleFrame({
    title: 'Quorums', active: 'quorums', viewer, org, inboxCount,
    body: `
<h1 class="console-heading">Quorums and aggregations</h1>
<div class="panel">
  <div class="panel-head"><h2>Key quorums</h2>${viewer.role === 'owner' ? '<button type="button" class="capsule capsule-dark" id="create-quorum-btn">Create key quorum</button>' : ''}</div>
  <table class="console-table" aria-label="Key quorums" id="quorums-table">
    <thead><tr><th scope="col">Name</th><th scope="col">Members</th><th scope="col">Threshold</th><th scope="col">Expiry</th><th scope="col">Wallets</th>${viewer.role === 'owner' ? '<th scope="col">Edit</th>' : ''}</tr></thead>
    <tbody>
    ${quorums.map((q) => `<tr>
      <td>${esc(q.name)}</td>
      <td>${q.member_ids.map((id) => esc(memberName(id))).join(', ')}</td>
      <td>${q.authorization_threshold} of ${q.member_ids.length}</td>
      <td>${Math.round(q.expiry_seconds / 3600)} hours</td>
      <td>${wallets.filter((w) => w.quorum_id === q.id).map((w) => esc(w.name)).join(', ') || '—'}</td>
      ${viewer.role === 'owner' ? `<td><button type="button" class="table-btn" data-edit-quorum="${esc(q.id)}">Edit ${esc(q.name)}</button></td>` : ''}
    </tr>`).join('') || '<tr><td colspan="6" class="empty-state">No key quorums yet</td></tr>'}
    </tbody>
  </table>
</div>
<div class="panel">
  <div class="panel-head"><h2>Aggregations</h2>${viewer.role === 'owner' ? '<button type="button" class="capsule capsule-dark" id="create-aggregation-btn">Create aggregation</button>' : ''}</div>
  <table class="console-table" aria-label="Aggregations" id="aggregations-table">
    <thead><tr><th scope="col">Name</th><th scope="col">Metric</th><th scope="col">Window</th><th scope="col">Asset</th><th scope="col">Grouping</th></tr></thead>
    <tbody>
    ${aggregations.map((a) => `<tr>
      <td>${esc(a.name)}</td><td>${esc(a.metric)}</td>
      <td>${Math.round(a.window_seconds / 3600)} hours</td><td>${esc(a.asset)}</td><td>${esc(a.group_by)}</td>
    </tr>`).join('') || '<tr><td colspan="5" class="empty-state">No aggregations yet</td></tr>'}
    </tbody>
  </table>
</div>`,
  });
}

export function auditPage(viewer, org, auditEvents, webhookEvents, chain, inboxCount) {
  return consoleFrame({
    title: 'Audit', active: 'audit', viewer, org, inboxCount,
    body: `
<h1 class="console-heading">Audit</h1>
<div class="panel">
  <div role="tablist" aria-label="Audit tabs" class="tablist">
    <button type="button" role="tab" id="tab-trail" aria-selected="true" aria-controls="panel-trail" class="tab">Audit trail</button>
    <button type="button" role="tab" id="tab-events" aria-selected="false" aria-controls="panel-events" class="tab">Signed events</button>
  </div>
  <p class="chain-status" role="status" aria-label="Chain status" id="chain-status">${chain.valid ? `Chain verified: ${chain.events} events` : `Chain broken at event ${chain.first_broken_seq}`}</p>
  <button type="button" class="capsule capsule-outline" id="verify-chain-btn">Verify chain</button>
  <div id="panel-trail" role="tabpanel" aria-labelledby="tab-trail">
    <table class="console-table" aria-label="Audit trail">
      <thead><tr><th scope="col">Seq</th><th scope="col">Time</th><th scope="col">Type</th><th scope="col">Actor</th><th scope="col">Subject</th><th scope="col">Hash</th></tr></thead>
      <tbody>
      ${auditEvents.slice().reverse().map((e) => `<tr>
        <td>${e.seq}</td><td>${esc(formatTsMinutes(new Date(e.at)))}</td><td>${esc(e.type)}</td>
        <td>${esc(e.actor)}</td><td>${esc(e.subject_id)}</td><td class="mono">${esc(String(e.hash).slice(0, 12))}</td>
      </tr>`).join('')}
      </tbody>
    </table>
  </div>
  <div id="panel-events" role="tabpanel" aria-labelledby="tab-events" hidden>
    <table class="console-table" aria-label="Signed events">
      <thead><tr><th scope="col">Seq</th><th scope="col">Type</th><th scope="col">Time</th><th scope="col">Signature</th></tr></thead>
      <tbody>
      ${webhookEvents.slice().reverse().map((e) => `<tr>
        <td>${e.seq}</td><td>${esc(e.type)}</td><td>${esc(formatTsMinutes(new Date(e.created_at)))}</td><td class="mono">${esc(e.signature)}</td>
      </tr>`).join('')}
      </tbody>
    </table>
  </div>
</div>`,
  });
}

export function settingsPage(viewer, org, members, apiKeys, inboxCount, newSecret) {
  const isOwner = viewer.role === 'owner';
  return consoleFrame({
    title: 'Settings', active: 'settings', viewer, org, inboxCount,
    body: `
<h1 class="console-heading">Settings</h1>
<div class="panel">
  <h2>Organization</h2>
  <dl class="facts">
    <div><dt>Organization name</dt><dd>${esc(org.name)}</dd></div>
    <div><dt>App id</dt><dd><span class="mono" id="app-id">${esc(org.app_id)}</span>
      <button type="button" class="capsule capsule-outline small" id="copy-app-id">Copy</button></dd></div>
  </dl>
</div>
<div class="panel">
  <div class="panel-head"><h2>Members</h2>${isOwner ? '<button type="button" class="capsule capsule-dark" id="add-member-btn">Add member</button>' : ''}</div>
  <table class="console-table" aria-label="Members" id="members-table">
    <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th>${isOwner ? '<th scope="col">Actions</th>' : ''}</tr></thead>
    <tbody>
    ${members.map((m) => `<tr data-member-id="${esc(m.id)}">
      <td>${esc(m.name)}</td><td>${esc(m.email)}</td>
      <td>${isOwner ? `<select aria-label="Role for ${esc(m.name)}" class="role-select" data-member="${esc(m.id)}">
        ${['owner', 'operator', 'approver', 'auditor'].map((r) => `<option value="${r}" ${m.role === r ? 'selected' : ''}>${r}</option>`).join('')}
      </select>` : esc(m.role)}</td>
      ${isOwner ? `<td><button type="button" class="table-btn" data-remove-member="${esc(m.id)}" data-member-name="${esc(m.name)}">Remove ${esc(m.name)}</button></td>` : ''}
    </tr>`).join('')}
    </tbody>
  </table>
  ${isOwner ? `
  <dialog id="remove-member-dialog" aria-label="Remove member">
    <p id="remove-member-text">Remove this member? Their sessions and API keys are revoked.</p>
    <button type="button" class="capsule capsule-outline keep-member">Keep member</button>
    <button type="button" class="capsule capsule-dark remove-member">Remove</button>
  </dialog>
  <form class="create-form" id="member-create-form" hidden>
    <div class="field"><label for="new-member-name">Name</label><input id="new-member-name" type="text"></div>
    <div class="field"><label for="new-member-email">Email</label><input id="new-member-email" type="text"></div>
    <div class="field"><label for="new-member-role">Role</label>
      <select id="new-member-role" aria-label="Role"><option value="operator">operator</option><option value="approver">approver</option><option value="auditor">auditor</option><option value="owner">owner</option></select></div>
    <div class="field"><label for="new-member-password">Password</label><input id="new-member-password" type="password"></div>
    <button type="submit" class="capsule capsule-dark">Add member</button>
  </form>` : ''}
</div>
<div class="panel">
  <div class="panel-head"><h2>API keys</h2>${isOwner ? '<button type="button" class="capsule capsule-dark" id="create-key-btn">Create API key</button>' : ''}</div>
  ${isOwner ? `
  <form class="create-form" id="key-create-form" hidden>
    <div class="field"><label for="key-name">Key name</label><input id="key-name" type="text"></div>
    <div class="field"><label for="key-role">Key role</label>
      <select id="key-role" aria-label="Key role"><option value="operator">operator</option><option value="auditor">auditor</option></select></div>
    <button type="submit" class="capsule capsule-dark">Create</button>
  </form>` : ''}
  ${newSecret ? `<p class="secret-reveal"><code class="mono">${esc(newSecret.secret)}</code> Copy this key now. It will not be shown again.</p>` : ''}
  <table class="console-table" aria-label="API keys" id="keys-table">
    <thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Prefix</th><th scope="col">Creator</th><th scope="col">Created</th><th scope="col">Revoked</th>${isOwner ? '<th scope="col">Actions</th>' : ''}</tr></thead>
    <tbody>
    ${apiKeys.map((k) => `<tr>
      <td>${esc(k.name)}</td><td>${esc(k.role)}</td><td class="mono">${esc(k.prefix)}</td>
      <td>${esc(k.creator_name || k.created_by)}</td>
      <td>${esc(formatTsMinutes(new Date(k.created_at)))}</td>
      <td>${k.revoked_at ? esc(formatTsMinutes(new Date(k.revoked_at))) : '—'}</td>
      ${isOwner && !k.revoked_at ? `<td><button type="button" class="table-btn" data-revoke-key="${esc(k.id)}" data-key-name="${esc(k.name)}">Revoke ${esc(k.name)}</button></td>` : isOwner ? '<td></td>' : ''}
    </tr>`).join('') || '<tr><td colspan="7" class="empty-state">No API keys yet</td></tr>'}
    </tbody>
  </table>
</div>
${isOwner ? `
<div class="panel">
  <h2>Webhook signing secret</h2>
  <form class="secret-panel">
    <div class="field">
      <label for="signing-secret">Signing secret</label>
      <input id="signing-secret" type="password" value="••••••••••••" readonly>
    </div>
    <button type="button" class="capsule capsule-outline" id="reveal-secret-btn">Reveal</button>
    <button type="button" class="capsule capsule-dark" id="rotate-secret-btn">Rotate</button>
  </form>
  <p class="form-result" id="secret-result" aria-live="polite"></p>
</div>` : ''}`,
  });
}

export { noAccess, notFoundPanel };

// Frame for arbitrary body panels (no-access and not-found).
export function consoleFrameHtml(viewer, org, inboxCount, title, active, body) {
  return consoleFrame({ title, active, viewer, org, inboxCount, body });
}
