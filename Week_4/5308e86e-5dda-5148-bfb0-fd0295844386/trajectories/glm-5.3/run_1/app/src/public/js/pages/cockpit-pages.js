// Payments list, Approvals page, Invoicing, Loans, and the placeholder pages.
import { api, ApiError, announce, el, formatDollars, formatEffectiveDate, sessionEpoch } from '../app.js';
import { Cockpit } from '../cockpit.js';
import { dollarsTextToCents } from '../app.js';

const STATUS_WORDS = {
  pending_approval: 'Awaiting approval',
  scheduled: 'Scheduled',
  posted: 'Posted',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  failed: 'Failed',
  expired: 'Expired',
};

// ---------- Payments ----------

class PaymentsPage {
  async run() {
    this.cockpit = new Cockpit({ pageName: 'payments' });
    const ok = await this.cockpit.boot();
    if (!ok) return;
    this.cockpit.anyDialogOpen = () => this.cockpit.drawerOpen || this.cockpit.avatarOpen;
    new (await import('../palette.js')).CommandPalette(this.cockpit);
    this.cockpit.body.textContent = '';
    const heading = el('div', { class: 'page-heading' });
    heading.append(el('h1', { text: 'Payments' }));
    heading.append(el('a', { class: 'button button-primary', href: '/payments/new', text: 'Send payment', role: 'button' }));
    this.cockpit.body.append(heading);
    this.listEl = el('div', { class: 'info-card panel-fade' });
    this.cockpit.body.append(this.listEl);
    await this.load();
  }

  async load() {
    const epoch = this.cockpit.epoch;
    try {
      const res = await api('GET', '/api/payments');
      if (epoch !== this.cockpit.epoch || epoch !== sessionEpoch) return;
      this.render(res.payments);
    } catch {
      this.cockpit.showOutage();
    }
  }

  render(payments) {
    this.listEl.textContent = '';
    if (payments.length === 0) {
      this.listEl.append(el('p', { class: 'feed-empty', text: 'No payments yet.' }));
      return;
    }
    for (const p of payments) {
      const row = el('div', { class: 'payment-row' });
      const main = el('div', { class: 'payment-main' });
      main.append(el('div', { class: 'approval-title', text: p.recipient_name }));
      const sub = `${p.method.toUpperCase()} · ${formatEffectiveDate(p.effective_date || p.scheduled_for || p.created_at.slice(0, 10))}`;
      main.append(el('div', { class: 'approval-sub', text: sub }));
      row.append(main);
      row.append(el('span', { class: `status-chip ${p.status}`, text: STATUS_WORDS[p.status] || p.status }));
      row.append(el('span', { class: 'payment-amount', text: formatDollars(p.amount_cents) }));
      if (p.status === 'scheduled') {
        row.append(el('button', {
          class: 'button button-danger',
          text: 'Cancel payment',
          onclick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            btn.textContent = 'Cancelling…';
            try {
              await api('POST', `/api/payments/${p.id}/cancel`);
              announce(this.cockpit.statusRegion, 'Payment cancelled');
              await this.load();
            } catch (err) {
              btn.disabled = false;
              btn.textContent = 'Cancel payment';
              if (err instanceof ApiError && err.status === 403) announce(this.cockpit.statusRegion, 'You can only cancel payments you created.');
              else if (err instanceof ApiError && err.status === 409) announce(this.cockpit.statusRegion, 'This payment can no longer be cancelled.');
              else announce(this.cockpit.statusRegion, "Tallwind can't be reached right now. Try again in a moment.");
            }
          },
        }));
      }
      this.listEl.append(row);
    }
  }
}

// ---------- Approvals ----------

