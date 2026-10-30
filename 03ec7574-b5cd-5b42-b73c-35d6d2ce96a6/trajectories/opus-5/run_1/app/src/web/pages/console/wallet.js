import { h, icon } from '../../html.js';
import { consolePage } from '../../layout.js';
import { amountWithAsset, badge, displayTime } from './parts.js';

export const FROZEN_BANNER = 'This wallet is frozen. New transfers and approvals are paused.';
const FREEZE_DIALOG_TEXT = 'Freezing pauses new transfers and approvals. Deposits, rejections and cancellations still work.';

function batchLine(index) {
  const number = index + 1;
  return `
    <div class="batch-line" data-batch-line>
      <div class="field">
        <label for="line-${number}-destination">Line ${number} destination</label>
        <input type="text" id="line-${number}-destination" name="destination_${index}" data-line-field="destination_address">
      </div>
      <div class="field">
        <label for="line-${number}-amount">Line ${number} amount</label>
        <input type="text" id="line-${number}-amount" name="amount_${index}" data-line-field="amount" inputmode="decimal">
        <p class="field-error" data-line-error></p>
      </div>
      <div class="field">
        <label for="line-${number}-memo">Line ${number} memo</label>
        <input type="text" id="line-${number}-memo" name="memo_${index}" data-line-field="memo">
      </div>
      <button type="button" class="capsule capsule-light" data-remove-line${index === 0 ? ' disabled' : ''}>Remove line ${number}</button>
    </div>`;
}

function sendForm(wallet) {
  return `
    <section class="panel">
      <h2>Send</h2>
      <form method="post" action="/console/wallets/${h(wallet.id)}" aria-label="Send" data-send-form>
        <input type="hidden" name="__action" value="send">
        <div class="field">
          <label for="send-destination">Destination address</label>
          <input type="text" id="send-destination" name="destination_address" data-field="destination_address">
          <p class="field-error" data-error-for="destination_address"></p>
        </div>
        <div class="field">
          <label for="send-amount">Amount</label>
          <input type="text" id="send-amount" name="amount" inputmode="decimal" data-field="amount">
          <p class="field-error" data-error-for="amount"></p>
        </div>
        <div class="field">
          <label for="send-memo">Memo</label>
          <input type="text" id="send-memo" name="memo" data-field="memo">
          <p class="field-error" data-error-for="memo"></p>
        </div>
        <button type="submit" class="capsule capsule-dark">Send${icon('swap')}</button>
        <p class="result-line" data-result></p>
      </form>
    </section>`;
}

function depositForm(wallet) {
  return `
    <section class="panel">
      <h2>Deposit</h2>
      <form method="post" action="/console/wallets/${h(wallet.id)}" aria-label="Deposit" data-deposit-form>
        <input type="hidden" name="__action" value="deposit">
        <div class="field">
          <label for="deposit-amount">Amount</label>
          <input type="text" id="deposit-amount" name="amount" inputmode="decimal" data-field="amount">
          <p class="field-error" data-error-for="amount"></p>
        </div>
        <div class="field">
          <label for="deposit-reference">Reference</label>
          <input type="text" id="deposit-reference" name="reference" data-field="reference">
          <p class="field-error" data-error-for="reference"></p>
        </div>
        <button type="submit" class="capsule capsule-dark">Record deposit</button>
        <p class="result-line" data-result></p>
      </form>
    </section>`;
}

function batchForm(wallet) {
  return `
    <section class="panel">
      <h2>Payroll batch</h2>
      <form method="post" action="/console/wallets/${h(wallet.id)}" aria-label="Payroll batch" data-batch-form data-asset="${h(wallet.asset)}" data-decimals="${wallet.asset === 'eth' ? 18 : 6}">
        <input type="hidden" name="__action" value="batch">
        <div data-batch-lines>${batchLine(0)}</div>
        <div class="inline-actions">
          <button type="button" class="capsule capsule-light" data-add-line>Add line</button>
        </div>
        <p class="result-line" role="status" aria-label="Batch total" data-batch-total>Total: 0 ${h(wallet.asset.toUpperCase())}</p>
        <button type="submit" class="capsule capsule-dark">Submit batch</button>
        <p class="result-line" data-result></p>
      </form>
    </section>`;
}

