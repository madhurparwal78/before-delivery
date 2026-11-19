import { el, bannerAlert, openDialog, errorSummary } from './ui.js';
import { get, post, patch, del, clinicFullDate, money, ROLE_LABELS, ApiRequestFailed } from './api.js';
import { renderSplitBand } from './shell.js';
import { announcer, live } from './live.js';
import type { Me } from './shell.js';

// ---------- Stock ----------

export function renderStockScreen(root: HTMLElement, me: Me): void {
  const wrap = el('div', { class: 'page-col' });
  const lowCount = el('p', { class: 'clinic-date', text: '0' });
  const lowStatus = el('div', { role: 'status', 'aria-label': 'Low stock count' }, lowCount);
  const band = renderSplitBand('Stock', lowStatus);
  wrap.append(band);
  const section = el('section');
  wrap.append(section);
  root.textContent = '';
  root.append(wrap);

  const openItems = new Set<string>();

  const load = async (): Promise<void> => {
    const r = await get('/api/stock');
    const low = r.items.filter((i: any) => i.low).length;
    lowCount.textContent = String(low);
    lowStatus.setAttribute('data-value', String(low));
    section.textContent = '';
    section.append(el('h2', { text: 'Stock' }));
    const isPhone = window.innerWidth <= 375;
    if (isPhone) {
      for (const item of r.items) section.append(stockCard(item));
    } else {
      const table = el('table', { class: 'data', 'aria-label': 'Stock' });
      const thead = el('thead');
      const headRow = el('tr');
      for (const h of ['Item', 'On hand', 'Usable', 'Reorder point', 'Price', 'Batches']) headRow.append(el('th', { text: h }));
      thead.append(headRow);
      table.append(thead);
      const tbody = el('tbody');
      for (const item of r.items) {
        const tr = el('tr', { 'aria-label': `${item.name}, ${item.onHand} on hand` });
        const nameCell = el('td', {}, el('strong', { text: item.name }));
        if (item.low) nameCell.append(el('span', { class: 'chip chip-late', style: 'margin-left:8px' }, 'Low stock'));
        tr.append(nameCell);
        tr.append(el('td', { text: String(item.onHand) }));
        tr.append(el('td', { text: `Usable ${item.usable}` }));
        tr.append(el('td', { text: String(item.reorderPoint) }));
        tr.append(el('td', { text: money(item.unitPricePence) }));
        const movesBtn = el('button', { class: 'btn', 'aria-label': `Movements, ${item.name}` }, `Movements, ${item.name}`);
        movesBtn.addEventListener('click', () => {
          if (openItems.has(item.id)) {
            openItems.delete(item.id);
          } else {
            openItems.add(item.id);
          }
          void load();
        });
        tr.append(el('td', {}, movesBtn));
        tbody.append(tr);
        if (openItems.has(item.id)) {
          const detail = await get(`/api/stock/${item.id}/movements`);
          const batchList = el('ul', { role: 'list', 'aria-label': 'Batches', style: 'list-style:none;padding:0' });
          for (const b of item.batches) {
            const li = el('li', { 'aria-label': `${b.batch}, ${b.remaining} left, expires ${clinicFullDate(b.expiresOn + 'T00:00:00Z')}` });
            let text = `${b.batch}, ${b.remaining} left, expires ${clinicFullDate(b.expiresOn + 'T00:00:00Z')}`;
            if (b.expired) text += ' — Expired';
            li.textContent = text;
            batchList.append(li);
          }
          const moveList = el('ul', { role: 'list', 'aria-label': 'Movements', style: 'list-style:none;padding:0' });
          for (const m of detail.movements) {
            const signed = m.delta > 0 ? `+${m.delta}` : String(m.delta);
            const li = el('li', {
              'aria-label': `${signed}, ${reasonLabel(m.reason)}, batch ${m.batch}, balance ${m.balanceAfter}`,
            }, `${signed}, ${reasonLabel(m.reason)}, batch ${m.batch}, balance ${m.balanceAfter}`);
            moveList.append(li);
          }
          const detailRow = el('tr');
          const cell = el('td', { colspan: '6' });
          cell.append(batchList, moveList);
          detailRow.append(cell);
          tbody.append(detailRow);
        }
      }
      table.append(tbody);
      section.append(el('div', { class: 'table-wrap' }, table));
    }

    // movement form (managers only)
    if (me.role === 'manager') {
      const form = el('div', { class: 'card' });
      form.append(el('h3', { text: 'Record movement' }));
      const itemSel = el('select', { class: 'input-pill', 'aria-label': 'Item' }) as HTMLSelectElement;
      for (const item of r.items) itemSel.append(new Option(item.name, item.id));
      const qty = el('input', { class: 'input-pill', 'aria-label': 'Quantity', type: 'number', min: '1', value: '1' }) as HTMLInputElement;
      const reasonSel = el('select', { class: 'input-pill', 'aria-label': 'Reason' }) as HTMLSelectElement;
      reasonSel.append(new Option('Received', 'receive'), new Option('Expired', 'expired'));
      const batchWrap = el('div', { class: 'field' });
      const submitBtn = el('button', { class: 'pill pill-primary' }, 'Record movement');
      const renderBatchField = (): void => {
        batchWrap.textContent = '';
        if (reasonSel.value === 'receive') {
          const batchInput = el('input', { class: 'input-pill', 'aria-label': 'Batch', type: 'text' }) as HTMLInputElement;
          const expiry = el('input', { class: 'input-pill', 'aria-label': 'Expires on', type: 'date' }) as HTMLInputElement;
          (batchWrap as any)._batch = batchInput;
          (batchWrap as any)._expiry = expiry;
          batchWrap.append(
            el('label', { text: 'Batch' }), batchInput,
            el('label', { text: 'Expires on' }), expiry,
          );
        } else {
          const batchSel = el('select', { class: 'input-pill', 'aria-label': 'Batch' }) as HTMLSelectElement;
          const item = r.items.find((i: any) => i.id === itemSel.value);
          for (const b of item?.batches ?? []) batchSel.append(new Option(b.batch, b.batch));
          (batchWrap as any)._batchSel = batchSel;
          batchWrap.append(el('label', { text: 'Batch' }), batchSel);
        }
      };
      reasonSel.addEventListener('change', renderBatchField);
      renderBatchField();
      const errP = el('p', { role: 'alert' });
      submitBtn.addEventListener('click', async () => {
        const qtyNum = Number(qty.value);
        if (!Number.isInteger(qtyNum) || qtyNum < 1) {
          errP.textContent = 'Quantity is not valid.';
          return;
        }
        errP.textContent = '';
        let batch: string;
        let expiresOn: string | undefined;
        if (reasonSel.value === 'receive') {
          batch = (batchWrap as any)._batch.value;
          expiresOn = (batchWrap as any)._expiry.value;
        } else {
          batch = (batchWrap as any)._batchSel.value;
        }
        try {
          await post(`/api/stock/${itemSel.value}/movements`, {
            delta: reasonSel.value === 'receive' ? qtyNum : -qtyNum,
            reason: reasonSel.value,
            batch,
            expiresOn,
          });
          const itemName = itemSel.options[itemSel.selectedIndex]?.text ?? '';
          announcer.say(`Recorded ${reasonSel.value === 'receive' ? '+' : '-'}${qtyNum} for ${itemName}.`);
          await load();
        } catch (e) {
          if (e instanceof ApiRequestFailed) errP.textContent = e.err.message;
        }
      });
      form.append(itemSel, qty, reasonSel, batchWrap, submitBtn, errP);
      section.append(form);
    }
  };

  load();
  live.onEvent((event, data) => {
    if (event === 'stock' || event === 'tick') load();
    if (event === 'announcement' && typeof data?.text === 'string' && data.text.includes(' is low: ')) {
      if (me.role === 'manager') announcer.say(data.text);
    }
  });
}

