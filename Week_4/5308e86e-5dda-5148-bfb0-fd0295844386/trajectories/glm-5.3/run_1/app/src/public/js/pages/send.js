// Send payment: draft in the address, review step, server-decided settlement.
import { api, ApiError, announce, el, formatDollars, formatEffectiveDate, sessionEpoch } from '../app.js';
import { Cockpit } from '../cockpit.js';
import { dollarsTextToCents } from '../app.js';

const THRESHOLD = 500000;

class SendPaymentPage {
  constructor() {
    this.step = 'form';
    this.idempotencyKey = null;
  }

  draftFromAddress() {
    const q = new URLSearchParams(window.location.search);
    return {
      source: q.get('source') || '',
      recipient: q.get('recipient') || '',
      method: q.get('method') || 'ach',
      amount: q.get('amount') || '',
      memo: q.get('memo') || '',
      send_on: q.get('send_on') || '',
      step: q.get('step') || '',
    };
  }

  addressForDraft(d) {
    const q = new URLSearchParams();
    if (d.source) q.set('source', d.source);
    if (d.recipient) q.set('recipient', d.recipient);
    if (d.method && d.method !== 'ach') q.set('method', d.method);
    if (d.amount) q.set('amount', d.amount);
    if (d.memo) q.set('memo', d.memo);
    if (d.send_on) q.set('send_on', d.send_on);
    if (this.step === 'review') q.set('step', 'review');
    const s = q.toString();
    return s ? `/payments/new?${s}` : '/payments/new';
  }

  async run() {
    this.cockpit = new Cockpit({ pageName: 'send-payment' });
    const ok = await this.cockpit.boot();
    if (!ok) return;
    this.cockpit.anyDialogOpen = () => this.cockpit.drawerOpen || this.cockpit.avatarOpen;
    new (await import('../palette.js')).CommandPalette(this.cockpit);
    await this.loadRecipients();
    this.build();
    this.applyAddressDraft();
    await this.loadMe();
    this.watchSettlement();
    window.addEventListener('popstate', () => {
      this.step = 'form';
      this.applyAddressDraft();
      this.render();
    });
  }

  async loadRecipients() {
    try {
      const res = await api('GET', '/api/recipients');
      this.recipients = res.recipients.filter(r => r.status === 'active');
    } catch { this.recipients = []; }
  }

  async loadMe() {
    try {
      this.me = await api('GET', '/api/me');
      this.updateSettlement();
      this.maybeOpenReviewFromAddress();
    } catch { this.me = null; }
  }

  watchSettlement() {
    // A timer that counts elapsed time rather than reading the wall clock.
    if (this.settleTimer) clearTimeout(this.settleTimer);
    if (!this.me) return;
    const changeAt = Date.parse(this.me.settlement_dates_change_at);
    if (!Number.isFinite(changeAt)) return;
    const wait = Math.max(0, changeAt - Date.now());
    this.settleTimer = setTimeout(async () => {
      if (this.epoch !== this.cockpit.epoch) return;
      await this.loadMe();
      this.watchSettlement();
    }, Math.min(wait + 500, 3600000));
  }

  build() {
    const b = this.cockpit.body;
    b.textContent = '';
    const heading = el('div', { class: 'page-heading' });
    heading.append(el('h1', { text: 'Send payment' }));
    b.append(heading);
    this.formCard = el('div', { class: 'info-card panel-fade' });
    this.formWrap = el('div', {});
    this.reviewWrap = el('div', { hidden: true });
    this.formCard.append(this.formWrap, this.reviewWrap);
    b.append(this.formCard);
    this.buildForm();
  }

