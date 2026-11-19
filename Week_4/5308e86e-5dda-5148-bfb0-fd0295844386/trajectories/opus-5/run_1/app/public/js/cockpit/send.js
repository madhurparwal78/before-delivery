// Send payment. The draft lives in the address, and the settlement date is
// decided by the server: the page never reads the browser's clock or zone.

import { el, clear, icon, setBusy, clearBusy, isBusy } from '../dom.js';
import * as api from '../api.js';
import * as router from '../router.js';
import { announce } from '../status.js';
import { money, parseDollars, effectiveDate, DOLLAR_FORMAT_MESSAGE, AMOUNT_MESSAGE, codePointLength } from '../format.js';
import * as data from './data.js';
import { celebrate } from './celebration.js';

const METHODS = ['ach', 'wire', 'rtp', 'check'];
const METHOD_LABELS = { ach: 'ACH', wire: 'Wire', rtp: 'RTP', check: 'Check' };
const APPROVAL_THRESHOLD_CENTS = 500000;

const INSUFFICIENT_MESSAGE = "You don't have enough in this account";
const DATE_MESSAGE = 'Choose a date after today';
const MEMO_MESSAGE = 'Keep the memo to 140 characters of plain text';
const REMOVED_RECIPIENT_MESSAGE = 'This recipient is no longer available.';
const QUOTE_MESSAGE = 'This quote is no longer available. Get a new quote.';
const SCHEDULED_CAP_MESSAGE = 'Scheduled payments can be at most $5,000.00';

function field(id, label, control) {
  const error = el('span', { class: 'field-error', id: `${id}-error` });
  const wrapper = el('div', { class: 'field' }, [el('label', { for: id, text: label }), control, error]);
  return { wrapper, control, error, id };
}

function setError(entry, message) {
  entry.error.textContent = message || '';
  if (message) {
    entry.control.setAttribute('aria-invalid', 'true');
    entry.control.setAttribute('aria-describedby', entry.error.id);
  } else {
    entry.control.removeAttribute('aria-invalid');
    entry.control.removeAttribute('aria-describedby');
  }
}

