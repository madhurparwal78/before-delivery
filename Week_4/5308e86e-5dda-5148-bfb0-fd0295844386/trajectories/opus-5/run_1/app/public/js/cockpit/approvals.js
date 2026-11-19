// The Approvals page: live, keyboard-complete, every row action named in full,
// and each row's server-dated "Approve by" deadline.

import { el, icon, setBusy, clearBusy, isBusy, placeAfter } from '../dom.js';
import * as api from '../api.js';
import * as router from '../router.js';
import * as session from '../session.js';
import { announce } from '../status.js';
import { money, effectiveDate, METHOD_LABELS } from '../format.js';
import * as data from './data.js';
import { layout } from './shell.js';

const LIVE_MS = 3000;
const NOT_PENDING = 'This payment is no longer waiting for approval.';
const ALREADY_APPROVED = "You've already approved this payment.";

function groupKey(payment) {
  return `${payment.amount_cents}|${payment.recipient_name}|${payment.source_account_name}`;
}

// Rows that share an amount, recipient and source account each gain a position
// suffix, so every name on the page is unique.
function suffixes(payments) {
  const counts = new Map();
  for (const payment of payments) {
    const key = groupKey(payment);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const seen = new Map();
  const result = new Map();
  for (const payment of payments) {
    const key = groupKey(payment);
    const total = counts.get(key);
    if (total < 2) {
      result.set(payment.id, '');
      continue;
    }
    const position = (seen.get(key) || 0) + 1;
    seen.set(key, position);
    result.set(payment.id, ` (payment ${position} of ${total})`);
  }
  return result;
}

function actionName(verb, payment, suffix) {
  return `${verb} ${money(payment.amount_cents)} to ${payment.recipient_name} from ${payment.source_account_name}${suffix}`;
}

export const approvals = {
  title: 'Approvals — Tallwind',
  async render() {
    if (!data.state.me) await data.refreshMe();
    const user = session.user();
    const mayDecide = user && (user.role === 'owner' || user.role === 'admin');

    const heading = el('h1', { text: 'Approvals', tabindex: '-1' });
    const list = el('div', {});
    const emptyLine = el('p', { class: 'hint', text: 'Nothing is waiting for approval.', hidden: true });
    const node = el('div', {}, [heading, emptyLine, list]);

    const rows = new Map();
    let order = [];
    let ownActionUntil = 0;
    let lastWaiting = null;

    function focusTarget(departedId) {
      const index = order.indexOf(departedId);
      for (let after = index + 1; after < order.length; after += 1) {
        const row = rows.get(order[after]);
        if (row) return row.approve || row.node;
      }
      for (let before = index - 1; before >= 0; before -= 1) {
        const row = rows.get(order[before]);
        if (row) return row.approve || row.node;
      }
      return heading;
    }

    function buildRow(payment, suffix) {
      const amount = el('p', { class: 'approval-amount mono', text: money(payment.amount_cents) });
      const details = el('p', { class: 'hint' });
      const progress = el('p', {});
      const approvedBy = el('p', { class: 'hint' });
      const deadline = el('p', { class: 'deadline' }, [icon('clock', { size: 14 }), el('span', {})]);
      const actions = el('div', { class: 'approval-actions' });
      const row = el('div', { class: 'approval-row', dataset: { payment: payment.id } }, [
        el('div', {}, [amount, details, progress, approvedBy, deadline]),
        actions,
      ]);
      const entry = { node: row, amount, details, progress, approvedBy, deadline, actions, approve: null, reject: null, pending: false, payment };

      if (mayDecide) {
        entry.approve = el('button', { type: 'button', class: 'pill', text: 'Approve' });
        entry.reject = el('button', { type: 'button', class: 'btn btn-secondary', text: 'Reject' });
        entry.approve.addEventListener('click', () => decide(entry, 'approve'));
        entry.reject.addEventListener('click', () => decide(entry, 'reject'));
        actions.append(entry.approve, entry.reject);
      }
      paintRow(entry, payment, suffix);
      return entry;
    }

    function paintRow(entry, payment, suffix) {
      entry.payment = payment;
      entry.amount.textContent = money(payment.amount_cents);
      entry.details.textContent = `${payment.recipient_name} · ${METHOD_LABELS[payment.method]} · from ${payment.source_account_name} · created by ${payment.creator_name}`;
      entry.progress.textContent = `${payment.approvals.length} of ${payment.approvals_required} approvals`;
      if (payment.approvals.length > 0) {
        entry.approvedBy.hidden = false;
        entry.approvedBy.textContent = `Approved by ${payment.approvals.map((approval) => approval.name).join(', ')}`;
      } else {
        entry.approvedBy.hidden = true;
        entry.approvedBy.textContent = '';
      }
      entry.deadline.querySelector('span').textContent = `Approve by ${effectiveDate(payment.approve_by)}`;
      if (entry.approve) entry.approve.setAttribute('aria-label', actionName('Approve', payment, suffix));
      if (entry.reject) entry.reject.setAttribute('aria-label', actionName('Reject', payment, suffix));
      const stacked = layout().stackRows;
      entry.node.classList.toggle('stacked', stacked);
    }

    async function decide(entry, action) {
      if (entry.pending || isBusy(entry.approve) || isBusy(entry.reject)) return;
      entry.pending = true;
      const pendingCopy = action === 'approve' ? 'Approving…' : 'Rejecting…';
      setBusy(action === 'approve' ? entry.approve : entry.reject, pendingCopy);
      setBusy(action === 'approve' ? entry.reject : entry.approve, action === 'approve' ? 'Reject' : 'Approve');
      announce(pendingCopy);

      const answer = await api.post(`/api/payments/${entry.payment.id}/${action}`);
      entry.pending = false;
      clearBusy(entry.approve);
      clearBusy(entry.reject);
      if (answer.aborted || answer.revoked) return;
      if (answer.status === 200) ownActionUntil = Date.now() + 1500;

      if (answer.status === 200) {
        const payment = answer.json;
        if (action === 'approve' && payment.status === 'pending_approval') {
          announce('Approval recorded');
          await load({ keepFocus: false });
          const again = rows.get(payment.id);
          if (again && again.reject) again.reject.focus();
          data.refreshMoney();
          return;
        }
        let message = action === 'approve' ? 'Payment approved and sent' : 'Payment rejected';
        const businessDate = data.state.me ? data.state.me.business_date : null;
        if (action === 'approve' && payment.effective_date && payment.effective_date !== businessDate) {
          message += ` Settles on ${effectiveDate(payment.effective_date)}`;
        }
        const target = focusTarget(payment.id);
        announce(message);
        await load({ keepFocus: false });
        const resolved = rows.get(payment.id) ? rows.get(payment.id).approve : null;
        (resolved || target || heading).focus();
        data.refreshMoney();
        return;
      }

      if (answer.status === 409) {
        const message = answer.json.error === 'already_approved' ? ALREADY_APPROVED : NOT_PENDING;
        announce(message);
        const departed = entry.payment.id;
        const target = focusTarget(departed);
        await load({ keepFocus: false });
        if (!rows.has(departed)) (target || heading).focus();
        return;
      }
      announce(api.isOutage(answer) ? api.OUTAGE_MESSAGE : api.SERVER_ERROR_MESSAGE);
    }

    async function load({ keepFocus = true } = {}) {
      const answer = await api.get('/api/approvals');
      if (answer.status !== 200) {
        if (api.isOutage(answer)) announce(api.OUTAGE_MESSAGE);
        return;
      }
      const payments = answer.json.approvals;
      const suffixMap = suffixes(payments);
      const wanted = payments.map((payment) => payment.id);
      const focused = document.activeElement;
      const focusedRow = focused && focused.closest ? focused.closest('[data-payment]') : null;
      const focusedId = focusedRow ? focusedRow.dataset.payment : null;
      const focusedWasApprove = focusedRow && rows.get(focusedId) && rows.get(focusedId).approve === focused;

      // A row whose own request is pending waits for its own answer.
      for (const [id, entry] of [...rows]) {
        if (wanted.includes(id) || entry.pending) continue;
        entry.node.remove();
        rows.delete(id);
      }

      let previous = null;
      for (const payment of payments) {
        let entry = rows.get(payment.id);
        if (entry) paintRow(entry, payment, suffixMap.get(payment.id));
        else {
          entry = buildRow(payment, suffixMap.get(payment.id));
          rows.set(payment.id, entry);
        }
        placeAfter(list, entry.node, previous ? previous.node : null);
        previous = entry;
      }
      order = wanted;
      emptyLine.hidden = payments.length > 0;

      if (keepFocus && focusedId && !rows.has(focusedId)) {
        const target = focusTarget(focusedId);
        (target || heading).focus();
      } else if (keepFocus && focusedId && rows.has(focusedId) && focused && !focused.isConnected) {
        const entry = rows.get(focusedId);
        (focusedWasApprove ? entry.approve : entry.reject || entry.approve || heading).focus();
      }

      const waiting = payments.length;
      if (lastWaiting !== null && waiting !== lastWaiting && Date.now() > ownActionUntil) {
        announce(`Payments waiting for approval: ${waiting}`);
      }
      lastWaiting = waiting;
      data.state.approvalsWaiting = waiting;
    }

    await load({ keepFocus: false });

    const timer = setInterval(() => load(), LIVE_MS);
    const unsubscribe = data.subscribe((event) => {
      if (event.type === 'transaction') load();
    });
    const onResize = () => {
      for (const entry of rows.values()) entry.node.classList.toggle('stacked', layout().stackRows);
    };
    window.addEventListener('resize', onResize);
    router.onCleanup(() => {
      clearInterval(timer);
      unsubscribe();
      window.removeEventListener('resize', onResize);
    });

    return node;
  },
};
