// Recipients list and the add-recipient form.
import { api, ApiError, announce, el, sessionEpoch } from '../app.js';
import { Cockpit, trapFocus } from '../cockpit.js';

class RecipientsPage {
  constructor() {}

  async run() {
    this.cockpit = new Cockpit({ pageName: 'recipients' });
    const ok = await this.cockpit.boot();
    if (!ok) return;
    this.cockpit.anyDialogOpen = () => this.cockpit.drawerOpen || this.cockpit.avatarOpen || this.dialogOpen;
    new (await import('../palette.js')).CommandPalette(this.cockpit);
    this.cockpit.body.textContent = '';
    const heading = el('div', { class: 'page-heading' });
    heading.append(el('h1', { text: 'Recipients' }));
    heading.append(el('a', { class: 'button button-primary', href: '/payments/recipients/new', text: 'Add recipient', role: 'button' }));
    this.cockpit.body.append(heading);
    this.listEl = el('div', { class: 'info-card panel-fade' });
    this.cockpit.body.append(this.listEl);
    await this.load();
  }

  async load() {
    const epoch = this.cockpit.epoch;
    try {
      const res = await api('GET', '/api/recipients');
      if (epoch !== this.cockpit.epoch || epoch !== sessionEpoch) return;
      this.render(res.recipients);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      this.cockpit.showOutage();
    }
  }

  render(recipients) {
    this.listEl.textContent = '';
    if (recipients.length === 0) {
      this.listEl.append(el('p', { class: 'feed-empty', text: 'No recipients yet.' }));
      return;
    }
    for (const r of recipients) {
      const row = el('div', { class: 'approval-row' });
      const main = el('div', { class: 'approval-details' });
      main.append(el('div', { class: 'approval-title', text: r.display_name }));
      const sub = r.status === 'pending'
        ? 'Invite pending'
        : `${r.kind === 'person' ? 'Person' : 'Business'} · ${r.account_last4 ? `Checking ${r.account_last4}` : ''} · ${(r.method || '').toUpperCase()}`;
      main.append(el('div', { class: 'approval-sub', text: sub }));
      row.append(main);
      const canRemove = this.cockpit.user.role === 'owner' || this.cockpit.user.role === 'admin';
      if (canRemove) {
        row.append(el('button', {
          class: 'button button-danger',
          text: `Remove ${r.display_name}`,
          'aria-label': `Remove ${r.display_name}`,
          onclick: (e) => this.confirmRemove(r, e.currentTarget),
        }));
      }
      this.listEl.append(row);
    }
  }

  confirmRemove(recipient, opener) {
    this.dialogOpen = true;
    const backdrop = el('div', { class: 'dialog-backdrop' });
    const dialog = el('div', { class: 'dialog', role: 'dialog', 'aria-label': 'Remove recipient' });
    dialog.append(el('h2', { text: 'Remove recipient' }));
    dialog.append(el('p', { text: `${recipient.display_name} will no longer appear in Recipients or Send payment. Past payments keep its name.` }));
    const actions = el('div', { class: 'dialog-actions' });
    const keep = el('button', { class: 'button button-secondary', text: 'Keep' });
    const remove = el('button', { class: 'button button-danger', text: 'Remove' });
    actions.append(keep, remove);
    dialog.append(actions);
    backdrop.append(dialog);
    document.body.append(backdrop);
    keep.focus();
    const close = () => {
      this.dialogOpen = false;
      trap.off();
      backdrop.remove();
      opener.focus();
    };
    keep.addEventListener('click', close);
    const trap = trapFocus(dialog, close, opener);
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      remove.textContent = 'Removing…';
      try {
        await api('DELETE', `/api/recipients/${recipient.id}`);
        announce(this.cockpit.statusRegion, 'Recipient removed');
        close();
        await this.load();
        const add = document.querySelector('.page-heading a[href="/payments/recipients/new"]');
        if (add) add.focus();
      } catch (e) {
        remove.disabled = false;
        remove.textContent = 'Remove';
        close();
        if (e instanceof ApiError && e.status === 409) {
          announce(this.cockpit.statusRegion, 'This recipient has a payment waiting for approval.');
        } else if (e instanceof ApiError && e.status === 503) {
          announce(this.cockpit.statusRegion, "Tallwind can't be reached right now. Try again in a moment.");
        } else if (e instanceof ApiError && e.status === 500) {
          announce(this.cockpit.statusRegion, 'Something went wrong. Try again.');
        }
        opener.focus();
      }
    });
  }
}

