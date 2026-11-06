(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const notifications = document.getElementById('notifications');
  const REASON_REQUIRED = 'Enter a reason to reject';
  const AMOUNT_MESSAGE = 'Enter an amount like 1250 or 0.5';
  const AMOUNT_PATTERN = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

  function toast(text) {
    if (!text || !notifications) return;
    const node = document.createElement('p');
    node.className = 'toast';
    node.textContent = text;
    notifications.appendChild(node);
    window.setTimeout(() => node.remove(), 5000);
  }

  function busy(button, on) {
    if (!button) return;
    button.disabled = on;
    if (on) {
      button.setAttribute('aria-busy', 'true');
      const marker = document.createElement('span');
      marker.setAttribute('aria-hidden', 'true');
      marker.setAttribute('data-busy-marker', '');
      if (reducedMotion) {
        marker.className = 'working-word';
        marker.textContent = ' Working';
      } else {
        marker.className = 'spinner';
      }
      button.appendChild(marker);
    } else {
      button.removeAttribute('aria-busy');
      const marker = button.querySelector('[data-busy-marker]');
      if (marker) marker.remove();
    }
  }

  async function postForm(form, data) {
    const response = await fetch(form.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Corvo-Enhanced': '1' },
      body: new URLSearchParams(data)
    });
    return { status: response.status, payload: await response.json() };
  }

  function clearErrors(form) {
    for (const holder of form.querySelectorAll('[data-error-for], [data-form-error], [data-row-error], [data-line-error]')) {
      holder.textContent = '';
    }
    for (const input of form.querySelectorAll('[aria-invalid="true"]')) input.removeAttribute('aria-invalid');
  }

  function setResult(form, text) {
    const result = form.querySelector('[data-result]');
    if (!result || !text) return;
    result.textContent = text;
    toast(text);
  }

  function markField(form, field, message) {
    const holder = form.querySelector(`[data-error-for="${field}"]`);
    const input = form.querySelector(`[data-field="${field}"]`) || form.elements[field];
    if (holder) holder.textContent = message;
    if (input && input.setAttribute) {
      input.setAttribute('aria-invalid', 'true');
      if (holder && holder.id) input.setAttribute('aria-describedby', holder.id);
      input.focus();
    }
  }

  function markBatchLine(form, index, field, message) {
    const lines = Array.from(form.querySelectorAll('[data-batch-line]'));
    const line = lines[index];
    if (!line) return;
    const input = line.querySelector(`[data-line-field="${field}"]`);
    const holder = line.querySelector('[data-line-error]');
    if (holder) holder.textContent = message;
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    }
  }

  function updateWalletFacts(wallet) {
    if (!wallet) return;
    const asset = wallet.asset.toUpperCase();
    const map = { balance: wallet.balance, available: wallet.available, reserved: wallet.reserved };
    for (const [name, value] of Object.entries(map)) {
      const node = document.querySelector(`[data-fact="${name}"]`);
      if (node) node.textContent = `${value} ${asset}`;
    }
  }

  function updateStats(stats) {
    if (!stats) return;
    const map = {
      wallets: stats.wallets,
      pending: stats.pending,
      awaiting: stats.awaiting,
      executed: stats.executedRecently
    };
    for (const [key, value] of Object.entries(map)) {
      const node = document.querySelector(`[data-stat="${key}"]`);
      if (node) node.textContent = String(value);
    }
    const count = document.querySelector('[data-awaiting-count]');
    if (count) count.textContent = String(stats.awaiting);
  }

  function goWithFlash(toastText) {
    const url = new URL(window.location.href);
    url.searchParams.delete('flash');
    if (toastText) url.searchParams.set('flash', toastText);
    window.location.assign(url.pathname + url.search);
  }

  function removeInboxCard(card) {
    const inbox = document.querySelector('[data-inbox]');
    const cards = Array.from(inbox.querySelectorAll('[role="group"]'));
    const index = cards.indexOf(card);
    const neighbour = cards[index + 1] || cards[index - 1] || null;
    card.remove();
    if (neighbour) {
      const approve = neighbour.querySelector('[data-approve]');
      if (approve) approve.focus();
      return;
    }
    const template = document.querySelector('[data-empty-template]');
    if (template) {
      inbox.replaceChildren(template.content.cloneNode(true));
    }
    const empty = inbox.querySelector('[data-empty-state]');
    if (empty) empty.focus();
  }

  function pathToField(path) {
    const rule = /^rules\[(\d+)\]\.name$/.exec(path);
    if (rule) return `rule_${rule[1]}_name`;
    const condition = /^rules\[(\d+)\]\.conditions\[(\d+)\]\.(\w+)/.exec(path);
    if (condition) return `cond_${condition[1]}_${condition[2]}_${condition[3]}`;
    const ruleField = /^rules\[(\d+)\]\.(\w+)$/.exec(path);
    if (ruleField) return `rule_${ruleField[1]}_${ruleField[2]}`;
    return null;
  }

  async function handleSubmit(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if ((form.method || '').toLowerCase() !== 'post') return;
    const data = new FormData(form, event.submitter);
    const action = data.get('__action');
    if (!action) return;
    event.preventDefault();

    if (action === 'reject') {
      const reason = (data.get('reason') || '').toString();
      if (!reason.trim()) {
        const input = form.querySelector('[data-reason]');
        const holder = form.querySelector('[data-error-for="reason"]');
        if (holder) holder.textContent = REASON_REQUIRED;
        if (input) {
          input.setAttribute('aria-invalid', 'true');
          input.focus();
        }
        toast(REASON_REQUIRED);
        return;
      }
    }

    const button = event.submitter || form.querySelector('button[type="submit"]');
    clearErrors(form);
    busy(button, true);
    let answer;
    try {
      answer = await postForm(form, data);
    } catch {
      toast("Corvo can't reach its database. Nothing was changed. Try again in a moment.");
      busy(button, false);
      return;
    }
    busy(button, false);
    const { payload } = answer;

    if (!payload.ok) {
      if (payload.result) setResult(form, payload.result);
      const field = payload.details && payload.details.field;
      const index = payload.details && payload.details.index;
      if (field && /^items\.\d+\./.test(field)) {
        markBatchLine(form, Number(field.split('.')[1]), field.split('.')[2], payload.message);
      } else if (field) {
        markField(form, field, payload.message);
      } else if (payload.details && payload.details.path) {
        const holder = form.querySelector('[data-form-error]');
        if (holder) holder.textContent = `${payload.message} at ${payload.details.path}`;
        const name = pathToField(payload.details.path);
        const input = name ? form.querySelector(`[name="${name}"]`) : null;
        if (input) {
          input.setAttribute('aria-invalid', 'true');
          input.focus();
        }
      } else if (index !== undefined && index !== null) {
        markBatchLine(form, Number(index), 'amount', payload.message);
      } else {
        const rowError = form.querySelector('[data-row-error]');
        const formError = form.querySelector('[data-form-error]');
        if (rowError) rowError.textContent = payload.message;
        else if (formError) formError.textContent = payload.message;
      }
      if (!payload.result) toast(payload.message);
      if (button) button.focus();
      return;
    }

    const view = payload.view || {};
    if (action === 'send' || action === 'deposit' || action === 'batch') {
      setResult(form, payload.result);
      toast(payload.toast);
      updateWalletFacts(view.wallet);
      if (action === 'batch') resetBatch(form);
      else form.reset();
      return;
    }
    if (action === 'approve' || action === 'reject') {
      toast(payload.toast);
      updateStats(view.stats);
      const card = form.closest('[role="group"]');
      if (card) removeInboxCard(card);
      return;
    }
    if (action === 'simulate') {
      const holder = document.querySelector('[data-simulation]');
      if (holder) holder.innerHTML = payload.simulationHtml || '';
      return;
    }
    if (action === 'create-api-key') {
      const holder = document.querySelector('[data-new-key]');
      const secret = document.querySelector('[data-new-key-secret]');
      if (holder && secret) {
        secret.textContent = view.secret;
        holder.hidden = false;
      }
      toast(payload.toast);
      return;
    }
    if (action === 'reveal-secret' || action === 'rotate-secret') {
      const node = document.querySelector('[data-secret]');
      if (node) node.textContent = view.secret;
      toast(payload.toast);
      return;
    }
    if (action === 'verify-chain') {
      const node = document.querySelector('[data-chain-status]');
      if (node) node.textContent = payload.chainStatus;
      return;
    }
    goWithFlash(payload.toast);
  }

  document.addEventListener('submit', handleSubmit);

  /* Payroll batch builder */
  function renumberBatch(form) {
    const lines = Array.from(form.querySelectorAll('[data-batch-line]'));
    lines.forEach((line, index) => {
      const number = index + 1;
      for (const [field, label] of [['destination_address', 'destination'], ['amount', 'amount'], ['memo', 'memo']]) {
        const input = line.querySelector(`[data-line-field="${field}"]`);
        const id = `line-${number}-${label}`;
        input.id = id;
        input.name = `${field === 'destination_address' ? 'destination' : field}_${index}`;
        line.querySelectorAll('label').forEach((node) => {
          if (node.htmlFor.endsWith(`-${label}`)) {
            node.htmlFor = id;
            node.textContent = `Line ${number} ${label}`;
          }
        });
      }
      const remove = line.querySelector('[data-remove-line]');
      remove.textContent = `Remove line ${number}`;
      remove.disabled = lines.length === 1;
    });
    updateBatchTotal(form);
  }

  function updateBatchTotal(form) {
    const decimals = Number(form.dataset.decimals || 6);
    const asset = (form.dataset.asset || 'usdc').toUpperCase();
    let total = 0n;
    for (const line of form.querySelectorAll('[data-batch-line]')) {
      const value = line.querySelector('[data-line-field="amount"]').value.trim();
      if (!AMOUNT_PATTERN.test(value)) continue;
      const [whole, fraction = ''] = value.split('.');
      if (fraction.length > decimals) continue;
      total += BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals));
    }
    const scale = 10n ** BigInt(decimals);
    const fraction = (total % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
    const display = `${total / scale}${fraction ? `.${fraction}` : ''}`;
    const node = form.querySelector('[data-batch-total]');
    if (node) node.textContent = `Total: ${display} ${asset}`;
  }

  function resetBatch(form) {
    const lines = Array.from(form.querySelectorAll('[data-batch-line]'));
    lines.slice(1).forEach((line) => line.remove());
    for (const input of lines[0].querySelectorAll('input')) {
      input.value = '';
      input.removeAttribute('aria-invalid');
    }
    renumberBatch(form);
  }

  document.addEventListener('click', (event) => {
    const addLine = event.target.closest('[data-add-line]');
    if (addLine) {
      const form = addLine.closest('form');
      const lines = form.querySelector('[data-batch-lines]');
      const copy = lines.querySelector('[data-batch-line]').cloneNode(true);
      for (const input of copy.querySelectorAll('input')) {
        input.value = '';
        input.removeAttribute('aria-invalid');
      }
      const error = copy.querySelector('[data-line-error]');
      if (error) error.textContent = '';
      lines.appendChild(copy);
      renumberBatch(form);
      copy.querySelector('[data-line-field="destination_address"]').focus();
      return;
    }

    const removeLine = event.target.closest('[data-remove-line]');
    if (removeLine) {
      const form = removeLine.closest('form');
      const line = removeLine.closest('[data-batch-line]');
      const lines = Array.from(form.querySelectorAll('[data-batch-line]'));
      const index = lines.indexOf(line);
      if (lines.length === 1) return;
      line.remove();
      renumberBatch(form);
      const remaining = Array.from(form.querySelectorAll('[data-batch-line]'));
      const next = remaining[index];
      if (next) next.querySelector('[data-line-field="destination_address"]').focus();
      else form.querySelector('[data-add-line]').focus();
    }
  });

  document.addEventListener('input', (event) => {
    const amount = event.target.closest('[data-line-field="amount"]');
    if (!amount) return;
    updateBatchTotal(amount.closest('form'));
  });

  document.addEventListener('focusout', (event) => {
    const amount = event.target.closest('[data-line-field="amount"]');
    if (!amount) return;
    const line = amount.closest('[data-batch-line]');
    const holder = line.querySelector('[data-line-error]');
    const value = amount.value.trim();
    if (value && !AMOUNT_PATTERN.test(value)) {
      holder.textContent = AMOUNT_MESSAGE;
      amount.setAttribute('aria-invalid', 'true');
    } else {
      holder.textContent = '';
      amount.removeAttribute('aria-invalid');
    }
  });

  /* Policy rule editor */
  const CONDITION_LABELS = { field_source: 'field source', field: 'field', operator: 'operator', value: 'value' };

  function renumberRules(form) {
    const rows = Array.from(form.querySelectorAll('[data-rule]'));
    rows.forEach((row, ruleIndex) => {
      const number = ruleIndex + 1;
      row.setAttribute('data-rule-index', String(ruleIndex));
      for (const kind of ['name', 'method', 'action']) {
        const control = row.querySelector(`[data-kind="${kind}"]`);
        if (!control) continue;
        const id = `rule_${ruleIndex}_${kind}`;
        const label = row.querySelector(`label[for="${control.id}"]`);
        control.id = id;
        control.name = id;
        if (label) {
          label.htmlFor = id;
          label.textContent = `Rule ${number} ${kind}`;
        }
      }
      const conditions = Array.from(row.querySelectorAll('[data-condition]'));
      conditions.forEach((condition, conditionIndex) => {
        for (const [kind, word] of Object.entries(CONDITION_LABELS)) {
          const control = condition.querySelector(`[data-kind="${kind}"]`);
          if (!control) continue;
          const id = `cond_${ruleIndex}_${conditionIndex}_${kind}`;
          const label = condition.querySelector(`label[for="${control.id}"]`);
          control.id = id;
          control.name = id;
          if (label) {
            label.htmlFor = id;
            label.textContent = `Rule ${number} condition ${conditionIndex + 1} ${word}`;
          }
        }
      });
      const addCondition = row.querySelector('[data-add-condition]');
      if (addCondition) addCondition.textContent = `Add condition to rule ${number}`;
      const up = row.querySelector('[data-move="up"]');
      if (up) up.textContent = `Move rule ${number} up`;
      const down = row.querySelector('[data-move="down"]');
      if (down) down.textContent = `Move rule ${number} down`;
      const remove = row.querySelector('[data-remove-rule]');
      if (remove) remove.textContent = `Remove rule ${number}`;
    });
  }

  document.addEventListener('click', (event) => {
    const addRule = event.target.closest('[data-add-rule]');
    if (addRule) {
      const form = addRule.closest('form');
      const template = document.querySelector('[data-rule-template]');
      const row = template.content.cloneNode(true).querySelector('[data-rule]');
      form.querySelector('[data-rules]').appendChild(row);
      renumberRules(form);
      row.querySelector('[data-kind="name"]').focus();
      return;
    }

    const addCondition = event.target.closest('[data-add-condition]');
    if (addCondition) {
      const form = addCondition.closest('form');
      const template = document.querySelector('[data-condition-template]');
      const condition = template.content.cloneNode(true).querySelector('[data-condition]');
      addCondition.closest('[data-conditions]').insertBefore(condition, addCondition);
      renumberRules(form);
      condition.querySelector('[data-kind="value"]').focus();
      return;
    }

    const removeRule = event.target.closest('[data-remove-rule]');
    if (removeRule) {
      const form = removeRule.closest('form');
      removeRule.closest('[data-rule]').remove();
      renumberRules(form);
      form.querySelector('[data-add-rule]').focus();
      return;
    }

    const move = event.target.closest('[data-move]');
    if (move) {
      const form = move.closest('form');
      const row = move.closest('[data-rule]');
      const sibling = move.dataset.move === 'up' ? row.previousElementSibling : row.nextElementSibling;
      if (!sibling) return;
      if (move.dataset.move === 'up') row.parentNode.insertBefore(row, sibling);
      else row.parentNode.insertBefore(sibling, row);
      renumberRules(form);
      row.querySelector(`[data-move="${move.dataset.move}"]`).focus();
    }
  });

  /* Inbox reject reveal */
  document.addEventListener('click', (event) => {
    const reject = event.target.closest('[data-reject]');
    if (!reject) return;
    const form = reject.closest('form');
    const holder = form.querySelector('[data-reason-holder]');
    holder.hidden = false;
    form.querySelector('[data-reason]').focus();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const reason = event.target.closest('[data-reason]');
    if (!reason) return;
    const form = reason.closest('form');
    form.querySelector('[data-reason-holder]').hidden = true;
    form.querySelector('[data-reject]').focus();
  });

  /* Inline create row */
  const createButton = document.querySelector('[data-create-wallet]');
  const createRow = document.querySelector('[data-create-row]');
  if (createButton && createRow) {
    const close = () => {
      createRow.hidden = true;
      createButton.focus();
    };
    createButton.addEventListener('click', () => {
      createRow.hidden = false;
      createRow.querySelector('#wallet-name').focus();
    });
    createRow.querySelector('[data-discard]').addEventListener('click', close);
    createRow.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close();
    });
  }

  /* Dialogs */
  document.addEventListener('click', (event) => {
    const openFreeze = event.target.closest('[data-open-freeze]');
    if (openFreeze) {
      const dialog = document.querySelector('[data-freeze-dialog]');
      dialog.returnValue = '';
      dialog.showModal();
      dialog.querySelector('[data-close-dialog]').focus();
      dialog.addEventListener('close', () => openFreeze.focus(), { once: true });
      return;
    }
    const openRemove = event.target.closest('[data-open-remove]');
    if (openRemove) {
      const dialog = document.querySelector(`[data-remove-dialog="${openRemove.dataset.openRemove}"]`);
      dialog.showModal();
      dialog.querySelector('[data-close-dialog]').focus();
      dialog.addEventListener('close', () => openRemove.focus(), { once: true });
      return;
    }
    const closeDialog = event.target.closest('[data-close-dialog]');
    if (closeDialog) closeDialog.closest('dialog').close();
  });

  /* Copy buttons */
  document.addEventListener('click', async (event) => {
    const copy = event.target.closest('[data-copy-address]');
    if (!copy) return;
    try {
      await navigator.clipboard.writeText(copy.dataset.value);
    } catch {
      // the clipboard is unavailable; the address stays on the page
    }
    toast('Address copied');
  });

  /* Panels */
  document.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-toggle]');
    if (!toggle) return;
    const panel = document.querySelector(`[data-panel="${toggle.dataset.toggle}"]`);
    if (!panel) return;
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      const input = panel.querySelector('input, select');
      if (input) input.focus();
    }
  });

  /* Intents list */
  document.addEventListener('click', (event) => {
    const details = event.target.closest('[data-details]');
    if (!details) return;
    const row = document.querySelector(`[data-details-for="${details.dataset.details}"]`);
    if (!row) return;
    const open = details.getAttribute('aria-expanded') === 'true';
    details.setAttribute('aria-expanded', open ? 'false' : 'true');
    row.hidden = open;
  });

  const statusFilter = document.querySelector('[data-status-filter]');
  if (statusFilter) {
    statusFilter.addEventListener('change', () => {
      const url = new URL(window.location.href);
      url.searchParams.delete('cursor');
      url.searchParams.delete('flash');
      if (statusFilter.value) url.searchParams.set('status', statusFilter.value);
      else url.searchParams.delete('status');
      window.location.assign(url.pathname + url.search);
    });
  }

  const loadMoreForm = document.querySelector('[data-load-more-form]');
  if (loadMoreForm) {
    loadMoreForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = loadMoreForm.querySelector('[data-load-more]');
      const body = document.querySelector('[data-intent-body]');
      const params = new URLSearchParams(new FormData(loadMoreForm));
      params.set('partial', 'rows');
      busy(button, true);
      const response = await fetch(`/console/intents?${params.toString()}`, { headers: { 'X-Corvo-Enhanced': '1' } });
      const payload = await response.json();
      busy(button, false);
      const holder = document.createElement('tbody');
      holder.innerHTML = payload.rows;
      const appended = Array.from(holder.children);
      for (const row of appended) body.appendChild(row);
      if (payload.next_cursor) {
        loadMoreForm.querySelector('[name="cursor"]').value = payload.next_cursor;
        button.focus();
        return;
      }
      loadMoreForm.remove();
      const firstAppended = appended.find((row) => row.hasAttribute('data-intent-row'));
      if (firstAppended) firstAppended.querySelector('[data-details]').focus();
    });
  }

  /* Audit tabs */
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      for (const other of tabs) {
        const panel = document.getElementById(other.getAttribute('aria-controls'));
        const selected = other === tab;
        other.setAttribute('aria-selected', selected ? 'true' : 'false');
        panel.hidden = !selected;
      }
    });
  }

  /* Console rail at phone width */
  const railButton = document.querySelector('[data-rail-button]');
  const rail = document.querySelector('[data-rail]');
  if (railButton && rail) {
    railButton.addEventListener('click', () => {
      const open = rail.getAttribute('data-open') === 'true';
      rail.setAttribute('data-open', open ? 'false' : 'true');
      railButton.setAttribute('aria-expanded', open ? 'false' : 'true');
    });
  }

  for (const form of document.querySelectorAll('[data-batch-form]')) renumberBatch(form);

  for (const node of document.querySelectorAll('#notifications .toast')) {
    window.setTimeout(() => node.remove(), 5000);
  }
})();