class ApprovalsPage {
  async run() {
    this.cockpit = new Cockpit({ pageName: 'approvals' });
    const ok = await this.cockpit.boot();
    if (!ok) return;
    this.cockpit.anyDialogOpen = () => this.cockpit.drawerOpen || this.cockpit.avatarOpen;
    new (await import('../palette.js')).CommandPalette(this.cockpit);
    const b = this.cockpit.body;
    b.textContent = '';
    this.heading = el('h1', { id: 'approvals-heading', text: 'Approvals', tabindex: '-1' });
    b.append(this.heading);
    this.card = el('div', { class: 'approvals-card panel-fade' });
    b.append(this.card);
    this.rows = new Map();
    this.cockpit.onApprovalsRefresh = (res) => this.applyList(res.approvals);
    this.cockpit.onRefresh = async () => {
      const res = await api('GET', '/api/approvals').catch(() => null);
      if (res) this.applyList(res.approvals);
    };
    this.cockpit.startPeriodicRefresh();
    const res = await api('GET', '/api/approvals').catch(() => null);
    if (res) this.applyList(res.approvals);
    this.focusHeadingIfEmpty();
  }

  focusHeadingIfEmpty() {
    // Focus never falls to the page body.
    if (!document.activeElement || document.activeElement === document.body) {
      this.heading.focus({ preventScroll: true });
    }
  }

  applyList(approvals) {
    const seen = new Set();
    for (const a of approvals) {
      seen.add(a.id);
      if (!this.rows.has(a.id)) {
        const row = this.renderRow(a);
        this.rows.set(a.id, row);
        this.card.append(row);
      } else {
        this.updateRow(this.rows.get(a.id), a);
      }
    }
    for (const [id, row] of Array.from(this.rows.entries())) {
      if (!seen.has(id)) {
        const focused = row.contains(document.activeElement);
        row.remove();
        this.rows.delete(id);
        if (focused) this.moveFocusAfterRemoval();
      }
    }
    if (approvals.length === 0) {
      this.card.textContent = '';
      this.card.append(el('p', { class: 'feed-empty', text: 'No payments waiting for approval.' }));
      this.rows.clear();
    }
    if (this.lastCount !== undefined && this.lastCount !== approvals.length) {
      announce(this.cockpit.statusRegion, `Payments waiting for approval: ${approvals.length}`);
    }
    this.lastCount = approvals.length;
  }

  moveFocusAfterRemoval() {
    const focusables = Array.from(this.card.querySelectorAll('button[aria-label^="Approve"]'));
    if (focusables.length > 0) focusables[0].focus();
    else this.heading.focus({ preventScroll: true });
  }

  updateRow(row, a) {
    // In place: keep the element, refresh progress, names, suffixes.
    const given = a.approvals.length;
    const required = a.approvals_required;
    const progressEl = row.querySelector('[data-progress]');
    if (progressEl) progressEl.textContent = `${given} of ${required} approvals`;
    const approvedBy = row.querySelector('[data-approvedby]');
    if (approvedBy) {
      approvedBy.textContent = given > 0 ? `Approved by ${a.approvals.map(x => x.name).join(', ')}` : '';
    }
    const approveBy = row.querySelector('[data-approveby]');
    if (approveBy) approveBy.textContent = `Approve by ${formatEffectiveDate(a.approve_by)}`;
  }

  renderRow(a) {
    const row = el('div', { class: 'approval-row', dataset: { id: a.id } });
    const details = el('div', { class: 'approval-details' });
    const title = `${formatDollars(a.amount_cents)} to ${a.recipient_name}`;
    details.append(el('div', { class: 'approval-title', text: title }));
    details.append(el('div', { class: 'approval-sub', text: `${a.creator_name} · ${a.method.toUpperCase()} · from ${a.source_account_name}` }));
    details.append(el('div', { class: 'approval-progress', 'data-progress': '', text: `${a.approvals.length} of ${a.approvals_required} approvals` }));
    details.append(el('div', { class: 'approval-sub', 'data-approvedby': '', text: a.approvals.length > 0 ? `Approved by ${a.approvals.map(x => x.name).join(', ')}` : '' }));
    const approveBy = el('div', { class: 'approve-by', 'data-approveby': '' });
    approveBy.append(el('span', { 'aria-hidden': 'true', text: '⏱ ' }), el('span', { text: `Approve by ${formatEffectiveDate(a.approve_by)}` }));
    details.append(approveBy);
    row.append(details);
    const buttons = el('div', { class: 'approval-buttons' });
    this.approveBtn = el('button', { class: 'button button-primary', text: 'Approve' });
    this.rejectBtn = el('button', { class: 'button button-danger', text: 'Reject' });
    buttons.append(this.approveBtn, this.rejectBtn);
    row.append(buttons);
    this.nameButtons(row, a);
    this.approveBtn.addEventListener('click', () => this.decide(a.id, 'approve', row));
    this.rejectBtn.addEventListener('click', () => this.decide(a.id, 'reject', row));
    return row;
  }

