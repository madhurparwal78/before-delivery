// Payments, Invoicing, Loans and the pages that are empty for now.

import { el, clear, setBusy, clearBusy, isBusy } from '../dom.js';
import * as api from '../api.js';
import * as session from '../session.js';
import { announce } from '../status.js';
import {
  money,
  parseDollars,
  effectiveDate,
  PAYMENT_STATUS_WORDS,
  METHOD_LABELS,
  DOLLAR_FORMAT_MESSAGE,
  AMOUNT_MESSAGE,
} from '../format.js';
import * as data from './data.js';

export const payments = {
  title: 'Payments — Tallwind',
  async render() {
    const wrap = el('div', { class: 'table-wrap' });

    async function load() {
      const answer = await api.get('/api/payments');
      if (answer.status !== 200) {
        if (api.isOutage(answer)) announce(api.OUTAGE_MESSAGE);
        return;
      }
      clear(wrap);
      const rows = answer.json.payments;
      if (rows.length === 0) {
        wrap.append(el('p', { class: 'hint', style: 'padding:1rem', text: 'No payments yet.' }));
        return;
      }
      const body = el('tbody');
      for (const payment of rows) {
        const cells = [
          el('th', { scope: 'row', text: payment.recipient_name }),
          el('td', { class: 'mono', text: money(payment.amount_cents) }),
          el('td', { text: METHOD_LABELS[payment.method] }),
          el('td', { text: PAYMENT_STATUS_WORDS[payment.status] }),
          el('td', { text: payment.effective_date ? effectiveDate(payment.effective_date) : '' }),
        ];
        const actions = el('td');
        if (payment.status === 'scheduled') {
          const cancel = el('button', {
            type: 'button',
            class: 'btn btn-secondary btn-small',
            text: 'Cancel payment',
          });
          cancel.addEventListener('click', async () => {
            if (isBusy(cancel)) return;
            setBusy(cancel, 'Cancelling…');
            announce('Cancelling…');
            const result = await api.post(`/api/payments/${payment.id}/cancel`);
            if (result.aborted || result.revoked) return;
            if (result.status === 200) {
              announce('Payment cancelled');
              await load();
              data.refreshMoney();
              return;
            }
            clearBusy(cancel);
            if (result.status === 403) announce('You can only cancel payments you created.');
            else if (result.status === 409) announce('This payment can no longer be cancelled.');
            else announce(api.isOutage(result) ? api.OUTAGE_MESSAGE : api.SERVER_ERROR_MESSAGE);
          });
          actions.append(cancel);
        }
        cells.push(actions);
        body.append(el('tr', {}, cells));
      }
      wrap.append(
        el('table', { class: 'data' }, [
          el('thead', {}, [
            el('tr', {}, [
              el('th', { scope: 'col', text: 'Recipient' }),
              el('th', { scope: 'col', text: 'Amount' }),
              el('th', { scope: 'col', text: 'Method' }),
              el('th', { scope: 'col', text: 'Status' }),
              el('th', { scope: 'col', text: 'Effective date' }),
              el('th', { scope: 'col', text: 'Actions' }),
            ]),
          ]),
          body,
        ])
      );
    }

    const node = el('div', {}, [el('h1', { text: 'Payments' }), wrap]);
    load();
    return node;
  },
};

