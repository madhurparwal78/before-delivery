import { h } from '../../html.js';
import { consolePage } from '../../layout.js';
import { amountWithAsset, approvalProgress, badge, decisionLine, destinationCell, displayTime, emptyState } from './parts.js';

export const STATUS_OPTIONS = [
  ['', 'All'],
  ['pending_approval', 'Pending approval'],
  ['executed', 'Executed'],
  ['rejected', 'Rejected'],
  ['cancelled', 'Cancelled'],
  ['expired', 'Expired']
];

function detailsRow(intent, { asset, names }) {
  return `
    <tr class="intent-row-details" hidden data-details-for="${h(intent.id)}">
      <td colspan="10">
        <p><strong>${h(decisionLine(intent))}</strong></p>
        ${intent.approvals.length ? `<ul>${intent.approvals.map((approval) => `
          <li>${h(names.get(approval.member_id) || approval.member_id)} · ${h(approval.decision)} · ${h(displayTime(approval.created_at))}</li>`).join('')}</ul>` : '<p class="help">No decisions yet</p>'}
        ${intent.rejection_reason ? `<p>Rejection reason: ${h(intent.rejection_reason)}</p>` : ''}
        ${intent.tx_hash ? `<p>Transaction hash: <span class="mono">${h(intent.tx_hash)}</span></p>` : ''}
        ${intent.items.length ? `
          <table>
            <caption>Batch lines</caption>
            <thead><tr><th scope="col">Line</th><th scope="col">Destination</th><th scope="col" class="num">Amount</th><th scope="col">Memo</th></tr></thead>
            <tbody>${intent.items.map((item) => `
              <tr>
                <td>${item.position + 1}</td>
                <td><span class="mono">${h(item.destination_address)}</span></td>
                <td class="num">${h(amountWithAsset(item.amount, asset))}</td>
                <td>${h(item.memo || '')}</td>
              </tr>`).join('')}</tbody>
          </table>` : ''}
      </td>
    </tr>`;
}

export function intentRows(intents, { assets, walletNames, names, session }) {
  return intents.map((intent) => {
    const asset = assets.get(intent.id) || 'usdc';
    const progress = approvalProgress(intent);
    const mayCancel = intent.status === 'pending_approval'
      && (session.member.role === 'owner' || intent.created_by === session.member.id);
    return `
      <tr data-intent-row="${h(intent.id)}">
        <td data-label="Id"><span class="mono">${h(intent.id)}</span></td>
        <td data-label="Wallet">${h(walletNames.get(intent.id) || '')}</td>
        <td data-label="Kind">${h(intent.kind)}</td>
        <td data-label="Destination"><span class="mono">${h(destinationCell(intent))}</span></td>
        <td data-label="Amount" class="num">${h(amountWithAsset(intent.amount, asset))}</td>
        <td data-label="Status">${badge(intent.status)}</td>
        <td data-label="Initiator">${h(names.get(intent.created_by) || intent.created_by)}</td>
        <td data-label="Created">${h(displayTime(intent.created_at))}</td>
        <td data-label="Approvals">${h(`${progress.recorded} of ${progress.required}`)}</td>
        <td data-label="Actions">
          <button type="button" class="capsule capsule-light" data-details="${h(intent.id)}" aria-expanded="false">Details for ${h(intent.id)}</button>
          ${mayCancel ? `
            <form method="post" action="/console/intents" data-cancel-form>
              <input type="hidden" name="__action" value="cancel">
              <input type="hidden" name="intent_id" value="${h(intent.id)}">
              <button type="submit" class="capsule capsule-light">Cancel request</button>
            </form>` : ''}
        </td>
      </tr>
      ${detailsRow(intent, { asset, names })}`;
  }).join('');
}

export function renderIntents({ session, data, toasts, awaiting, status, nextCursor }) {
  const exportQuery = status ? `?status=${encodeURIComponent(status)}` : '';
  const content = `
    <h1>Intents</h1>
    <section class="panel">
      <form method="get" action="/console/intents" class="inline-actions" data-filter-form>
        <div class="field">
          <label for="status">Status</label>
          <select id="status" name="status" data-status-filter>
            ${STATUS_OPTIONS.map(([value, label]) => `<option value="${h(value)}"${value === status ? ' selected' : ''}>${h(label)}</option>`).join('')}
          </select>
        </div>
        <button type="submit" class="capsule capsule-light">Apply</button>
        <a class="capsule capsule-light" href="/console/intents/export${h(exportQuery)}" download>Download CSV</a>
      </form>
      ${data.items.length ? `
      <table class="stacked">
        <caption>Intents</caption>
        <thead>
          <tr>
            <th scope="col">Id</th><th scope="col">Wallet</th><th scope="col">Kind</th><th scope="col">Destination</th>
            <th scope="col" class="num">Amount</th><th scope="col">Status</th><th scope="col">Initiator</th>
            <th scope="col">Created</th><th scope="col">Approvals</th><th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody data-intent-body>
          ${intentRows(data.items, { assets: data.assets, walletNames: data.walletNames, names: data.names, session })}
        </tbody>
      </table>
      ${nextCursor ? `
        <form method="get" action="/console/intents" data-load-more-form>
          <input type="hidden" name="status" value="${h(status)}">
          <input type="hidden" name="cursor" value="${h(nextCursor)}">
          <button type="submit" class="capsule capsule-light" data-load-more>Load more</button>
        </form>` : ''}
      ` : emptyState('No intents yet')}
    </section>`;

  return consolePage({
    title: 'Intents — Corvo console',
    session,
    active: '/console/intents',
    content,
    toasts,
    awaiting
  });
}