class RecipientsNewPage {
  async run() {
    this.cockpit = new Cockpit({ pageName: 'recipients-new' });
    const ok = await this.cockpit.boot();
    if (!ok) return;
    this.cockpit.anyDialogOpen = () => this.cockpit.drawerOpen || this.cockpit.avatarOpen;
    new (await import('../palette.js')).CommandPalette(this.cockpit);
    this.build();
    await this.loadRecipients();
  }

  build() {
    const b = this.cockpit.body;
    b.textContent = '';
    const heading = el('div', { class: 'page-heading' });
    heading.append(el('h1', { text: 'Add recipient' }));
    b.append(heading);
    const grid = el('div', { class: 'cards-grid' });
    const formCard = el('div', { class: 'info-card panel-fade' });
    this.form = el('form', { class: 'auth-form', novalidate: true });
    this.nameField = field('Display name', 'text', 'display_name');
    this.kindField = selectField('Kind', 'kind', ['Business', 'Person'], 'business');
    this.methodField = selectField('Method', 'method', ['ACH', 'Wire', 'RTP', 'Check'], 'ach');
    this.accountField = field('Account number', 'text', 'account_number', { inputMode: 'numeric' });
    this.routingField = field('Routing number', 'text', 'routing_number', { inputMode: 'numeric' });
    this.saveButton = el('button', { class: 'button button-primary', type: 'submit', text: 'Save recipient' });
    this.form.append(this.nameField.wrap, this.kindField.wrap, this.methodField.wrap, this.accountField.wrap, this.routingField.wrap, this.saveButton);
    this.form.addEventListener('submit', (e) => { e.preventDefault(); this.save(); });
    formCard.append(this.form);
    grid.append(formCard);
    const inviteCard = el('div', { class: 'info-card panel-fade' });
    inviteCard.append(el('h2', { text: 'Invite by email' }));
    this.inviteForm = el('form', { class: 'auth-form', novalidate: true });
    this.inviteField = field('Recipient email', 'email', 'email');
    this.inviteButton = el('button', { class: 'button button-secondary', type: 'submit', text: 'Send invite' });
    this.inviteForm.append(this.inviteField.wrap, this.inviteButton);
    this.inviteForm.addEventListener('submit', (e) => { e.preventDefault(); this.invite(); });
    inviteCard.append(this.inviteForm);
    grid.append(inviteCard);
    b.append(grid);
  }

  async loadRecipients() {
    try {
      const res = await api('GET', '/api/recipients');
      this.recipients = res.recipients;
    } catch { this.recipients = []; }
  }

  clearErrors() {
    for (const f of [this.nameField, this.kindField, this.methodField, this.accountField, this.routingField]) {
      f.input.removeAttribute('aria-invalid');
      f.input.removeAttribute('aria-describedby');
      f.error.textContent = '';
    }
  }

  failField(f, message) {
    f.input.setAttribute('aria-invalid', 'true');
    f.error.id = f.error.id || `err-${f.input.name}`;
    f.input.setAttribute('aria-describedby', f.error.id);
    f.error.textContent = message;
  }

  firstFailing() {
    const order = [this.nameField, this.kindField, this.methodField, this.accountField, this.routingField];
    return order.find(f => f.input.getAttribute('aria-invalid') === 'true');
  }