export const invoices = {
  title: 'Invoicing — Tallwind',
  async render() {
    if (!data.state.accounts.length) await data.refreshMoney();
    const wrap = el('div', { class: 'table-wrap' });

    async function load() {
      const answer = await api.get('/api/invoices');
      if (answer.status !== 200) {
        if (api.isOutage(answer)) announce(api.OUTAGE_MESSAGE);
        return;
      }
      clear(wrap);
      const body = el('tbody');
      for (const invoice of answer.json.invoices) {
        const actions = el('td');
        if (invoice.status === 'sent') {
          const deposit = el(
            'select',
            { 'aria-label': 'Deposit to' },
            data.state.accounts.map((account) => el('option', { value: account.id, text: account.name }))
          );
          const markPaid = el('button', { type: 'button', class: 'btn btn-secondary btn-small', text: 'Mark paid' });
          markPaid.addEventListener('click', async () => {
            if (isBusy(markPaid)) return;
            setBusy(markPaid, 'Marking paid…');
            announce('Marking paid…');
            const result = await api.post(`/api/invoices/${invoice.id}/mark-paid`, { account_id: deposit.value });
            if (result.aborted || result.revoked) return;
            if (result.status === 200) {
              announce(`${invoice.number} marked paid`);
              await Promise.all([load(), data.refreshMoney()]);
              return;
            }
            clearBusy(markPaid);
            if (result.json && result.json.error === 'invoice_already_paid') announce('This invoice is already paid');
            else if (result.json && result.json.error === 'invoice_not_sent') announce('Send this invoice before marking it paid');
            else if (result.status === 403) announce('You may not mark invoices paid.');
            else announce(api.isOutage(result) ? api.OUTAGE_MESSAGE : api.SERVER_ERROR_MESSAGE);
          });
          actions.append(
            el('div', { class: 'approval-actions' }, [
              el('label', { class: 'visually-hidden', text: 'Deposit to' }),
              deposit,
              markPaid,
            ])
          );
        } else if (invoice.status === 'draft') {
          const send = el('button', { type: 'button', class: 'btn btn-secondary btn-small', text: 'Send invoice' });
          send.addEventListener('click', async () => {
            if (isBusy(send)) return;
            setBusy(send, 'Sending…');
            announce('Sending…');
            const result = await api.post(`/api/invoices/${invoice.id}/send`);
            if (result.aborted || result.revoked) return;
            if (result.status === 200) {
              announce(`${invoice.number} sent`);
              await load();
              return;
            }
            clearBusy(send);
            if (result.json && result.json.error === 'invoice_not_draft') announce('This invoice has already been sent.');
            else announce(api.isOutage(result) ? api.OUTAGE_MESSAGE : api.SERVER_ERROR_MESSAGE);
          });
          actions.append(send);
        } else {
          actions.append(el('span', { text: 'Paid' }));
        }
        body.append(
          el('tr', {}, [
            el('th', { scope: 'row', text: invoice.number }),
            el('td', { text: invoice.customer_name }),
            el('td', { class: 'mono', text: money(invoice.total_cents) }),
            el('td', { text: invoice.status === 'draft' ? 'Draft' : invoice.status === 'sent' ? 'Sent' : 'Paid' }),
            actions,
          ])
        );
      }
      wrap.append(
        el('table', { class: 'data' }, [
          el('thead', {}, [
            el('tr', {}, [
              el('th', { scope: 'col', text: 'Invoice' }),
              el('th', { scope: 'col', text: 'Customer' }),
              el('th', { scope: 'col', text: 'Total' }),
              el('th', { scope: 'col', text: 'Status' }),
              el('th', { scope: 'col', text: 'Actions' }),
            ]),
          ]),
          body,
        ])
      );
    }

    const node = el('div', {}, [el('h1', { text: 'Invoicing' }), wrap]);
    load();
    return node;
  },
};