  nameButtons(row, a) {
    // Unique names: identical triples gain a position suffix.
    const twins = this.twinsOf(a);
    const suffix = twins.length > 1 ? ` (payment ${twins.indexOf(a.id) + 1} of ${twins.length})` : '';
    const base = `$${formatDollars(a.amount_cents).slice(1)} to ${a.recipient_name} from ${a.source_account_name}`;
    const approveBtn = row.querySelector('.approval-buttons .button-primary');
    const rejectBtn = row.querySelector('.approval-buttons .button-danger');
    approveBtn.setAttribute('aria-label', `Approve ${base}${suffix}`);
    rejectBtn.setAttribute('aria-label', `Reject ${base}${suffix}`);
  }

  twinsOf(a) {
    const all = Array.from(this.rows.entries()).map(([id, row]) => {
      return this.lastApprovals?.find(x => x.id === id);
    }).filter(Boolean);
    const list = this.lastApprovals || [];
    return list.filter(x => x.amount_cents === a.amount_cents && x.recipient_name === a.recipient_name && x.source_account_name === a.source_account_name).map(x => x.id);
  }

  async decide(id, kind, row) {
    const approveBtn = row.querySelector('.approval-buttons .button-primary');
    const rejectBtn = row.querySelector('.approval-buttons .button-danger');
    const prevApprove = approveBtn.textContent;
    const prevReject = rejectBtn.textContent;
    approveBtn.disabled = true;
    rejectBtn.disabled = true;
    if (kind === 'approve') approveBtn.textContent = 'Approving…';
    else rejectBtn.textContent = 'Rejecting…';
    announce(this.cockpit.statusRegion, kind === 'approve' ? 'Approving…' : 'Rejecting…');
    try {
      const payment = await api('POST', `/api/payments/${id}/${kind}`);
      const message = this.successMessage(payment, kind);
      announce(this.cockpit.statusRegion, message);
      if (payment.status === 'pending_approval') {
        // First of two: the row stays, focus its Reject button.
        approveBtn.disabled = false;
        rejectBtn.disabled = false;
        approveBtn.textContent = prevApprove;
        rejectBtn.textContent = prevReject;
        const res = await api('GET', '/api/approvals');
        this.applyList(res.approvals);
        rejectBtn.focus();
      } else {
        this.removeRow(id);
      }
      this.cockpit.scheduleRefresh('user');
    } catch (e) {
      approveBtn.disabled = false;
      rejectBtn.disabled = false;
      approveBtn.textContent = prevApprove;
      rejectBtn.textContent = prevReject;
      if (e instanceof ApiError && e.status === 409 && e.body.error === 'already_approved') {
        announce(this.cockpit.statusRegion, "You've already approved this payment.");
        return;
      }
      if (e instanceof ApiError && e.status === 409) {
        announce(this.cockpit.statusRegion, 'This payment is no longer waiting for approval.');
        const res = await api('GET', '/api/approvals').catch(() => null);
        if (res) this.applyList(res.approvals);
        return;
      }
      if (e instanceof ApiError && e.status === 403) {
        announce(this.cockpit.statusRegion, 'You may not act on this payment.');
        return;
      }
      announce(this.cockpit.statusRegion, "Tallwind can't be reached right now. Try again in a moment.");
    }
  }

