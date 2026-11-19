// Recipients: saved by keyboard, shown by their last four digits, removed
// through a confirmation dialog without rewriting history.

import { el, clear, setBusy, clearBusy, isBusy } from '../dom.js';
import * as api from '../api.js';
import * as router from '../router.js';
import * as session from '../session.js';
import { announce } from '../status.js';
import { openDialog } from './dialog.js';
import * as data from './data.js';

const METHOD_LABELS = { ach: 'ACH', wire: 'Wire', rtp: 'RTP', check: 'Check' };
const HELD_MESSAGE = 'This recipient has a payment waiting for approval.';

function describe(recipient) {
  if (recipient.status === 'pending') return 'Invite pending';
  return `Checking ${recipient.account_last4} · ${METHOD_LABELS[recipient.method] || ''}`.trim();
}

export const recipients = {
  title: 'Recipients — Tallwind',
  async render() {
    if (!data.state.me) await data.refreshMe();
    const user = session.user();
    const mayRemove = user && (user.role === 'owner' || user.role === 'admin');

    const list = el('div', { class: 'table-wrap' });
    const addLink = el('a', { class: 'pill', href: '/payments/recipients/new', text: 'Add recipient' });

    function removeDialog(recipient, trigger) {
      const keep = el('button', { type: 'button', class: 'btn btn-secondary', text: 'Keep' });
      const remove = el('button', { type: 'button', class: 'pill', text: 'Remove' });
      const content = el('div', {}, [
        el('h2', { text: 'Remove recipient' }),
        el('p', {
          text: `${recipient.display_name} will no longer appear in Recipients or Send payment. Past payments keep its name.`,
        }),
        el('div', { class: 'dialog-actions' }, [keep, remove]),
      ]);
      const handle = openDialog({ label: 'Remove recipient', content, initialFocus: keep });
      keep.addEventListener('click', () => handle.close());
      remove.addEventListener('click', async () => {
        if (isBusy(remove)) return;
        setBusy(remove, 'Removing…');
        announce('Removing…');
        const answer = await api.del(`/api/recipients/${recipient.id}`);
        if (answer.aborted || answer.revoked) return;
        if (answer.status === 204) {
          handle.close({ restoreFocus: false });
          await load();
          announce('Recipient removed');
          addLink.focus();
          return;
        }
        if (answer.status === 409) {
          handle.close({ restoreFocus: false });
          announce(HELD_MESSAGE);
          const again = list.querySelector(`[data-remove="${recipient.id}"]`);
          if (again) again.focus();
          return;
        }
        clearBusy(remove);
        announce(api.isOutage(answer) ? api.OUTAGE_MESSAGE : api.SERVER_ERROR_MESSAGE);
      });
    }

    async function load() {
      const answer = await api.get('/api/recipients');
      if (answer.status !== 200) {
        if (api.isOutage(answer)) announce(api.OUTAGE_MESSAGE);
        return;
      }
      clear(list);
      const rows = answer.json.recipients;
      if (rows.length === 0) {
        list.append(el('p', { class: 'hint', style: 'padding:1rem', text: 'No recipients yet.' }));
        return;
      }
      const table = el('table', { class: 'data' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col', text: 'Recipient' }),
            el('th', { scope: 'col', text: 'Kind' }),
            el('th', { scope: 'col', text: 'Account' }),
            mayRemove ? el('th', { scope: 'col', text: 'Actions' }) : null,
          ]),
        ]),
      ]);
      const body = el('tbody');
      for (const recipient of rows) {
        const cells = [
          el('th', { scope: 'row', text: recipient.display_name }),
          el('td', { text: recipient.kind === 'person' ? 'Person' : recipient.kind === 'business' ? 'Business' : '—' }),
          el('td', { text: describe(recipient) }),
        ];
        if (mayRemove) {
          const button = el('button', {
            type: 'button',
            class: 'btn btn-secondary btn-small',
            'aria-label': `Remove ${recipient.display_name}`,
            text: 'Remove',
            dataset: { remove: recipient.id },
          });
          button.addEventListener('click', () => removeDialog(recipient, button));
          cells.push(el('td', {}, [button]));
        }
        body.append(el('tr', {}, cells));
      }
      table.append(body);
      list.append(table);
    }

    const node = el('div', {}, [
      el('div', { class: 'snapshot-head' }, [el('h1', { text: 'Recipients' }), addLink]),
      list,
    ]);
    load();
    return node;
  },
};

const FIELD_ORDER = ['display_name', 'kind', 'method', 'account_number', 'routing_number'];