  buildForm() {
    this.formWrap.textContent = '';
    const form = el('form', { class: 'auth-form', novalidate: true });
    this.sourceSelect = el('select', { class: 'input', id: 'source', name: 'source_account' });
    form.append(labelled('Source account', this.sourceSelect));
    this.recipientSelect = el('select', { class: 'input', id: 'recipient', name: 'recipient' });
    for (const r of this.recipients) {
      this.recipientSelect.append(el('option', { value: r.id, text: r.display_name }));
    }
    form.append(labelled('Recipient', this.recipientSelect));
    this.methodSelect = el('select', { class: 'input', id: 'method', name: 'method' });
    for (const m of ['ACH', 'Wire', 'RTP', 'Check']) {
      this.methodSelect.append(el('option', { value: m.toLowerCase(), text: m }));
    }
    form.append(labelled('Method', this.methodSelect));
    this.settlementLine = el('p', { class: 'settlement-line' });
    this.settlementLine.append(clockGlyph(), el('span', { text: 'Settles —' }));
    form.append(this.settlementLine);
    this.amountInput = el('input', { class: 'input', id: 'amount', name: 'amount', autocomplete: 'off', inputMode: 'decimal' });
    this.amountError = el('p', { class: 'field-error' });
    form.append(labelled('Amount', this.amountInput), this.amountError);
    this.memoInput = el('input', { class: 'input', id: 'memo', name: 'memo', autocomplete: 'off' });
    this.memoError = el('p', { class: 'field-error' });
    form.append(labelled('Memo', this.memoInput), this.memoError);
    this.sendOnInput = el('input', { class: 'input', type: 'date', id: 'send_on', name: 'send_on' });
    this.sendOnError = el('p', { class: 'field-error' });
    form.append(labelled('Send on', this.sendOnInput), this.sendOnError);
    this.reviewButton = el('button', { class: 'button button-primary', type: 'submit', text: 'Review payment' });
    form.append(this.reviewButton);
    form.addEventListener('submit', (e) => { e.preventDefault(); this.review(); });
    for (const input of [this.sourceSelect, this.recipientSelect, this.methodSelect, this.amountInput, this.memoInput, this.sendOnInput]) {
      input.addEventListener('change', () => this.draftChanged());
      input.addEventListener('input', () => this.draftChanged(false));
    }
    this.formWrap.append(form);
    this.sourceSelect.textContent = '';
    for (const a of this.cockpit.accounts) {
      this.sourceSelect.append(el('option', { value: a.id, text: `${a.name} — ${formatDollars(a.available_cents)} available` }));
    }
  }

  buildReview() {
    this.reviewWrap.textContent = '';
    const summary = el('div', { class: 'review-summary kv' });
    const account = this.cockpit.accounts.find(a => a.id === this.draft.source);
    const recipient = this.recipients.find(r => r.id === this.draft.recipient);
    const cents = dollarsTextToCents(this.draft.amount);
    const rows = [
      ['Source account', account ? account.name : ''],
      ['Recipient', recipient ? recipient.display_name : ''],
      ['Method', this.draft.method.toUpperCase()],
      ['Amount', cents !== null ? formatDollars(cents) : this.draft.amount],
    ];
    for (const [k, v] of rows) {
      const row = el('div', {});
      row.append(el('dt', { text: k }), el('dd', { text: v }));
      summary.append(row);
    }
    this.reviewSettlementLine = el('p', { class: 'settlement-line' });
    this.reviewSettlementLine.append(clockGlyph(), el('span', { text: '' }));
    if (!this.draft.send_on) summary.append(this.reviewSettlementLine);
    else {
      const row = el('div', {});
      row.append(el('dt', { text: 'Send on' }), el('dd', { text: formatEffectiveDate(this.draft.send_on) }));
      summary.append(row);
    }
    const actions = el('div', { class: 'dialog-actions', style: 'margin-top:20px' });
    const back = el('button', { class: 'button button-secondary', text: 'Back', type: 'button', onclick: () => history.back() });
    this.confirmButton = el('button', { class: 'button button-primary', text: 'Confirm and send', type: 'button', onclick: () => this.confirm() });
    actions.append(back, this.confirmButton);
    this.reviewWrap.append(summary, actions);
  }

  applyAddressDraft() {
    const d = this.draftFromAddress();
    const ownAccounts = new Set(this.cockpit.accounts.map(a => a.id));
    const ownRecipients = new Set(this.recipients.map(r => r.id));
    let changed = false;
    if (d.source && !ownAccounts.has(d.source)) { d.source = ''; changed = true; }
    if (d.recipient && !ownRecipients.has(d.recipient)) { d.recipient = ''; changed = true; }
    if (d.method && !['ach', 'wire', 'rtp', 'check'].includes(d.method)) { d.method = 'ach'; changed = true; }
    if (d.step && d.step !== 'review') { d.step = ''; changed = true; }
    this.draft = d;
    if (changed) window.history.replaceState(null, '', this.addressForDraft(d));
    this.step = d.step === 'review' ? 'review' : 'form';
  }