export const sendPayment = {
  title: 'Send payment — Tallwind',
  async render(context) {
    if (!data.state.snapshot) await data.refreshMoney();
    if (!data.state.me) await data.refreshMe();
    const recipientsAnswer = await api.get('/api/recipients');
    const recipients =
      recipientsAnswer.status === 200
        ? recipientsAnswer.json.recipients.filter((recipient) => recipient.status === 'active')
        : [];
    const accounts = data.state.accounts;

    // ---- the draft, read from the address ----
    const query = context.query;
    let dropped = false;
    const wantedSource = query.get('source') || '';
    const source = accounts.some((account) => account.id === wantedSource) ? wantedSource : accounts[0] ? accounts[0].id : '';
    if (query.has('source') && source !== wantedSource) dropped = true;
    const wantedRecipient = query.get('recipient') || '';
    const recipient = recipients.some((entry) => entry.id === wantedRecipient) ? wantedRecipient : '';
    if (query.has('recipient') && recipient !== wantedRecipient) dropped = true;
    const wantedMethod = query.get('method') || 'ach';
    const method = METHODS.includes(wantedMethod) ? wantedMethod : 'ach';
    if (query.has('method') && method !== wantedMethod) dropped = true;
    const amountText = query.get('amount') || '';
    const memoText = query.get('memo') || '';
    const sendOnText = query.get('send_on') || '';
    const wantsReview = query.get('step') === 'review';

    // ---- the form ----
    const sourceSelect = el('select', { id: 'source-account' });
    const recipientSelect = el('select', { id: 'recipient' });
    const methodSelect = el(
      'select',
      { id: 'method' },
      METHODS.map((value) => el('option', { value, text: METHOD_LABELS[value] }))
    );
    const amountInput = el('input', { type: 'text', id: 'amount', inputmode: 'decimal', autocomplete: 'off' });
    const memoInput = el('input', { type: 'text', id: 'memo', autocomplete: 'off' });
    const sendOnInput = el('input', { type: 'date', id: 'send-on' });

    const sourceField = field('source-account', 'Source account', sourceSelect);
    const recipientField = field('recipient', 'Recipient', recipientSelect);
    const methodField = field('method', 'Method', methodSelect);
    const amountField = field('amount', 'Amount', amountInput);
    const memoField = field('memo', 'Memo', memoInput);
    const sendOnField = field('send-on', 'Send on', sendOnInput);

    function paintSourceOptions() {
      clear(sourceSelect);
      for (const account of accounts) {
        const figures = data.perAccount(account.id);
        const availableCents = figures ? figures.available_cents : account.available_cents;
        sourceSelect.append(
          el('option', { value: account.id, text: `${account.name} — ${money(availableCents)} available` })
        );
      }
      sourceSelect.value = source;
    }
    paintSourceOptions();

    clear(recipientSelect);
    recipientSelect.append(el('option', { value: '', text: 'Choose a recipient' }));
    for (const entry of recipients) {
      recipientSelect.append(el('option', { value: entry.id, text: entry.display_name }));
    }
    recipientSelect.value = recipient;
    methodSelect.value = method;
    amountInput.value = amountText;
    memoInput.value = memoText;
    sendOnInput.value = sendOnText;

    const settlementLine = el('p', { class: 'settlement-line' }, [icon('clock', { size: 15 }), el('span', {})]);
    const reviewSettlement = el('p', { class: 'settlement-line' }, [icon('clock', { size: 15 }), el('span', {})]);

    const reviewButton = el('button', { type: 'button', class: 'pill', text: 'Review payment' });
    const confirmButton = el('button', { type: 'button', class: 'pill', text: 'Confirm and send' });
    const backButton = el('button', { type: 'button', class: 'btn btn-secondary', text: 'Back' });

    const formStep = el('div', {}, [
      sourceField.wrapper,
      recipientField.wrapper,
      methodField.wrapper,
      settlementLine,
      amountField.wrapper,
      memoField.wrapper,
      sendOnField.wrapper,
      el('div', { class: 'hero-actions' }, [reviewButton]),
    ]);

    const reviewSummary = el('dl', { class: 'card' });
    const reviewStep = el('div', { hidden: true }, [
      el('h2', { text: 'Review payment' }),
      reviewSummary,
      reviewSettlement,
      el('div', { class: 'hero-actions' }, [confirmButton, backButton]),
    ]);

    const node = el('div', {}, [el('h1', { text: 'Send payment' }), formStep, reviewStep]);

    // ---- the address ----
    function draftAddress({ review = false } = {}) {
      const parts = [];
      if (sourceSelect.value) parts.push(`source=${encodeURIComponent(sourceSelect.value)}`);
      if (recipientSelect.value) parts.push(`recipient=${encodeURIComponent(recipientSelect.value)}`);
      if (methodSelect.value && methodSelect.value !== 'ach') parts.push(`method=${encodeURIComponent(methodSelect.value)}`);
      if (amountInput.value) parts.push(`amount=${encodeURIComponent(amountInput.value)}`);
      if (memoInput.value) parts.push(`memo=${encodeURIComponent(memoInput.value)}`);
      if (sendOnInput.value) parts.push(`send_on=${encodeURIComponent(sendOnInput.value)}`);
      if (review) parts.push('step=review');
      return parts.length ? `/payments/new?${parts.join('&')}` : '/payments/new';
    }

    function syncAddress() {
      router.setAddress(draftAddress({ review: reviewStep.hidden === false }), { replace: true });
    }

    // ---- the settlement line ----
    function settlementText() {
      if (sendOnInput.value) return null;
      const parsed = parseDollars(amountInput.value);
      if (parsed.ok && parsed.cents > APPROVAL_THRESHOLD_CENTS) return 'Settles once approved';
      const me = data.state.me;
      if (!me) return null;
      return `Settles ${effectiveDate(me.settlement_dates[methodSelect.value])}`;
    }

    function paintSettlement() {
      const text = settlementText();
      for (const line of [settlementLine, reviewSettlement]) {
        if (text === null) {
          line.hidden = true;
          line.querySelector('span').textContent = '';
        } else {
          line.hidden = false;
          line.querySelector('span').textContent = text;
        }
      }
    }

    let settlementTimer = null;
    function scheduleSettlementRefresh() {
      if (settlementTimer) clearTimeout(settlementTimer);
      const me = data.state.me;
      if (!me) return;
      const gap = Date.parse(me.settlement_dates_change_at) - Date.parse(me.business_now);
      const wait = Number.isFinite(gap) ? Math.max(500, gap + 800) : 30000;
      settlementTimer = setTimeout(async () => {
        const answer = await data.refreshMe();
        if (answer.status === 200) paintSettlement();
        scheduleSettlementRefresh();
      }, Math.min(wait, 86400000));
    }

    // ---- the review step ----
    let idempotencyKey = null;

    function clearErrors() {
      for (const entry of [sourceField, recipientField, methodField, amountField, memoField, sendOnField]) {
        setError(entry, null);
      }
    }

    // The published order: the dollar format, then zero, then the available
    // balance, then the "Send on" date.
    function checkDraft() {
      clearErrors();
      if (!recipientSelect.value) {
        setError(recipientField, 'Choose a recipient');
        return { ok: false, focus: recipientSelect };
      }
      const parsed = parseDollars(amountInput.value);
      if (!parsed.ok && parsed.reason === 'format') {
        setError(amountField, DOLLAR_FORMAT_MESSAGE);
        return { ok: false, focus: amountInput };
      }
      if (!parsed.ok || parsed.cents === 0) {
        setError(amountField, AMOUNT_MESSAGE);
        return { ok: false, focus: amountInput };
      }
      if (codePointLength(memoInput.value) > 140) {
        setError(memoField, MEMO_MESSAGE);
        return { ok: false, focus: memoInput };
      }
      if (sendOnInput.value && parsed.cents > APPROVAL_THRESHOLD_CENTS) {
        setError(amountField, SCHEDULED_CAP_MESSAGE);
        return { ok: false, focus: amountInput };
      }
      const figures = data.perAccount(sourceSelect.value);
      const availableCents = figures
        ? figures.available_cents
        : (data.accountById(sourceSelect.value) || { available_cents: 0 }).available_cents;
      if (parsed.cents > availableCents) {
        setError(amountField, INSUFFICIENT_MESSAGE);
        return { ok: false, focus: amountInput };
      }
      const businessDate = data.state.me ? data.state.me.business_date : null;
      if (sendOnInput.value && businessDate && sendOnInput.value <= businessDate) {
        setError(sendOnField, DATE_MESSAGE);
        return { ok: false, focus: sendOnInput };
      }
      return { ok: true, cents: parsed.cents };
    }

    function paintReview(cents) {
      const sourceName = (data.accountById(sourceSelect.value) || {}).name || '';
      const recipientName = (recipients.find((entry) => entry.id === recipientSelect.value) || {}).display_name || '';
      clear(reviewSummary);
      const rows = [
        ['Source account', sourceName],
        ['Recipient', recipientName],
        ['Method', METHOD_LABELS[methodSelect.value]],
        ['Amount', money(cents)],
      ];
      if (memoInput.value) rows.push(['Memo', memoInput.value]);
      if (sendOnInput.value) rows.push(['Send on', sendOnInput.value]);
      for (const [label, value] of rows) {
        reviewSummary.append(el('dt', { text: label }), el('dd', { text: value }));
      }
    }

    function openReview(cents, { pushHistory = true }) {
      paintReview(cents);
      paintSettlement();
      formStep.hidden = true;
      reviewStep.hidden = false;
      idempotencyKey = api.newIdempotencyKey();
      if (pushHistory) router.setAddress(draftAddress({ review: true }), { replace: false });
      confirmButton.focus();
    }

    function showForm() {
      formStep.hidden = false;
      reviewStep.hidden = true;
    }

    reviewButton.addEventListener('click', () => {
      const result = checkDraft();
      if (!result.ok) {
        if (result.focus) result.focus.focus();
        return;
      }
      openReview(result.cents, { pushHistory: true });
    });

    backButton.addEventListener('click', () => {
      window.history.back();
    });

    confirmButton.addEventListener('click', async () => {
      if (isBusy(confirmButton)) return;
      const result = checkDraft();
      if (!result.ok) {
        showForm();
        if (result.focus) result.focus.focus();
        return;
      }
      setBusy(confirmButton, 'Sending…');
      announce('Sending…');

      const body = {
        source_account_id: sourceSelect.value,
        recipient_id: recipientSelect.value,
        method: methodSelect.value,
        amount_cents: result.cents,
      };
      if (memoInput.value) body.memo = memoInput.value;
      if (sendOnInput.value) body.scheduled_for = sendOnInput.value;

      const answer = await api.post('/api/payments', body, { idempotencyKey });
      clearBusy(confirmButton);
      if (answer.aborted || answer.revoked) return;

      if (answer.status === 201) {
        const payment = answer.json;
        const businessDate = data.state.me ? data.state.me.business_date : null;
        let message = 'Payment sent';
        if (payment.status === 'pending_approval') message = 'Payment awaiting approval';
        else if (payment.status === 'scheduled') {
          message = 'Payment scheduled';
          if (payment.effective_date && payment.effective_date !== payment.scheduled_for) {
            message += ` Scheduled for ${effectiveDate(payment.effective_date)}`;
          }
        } else if (payment.effective_date && payment.effective_date !== businessDate) {
          message += ` Settles on ${effectiveDate(payment.effective_date)}`;
        }
        // The draft entry is replaced before the result is announced.
        router.setAddress('/payments/new', { replace: true });
        amountInput.value = '';
        memoInput.value = '';
        sendOnInput.value = '';
        recipientSelect.value = '';
        clearErrors();
        showForm();
        paintSettlement();
        announce(message);
        if (payment.status === 'posted') celebrate();
        data.refreshMoney();
        data.refreshApprovals();
        paintSourceOptions();
        sourceSelect.value = body.source_account_id;
        return;
      }

      showForm();
      if (answer.status === 404) {
        setError(recipientField, REMOVED_RECIPIENT_MESSAGE);
        announce(REMOVED_RECIPIENT_MESSAGE);
        return;
      }
      if (answer.json && answer.json.error === 'insufficient_funds') {
        setError(amountField, INSUFFICIENT_MESSAGE);
        announce(INSUFFICIENT_MESSAGE);
        return;
      }
      if (answer.json && (answer.json.error === 'quote_used' || answer.json.error === 'quote_expired')) {
        announce(QUOTE_MESSAGE);
        return;
      }
      const fields = api.fieldErrors(answer);
      if (fields) {
        const map = {
          amount_cents: amountField,
          scheduled_for: sendOnField,
          recipient_id: recipientField,
          memo: memoField,
          method: methodField,
          source_account_id: sourceField,
        };
        const copy = {
          amount_cents: sendOnInput.value ? SCHEDULED_CAP_MESSAGE : AMOUNT_MESSAGE,
          scheduled_for: DATE_MESSAGE,
          recipient_id: REMOVED_RECIPIENT_MESSAGE,
          memo: MEMO_MESSAGE,
          method: 'Choose a method',
          source_account_id: 'Choose a source account',
        };
        let first = null;
        for (const key of Object.keys(map)) {
          if (fields[key]) {
            setError(map[key], copy[key]);
            if (!first) first = map[key];
          }
        }
        if (first) {
          announce(first.error.textContent);
          first.control.focus();
        }
        return;
      }
      announce(api.isOutage(answer) ? api.OUTAGE_MESSAGE : api.SERVER_ERROR_MESSAGE);
    });

    for (const control of [sourceSelect, recipientSelect, methodSelect, amountInput, memoInput, sendOnInput]) {
      const event = control.tagName === 'SELECT' || control.type === 'date' ? 'change' : 'input';
      control.addEventListener(event, () => {
        paintSettlement();
        syncAddress();
      });
    }

    paintSettlement();
    scheduleSettlementRefresh();

    if (dropped) router.setAddress(draftAddress({ review: wantsReview }), { replace: true });

    // An address carrying step=review opens the review step only when every
    // check passes.
    if (wantsReview) {
      const result = checkDraft();
      if (result.ok) openReview(result.cents, { pushHistory: false });
      else {
        showForm();
        router.setAddress(draftAddress({ review: false }), { replace: true });
      }
    }

    const unsubscribe = data.subscribe((event) => {
      if (event.type === 'money') {
        const chosen = sourceSelect.value;
        paintSourceOptions();
        sourceSelect.value = chosen;
      }
    });
    router.onCleanup(() => {
      unsubscribe();
      if (settlementTimer) clearTimeout(settlementTimer);
    });

    return node;
  },
};
