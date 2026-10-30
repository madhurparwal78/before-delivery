import { h } from '../../html.js';
import { consolePage } from '../../layout.js';
import { amountWithAsset, approvalProgress, decisionLine, displayTime, emptyState, shortAddress } from './parts.js';

export const INBOX_EMPTY = 'Nothing waiting for your approval';

function inboxCard(intent, { walletName, asset, initiator }) {
  const progress = approvalProgress(intent);
  const destination = intent.kind === 'batch'
    ? `${intent.items.length} lines`
    : shortAddress(intent.destination_address);
  const descriptionId = `destination-${h(intent.id)}`;
  return `
    <div class="inbox-card" role="group" aria-label="Intent ${h(intent.id)}" data-intent="${h(intent.id)}">
      <div class="grid">
        <div><span class="label">Wallet</span>${h(walletName)}</div>
        <div><span class="label">Destination</span>
          <span aria-describedby="${descriptionId}">${h(destination)}</span>
          <span class="sr-only" id="${descriptionId}">${h(intent.kind === 'batch' ? `${intent.items.length} lines` : intent.destination_address)}</span>
        </div>
        <div><span class="label">Amount</span><span class="num">${h(amountWithAsset(intent.amount, asset))}</span></div>
        <div><span class="label">Memo</span>${h(intent.memo || '')}</div>
        <div><span class="label">Initiator</span>${h(initiator)}</div>
        <div><span class="label">Expires</span>${h(displayTime(intent.expires_at))}</div>
        <div><span class="label">Policy decision</span>${h(decisionLine(intent))}</div>
      </div>
      <div class="progress" role="progressbar" aria-label="Approvals" aria-valuemin="0" aria-valuemax="${progress.required}" aria-valuenow="${progress.recorded}" aria-valuetext="${h(progress.text)}">
        <div class="fill" style="width:${progress.required ? Math.round((progress.recorded / progress.required) * 100) : 0}%"></div>
      </div>
      <p class="help" data-progress-text>${h(progress.text)}</p>
      <form method="post" action="/console/approvals" data-decide-form>
        <input type="hidden" name="intent_id" value="${h(intent.id)}">
        <div class="inbox-actions">
          <button type="submit" class="capsule capsule-dark" name="__action" value="approve" data-approve>Approve</button>
          <button type="button" class="capsule capsule-light" data-reject>Reject</button>
        </div>
        <div class="field" hidden data-reason-holder>
          <label for="reason-${h(intent.id)}">Reason for rejecting</label>
          <input type="text" id="reason-${h(intent.id)}" name="reason" data-reason>
          <p class="field-error" data-error-for="reason"></p>
          <button type="submit" class="capsule capsule-dark" name="__action" value="reject" data-confirm-reject>Confirm reject</button>
        </div>
        <p class="field-error" data-row-error></p>
      </form>
    </div>`;
}

export function renderApprovals({ session, data, toasts }) {
  const content = `
    <h1>Approvals</h1>
    <div data-inbox>
      ${data.items.length
    ? data.items.map((intent) => inboxCard(intent, {
      walletName: data.walletNames.get(intent.id) || '',
      asset: data.assets.get(intent.id) || 'usdc',
      initiator: data.names.get(intent.created_by) || intent.created_by
    })).join('')
    : emptyState(INBOX_EMPTY, { id: 'inbox-empty' })}
    </div>
    ${data.items.length ? `<template data-empty-template>${emptyState(INBOX_EMPTY, { id: 'inbox-empty' })}</template>` : ''}`;

  return consolePage({
    title: 'Approvals — Corvo console',
    session,
    active: '/console/approvals',
    content,
    toasts,
    awaiting: data.items.length
  });
}