export const newRecipient = {
  title: 'Add recipient — Tallwind',
  async render() {
    const controls = {};
    const errors = {};

    function entry(key, label, control) {
      const id = `recipient-${key}`;
      control.id = id;
      const error = el('span', { class: 'field-error', id: `${id}-error` });
      controls[key] = control;
      errors[key] = error;
      return el('div', { class: 'field' }, [el('label', { for: id, text: label }), control, error]);
    }

    const displayName = el('input', { type: 'text', autocomplete: 'off' });
    const kind = el('select', {}, [
      el('option', { value: 'business', text: 'Business' }),
      el('option', { value: 'person', text: 'Person' }),
    ]);
    const method = el('select', {}, Object.entries(METHOD_LABELS).map(([value, text]) => el('option', { value, text })));
    const accountNumber = el('input', { type: 'text', autocomplete: 'off', inputmode: 'numeric' });
    const routingNumber = el('input', { type: 'text', autocomplete: 'off', inputmode: 'numeric' });

    const save = el('button', { type: 'submit', class: 'pill', text: 'Save recipient' });
    const form = el('form', { novalidate: true }, [
      entry('display_name', 'Display name', displayName),
      entry('kind', 'Kind', kind),
      entry('method', 'Method', method),
      entry('account_number', 'Account number', accountNumber),
      entry('routing_number', 'Routing number', routingNumber),
      el('div', { class: 'hero-actions' }, [save]),
    ]);

    function clearErrors() {
      for (const key of FIELD_ORDER) {
        errors[key].textContent = '';
        controls[key].removeAttribute('aria-invalid');
        controls[key].removeAttribute('aria-describedby');
      }
    }

    function showErrors(fields) {
      clearErrors();
      let first = null;
      for (const key of FIELD_ORDER) {
        if (!fields[key]) continue;
        errors[key].textContent = fields[key];
        controls[key].setAttribute('aria-invalid', 'true');
        controls[key].setAttribute('aria-describedby', errors[key].id);
        if (!first) first = key;
      }
      if (first) {
        controls[first].focus();
        announce(fields[first]);
      }
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (isBusy(save)) return;
      setBusy(save, 'Saving…');
      announce('Saving…');
      const answer = await api.post('/api/recipients', {
        display_name: displayName.value,
        kind: kind.value,
        method: method.value,
        account_number: accountNumber.value,
        routing_number: routingNumber.value,
      });
      clearBusy(save);
      if (answer.aborted || answer.revoked) return;

      if (answer.status === 201) {
        clearErrors();
        router.navigate('/payments/recipients');
        announce('Recipient saved');
        return;
      }
      if (answer.status === 409 && answer.json.error === 'duplicate_recipient') {
        const message = `This recipient is already saved as ${answer.json.display_name}.`;
        showErrors({ account_number: message });
        return;
      }
      const fields = api.fieldErrors(answer);
      if (fields) {
        showErrors(fields);
        return;
      }
      announce(api.isOutage(answer) ? api.OUTAGE_MESSAGE : api.SERVER_ERROR_MESSAGE);
    });

    // ---- the invite form ----
    const inviteEmail = el('input', { type: 'email', id: 'recipient-email', autocomplete: 'off' });
    const inviteError = el('span', { class: 'field-error', id: 'recipient-email-error' });
    const inviteButton = el('button', { type: 'submit', class: 'btn btn-secondary', text: 'Send invite' });
    const inviteForm = el('form', { novalidate: true }, [
      el('div', { class: 'field' }, [
        el('label', { for: 'recipient-email', text: 'Recipient email' }),
        inviteEmail,
        inviteError,
      ]),
      el('div', { class: 'hero-actions' }, [inviteButton]),
    ]);

    inviteForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (isBusy(inviteButton)) return;
      setBusy(inviteButton, 'Sending invite…');
      announce('Sending invite…');
      const answer = await api.post('/api/recipients/invite', { email: inviteEmail.value });
      clearBusy(inviteButton);
      if (answer.aborted || answer.revoked) return;
      inviteError.textContent = '';
      inviteEmail.removeAttribute('aria-invalid');
      inviteEmail.removeAttribute('aria-describedby');
      if (answer.status === 201) {
        announce(`Invite sent to ${answer.json.recipient.email}`);
        inviteEmail.value = '';
        return;
      }
      const message =
        answer.status === 409
          ? 'An invite to this email is already pending.'
          : api.fieldErrors(answer)
          ? 'Enter a valid email'
          : null;
      if (message) {
        inviteError.textContent = message;
        inviteEmail.setAttribute('aria-invalid', 'true');
        inviteEmail.setAttribute('aria-describedby', inviteError.id);
        inviteEmail.focus();
        announce(message);
        return;
      }
      announce(api.isOutage(answer) ? api.OUTAGE_MESSAGE : api.SERVER_ERROR_MESSAGE);
    });

    return el('div', {}, [
      el('h1', { text: 'Add recipient' }),
      el('div', { class: 'grid-2' }, [
        el('div', { class: 'card' }, [el('h2', { text: 'Bank details' }), form]),
        el('div', { class: 'card' }, [
          el('h2', { text: 'Invite by email' }),
          el('p', { class: 'hint', text: 'We will ask them for their bank details.' }),
          inviteForm,
        ]),
      ]),
    ]);
  },
};