  async save() {
    if (this.saving) return;
    this.saving = true;
    this.clearErrors();
    this.saveButton.disabled = true;
    this.saveButton.textContent = 'Saving…';
    const body = {
      display_name: this.nameField.input.value,
      kind: this.kindField.input.value,
      method: this.methodField.input.value,
      account_number: this.accountField.input.value,
      routing_number: this.routingField.input.value,
    };
    let bad = null;
    const name = body.display_name.trim();
    if (name === '') { this.failField(this.nameField, 'Enter a name of up to 120 characters'); bad = bad || this.nameField; }
    else {
      const cps = Array.from(name).length;
      if (cps > 120) { this.failField(this.nameField, 'Enter a name of up to 120 characters'); bad = bad || this.nameField; }
      else if (hasBadControl(name)) { this.failField(this.nameField, 'Remove control or direction characters from this name'); bad = bad || this.nameField; }
    }
    if (!/^[0-9]{4,17}$/.test(body.account_number.trim())) { this.failField(this.accountField, 'Enter 4 to 17 digits'); bad = bad || this.accountField; }
    if (!abaOk(body.routing_number.trim())) { this.failField(this.routingField, 'Enter a valid 9-digit routing number'); bad = bad || this.routingField; }
    if (bad) {
      this.saving = false;
      this.saveButton.disabled = false;
      this.saveButton.textContent = 'Save recipient';
      bad.input.focus();
      return;
    }
    try {
      await api('POST', '/api/recipients', { body });
      announce(this.cockpit.statusRegion, 'Recipient saved');
      window.location.href = '/payments/recipients';
    } catch (e) {
      this.saving = false;
      this.saveButton.disabled = false;
      this.saveButton.textContent = 'Save recipient';
      if (e instanceof ApiError && e.status === 400 && e.body.fields) {
        const fields = e.body.fields;
        let first = null;
        const map = {
          display_name: [this.nameField, msgFor(fields.display_name)],
          kind: [this.kindField, msgFor(fields.kind)],
          method: [this.methodField, msgFor(fields.method)],
          account_number: [this.accountField, 'Enter 4 to 17 digits'],
          routing_number: [this.routingField, 'Enter a valid 9-digit routing number'],
        };
        for (const key of Object.keys(fields)) {
          const entry = map[key];
          if (entry) {
            this.failField(entry[0], entry[1]);
            first = first || entry[0];
          }
        }
        if (fields.display_name && fields.display_name.includes('control')) {
          this.failField(this.nameField, 'Remove control or direction characters from this name');
        }
        if (first) first.input.focus();
      } else if (e instanceof ApiError && e.status === 409 && e.body.error === 'duplicate_recipient') {
        this.failField(this.accountField, `This recipient is already saved as ${e.body.display_name}.`);
        announce(this.cockpit.statusRegion, `This recipient is already saved as ${e.body.display_name}.`);
        this.accountField.input.focus();
      } else if (e instanceof ApiError && e.status === 503) {
        announce(this.cockpit.statusRegion, "Tallwind can't be reached right now. Try again in a moment.");
      } else if (e instanceof ApiError && e.status === 500) {
        announce(this.cockpit.statusRegion, 'Something went wrong. Try again.');
      }
    }
  }

  async invite() {
    if (this.inviting) return;
    this.inviting = true;
    this.inviteButton.disabled = true;
    this.inviteButton.textContent = 'Sending invite…';
    const email = this.inviteField.input.value;
    try {
      await api('POST', '/api/recipients/invite', { body: { email } });
      announce(this.cockpit.statusRegion, `Invite sent to ${email.trim().toLowerCase()}`);
      this.inviteField.input.value = '';
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        this.failField(this.inviteField, 'An invite to this email is already pending.');
        announce(this.cockpit.statusRegion, 'An invite to this email is already pending.');
        this.inviteField.input.focus();
      } else if (e instanceof ApiError && e.status === 400) {
        this.failField(this.inviteField, 'Enter a valid email');
        this.inviteField.input.focus();
      } else if (e instanceof ApiError && e.status === 503) {
        announce(this.cockpit.statusRegion, "Tallwind can't be reached right now. Try again in a moment.");
      }
    } finally {
      this.inviting = false;
      this.inviteButton.disabled = false;
      this.inviteButton.textContent = 'Send invite';
    }
  }
}

function field(labelText, type, name, attrs = {}) {
  const wrap = el('div', {});
  const label = el('label', { for: name, text: labelText });
  const input = el('input', { class: 'input', type, id: name, name, autocomplete: 'off', ...attrs });
  const error = el('p', { class: 'field-error', 'aria-live': 'polite' });
  wrap.append(label, input, error);
  return { wrap, input, error, label };
}

function selectField(labelText, name, options, selected) {
  const wrap = el('div', {});
  const label = el('label', { for: name, text: labelText });
  const input = el('select', { class: 'input', id: name, name });
  for (const opt of options) {
    const value = opt.toLowerCase();
    const o = el('option', { value, text: opt });
    if (value === selected) o.setAttribute('selected', 'selected');
    input.append(o);
  }
  const error = el('p', { class: 'field-error' });
  wrap.append(label, input, error);
  return { wrap, input, error };
}

function hasBadControl(s) {
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c <= 0x1f || c === 0x7f) return true;
    if (c >= 0x202a && c <= 0x202e) return true;
    if (c >= 0x2066 && c <= 0x2069) return true;
  }
  return false;
}

function abaOk(routing) {
  if (!/^[0-9]{9}$/.test(routing)) return false;
  const d = routing.split('').map(Number);
  return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])) % 10 === 0;
}

function msgFor(msg) {
  if (!msg) return 'Enter a valid value';
  return String(msg);
}

export { RecipientsPage, RecipientsNewPage };
