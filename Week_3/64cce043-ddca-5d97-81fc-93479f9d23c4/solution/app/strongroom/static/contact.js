// The owner's Trusted contact screen (grant, narrow, revoke) and the Account screen (change password).
import { app } from './app.js';
import { FAILED, call, errorCode, errorMessage, failedWithoutBody, get } from './api.js';
import {
  LEVELS, LEVEL_LABEL, announce, busy, clearFieldErrors, formatRemaining, h, icon, nextId, openDialog, setText,
  showAlert, showFieldErrors,
} from './dom.js';

const GRANT_REFRESH_MS = 15000;
const DURATIONS = [['24h', '24 hours'], ['7d', '7 days'], ['30d', '30 days']];
const GRANT_LABELS = { contact_name: 'Contact name', contact_email: 'Contact email', duration: 'Duration', levels: 'Levels shown' };
const STATUS_WORD = { active: 'Active', expired: 'Expired', revoked: 'Revoked' };

export function mountContact(main) {
  let alive = true;
  let grant;
  document.title = 'Trusted contact · Strongroom Ledger';
  const updates = h('p', { class: 'ticker', role: 'status', 'aria-label': 'Grant updates' });
  const panel = h('div', { class: 'grant-panel' });
  const alerts = h('div', { class: 'alert-slot' });
  const add = h('button', { type: 'button', class: 'button button-primary', onclick: () => openGrant() }, icon('plus'), h('span', { text: 'Add trusted contact' }));
  main.replaceChildren(h('div', { class: 'screen screen-contact' },
    h('div', { class: 'pane-head' }, h('div', {}, h('h1', { class: 'page-title', text: 'Trusted contact' }),
      h('p', { class: 'lede', text: 'One person may see a masked, read-only view of your ledger, limited to the levels you choose, until a time the server sets.' }))),
    updates, alerts, h('div', { class: 'grant-body', hidden: true }, panel, h('div', { class: 'actions' }, add))));

  // ---------------------------------------------------------------- panel
  const name = h('p', { class: 'grant-name' });
  const email = h('p', { class: 'grant-email' });
  const statusWord = h('span', { class: 'status-word' });
  const remaining = h('p', { class: 'grant-remaining' });
  const levelBoxes = LEVELS.map((lv) => h('input', { type: 'checkbox', class: 'checkbox', id: `scope-${lv}`, value: lv }));
  const levelsGroup = h('fieldset', { class: 'levels' }, h('legend', { class: 'field-label', text: 'Levels shown' }),
    h('div', { class: 'levels-row' }, LEVELS.map((lv, i) => h('label', { class: 'check-row', for: levelBoxes[i].id }, levelBoxes[i], h('span', { text: LEVEL_LABEL[lv] })))));
  const narrow = h('button', { type: 'button', class: 'button button-secondary', text: 'Narrow scope', onclick: () => narrowScope() });
  const revoke = h('button', { type: 'button', class: 'button button-danger', text: 'Revoke access', onclick: () => confirmRevoke() });
  const controls = h('div', { class: 'grant-controls' }, levelsGroup, h('div', { class: 'actions' }, narrow, revoke));
  const card = h('section', { class: 'grant-card', 'aria-labelledby': 'grant-card-title' },
    h('div', { class: 'grant-card-head' }, h('h2', { class: 'section-label', id: 'grant-card-title', text: 'Most recent grant' }), statusWord),
    name, email, remaining, controls);
  const empty = h('p', { class: 'empty', text: 'No trusted contact. Add one to share a read-only view while you are away.' });

  function render(next, { keepTicks = false } = {}) {
    grant = next;
    add.hidden = Boolean(grant && grant.status === 'active');
    if (!grant) {
      panel.replaceChildren(empty);
      return;
    }
    if (panel.firstChild !== card) panel.replaceChildren(card);
    setText(name, grant.contact_name);
    setText(email, grant.contact_email);
    setText(statusWord, STATUS_WORD[grant.status]);
    statusWord.dataset.status = grant.status;
    const active = grant.status === 'active';
    remaining.hidden = !active;
    controls.hidden = !active;
    if (active) setText(remaining, `Access ends in ${formatRemaining(grant.remaining_seconds)}`);
    levelBoxes.forEach((box) => {
      const granted = grant.levels.includes(box.value);
      if (!keepTicks || !granted) box.checked = granted;
      box.disabled = !granted;
    });
  }

  async function load(options = {}) {
    const answer = await get('/api/grant', { keepalive: true });
    if (!alive || answer.status !== 200) return;
    render(answer.body.grant, options);
    main.querySelector('.grant-body').hidden = false;
  }

  async function narrowScope() {
    if (narrow.disabled) return;
    busy(narrow, true);
    alerts.replaceChildren();
    const levels = levelBoxes.filter((box) => box.checked).map((box) => box.value);
    const answer = await call('PATCH', '/api/grant', { levels });
    busy(narrow, false);
    if (answer.status === 200) {
      render(answer.body.grant);
      announce(updates, 'Scope narrowed.');
    } else if (answer.status === 401) {
      app.sessionEnded();
    } else {
      const fields = answer.body?.error?.fields;
      showAlert(alerts, fields?.levels || (failedWithoutBody(answer) ? FAILED : errorMessage(answer) || FAILED), { focus: true });
      load();
    }
  }

  function confirmRevoke() {
    const yes = h('button', { type: 'button', class: 'button button-danger', text: 'Revoke' });
    const keep = h('button', { type: 'button', class: 'button button-secondary', text: 'Keep', onclick: () => handle.close() });
    const dialogAlerts = h('div', { class: 'alert-slot' });
    const handle = openDialog({
      title: 'Revoke access?', role: 'alertdialog', opener: () => (document.contains(revoke) && !controls.hidden ? revoke : add),
      content: h('div', { class: 'dialog-form' }, h('p', { class: 'dialog-text', text: `${grant.contact_name} loses the shared view at once.` }),
        dialogAlerts, h('div', { class: 'actions' }, keep, yes)),
      initialFocus: () => keep,
    });
    yes.addEventListener('click', async () => {
      if (yes.disabled) return;
      busy(yes, true);
      const contactName = grant.contact_name;
      const answer = await call('DELETE', '/api/grant');
      if (answer.status === 200) {
        render(answer.body.grant);
        handle.close();
        announce(updates, `Access ended for ${contactName}.`);
      } else if (answer.status === 401) {
        app.sessionEnded();
      } else {
        busy(yes, false);
        showAlert(dialogAlerts, failedWithoutBody(answer) ? FAILED : errorMessage(answer) || FAILED, { focus: true });
        load();
      }
    });
  }

  function openGrant() {
    const id = nextId('grant');
    const contactName = h('input', { id: `${id}-name`, class: 'input', type: 'text', 'data-field': 'contact_name', autocomplete: 'off' });
    const contactEmail = h('input', { id: `${id}-email`, class: 'input', type: 'email', 'data-field': 'contact_email', autocomplete: 'off', spellcheck: 'false' });
    const radios = DURATIONS.map(([value, label]) => h('label', { class: 'check-row', for: `${id}-d-${value}` },
      h('input', { type: 'radio', class: 'radio', name: `${id}-duration`, id: `${id}-d-${value}`, value, checked: value === '30d' }), h('span', { text: label })));
    const duration = h('div', { class: 'radios', role: 'radiogroup', 'aria-labelledby': `${id}-duration-label`, 'data-field': 'duration', id: `${id}-duration` },
      h('span', { class: 'field-label', id: `${id}-duration-label`, text: 'Duration' }), h('div', { class: 'levels-row' }, radios));
    const boxes = LEVELS.map((lv) => h('input', { type: 'checkbox', class: 'checkbox', id: `${id}-l-${lv}`, value: lv, checked: true }));
    const levels = h('fieldset', { class: 'levels', 'data-field': 'levels', id: `${id}-levels` }, h('legend', { class: 'field-label', text: 'Levels shown' }),
      h('div', { class: 'levels-row' }, LEVELS.map((lv, i) => h('label', { class: 'check-row', for: boxes[i].id }, boxes[i], h('span', { text: LEVEL_LABEL[lv] })))));
    const submit = h('button', { type: 'submit', class: 'button button-primary', text: 'Grant access' });
    const cancel = h('button', { type: 'button', class: 'button button-secondary', text: 'Cancel', onclick: () => handle.close() });
    const summary = h('div', { class: 'summary-slot' });
    const dialogAlerts = h('div', { class: 'alert-slot' });
    const field = (input, label) => h('div', { class: 'field' }, h('label', { class: 'field-label', for: input.id, text: label }), input);
    const form = h('form', { class: 'dialog-form', novalidate: true }, summary, dialogAlerts,
      field(contactName, 'Contact name'), field(contactEmail, 'Contact email'), duration, levels, h('div', { class: 'actions' }, submit, cancel));
    const body = h('div', {}, form);
    const handle = openDialog({
      title: 'Grant access', opener: () => (add.hidden ? (controls.hidden ? null : narrow) : add), content: body,
      onClose: () => load(),
    });
    let saving = false;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (saving) return;
      saving = true;
      busy(submit, true);
      dialogAlerts.replaceChildren();
      const picked = form.querySelector('input[type=radio]:checked');
      const answer = await call('POST', '/api/grant', {
        contact_name: contactName.value, contact_email: contactEmail.value, duration: picked?.value,
        levels: boxes.filter((box) => box.checked).map((box) => box.value),
      });
      saving = false;
      busy(submit, false);
      if (answer.status === 201) {
        // The password is shown once; closing the dialog removes it from the page for good.
        const done = h('button', { type: 'button', class: 'button button-primary', text: 'Done', onclick: () => handle.close() });
        body.replaceChildren(h('div', { class: 'dialog-form' },
          h('p', { class: 'dialog-text', text: `Pass this one-time password to ${answer.body.grant.contact_name}. They choose their own password when they first sign in.` }),
          h('p', { class: 'temporary' }, `Temporary password: ${answer.body.temporary_password}`),
          h('div', { class: 'actions' }, done)));
        done.focus();
        announce(updates, `Access granted to ${answer.body.grant.contact_name}.`);
      } else if (answer.status === 401) {
        app.sessionEnded();
      } else if (answer.status === 422) {
        showFieldErrors(form, summary, answer.body.error.fields || {}, GRANT_LABELS);
      } else {
        showAlert(dialogAlerts, failedWithoutBody(answer) ? FAILED : errorMessage(answer) || FAILED, { focus: true });
      }
    });
  }

  load();
  const timer = setInterval(() => load({ keepTicks: true }), GRANT_REFRESH_MS);
  return {
    live() {
      load({ keepTicks: true });
    },
    destroy() {
      alive = false;
      clearInterval(timer);
    },
  };
}