  render() {
    if (this.step === 'review') {
      this.formWrap.hidden = true;
      this.reviewWrap.hidden = false;
      this.buildReview();
      this.updateSettlement();
    } else {
      this.formWrap.hidden = false;
      this.reviewWrap.hidden = true;
      this.sourceSelect.value = this.draft.source || (this.cockpit.accounts[0] && this.cockpit.accounts[0].id) || '';
      this.recipientSelect.value = this.draft.recipient || (this.recipients[0] && this.recipients[0].id) || '';
      this.methodSelect.value = this.draft.method || 'ach';
      this.amountInput.value = this.draft.amount;
      this.memoInput.value = this.draft.memo;
      this.sendOnInput.value = this.draft.send_on;
      this.updateSettlement();
    }
  }

  draftChanged(push = false) {
    const d = {
      source: this.sourceSelect.value,
      recipient: this.recipientSelect.value,
      method: this.methodSelect.value,
      amount: this.amountInput.value,
      memo: this.memoInput.value,
      send_on: this.sendOnInput.value,
    };
    this.draft = { ...this.draft, ...d };
    this.updateSettlement();
    // Typing replaces the current history entry in place.
    window.history.replaceState(null, '', this.addressForDraft(this.draft));
  }

  updateSettlement() {
    if (!this.me) return;
    const text = this.settlementText();
    if (this.settlementLine) this.settlementLine.lastChild.textContent = text;
    if (this.reviewSettlementLine) this.reviewSettlementLine.lastChild.textContent = text;
  }

  settlementText() {
    if (this.draft.send_on) return '';
    const cents = dollarsTextToCents(this.draft.amount);
    if (cents !== null && cents > THRESHOLD) return 'Settles once approved';
    const date = this.me.settlement_dates[this.draft.method || 'ach'];
    return `Settles ${formatEffectiveDate(date)}`;
  }

  clearErrors() {
    for (const e of [this.amountError, this.memoError, this.sendOnError]) e.textContent = '';
    for (const i of [this.amountInput, this.memoInput, this.sendOnInput]) {
      i.removeAttribute('aria-invalid');
      i.removeAttribute('aria-describedby');
    }
  }

  fail(input, error, message) {
    error.id = error.id || `err-${input.name}`;
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', error.id);
    error.textContent = message;
  }

  review() {
    this.clearErrors();
    const d = this.draft;
    const cents = dollarsTextToCents(d.amount);
    if (cents === null) {
      if (d.amount.trim() === '') this.fail(this.amountInput, this.amountError, 'Enter an amount greater than $0.00');
      else this.fail(this.amountInput, this.amountError, 'Enter an amount in dollars and cents, such as 12.50');
      this.amountInput.focus();
      return;
    }
    if (cents <= 0) {
      this.fail(this.amountInput, this.amountError, 'Enter an amount greater than $0.00');
      this.amountInput.focus();
      return;
    }
    const memo = d.memo.trim();
    if (memo.length > 140) {
      this.fail(this.memoInput, this.memoError, 'Keep the memo to 140 characters of plain text');
      this.memoInput.focus();
      return;
    }
    if (!d.send_on) {
      const account = this.cockpit.accounts.find(a => a.id === d.source);
      if (account && cents > account.available_cents) {
        this.fail(this.amountInput, this.amountError, "You don't have enough in this account");
        this.amountInput.focus();
        return;
      }
    }
    if (d.send_on && this.me && d.send_on <= this.me.business_date) {
      this.fail(this.sendOnInput, this.sendOnError, 'Choose a date after today');
      this.sendOnInput.focus();
      return;
    }
    this.step = 'review';
    this.draft.step = 'review';
    window.history.pushState(null, '', this.addressForDraft(this.draft));
    this.render();
    this.confirmButton.focus();
  }

  maybeOpenReviewFromAddress() {
    if (this.step !== 'review') return;
    // Run the checks once GET /api/me has answered; reopen only when they pass.
    const saved = this.step;
    this.step = 'form';
    try {
      this.reviewChecksOnly();
      this.step = 'review';
      this.render();
    } catch {
      this.step = 'form';
      this.draft.step = '';
      window.history.replaceState(null, '', this.addressForDraft(this.draft));
      this.render();
      this.reviewChecksOnly();
    }
  }