export const loans = {
  title: 'Loans — Tallwind',
  async render() {
    if (!data.state.accounts.length) await data.refreshMoney();
    const container = el('div', {});

    // A withdrawal whose answer was lost is retried with its own key.
    const keys = new Map();

    function keyFor(loanId, text) {
      const entry = keys.get(loanId);
      if (entry && entry.text === text) return entry.key;
      const key = api.newIdempotencyKey();
      keys.set(loanId, { text, key });
      return key;
    }

    async function load() {
      const answer = await api.get('/api/loans');
      if (answer.status !== 200) {
        if (api.isOutage(answer)) announce(api.OUTAGE_MESSAGE);
        return;
      }
      clear(container);
      if (answer.json.loans.length === 0) {
        container.append(el('p', { class: 'hint', text: 'No credit lines yet.' }));
        return;
      }
      for (const loan of answer.json.loans) {
        container.append(loanCard(loan));
      }
    }

    function loanCard(loan) {
      const fundingAccount = data.accountById(loan.funding_account_id);
      const drawn = el('span', { class: 'mono', text: money(loan.drawn_cents) });
      const remaining = el('span', { class: 'mono', text: money(loan.remaining_cents) });
      const inputId = `withdraw-${loan.id}`;
      const input = el('input', { type: 'text', id: inputId, inputmode: 'decimal', autocomplete: 'off' });
      const error = el('span', { class: 'field-error', id: `${inputId}-error` });
      const button = el('button', { type: 'button', class: 'pill', text: 'Request withdrawal' });

      function setError(message) {
        error.textContent = message || '';
        if (message) {
          input.setAttribute('aria-invalid', 'true');
          input.setAttribute('aria-describedby', error.id);
        } else {
          input.removeAttribute('aria-invalid');
          input.removeAttribute('aria-describedby');
        }
      }

      button.addEventListener('click', async () => {
        if (isBusy(button)) return;
        setError(null);
        const text = input.value.trim();
        const parsed = parseDollars(text);
        if (!parsed.ok && parsed.reason === 'format') {
          setError(DOLLAR_FORMAT_MESSAGE);
          announce(DOLLAR_FORMAT_MESSAGE);
          input.focus();
          return;
        }
        if (!parsed.ok || parsed.cents === 0) {
          setError(AMOUNT_MESSAGE);
          announce(AMOUNT_MESSAGE);
          input.focus();
          return;
        }
        const key = keyFor(loan.id, text);
        setBusy(button, 'Requesting…');
        announce('Requesting…');
        const result = await api.post(
          `/api/loans/${loan.id}/draw`,
          { amount_cents: parsed.cents },
          { idempotencyKey: key }
        );
        clearBusy(button);
        if (result.aborted || result.revoked) return;

        if (result.status === 200) {
          keys.delete(loan.id);
          drawn.textContent = money(result.json.drawn_cents);
          remaining.textContent = money(result.json.remaining_cents);
          const accountName = (data.accountById(result.json.funding_account_id) || fundingAccount || {}).name || 'your account';
          announce(`${money(parsed.cents)} credited to ${accountName}`);
          data.refreshMoney();
          return;
        }
        if (result.json && result.json.error === 'exceeds_available_credit') {
          keys.delete(loan.id);
          const message = "That's more than the remaining credit";
          setError(message);
          announce(message);
          return;
        }
        if (result.status === 403) {
          keys.delete(loan.id);
          announce('Only an owner can draw on this line.');
          return;
        }
        if (api.isOutage(result)) {
          // The figures stay as they were and the key is kept for the next press.
          announce(api.OUTAGE_MESSAGE);
          return;
        }
        if (result.status === 500) {
          announce(api.SERVER_ERROR_MESSAGE);
          return;
        }
        keys.delete(loan.id);
        const fields = api.fieldErrors(result);
        if (fields && fields.amount_cents) {
          setError(AMOUNT_MESSAGE);
          announce(AMOUNT_MESSAGE);
          return;
        }
        announce(api.SERVER_ERROR_MESSAGE);
      });

      return el('div', { class: 'loan-card' }, [
        el('h2', { text: loan.name }),
        el('div', { class: 'loan-figures' }, [
          el('div', {}, [el('span', { class: 'snap-label', text: 'Principal' }), el('span', { class: 'mono', text: money(loan.principal_cents) })]),
          el('div', {}, [el('span', { class: 'snap-label', text: 'Drawn' }), drawn]),
          el('div', {}, [el('span', { class: 'snap-label', text: 'Remaining' }), remaining]),
          el('div', {}, [
            el('span', { class: 'snap-label', text: 'Funding account' }),
            el('span', { text: fundingAccount ? fundingAccount.name : '' }),
          ]),
        ]),
        el('div', { class: 'field' }, [
          el('label', { for: inputId, text: 'Withdrawal amount' }),
          input,
          error,
        ]),
        button,
      ]);
    }

    const node = el('div', {}, [el('h1', { text: 'Loans' }), container]);
    load();
    return node;
  },
};

function emptyPage(title) {
  return {
    title: `${title} — Tallwind`,
    async render() {
      if (!data.state.companyName) await data.refreshMe();
      const companyName = data.state.companyName;
      return el('div', {}, [
        el('h1', { text: title }),
        el('p', { text: `Nothing here yet for ${companyName}.` }),
      ]);
    },
  };
}

export const cards = emptyPage('Cards');
export const treasuryAccount = emptyPage('Treasury');
export const billPay = emptyPage('Bill Pay');
