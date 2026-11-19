import { el, bannerAlert, openDialog, errorSummary } from './ui.js';
import { get, post, patch, del, clinicTime, clinicFullDate, money, ApiRequestFailed } from './api.js';
import { renderSplitBand } from './shell.js';
import { announcer, live } from './live.js';
import type { Me } from './shell.js';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  issued: 'Unpaid',
  'part-paid': 'Part paid',
  paid: 'Paid',
  voided: 'Voided',
};

// ---------- invoices list ----------

export function renderInvoicesScreen(root: HTMLElement, me: Me): void {
  const wrap = el('div', { class: 'page-col' });
  const outstanding = el('p', { class: 'clinic-date', text: 'Outstanding £0.00' });
  const band = renderSplitBand('Invoices', el('div', {}, outstanding));
  wrap.append(band);
  const section = el('section');
  wrap.append(section);
  root.textContent = '';
  root.append(wrap);

  const load = async (): Promise<void> => {
    const r = await get('/api/invoices');
    const total = r.invoices
      .filter((i: any) => i.status === 'issued' || i.status === 'part-paid')
      .reduce((s: number, i: any) => s + i.balancePence, 0);
    outstanding.textContent = `Outstanding ${money(total)}`;
    section.textContent = '';
    section.append(el('h2', { text: 'Invoices' }));
    if (r.invoices.length === 0) {
      const card = el('div', { class: 'empty-card' });
      card.append(el('p', { class: 'title', text: 'No invoices yet.' }));
      section.append(card);
      return;
    }
    const table = el('table', { class: 'data', 'aria-label': 'Invoices' });
    const thead = el('thead');
    const headRow = el('tr');
    for (const h of ['Number', 'Patient', 'Status', 'Total', 'Balance due']) headRow.append(el('th', { text: h }));
    thead.append(headRow);
    table.append(thead);
    const tbody = el('tbody');
    for (const inv of r.invoices) {
      const tr = el('tr');
      const link = el('a', { href: `/invoices/${inv.id}`, 'aria-label': `Open invoice ${inv.number}` }, inv.number);
      tr.append(el('td', {}, link));
      tr.append(el('td', { text: inv.patientName }));
      tr.append(el('td', { text: STATUS_LABEL[inv.status] ?? inv.status }));
      tr.append(el('td', { text: money(inv.totalPence) }));
      tr.append(el('td', { text: money(inv.balancePence) }));
      tbody.append(tr);
    }
    table.append(tbody);
    section.append(el('div', { class: 'table-wrap' }, table));
  };

  load();
  live.onEvent((event) => {
    if (event === 'invoices' || event === 'tick') load();
  });
}

// ---------- invoice detail ----------