  removeRow(id) {
    const row = this.rows.get(id);
    if (!row) return;
    const nextRow = nextSiblingRow(row);
    const prevRow = prevSiblingRow(row);
    row.remove();
    this.rows.delete(id);
    const nextBtn = nextRow ? nextRow.querySelector('.approval-buttons .button-primary') : null;
    const prevBtn = prevRow ? prevRow.querySelector('.approval-buttons .button-primary') : null;
    if (nextBtn) nextBtn.focus();
    else if (prevBtn) prevBtn.focus();
    else this.heading.focus({ preventScroll: true });
  }

  successMessage(payment, kind) {
    if (kind === 'reject') return 'Payment rejected';
    if (payment.status === 'posted') {
      if (payment.effective_date && this.cockpit.me && payment.effective_date !== this.cockpit.me.business_date) {
        return `Payment approved and sent Settles on ${formatEffectiveDate(payment.effective_date)}`;
      }
      return 'Payment approved and sent';
    }
    return 'Approval recorded';
  }
}

function nextSiblingRow(row) {
  let n = row.nextElementSibling;
  while (n && !n.classList.contains('approval-row')) n = n.nextElementSibling;
  return n;
}
function prevSiblingRow(row) {
  let p = row.previousElementSibling;
  while (p && !p.classList.contains('approval-row')) p = p.previousElementSibling;
  return p;
}

// ---------- Invoicing ----------

class InvoicesPage {
  async run() {
    this.cockpit = new Cockpit({ pageName: 'invoices' });
    const ok = await this.cockpit.boot();
    if (!ok) return;
    this.cockpit.anyDialogOpen = () => this.cockpit.drawerOpen || this.cockpit.avatarOpen;
    new (await import('../palette.js')).CommandPalette(this.cockpit);
    const b = this.cockpit.body;
    b.textContent = '';
    const heading = el('div', { class: 'page-heading' });
    heading.append(el('h1', { text: 'Invoicing' }));
    b.append(heading);
    this.card = el('div', { class: 'info-card panel-fade' });
    b.append(this.card);
    await this.load();
  }

  async load() {
    const epoch = this.cockpit.epoch;
    try {
      const [res, accounts] = await Promise.all([api('GET', '/api/invoices'), api('GET', '/api/accounts')]);
      if (epoch !== this.cockpit.epoch || epoch !== sessionEpoch) return;
      this.render(res.invoices, accounts.accounts);
    } catch {
      this.cockpit.showOutage();
    }
  }

  render(invoices, accounts) {
    this.card.textContent = '';
    if (invoices.length === 0) {
      this.card.append(el('p', { class: 'feed-empty', text: 'No invoices yet.' }));
      return;
    }
    for (const inv of invoices) {
      const row = el('div', { class: 'payment-row' });
      const main = el('div', { class: 'payment-main' });
      main.append(el('div', { class: 'approval-title', text: inv.number }));
      main.append(el('div', { class: 'approval-sub', text: inv.customer_name }));
      row.append(main);
      row.append(el('span', { class: 'payment-amount', text: formatDollars(inv.total_cents) }));
      if (inv.status === 'draft') {
        row.append(el('button', {
          class: 'button button-secondary', text: 'Send invoice',
          onclick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            btn.textContent = 'Sending…';
            try {
              await api('POST', `/api/invoices/${inv.id}/send`);
              announce(this.cockpit.statusRegion, `${inv.number} sent`);
              await this.load();
            } catch (err) {
              btn.disabled = false;
              btn.textContent = 'Send invoice';
              announce(this.cockpit.statusRegion, err instanceof ApiError && err.status === 409 ? 'This invoice has already been sent.' : "Tallwind can't be reached right now. Try again in a moment.");
            }
          },
        }));
      } else if (inv.status === 'sent') {
        const canAct = this.cockpit.user.role === 'owner' || this.cockpit.user.role === 'admin';
        if (canAct) {
          const select = el('select', { class: 'input', 'aria-label': 'Deposit to' });
          for (const a of accounts) select.append(el('option', { value: a.id, text: a.name }));
          const btn = el('button', { class: 'button button-primary', text: 'Mark paid' });
          const wrapped = el('div', { class: 'approval-buttons' });
          wrapped.append(select, btn);
          btn.addEventListener('click', async () => {
            if (btn.dataset.pending) return;
            btn.dataset.pending = '1';
            btn.disabled = true;
            btn.textContent = 'Marking paid…';
            try {
              await api('POST', `/api/invoices/${inv.id}/mark-paid`, { body: { account_id: select.value } });
              announce(this.cockpit.statusRegion, `${inv.number} marked paid`);
              this.cockpit.scheduleRefresh('user');
              await this.load();
            } catch (err) {
              announce(this.cockpit.statusRegion, this.refusal(err));
            } finally {
              delete btn.dataset.pending;
              btn.disabled = false;
              btn.textContent = 'Mark paid';
            }
          });
          row.append(wrapped);
        }
      } else {
        row.append(el('span', { class: 'status-chip', text: 'Paid' }));
      }
      this.card.append(row);
    }
  }

  refusal(err) {
    if (err instanceof ApiError) {
      if (err.body && err.body.error === 'invoice_already_paid') return 'This invoice is already paid';
      if (err.body && err.body.error === 'invoice_not_sent') return 'Send this invoice before marking it paid';
      if (err.status === 503) return "Tallwind can't be reached right now. Try again in a moment.";
    }
    return 'Something went wrong. Try again.';
  }
}