  reviewChecksOnly() {
    this.clearErrors();
    const d = this.draft;
    const cents = dollarsTextToCents(d.amount);
    if (cents === null || cents <= 0) {
      this.fail(this.amountInput, this.amountError, cents === null && d.amount.trim() !== '' ? 'Enter an amount in dollars and cents, such as 12.50' : 'Enter an amount greater than $0.00');
      throw new Error('amount');
    }
    if ((d.memo || '').trim().length > 140) {
      this.fail(this.memoInput, this.memoError, 'Keep the memo to 140 characters of plain text');
      throw new Error('memo');
    }
    if (!d.send_on) {
      const account = this.cockpit.accounts.find(a => a.id === d.source);
      if (account && cents > account.available_cents) {
        this.fail(this.amountInput, this.amountError, "You don't have enough in this account");
        throw new Error('funds');
      }
    }
    if (d.send_on && this.me && d.send_on <= this.me.business_date) {
      this.fail(this.sendOnInput, this.sendOnError, 'Choose a date after today');
      throw new Error('date');
    }
  }

  newKey() {
    this.idempotencyKey = `pay_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  }

  async confirm() {
    if (this.sending) return;
    this.sending = true;
    if (!this.idempotencyKey) this.newKey();
    this.confirmButton.disabled = true;
    this.confirmButton.textContent = 'Sending…';
    const d = this.draft;
    const cents = dollarsTextToCents(d.amount);
    const body = {
      source_account_id: d.source,
      recipient_id: d.recipient,
      method: d.method,
      amount_cents: cents,
    };
    if (d.memo) body.memo = d.memo.trim();
    if (d.send_on) body.scheduled_for = d.send_on;
    try {
      const payment = await api('POST', '/api/payments', { body, idempotencyKey: this.idempotencyKey });
      const message = this.successMessage(payment);
      window.history.replaceState(null, '', '/payments/new');
      announce(this.cockpit.statusRegion, message);
      this.cockpit.scheduleRefresh('user');
      window.location.href = '/app';
    } catch (e) {
      this.sending = false;
      this.confirmButton.disabled = false;
      this.confirmButton.textContent = 'Confirm and send';
      if (e instanceof ApiError && e.status === 401) {
        // The session was revoked; the login page carries the draft address.
        setTokenEmpty();
        window.location.replace(`/login?next=${encodeURIComponent(this.addressForDraft({ ...this.draft, step: 'review' }))}`);
        return;
      }
      if (e instanceof ApiError && e.status === 400 && e.body.error === 'insufficient_funds') {
        this.step = 'form';
        this.draft.step = '';
        window.history.replaceState(null, '', this.addressForDraft(this.draft));
        this.render();
        this.fail(this.amountInput, this.amountError, "You don't have enough in this account");
        announce(this.cockpit.statusRegion, "You don't have enough in this account");
        this.amountInput.focus();
        return;
      }
      const refusal = refusalMessage(e);
      announce(this.cockpit.statusRegion, refusal);
      if (e instanceof ApiError && e.status === 409 && (e.body.error === 'quote_used' || e.body.error === 'quote_expired')) {
        this.step = 'form';
        this.render();
      }
    }
  }

  successMessage(payment) {
    const dateText = payment.effective_date ? formatEffectiveDate(payment.effective_date) : '';
    if (payment.status === 'posted') {
      if (payment.effective_date && this.me && payment.effective_date !== this.me.business_date) {
        return `Payment sent Settles on ${dateText}`;
      }
      return 'Payment sent';
    }
    if (payment.status === 'pending_approval') return 'Payment awaiting approval';
    if (payment.status === 'scheduled') {
      if (payment.effective_date && payment.scheduled_for && payment.effective_date !== payment.scheduled_for) {
        return `Payment scheduled Scheduled for ${dateText}`;
      }
      return 'Payment scheduled';
    }
    return 'Payment sent';
  }
}

function labelled(text, input) {
  const wrap = el('div', {});
  wrap.append(el('label', { for: input.id, text }), input);
  return wrap;
}

function clockGlyph() {
  const span = el('span', { 'aria-hidden': 'true', text: '⏱ ' });
  return span;
}

function refusalMessage(e) {
  if (e instanceof ApiError) {
    if (e.status === 503) return "Tallwind can't be reached right now. Try again in a moment.";
    if (e.status === 500) return 'Something went wrong. Try again.';
    if (e.body && e.body.error === 'quote_used') return 'This quote is no longer available. Get a new quote.';
    if (e.body && e.body.error === 'quote_expired') return 'This quote is no longer available. Get a new quote.';
    if (e.body && e.body.error === 'idempotency_key_reused') return 'Something went wrong. Try again.';
  }
  return 'Something went wrong. Try again.';
}

function setTokenEmpty() {
  try { localStorage.removeItem('tallwind_token'); } catch { /* unavailable */ }
}

new SendPaymentPage().run();