export function renderInvoiceScreen(root: HTMLElement, me: Me, invoiceId: string): void {
  const wrap = el('div', { class: 'page-col' });
  root.textContent = '';
  root.append(wrap);

  const state = {
    invoice: null as any,
    items: [] as any[],
    lineKey: '' as string,
    payKey: '' as string,
    lastLineValue: '' as string,
    lastPayValue: '' as string,
  };

  const load = async (): Promise<void> => {
    const [inv, stock] = await Promise.all([
      get(`/api/invoices/${invoiceId}`),
      me.role === 'vet' || me.role === 'manager' ? get('/api/stock') : Promise.resolve({ items: [] }),
    ]);
    state.invoice = inv;
    state.items = stock.items ?? [];
    render();
  };

  const render = (): void => {
    const inv = state.invoice;
    if (!inv) return;
    wrap.textContent = '';
    const outstanding = el('p', { class: 'clinic-date', text: money(inv.balancePence) });
    const band = renderSplitBand(`Invoice ${inv.number}`, el('div', {}, outstanding));
    wrap.append(band);

    const main = el('div', { style: 'display:grid;grid-template-columns:1.5fr 1fr;gap:18px' });
    if (window.innerWidth <= 768) main.style.gridTemplateColumns = '1fr';
    const left = el('section');
    const right = el('aside');

    left.append(el('h2', { text: `Invoice ${inv.number}` }));
    const statusGroup = el('div', { role: 'group', 'aria-label': 'Status' });
    statusGroup.append(el('span', { class: 'chip chip-status', text: STATUS_LABEL[inv.status] ?? inv.status }));
    left.append(statusGroup);

    // lines table
    left.append(el('h3', { text: 'Invoice lines' }));
    const table = el('table', { class: 'data', 'aria-label': 'Invoice lines' });
    const thead = el('thead');
    const headRow = el('tr');
    for (const h of ['Item', 'Qty', 'Net', 'Discount', 'VAT', 'Total']) headRow.append(el('th', { text: h }));
    thead.append(headRow);
    table.append(thead);
    const tbody = el('tbody');
    const discountOn = inv.discountPercent > 0;
    for (const line of inv.lines) {
      const tr = el('tr');
      let desc = line.description;
      if (discountOn) desc += ' *';
      desc += ' **';
      tr.append(el('td', { text: desc }));
      tr.append(el('td', { text: `x${line.quantity}` }));
      tr.append(el('td', { text: money(line.netPence) }));
      tr.append(el('td', { text: money(line.discountPence) }));
      tr.append(el('td', { text: money(line.vatPence) }));
      tr.append(el('td', { text: money(line.totalPence) }));
      if (inv.status === 'draft' && (me.role === 'vet' || me.role === 'manager')) {
        const rm = el('button', { class: 'btn', 'aria-label': `Remove line, ${line.description}` }, 'Remove');
        rm.addEventListener('click', async () => {
          try {
            await del(`/api/invoices/${invoiceId}/lines/${line.id}`);
            announcer.say(`Removed ${line.description}.`);
            await load();
          } catch (e) {
            if (e instanceof ApiRequestFailed) left.prepend(bannerAlert(e.err.message));
          }
        });
        tr.append(el('td', {}, rm));
      }
      tbody.append(tr);
    }
    table.append(tbody);
    left.append(el('div', { class: 'table-wrap' }, table));

    // line form (vet, manager) in draft
    if (inv.status === 'draft' && (me.role === 'vet' || me.role === 'manager')) {
      const form = el('div', { class: 'card' });
      form.append(el('h3', { text: 'Add line' }));
      const itemSel = el('select', { class: 'input-pill', 'aria-label': 'Stock item' }) as HTMLSelectElement;
      for (const it of state.items) itemSel.append(new Option(it.name, it.id));
      const qty = el('input', { class: 'input-pill', 'aria-label': 'Quantity', type: 'number', min: '1', value: '1' }) as HTMLInputElement;
      const addLineBtn = el('button', { class: 'btn' }, 'Add line');
      qty.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          addLineBtn.click();
        }
      });
      const doAdd = async (): Promise<void> => {
        if (addLineBtn.getAttribute('aria-busy') === 'true') return; // a second press while pending sends nothing
        const value = `${itemSel.value}|${qty.value}`;
        if (state.lastLineValue === value && state.lineKey) {
          // reuses the same key for an unchanged value after two lost sends
        } else {
          state.lineKey = `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          state.lastLineValue = value;
        }
        addLineBtn.setAttribute('aria-busy', 'true');
        addLineBtn.disabled = true;
        try {
          const updated = await post(`/api/invoices/${invoiceId}/lines`, {
            stockItemId: itemSel.value,
            quantity: Number(qty.value),
          }, { idempotencyKey: state.lineKey, retryOnce: true });
          announcer.say(`Added ${itemSel.options[itemSel.selectedIndex].text} x${qty.value} to ${inv.number}.`);
          const itemName = itemSel.options[itemSel.selectedIndex]?.text ?? '';
          const stockItem = state.items.find((i: any) => i.name === itemName);
          if (stockItem && stockItem.usable <= stockItem.reorderPoint) {
            // low stock arrives through the live push; announce after the add
          }
          await load();
        } catch (e) {
          if (e instanceof ApiRequestFailed) form.prepend(bannerAlert(e.err.message));
        } finally {
          addLineBtn.removeAttribute('aria-busy');
          addLineBtn.disabled = false;
        }
      };
      addLineBtn.addEventListener('click', doAdd);
      form.append(itemSel, qty, addLineBtn);
      left.append(form);

      const discForm = el('div', { class: 'card' });
      discForm.append(el('h3', { text: 'Discount' }));
      const discInput = el('input', { class: 'input-pill', 'aria-label': 'Discount percent', type: 'number', min: '0', max: '100', value: String(inv.discountPercent) }) as HTMLInputElement;
      const applyBtn = el('button', { class: 'btn' }, 'Apply discount');
      applyBtn.addEventListener('click', async () => {
        try {
          await patch(`/api/invoices/${invoiceId}`, { discountPercent: Number(discInput.value) });
          await load();
        } catch (e) {
          if (e instanceof ApiRequestFailed) discForm.prepend(bannerAlert(e.err.message));
        }
      });
      discForm.append(discInput, applyBtn);
      left.append(discForm);

      const issueBtn = el('button', { class: 'pill pill-solid' }, 'Issue invoice');
      issueBtn.addEventListener('click', async () => {
        try {
          await post(`/api/invoices/${invoiceId}/issue`);
          announcer.say(`${inv.number} issued.`);
          await load();
        } catch (e) {
          if (e instanceof ApiRequestFailed) left.prepend(bannerAlert(e.err.message));
        }
      });
      left.append(issueBtn);
    }

    // right: totals, payments, void
    const totals = el('div', { class: 'card' });
    const mk = (label: string, pence: number) => {
      const g = el('div', { role: 'group', 'aria-label': label });
      g.append(el('span', { text: `${label} ` }));
      g.append(el('strong', { text: money(pence) }));
      return g;
    };
    totals.append(mk('Total', inv.totalPence), mk('Paid', inv.paidPence), mk('Balance due', inv.balancePence));
    right.append(totals);

    const paymentsCard = el('div', { class: 'card' });
    paymentsCard.append(el('h3', { text: 'Payments' }));
    const payList = el('ul', { role: 'list', 'aria-label': 'Payments', style: 'list-style:none;padding:0' });
    for (const p of inv.payments) {
      payList.append(el('li', { 'aria-label': `${money(p.pence)} taken by ${p.takenBy?.name ?? ''} at ${clinicTime(p.at)}` }, `${money(p.pence)} taken by ${p.takenBy?.name ?? ''} at ${clinicTime(p.at)}`));
    }
    paymentsCard.append(payList);
    right.append(paymentsCard);

    if (inv.voidedBy) {
      const voidCard = el('div', { class: 'card', role: 'note', 'aria-label': 'Void record' });
      voidCard.append(el('p', { text: `Voided by ${inv.voidedBy.name} at ${clinicTime(inv.voidedAt)}: ${inv.voidReason}` }));
      right.append(voidCard);
    }

    // payment form
    if ((me.role === 'front-desk' || me.role === 'manager') && (inv.status === 'issued' || inv.status === 'part-paid')) {
      const payForm = el('div', { class: 'card' });
      payForm.append(el('h3', { text: 'Take payment' }));
      const amount = el('input', { class: 'input-pill', 'aria-label': 'Payment amount', placeholder: '12.50', inputmode: 'decimal' }) as HTMLInputElement;
      const amountErr = el('p', { role: 'alert' });
      const payBtn = el('button', { class: 'pill pill-solid' }, 'Take payment');
      const doPay = async (): Promise<void> => {
        const raw = amount.value.trim();
        const match = raw.match(/^\d+(\.\d{1,2})?$/);
        if (!match || Number(raw) <= 0) {
          amountErr.textContent = 'Enter an amount like 12.50.';
          return;
        }
        amountErr.textContent = '';
        if (payBtn.getAttribute('aria-busy') === 'true') return;
        const value = raw;
        if (state.lastPayValue !== value || !state.payKey) {
          state.payKey = `pay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          state.lastPayValue = value;
        }
        payBtn.setAttribute('aria-busy', 'true');
        payBtn.disabled = true;
        try {
          const pence = Math.round(Number(raw) * 100);
          const updated = await post(`/api/invoices/${invoiceId}/payments`, { pence }, { idempotencyKey: state.payKey, retryOnce: true });
          announcer.say(`Payment of ${money(pence)} taken. Balance due ${money(updated.balancePence)}.`);
          await load();
        } catch (e) {
          if (e instanceof ApiRequestFailed) payForm.prepend(bannerAlert(e.err.message));
        } finally {
          payBtn.removeAttribute('aria-busy');
          payBtn.disabled = false;
        }
      };
      amount.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void doPay();
        }
      });
      payBtn.addEventListener('click', doPay);
      payForm.append(amount, amountErr, payBtn);
      right.append(payForm);
    }

    // void
    if ((me.role === 'front-desk' || me.role === 'manager') && (inv.status === 'draft' || inv.status === 'issued')) {
      let dlg: HTMLDialogElement | null = null;
      const voidBtn = el('button', { class: 'btn' }, 'Void invoice');
      voidBtn.addEventListener('click', () => {
        openDialog(() => {
          const body = el('div', { class: 'dialog-body' });
          body.append(el('h2', { id: 'dlg-void', text: 'Void invoice' }));
          const summaryHolder = el('div');
          const reason = el('input', { class: 'input-pill', 'aria-label': 'Reason', type: 'text' }) as HTMLInputElement;
          const actions = el('div', { style: 'display:flex;gap:10px' });
          const confirmBtn = el('button', { class: 'pill pill-solid' }, 'Confirm void');
          const cancelBtn = el('button', { class: 'btn' }, 'Cancel');
          actions.append(confirmBtn, cancelBtn);
          confirmBtn.addEventListener('click', async () => {
            if (!reason.value.trim()) {
              summaryHolder.textContent = '';
              const box = errorSummary([{ message: 'Reason is required.', focus: () => reason.focus() }]);
              summaryHolder.append(box);
              box.querySelector('a')?.focus();
              return;
            }
            try {
              await post(`/api/invoices/${invoiceId}/void`, { reason: reason.value });
              announcer.say(`${inv.number} voided.`);
              dlg?.close();
              await load();
            } catch (e) {
              if (e instanceof ApiRequestFailed) {
                summaryHolder.textContent = '';
                const box = errorSummary([{ message: e.err.message, focus: () => reason.focus() }]);
                summaryHolder.append(box);
                box.querySelector('a')?.focus();
              }
            }
          });
          cancelBtn.addEventListener('click', () => document.querySelector('dialog.rb-dialog')?.close());
          body.append(summaryHolder, el('div', { class: 'field' }, el('label', { text: 'Reason' }), reason), actions);
          return body;
        }, {
          labelledBy: 'dlg-void',
          onOpen: (d) => { dlg = d; },
          onClose: () => voidBtn.focus(),
        });
      });
      right.append(voidBtn);
    }

    const exportLink = el('a', { class: 'btn', href: `/api/invoices/${invoiceId}.pdf` }, 'Export invoice PDF');
    right.append(exportLink);

    main.append(left, right);
    wrap.append(main);

    // footnotes
    const footnotes = el('div', { role: 'note', 'aria-label': 'Invoice footnotes', style: 'color:#5d6b77;font-size:14px' });
    const vatPercent = 20;
    if (discountOn) {
      footnotes.append(el('p', { style: 'margin:4px 0' }, `* Discount of ${inv.discountPercent}% applied to this line.`));
    }
    footnotes.append(el('p', { style: 'margin:4px 0' }, `** VAT at ${vatPercent}% on the line after discount.`));
    wrap.append(footnotes);
  };

  load();
  live.onEvent((event, data) => {
    if (event === 'invoices' || event === 'stock' || event === 'tick') load();
    if (event === 'announcement' && typeof data?.text === 'string' && data.text.includes(' is low: ')) {
      if (me.role === 'manager') announcer.say(data.text);
    }
  });
}