// ---------- Loans ----------

class LoansPage {
  async run() {
    this.cockpit = new Cockpit({ pageName: 'loans' });
    const ok = await this.cockpit.boot();
    if (!ok) return;
    this.cockpit.anyDialogOpen = () => this.cockpit.drawerOpen || this.cockpit.avatarOpen;
    new (await import('../palette.js')).CommandPalette(this.cockpit);
    const b = this.cockpit.body;
    b.textContent = '';
    const heading = el('div', { class: 'page-heading' });
    heading.append(el('h1', { text: 'Loans' }));
    b.append(heading);
    this.grid = el('div', { class: 'cards-grid' });
    b.append(this.grid);
    await this.load();
  }

  async load() {
    const epoch = this.cockpit.epoch;
    try {
      const [loansRes, accountsRes] = await Promise.all([api('GET', '/api/loans'), api('GET', '/api/accounts')]);
      if (epoch !== this.cockpit.epoch || epoch !== sessionEpoch) return;
      const nameOf = new Map(accountsRes.accounts.map(a => [a.id, a.name]));
      this.render(loansRes.loans, nameOf);
    } catch {
      this.cockpit.showOutage();
    }
  }

  render(loans, nameOf) {
    this.grid.textContent = '';
    this.keys = new Map();
    for (const loan of loans) {
      const card = el('div', { class: 'info-card panel-fade' });
      card.append(el('h2', { text: loan.name }));
      const kv = el('dl', { class: 'kv' });
      for (const [k, v] of [['Principal', formatDollars(loan.principal_cents)], ['Drawn', formatDollars(loan.drawn_cents)], ['Remaining', formatDollars(loan.remaining_cents)], ['Funding account', nameOf.get(loan.funding_account_id) || '']]) {
        const row = el('div', {});
        row.append(el('dt', { text: k }), el('dd', { text: v }));
        kv.append(row);
      }
      card.append(kv);
      const form = el('form', { class: 'auth-form', novalidate: true });
      const amountWrap = el('div', {});
      const input = el('input', { class: 'input', 'aria-label': 'Withdrawal amount', inputMode: 'decimal', autocomplete: 'off' });
      const error = el('p', { class: 'field-error' });
      amountWrap.append(input, error);
      const btn = el('button', { class: 'button button-primary', type: 'submit', text: 'Request withdrawal' });
      form.append(amountWrap, btn);
      card.append(form);
      const state = { key: null, text: '' };
      this.keys.set(loan.id, state);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (btn.dataset.pending) return;
        const text = input.value;
        const cents = dollarsTextToCents(text);
        error.textContent = '';
        input.removeAttribute('aria-invalid');
        if (cents === null) {
          if (text.trim() === '') {
            announce(this.cockpit.statusRegion, 'Enter an amount greater than $0.00');
          } else {
            announce(this.cockpit.statusRegion, 'Enter an amount in dollars and cents, such as 12.50');
            error.textContent = 'Enter an amount in dollars and cents, such as 12.50';
            input.setAttribute('aria-invalid', 'true');
          }
          return;
        }
        if (cents <= 0) {
          announce(this.cockpit.statusRegion, 'Enter an amount greater than $0.00');
          return;
        }
        // A key belongs to one loan and one amount text; a lost answer reuses it.
        if (state.text !== text.trim()) {
          state.key = `draw_${loan.id}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
          state.text = text.trim();
        }
        btn.dataset.pending = '1';
        btn.disabled = true;
        btn.textContent = 'Requesting…';
        try {
          const loan2 = await api('POST', `/api/loans/${loan.id}/draw`, { body: { amount_cents: cents }, idempotencyKey: state.key });
          const name = nameOf.get(loan2.funding_account_id) || '';
          announce(this.cockpit.statusRegion, `$${formatDollars(cents).slice(1)} credited to ${name}`);
          state.key = null;
          state.text = '';
          this.cockpit.scheduleRefresh('user');
          await this.load();
        } catch (err) {
          if (err instanceof ApiError && err.status === 400 && err.body.error === 'exceeds_available_credit') {
            announce(this.cockpit.statusRegion, "That's more than the remaining credit");
            state.key = null;
            state.text = '';
          } else if (err instanceof ApiError && (err.status === 503 || err.status === 0)) {
            announce(this.cockpit.statusRegion, "Tallwind can't be reached right now. Try again in a moment.");
            // keep the key for a replayed answer
          } else if (err instanceof ApiError && err.status === 500) {
            announce(this.cockpit.statusRegion, 'Something went wrong. Try again.');
            // keep the key
          } else if (err instanceof ApiError && err.status === 422) {
            announce(this.cockpit.statusRegion, 'Something went wrong. Try again.');
            state.key = null;
            state.text = '';
          } else {
            announce(this.cockpit.statusRegion, "Tallwind can't be reached right now. Try again in a moment.");
          }
        } finally {
          delete btn.dataset.pending;
          btn.disabled = false;
          btn.textContent = 'Request withdrawal';
        }
      });
      this.grid.append(card);
    }
    if (loans.length === 0) {
      this.grid.append(el('p', { class: 'feed-empty', text: 'No loans yet.' }));
    }
  }
}

// ---------- Placeholder pages ----------

class PlaceholderPage {
  constructor(name) { this.name = name; }
  async run() {
    this.cockpit = new Cockpit({ pageName: this.name });
    const ok = await this.cockpit.boot();
    if (!ok) return;
    this.cockpit.anyDialogOpen = () => this.cockpit.drawerOpen || this.cockpit.avatarOpen;
    new (await import('../palette.js')).CommandPalette(this.cockpit);
    const b = this.cockpit.body;
    b.textContent = '';
    const heading = el('div', { class: 'page-heading' });
    const titles = { cards: 'Cards', 'treasury-account': 'Treasury', 'bill-pay': 'Bill Pay' };
    heading.append(el('h1', { text: titles[this.name] || this.name }));
    b.append(heading);
    const card = el('div', { class: 'info-card panel-fade' });
    const companyName = this.cockpit.user ? companyDisplayName(this.cockpit) : '';
    card.append(el('p', { text: `Nothing here yet for ${companyName}.` }));
    b.append(card);
  }
}

function companyDisplayName(cockpit) {
  // The signed-in user's company name, from /api/me's company context. The
  // API does not expose the name directly, so the page asks the accounts
  // endpoint only for ids; the display name comes from the session's user.
  return cockpit.user ? (cockpit.user.name || 'your company') : 'your company';
}

export { PaymentsPage, ApprovalsPage, InvoicesPage, LoansPage, PlaceholderPage };