// --------------------------------------------------------------------------- account

export function mountAccount(main) {
  document.title = 'Account · Strongroom Ledger';
  const updates = h('p', { class: 'ticker', role: 'status', 'aria-label': 'Account updates' });
  const current = h('input', { id: 'current-password', class: 'input', type: 'password', autocomplete: 'current-password', 'data-field': 'current_password' });
  const next = h('input', { id: 'new-password', class: 'input', type: 'password', autocomplete: 'new-password', 'data-field': 'new_password', 'aria-describedby': 'new-password-hint' });
  const submit = h('button', { type: 'submit', class: 'button button-primary', text: 'Change password' });
  const summary = h('div', { class: 'summary-slot' });
  const alerts = h('div', { class: 'alert-slot' });
  const form = h('form', { class: 'account-form', 'aria-label': 'Change password', novalidate: true },
    summary, alerts,
    h('div', { class: 'field' }, h('label', { class: 'field-label', for: current.id, text: 'Current password' }), current),
    h('div', { class: 'field' }, h('label', { class: 'field-label', for: next.id, text: 'New password' }), next,
      h('p', { class: 'hint', id: 'new-password-hint', text: '12 to 128 characters.' })),
    h('div', { class: 'actions' }, submit));
  main.replaceChildren(h('div', { class: 'screen screen-account' },
    h('div', { class: 'pane-head' }, h('div', {}, h('h1', { class: 'page-title', text: 'Account' }),
      h('p', { class: 'lede', text: `Signed in as ${app.me.name} (${app.me.email}). Changing your password signs out your other browsers and your trusted contact.` }))),
    updates, form));
  let saving = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving) return;
    saving = true;
    busy(submit, true);
    alerts.replaceChildren();
    const answer = await call('POST', '/api/account/password', { current_password: current.value, new_password: next.value });
    saving = false;
    busy(submit, false);
    if (answer.status === 200) {
      clearFieldErrors(form, summary);
      current.value = '';
      next.value = '';
      announce(updates, 'Password changed. Other sessions are signed out.');
    } else if (answer.status === 401) {
      app.sessionEnded();
    } else if (answer.status === 422) {
      showFieldErrors(form, summary, answer.body.error.fields || {}, { current_password: 'Current password', new_password: 'New password' });
    } else {
      clearFieldErrors(form, summary);
      showAlert(alerts, failedWithoutBody(answer) && errorCode(answer) !== 'identity_unavailable' ? FAILED : errorMessage(answer) || FAILED, { focus: true });
    }
  });
  return { live() {}, destroy() {} };
}