export function renderWallet({ session, data, toasts, awaiting }) {
  const { wallet, policy, quorum, activity } = data;
  const canSend = ['owner', 'operator'].includes(session.member.role);
  const isOwner = session.member.role === 'owner';
  const frozen = wallet.status === 'frozen';

  const facts = `
    <section class="panel">
      <div class="inline-actions" style="justify-content:space-between;align-items:center">
        <h1>${h(wallet.name)}</h1>
        ${badge(wallet.status)}
      </div>
      <dl class="facts">
        <div><dt>Address</dt><dd><span class="mono" data-address>${h(wallet.address)}</span>
          <button type="button" class="capsule capsule-light" data-copy-address data-value="${h(wallet.address)}">Copy address</button></dd></div>
        <div><dt>Chain</dt><dd>${h(wallet.chain)}</dd></div>
        <div><dt>Asset</dt><dd>${h(wallet.asset.toUpperCase())}</dd></div>
        <div><dt>Balance</dt><dd data-fact="balance">${h(amountWithAsset(wallet.balance, wallet.asset))}</dd></div>
        <div><dt>Available</dt><dd data-fact="available">${h(amountWithAsset(wallet.available, wallet.asset))}</dd></div>
        <div><dt>Pending</dt><dd data-fact="reserved">${h(amountWithAsset(wallet.reserved, wallet.asset))}</dd></div>
        <div><dt>Policy</dt><dd>${h(policy ? policy.name : 'None')}</dd></div>
        <div><dt>Quorum</dt><dd>${h(quorum ? quorum.name : 'None')}</dd></div>
        <div><dt>Approval floor</dt><dd>${h(amountWithAsset(wallet.approval_floor, wallet.asset))}</dd></div>
      </dl>
      ${isOwner ? `
        <div class="inline-actions" style="margin-top:1rem">
          ${frozen
    ? `<form method="post" action="/console/wallets/${h(wallet.id)}" data-status-form>
                <input type="hidden" name="__action" value="unfreeze">
                <button type="submit" class="capsule capsule-light">Unfreeze wallet</button>
              </form>`
    : '<button type="button" class="capsule capsule-light" data-open-freeze>Freeze wallet</button>'}
        </div>
        <dialog aria-label="Freeze wallet" data-freeze-dialog>
          <h2>Freeze wallet</h2>
          <p>${h(FREEZE_DIALOG_TEXT)}</p>
          <form method="post" action="/console/wallets/${h(wallet.id)}" class="dialog-actions" data-status-form>
            <input type="hidden" name="__action" value="freeze">
            <button type="button" class="capsule capsule-light" data-close-dialog>Keep active</button>
            <button type="submit" class="capsule capsule-dark">Freeze</button>
          </form>
        </dialog>` : ''}
    </section>`;

  const activityTable = `
    <section class="panel">
      <h2>Activity</h2>
      ${activity.length ? `
      <table class="stacked">
        <caption>Activity</caption>
        <thead><tr><th scope="col">Kind</th><th scope="col">When</th><th scope="col" class="num">Amount</th><th scope="col">Status</th><th scope="col">Reference</th><th scope="col">Memo</th></tr></thead>
        <tbody>
          ${activity.map((entry) => `
            <tr>
              <td data-label="Kind">${h(entry.kind)}</td>
              <td data-label="When">${h(displayTime(entry.at))}</td>
              <td data-label="Amount" class="num">${h(entry.amount)}</td>
              <td data-label="Status">${badge(entry.status)}</td>
              <td data-label="Reference"><span class="mono">${h(entry.reference)}</span></td>
              <td data-label="Memo">${h(entry.memo)}</td>
            </tr>`).join('')}
        </tbody>
      </table>` : '<p class="help">No deposits or intents yet</p>'}
    </section>`;

  const banner = `<section class="panel" role="region" aria-label="Frozen wallet"><p class="frozen-banner">${h(FROZEN_BANNER)}</p></section>`;
  const forms = frozen
    ? `${banner}${canSend ? depositForm(wallet) : ''}`
    : (canSend ? `${sendForm(wallet)}${depositForm(wallet)}${batchForm(wallet)}` : '');

  return consolePage({
    title: `${wallet.name} — Corvo console`,
    session,
    active: '/console',
    content: `<div class="wallet-layout"><div>${facts}${activityTable}</div><div>${forms}</div></div>`,
    toasts,
    awaiting
  });
}