function reasonLabel(reason: string): string {
  return ({ receive: 'Received', expired: 'Expired', 'invoice-line': 'Invoice line', return: 'Returned' } as Record<string, string>)[reason] ?? reason;
}

// ---------- Staff ----------

export function renderStaffScreen(root: HTMLElement, me: Me): void {
  const wrap = el('div', { class: 'page-col' });
  const count = el('p', { class: 'clinic-date', text: '0' });
  const band = renderSplitBand('Staff', el('div', { role: 'status' }, count));
  wrap.append(band);
  const section = el('section');
  wrap.append(section);
  root.textContent = '';
  root.append(wrap);

  const load = async (): Promise<void> => {
    const r = await get('/api/staff');
    const active = r.staff.filter((s: any) => s.status === 'Active').length;
    count.textContent = String(active);
    section.textContent = '';
    section.append(el('h2', { text: 'Staff' }));

    const form = el('div', { class: 'card' });
    form.append(el('h3', { text: 'Invite staff' }));
    const name = el('input', { class: 'input-pill', 'aria-label': 'Name', type: 'text' }) as HTMLInputElement;
    const email = el('input', { class: 'input-pill', 'aria-label': 'Email', type: 'email' }) as HTMLInputElement;
    const role = el('select', { class: 'input-pill', 'aria-label': 'Role' }) as HTMLSelectElement;
    for (const [v, l] of Object.entries(ROLE_LABELS)) role.append(new Option(l, v));
    const sendBtn = el('button', { class: 'pill pill-primary' }, 'Send invitation');
    const errP = el('p', { role: 'alert' });
    sendBtn.addEventListener('click', async () => {
      sendBtn.setAttribute('aria-busy', 'true');
      try {
        await post('/api/staff/invitations', { name: name.value, email: email.value, role: role.value });
        announcer.say(`Invitation created for ${email.value}.`);
        await load();
      } catch (e) {
        if (e instanceof ApiRequestFailed) errP.textContent = e.err.message;
      } finally {
        sendBtn.removeAttribute('aria-busy');
      }
    });
    form.append(name, email, role, sendBtn, errP);
    section.append(form);

    const isPhone = window.innerWidth <= 375;
    if (isPhone) {
      for (const s of r.staff) section.append(staffCard(s, me));
    } else {
      const table = el('table', { class: 'data', 'aria-label': 'Staff' });
      const thead = el('thead');
      const headRow = el('tr');
      for (const h of ['Name', 'Email', 'Role', 'Status', 'Actions']) headRow.append(el('th', { text: h }));
      thead.append(headRow);
      table.append(thead);
      const tbody = el('tbody');
      for (const s of r.staff) {
        const tr = el('tr', { 'aria-label': `${s.name}, ${ROLE_LABELS[s.role] ?? s.role}, ${s.status}` });
        tr.append(el('td', { text: s.name }));
        tr.append(el('td', { text: s.email }));
        tr.append(el('td', { text: ROLE_LABELS[s.role] ?? s.role }));
        tr.append(el('td', { text: s.status }));
        const actions = el('td', { style: 'display:flex;gap:8px;flex-wrap:wrap' });
        if (s.status === 'Active' || s.status === 'Invited') {
          actions.append(changeRoleBtn(s), removeBtn(s));
        }
        tr.append(actions);
        tbody.append(tr);
      }
      table.append(tbody);
      section.append(el('div', { class: 'table-wrap' }, table));
    }
  };

  function changeRoleBtn(s: any): HTMLElement {
    const btn = el('button', { class: 'btn', 'aria-label': `Change role, ${s.name}` }, `Change role, ${s.name}`);
    btn.addEventListener('click', () => {
      let dlg: HTMLDialogElement | null = null;
      openDialog(() => {
        const body = el('div', { class: 'dialog-body' });
        body.append(el('h2', { id: 'dlg-role', text: 'Change role' }));
        const summaryHolder = el('div');
        const sel = el('select', { class: 'input-pill', 'aria-label': 'Role' }) as HTMLSelectElement;
        sel.append(new Option('', ''));
        for (const [v, l] of Object.entries(ROLE_LABELS)) sel.append(new Option(l, v));
        const actions = el('div', { style: 'display:flex;gap:10px' });
        const saveBtn = el('button', { class: 'pill pill-primary' }, 'Save role');
        const cancelBtn = el('button', { class: 'btn' }, 'Cancel');
        actions.append(saveBtn, cancelBtn);
        saveBtn.addEventListener('click', async () => {
          if (!sel.value) {
            summaryHolder.textContent = '';
            const box = errorSummary([{ message: 'Role is required.', focus: () => sel.focus() }]);
            summaryHolder.append(box);
            box.querySelector('a')?.focus();
            return;
          }
          try {
            await patch(`/api/staff/${s.id}`, { role: sel.value });
            announcer.say(`${s.name} is now ${ROLE_LABELS[sel.value]}.`);
            dlg?.close();
            await load();
          } catch (e) {
            if (e instanceof ApiRequestFailed) {
              summaryHolder.textContent = '';
              const box = errorSummary([{ message: e.err.message, focus: () => sel.focus() }]);
              summaryHolder.append(box);
              box.querySelector('a')?.focus();
            }
          }
        });
        cancelBtn.addEventListener('click', () => document.querySelector('dialog.rb-dialog')?.close());
        body.append(summaryHolder, el('div', { class: 'field' }, el('label', { text: 'Role' }), sel), actions);
        return body;
      }, {
        labelledBy: 'dlg-role',
        onOpen: (d) => { dlg = d; },
        onClose: () => btn.focus(),
      });
    });
    return btn;
  }

  function removeBtn(s: any): HTMLElement {
    const btn = el('button', { class: 'btn', 'aria-label': `Remove access, ${s.name}` }, `Remove access, ${s.name}`);
    btn.addEventListener('click', async () => {
      try {
        await del(`/api/staff/${s.id}`);
        announcer.say(`Access removed for ${s.name}.`);
        await load();
        const heading = section.querySelector('h2') as HTMLElement;
        heading?.focus?.();
        heading?.setAttribute('tabindex', '-1');
        heading?.focus();
      } catch (e) {
        if (e instanceof ApiRequestFailed) section.prepend(bannerAlert(e.err.message));
      }
    });
    return btn;
  }

  function staffCard(s: any, me: Me): HTMLElement {
    const card = el('div', { class: 'card', 'aria-label': `${s.name}, ${ROLE_LABELS[s.role] ?? s.role}, ${s.status}` });
    card.append(el('strong', { text: s.name }));
    card.append(el('p', { style: 'margin:2px 0;color:#5d6b77' }, `${s.email} · ${ROLE_LABELS[s.role] ?? s.role} · ${s.status}`));
    const row = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' });
    if (s.status === 'Active' || s.status === 'Invited') {
      row.append(changeRoleBtn(s), removeBtn(s));
    }
    card.append(row);
    return card;
  }

  load();
  live.onEvent((event) => {
    if (event === 'staff' || event === 'tick') load();
  });
}

function stockCard(item: any): HTMLElement {
  const card = el('div', { class: 'card', 'aria-label': `${item.name}, ${item.onHand} on hand` });
  card.append(el('strong', { text: item.name }));
  if (item.low) card.append(el('span', { class: 'chip chip-late' }, 'Low stock'));
  card.append(el('p', { style: 'margin:4px 0;color:#5d6b77' }, `Usable ${item.usable} · reorder at ${item.reorderPoint} · ${money(item.unitPricePence)}`));
  return card;
}
