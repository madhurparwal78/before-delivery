/* Trusted contact screen (grant panel) and account screen (change password). */

(() => {
  'use strict';
  const { S, api, el, $, announce, showAlert, startStream, stopStream, discardDraft,
    remainingText, showFieldErrors, clearFieldErrors, storeDraft } = window.Strongroom;
  const { LEVEL_LABEL } = window.Screens;

  async function renderContactScreen(screen) {
    screen.replaceChildren(el('div', { id: 'alerts' }));
    const wrap = el('div', { class: 'two-col' });
    const left = el('div');
    const right = el('div', { class: 'exposure-col' });

    left.appendChild(el('h1', { class: 'screen-title', text: 'Trusted contact' }));
    left.appendChild(el('div', { id: 'grant-panel-slot' }));
    left.appendChild(el('div', { id: 'grant-updates', class: 'status-line', role: 'status', 'aria-live': 'polite' }));
    left.appendChild(el('div', { id: 'exposure-updates', class: 'status-line', role: 'status', 'aria-live': 'polite' }));

    right.appendChild(el('div', { class: 'exposure-panel' }));
    wrap.append(left, right);
    screen.appendChild(wrap);

    let grant = null;
    let dialogRefOpen = false;   // refreshes never close the open dialog
    let addBtnRef = null;

    async function refresh({ keepDialog = true } = {}) {
      const { status, data } = await api('/api/grant');
      if (status !== 200) return;
      grant = data.grant;
      if (!keepDialog || !dialogRefOpen) renderPanel();
      refreshRemaining();
    }

    function renderPanel() {
      const slot = document.getElementById('grant-panel-slot');
      if (grant === null) {
        const empty = el('div', { class: 'grant-panel' });
        empty.appendChild(el('p', { class: 'empty-state', text: 'No trusted contact. Add one to share a read-only view while you are away.' }));
        const add = el('button', { type: 'button', text: 'Add trusted contact' });
        add.addEventListener('click', () => openGrantDialog(add));
        empty.appendChild(add);
        addBtnRef = add;
        slot.replaceChildren(empty);
        return;
      }
      const panel = el('div', { class: 'grant-panel' });
      panel.appendChild(el('p', {}, `${grant.contact_name} · ${grant.contact_email}`));
      const statusWord = el('p', { class: 'grant-status-word', text: statusWordFor(grant) });
      panel.appendChild(statusWord);
      const remaining = document.getElementById('grant-remaining');
      if (grant.status === 'active') {
        const line = el('p', { id: 'grant-remaining', class: 'status-line' });
        panel.appendChild(line);
        const levels = el('fieldset');
        levels.setAttribute('role', 'group');
        levels.setAttribute('aria-label', 'Levels shown');
        levels.appendChild(el('legend', { text: 'Levels shown' }));
        for (const code of ['critical', 'high', 'moderate', 'low']) {
          const row = el('label', { class: 'checkrow' });
          const cb = el('input', { type: 'checkbox', name: 'levels', value: code });
          cb.checked = grant.levels.includes(code);
          row.append(cb, el('span', { text: LEVEL_LABEL[code] }));
          levels.appendChild(row);
        }
        panel.appendChild(levels);

        const narrow = el('button', { type: 'button', text: 'Narrow scope' });
        narrow.addEventListener('click', async () => {
          const chosen = [...panel.querySelectorAll('input[name="levels"]:checked')].map((n) => n.value);
          const { status, data } = await api('/api/grant', { method: 'PATCH', body: { levels: chosen } });
          if (status === 200) {
            announce('grant-updates', 'Scope narrowed.');
            await refresh({ keepDialog: false });
          } else if (status === 401) {
            location.href = `/auth/login?next=${encodeURIComponent(location.pathname + location.search)}`;
          } else if (status === 422 || status === 409) {
            showFieldErrors(panel, (data && data.error && data.error.fields) || {});
            showAlert((data && data.error && data.error.message) || 'Something went wrong.');
          } else {
            showAlert('Something went wrong. Your change was not saved.');
          }
        });
        panel.appendChild(narrow);

        const revoke = el('button', { type: 'button', class: 'danger', text: 'Revoke access' });
        revoke.addEventListener('click', () => {
          const dlg = el('dialog', { 'aria-label': 'Revoke access?' });
          const box = el('div');
          box.appendChild(el('h2', { class: 'section-title', text: 'Revoke access?' }));
          box.appendChild(el('p', { text: `End ${grant.contact_name}'s access at once?` }));
          const actions = el('div', { class: 'form-actions' });
          const rm = el('button', { type: 'button', class: 'danger', text: 'Revoke' });
          const keep = el('button', { type: 'button', text: 'Keep' });
          actions.append(rm, keep);
          box.appendChild(actions);
          dlg.appendChild(box);
          document.body.appendChild(dlg);
          dlg.showModal();
          keep.focus();
          keep.addEventListener('click', () => { dlg.close(); dlg.remove(); revoke.focus(); });
          rm.addEventListener('click', async () => {
            rm.disabled = true;
            const { status, data } = await api('/api/grant', { method: 'DELETE' });
            dlg.close();
            dlg.remove();
            if (status === 200) {
              announce('grant-updates', `Access ended for ${data.grant.contact_name}.`);
              await refresh({ keepDialog: false });
            } else if (status === 401) {
              location.href = `/auth/login?next=${encodeURIComponent(location.pathname + location.search)}`;
            } else {
              showAlert('Something went wrong. Your change was not saved.');
            }
          });
        });
        panel.appendChild(revoke);
      } else {
        panel.appendChild(el('p', { class: 'empty-state', text: 'This grant has ended. Add a trusted contact to share a read-only view again.' }));
        const add = el('button', { type: 'button', text: 'Add trusted contact' });
        add.addEventListener('click', () => openGrantDialog(add));
        panel.appendChild(add);
      }
      slot.replaceChildren(panel);
    }

    function statusWordFor(g) {
      if (g.status === 'active') return 'Active';
      if (g.status === 'revoked') return 'Revoked';
      return 'Expired';
    }

    async function refreshRemaining() {
      const { status, data } = await api('/api/grant');
      if (status !== 200 || !data.grant) return;
      const line = document.getElementById('grant-remaining');
      if (line && data.grant.status === 'active') {
        line.textContent = `Access ends in ${remainingText(data.grant.remaining_seconds)}`;
      }
    }

    async function openGrantDialog(opener) {
      dialogRefOpen = true;
      const dlg = el('dialog', { 'aria-label': 'Grant access' });
      const form = el('form', {});
      form.appendChild(el('h2', { class: 'section-title', text: 'Grant access' }));
      const grid = el('div', { class: 'form-grid' });

      const name = el('input', { type: 'text', name: 'contact_name', id: 'contact-name' });
      grid.append(el('label', { for: 'contact-name', text: 'Contact name' }), name);
      const email = el('input', { type: 'email', name: 'contact_email', id: 'contact-email' });
      grid.append(el('label', { for: 'contact-email', text: 'Contact email' }), email);

      const dur = el('fieldset');
      dur.setAttribute('role', 'radiogroup');
      dur.setAttribute('aria-label', 'Duration');
      dur.appendChild(el('legend', { text: 'Duration' }));
      for (const [value, label] of [['24h', '24 hours'], ['7d', '7 days'], ['30d', '30 days']]) {
        const row = el('label', { class: 'checkrow' });
        const rb = el('input', { type: 'radio', name: 'duration', value });
        if (value === '24h') rb.checked = true;
        row.append(rb, el('span', { text: label }));
        dur.appendChild(row);
      }
      grid.appendChild(dur);

      const levels = el('fieldset');
      levels.setAttribute('role', 'group');
      levels.setAttribute('aria-label', 'Levels shown');
      levels.appendChild(el('legend', { text: 'Levels shown' }));
      for (const code of ['critical', 'high', 'moderate', 'low']) {
        const row = el('label', { class: 'checkrow' });
        const cb = el('input', { type: 'checkbox', name: 'levels', value: code });
        cb.checked = true;
        row.append(cb, el('span', { text: LEVEL_LABEL[code] }));
        levels.appendChild(row);
      }
      grid.appendChild(levels);
      form.appendChild(grid);

      const actions = el('div', { class: 'form-actions' });
      const submit = el('button', { type: 'submit', text: 'Grant access' });
      const cancel = el('button', { type: 'button', text: 'Cancel' });
      actions.append(submit, cancel);
      form.appendChild(actions);
      const passwordSlot = el('div');
      form.appendChild(passwordSlot);
      dlg.appendChild(form);
      document.body.appendChild(dlg);

      cancel.addEventListener('click', () => {
        dlg.close();
        dlg.remove();
        dialogRefOpen = false;
        opener?.focus();
      });

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFieldErrors(form);
        submit.disabled = true;
        submit.textContent = 'Working...';
        const body = {
          contact_name: name.value,
          contact_email: email.value,
          duration: form.querySelector('input[name="duration"]:checked')?.value || '24h',
          levels: [...form.querySelectorAll('input[name="levels"]:checked')].map((n) => n.value),
        };
        const { status, data } = await api('/api/grant', { method: 'POST', body });
        submit.disabled = false;
        submit.textContent = 'Grant access';
        if (status === 201) {
          announce('grant-updates', `Access granted to ${data.grant.contact_name}.`);
          // Show the temporary password once, with Done taking focus.
          passwordSlot.replaceChildren(
            el('p', { class: 'temp-password', text: `Temporary password: ${data.temporary_password}` }),
          );
          const done = el('button', { type: 'button', text: 'Done' });
          done.addEventListener('click', () => {
            dlg.close();
            dlg.remove();
            dialogRefOpen = false;
            opener?.focus();
            refresh({ keepDialog: false });
          });
          passwordSlot.appendChild(done);
          done.focus();
        } else if (status === 422) {
          showFieldErrors(form, (data && data.error && data.error.fields) || {});
        } else if (status === 409) {
          showAlert((data && data.error && data.error.message) || 'Something went wrong.');
        } else if (status === 503) {
          showAlert('Sign-in service unavailable. Try again in a few minutes.');
        } else {
          showAlert('Something went wrong. Your change was not saved.');
        }
      });

      dlg.showModal();
      name.focus();
      dlg.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') window.Dialogs.trapFocus(dlg, e);
        if (e.key === 'Escape') { e.preventDefault(); dlg.close(); dlg.remove(); dialogRefOpen = false; opener?.focus(); }
      });
    }

    await refresh({ keepDialog: false });
    setInterval(() => { refresh(); }, 15000);

    startStream(async () => {
      // Live events never close the open Grant access dialog.
      await refresh();
    }, () => {});
  }

  async function renderAccountScreen(screen) {
    screen.replaceChildren(el('div', { id: 'alerts' }));
    const wrap = el('div', { class: 'two-col' });
    const left = el('div');
    const right = el('div', { class: 'exposure-col' });

    left.appendChild(el('h1', { class: 'screen-title', text: 'Account' }));
    const form = el('form', { 'aria-label': 'Change password' });
    const grid = el('div', { class: 'form-grid' });
    const current = el('input', { type: 'password', name: 'current_password', id: 'current-password', autocomplete: 'current-password' });
    grid.append(el('label', { for: 'current-password', text: 'Current password' }), current);
    const next = el('input', { type: 'password', name: 'new_password', id: 'new-password', autocomplete: 'new-password' });
    grid.append(el('label', { for: 'new-password', text: 'New password' }), next);
    form.appendChild(grid);
    const submit = el('button', { type: 'submit', text: 'Change password' });
    form.appendChild(submit);
    left.appendChild(form);
    left.appendChild(el('div', { id: 'account-updates', class: 'status-line', role: 'status', 'aria-live': 'polite' }));

    wrap.append(left, right);
    screen.appendChild(wrap);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearFieldErrors(form);
      submit.disabled = true;
      submit.textContent = 'Working...';
      const { status, data } = await api('/api/account/password', {
        method: 'POST',
        body: { current_password: current.value, new_password: next.value },
      });
      submit.disabled = false;
      submit.textContent = 'Change password';
      if (status === 200) {
        announce('account-updates', 'Password changed. Other sessions are signed out.');
        current.value = '';
        next.value = '';
      } else if (status === 422) {
        showFieldErrors(form, (data && data.error && data.error.fields) || {});
      } else if (status === 503) {
        showAlert('Sign-in service unavailable. Try again in a few minutes.');
      } else {
        showAlert('Something went wrong. Your change was not saved.');
      }
    });

    startStream(async () => {}, () => {});
  }

  window.Screens.renderContactScreen = renderContactScreen;
  window.Screens.renderAccountScreen = renderAccountScreen;
})();
