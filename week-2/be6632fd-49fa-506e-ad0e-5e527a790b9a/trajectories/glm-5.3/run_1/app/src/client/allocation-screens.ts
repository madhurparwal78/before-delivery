// Allocations for a drop: Split edition, Enter allocation, Record request, and
// the allocation screen with its editable lines and Confirm allocation dialog.
import { api, apiOk, failOf, type AllocationOut, type DropStaff, type StockistOut } from './api.js';
import { el, buttonEl, liveRegion, announce, pending, openDialog, emptyRow } from './ui.js';
import { money, parseInstant, marketTimeWords, dateWords } from './format.js';
import { navigate } from './router.js';
import { renderHeader, renderAuthNeeded, renderNotFoundScreen, ensureMember } from './staff-helpers.js';

export async function renderAllocationsForDrop(root: HTMLElement, dropId: string): Promise<HTMLElement> {
  if (!(await ensureMember())) return renderAuthNeeded(root, `/studio/drops/${dropId}/allocations`);
  renderHeader('/studio/drops');
  let drop: DropStaff | null = null;
  try { drop = await apiOk<DropStaff>('GET', `/api/drops/${dropId}`); } catch { drop = null; }
  if (!drop) return renderNotFoundScreen(root);
  const h = el('h1', {}, `Allocations · ${drop.name}`);
  const status = liveRegion('Allocation status');
  const table = el('table', { class: 'table-to-cards' });
  const h2 = el('h2', {}, 'Allocations');
  table.append(el('caption', { text: 'Allocations' }));
  const headCells = [el('th', { text: 'Stockist' }), el('th', { text: 'Status' })];
  for (const s of drop.styles) headCells.push(el('th', { text: `${s.styleNumber} req / alloc` }));
  headCells.push(el('th', { text: 'Requested at' }));
  table.append(el('thead', {}, el('tr', {}, ...headCells)));
  const tbody = el('tbody');
  table.append(tbody);

  async function reload(): Promise<void> {
    tbody.replaceChildren();
    let allocs: AllocationOut[] = [];
    try {
      const res = await apiOk<{ items: AllocationOut[] }>('GET', `/api/drops/${dropId}/allocations`);
      allocs = res.items ?? [];
    } catch { allocs = []; }
    for (const a of allocs) {
      const row = el('tr', {});
      row.append(el('td', { 'data-label': 'Stockist' }, el('a', { href: `/studio/allocations/${a.id}`, text: a.stockistName })));
      row.append(el('td', { 'data-label': 'Status', text: a.status }));
      for (const s of drop!.styles) {
        const line = a.lines.find(l => l.styleNumber === s.styleNumber);
        row.append(el('td', { 'data-label': s.styleNumber, class: 'mono', text: `${line?.requestedQuantity ?? 0} / ${line?.allocatedQuantity ?? 0}` }));
      }
      const at = parseInstant(a.requestedAt);
      row.append(el('td', { 'data-label': 'Requested at', class: 'mono', text: marketTimeWords(at, 'copenhagen', 'Copenhagen') }));
      tbody.append(row);
    }
    if (tbody.children.length === 0) tbody.append(emptyRow(2 + drop!.styles.length + 1));
  }

  const splitBtn = buttonEl({ class: 'btn', text: 'Split edition', onclick: async () => {
    openDialog({
      label: 'Split edition', opener: splitBtn, successFocus: h2,
      body: (dlg) => {
        const proposalWrap = el('div', {});
        const table2 = el('table', {});
        table2.append(el('caption', { text: 'Proposed split' }));
        table2.append(el('thead', {}, el('tr', {}, el('th', { text: 'Stockist' }), el('th', { text: 'Style' }), el('th', { text: 'Requested' }), el('th', { text: 'Allocated' }))));
        const tb = el('tbody');
        table2.append(tb);
        proposalWrap.append(table2);
        void apiOk<{ items: { stockistId: string; stockistName: string; lines: { styleNumber: string; requestedQuantity: number; allocatedQuantity: number }[] }[] }>('GET', `/api/drops/${dropId}/split`).then(res => {
          for (const p of res.items ?? []) {
            for (const l of p.lines) {
              tb.append(el('tr', {}, el('td', { text: p.stockistName }), el('td', { text: l.styleNumber }), el('td', { class: 'mono', text: String(l.requestedQuantity) }), el('td', { class: 'mono', text: String(l.allocatedQuantity) })));
            }
          }
        }).catch(() => undefined);
        const apply = buttonEl({ class: 'btn btn-primary', text: 'Apply split', onclick: () => {
          dlg.onResult(api('POST', `/api/drops/${dropId}/split`), (ok, fail) => {
            if (ok) announce(status, 'Split applied.');
            else announce(status, fail?.message ?? 'Splitting failed', true);
          });
        } });
        const cancel = buttonEl({ class: 'btn', text: 'Cancel', onclick: () => dlg.close() });
        return el('div', {}, proposalWrap, el('div', { class: 'btn-row' }, apply, cancel));
      },
      onSubmitted: () => { void reload(); void navigate(`/studio/drops/${dropId}/allocations`, { push: false, wipe: false }); }
    });
  } });

  async function enterDialog(label: string, submitText: string, endpoint: string, openerSuccessMessage: string): Promise<void> {
    let stockists: StockistOut[] = [];
    try { const res = await apiOk<{ items: StockistOut[] }>('GET', '/api/stockists?limit=50'); stockists = res.items ?? []; } catch { stockists = []; }
    openDialog({
      label, opener: null,
      body: (dlg) => {
        const stockist = el('select', { 'aria-label': 'Stockist' }) as HTMLSelectElement;
        stockist.append(el('option', { value: '', text: 'Choose a stockist' }));
        for (const s of stockists) stockist.append(el('option', { value: s.id, text: s.name }));
        const inputs = drop!.styles.map(s => ({ s, input: el('input', { type: 'number', min: '0', value: '0', 'aria-label': `${s.styleNumber} quantity`, class: 'mono' }) as HTMLInputElement }));
        const submit = buttonEl({ class: 'btn btn-primary', text: submitText, onclick: () => {
          dlg.onResult(api('POST', endpoint, {
            stockistId: stockist.value || undefined,
            lines: inputs.map(i => ({ styleNumber: i.s.styleNumber, quantity: Number(i.input.value) || 0 }))
          }), (ok, fail) => {
            if (ok) { announce(status, openerSuccessMessage); void reload(); }
            else if (fail?.code === 'allocation_exists') announce(status, 'This stockist already has an allocation for this drop.', true);
            else if (fail?.code === 'allocation_split') announce(status, 'The edition was already split, so requests are closed.', true);
            else announce(status, fail?.message ?? 'Saving failed', true);
          });
        } });
        const cancel = buttonEl({ class: 'btn', text: 'Cancel', onclick: () => dlg.close() });
        const body = el('div', {},
          el('label', { class: 'field' }, el('span', { class: 'label', text: 'Stockist' }), stockist),
          ...inputs.map(i => el('label', { class: 'field' }, el('span', { class: 'label', text: `${i.s.styleNumber} quantity` }), i.input)));
        if (label === 'Enter allocation') {
          const note = el('textarea', { 'aria-label': 'Internal note' }) as HTMLTextAreaElement;
          body.append(el('label', { class: 'field' }, el('span', { class: 'label', text: 'Internal note' }), note));
        }
        body.append(el('div', { class: 'btn-row' }, submit, cancel));
        return body;
      }
    });
  }

  const enterBtn = buttonEl({ class: 'btn', text: 'Enter allocation', onclick: () => void enterDialog('Enter allocation', 'Save allocation', `/api/drops/${dropId}/requests`, 'Allocation saved.') });
  const recordBtn = buttonEl({ class: 'btn', text: 'Record request', onclick: () => void enterDialog('Record request', 'Save request', `/api/drops/${dropId}/requests`, 'Request saved.') });

  root.append(h, el('section', { class: 'panel col-12' }, h2, table,
    el('div', { class: 'btn-row', style: 'margin-top: 14px;' }, splitBtn, enterBtn, recordBtn), status));
  await reload();
  return h;
}

export async function renderAllocation(root: HTMLElement, allocId: string): Promise<HTMLElement> {
  if (!(await ensureMember())) return renderAuthNeeded(root, `/studio/allocations/${allocId}`);
  renderHeader('/studio/drops');
  let a: AllocationOut | null = null;
  try { a = await apiOk<AllocationOut>('GET', `/api/allocations/${allocId}`); } catch { a = null; }
  if (!a) return renderNotFoundScreen(root);
  const h = el('h1', {}, `Allocation · ${a.stockistName}`);
  const status = liveRegion('Allocation status');
  let version = a.version;
  const table = el('table', {});
  table.append(el('caption', { text: 'Allocation lines' }));
  table.append(el('thead', {}, el('tr', {}, el('th', { text: 'Style' }), el('th', { text: 'Requested' }), el('th', { text: 'Allocated' }), el('th', { text: 'Unit price' }), el('th', { text: 'Net' }), el('th', { text: 'VAT' }), el('th', { text: 'Line total' }))));
  const tbody = el('tbody');
  table.append(tbody);
  const inputs: { styleNumber: string; input: HTMLInputElement }[] = [];
  for (const l of a.lines) {
    const input = el('input', { type: 'number', min: '0', value: String(l.allocatedQuantity), 'aria-label': `${l.styleNumber} allocated`, class: 'mono' }) as HTMLInputElement;
    inputs.push({ styleNumber: l.styleNumber, input });
    tbody.append(el('tr', {},
      el('td', { text: `${l.styleNumber} ${l.styleName}` }),
      el('td', { class: 'mono', text: String(l.requestedQuantity) }),
      el('td', {}, input),
      el('td', { class: 'mono', text: l.unitPriceMinor !== null ? money(l.unitPriceMinor, a!.currency) : '—' }),
      el('td', { class: 'mono', text: l.netMinor !== null ? money(l.netMinor, a!.currency) : '—' }),
      el('td', { class: 'mono', text: l.vatMinor !== null ? money(l.vatMinor, a!.currency) : '—' }),
      el('td', { class: 'mono', text: l.lineTotalMinor !== null ? money(l.lineTotalMinor, a!.currency) : '—' })));
  }
  if (a.lines.length === 0) tbody.append(emptyRow(7));
  const note = el('textarea', { 'aria-label': 'Internal note' }) as HTMLTextAreaElement;
  note.value = a.internalNote;
  const saveBtn = buttonEl({ class: 'btn btn-primary', text: 'Save allocation', onclick: async () => {
    const restore = pending(saveBtn, 'Saving allocation…');
    try {
      const res = await api<AllocationOut>('PATCH', `/api/allocations/${allocId}`, {
        version,
        lines: inputs.map(i => ({ styleNumber: i.styleNumber, quantity: Number(i.input.value) || 0 })),
        internalNote: note.value
      });
      version = res.data!.version;
      announce(status, 'Allocation saved.');
      await renderAllocation(root, allocId);
    } catch (err) {
      const fail = failOf(err);
      if (fail.status === 412) {
        announce(status, `Not saved: ${fail.savedBy} saved a newer version at ${fail.savedAt}. Showing their version.`, true);
        const current = fail.current as AllocationOut | undefined;
        if (current) { version = current.version; void renderAllocation(root, allocId); }
      } else if (fail.code === 'allocation_confirmed') announce(status, 'This allocation is already confirmed.', true);
      else announce(status, fail.message, true);
    } finally { restore(); }
  } });

  const confirmBtn = buttonEl({ class: 'btn', text: 'Confirm allocation', onclick: () => {
    openDialog({
      label: 'Confirm allocation', opener: confirmBtn, successFocus: h,
      body: (dlg) => {
        const quoteWrap = el('div', {});
        const table2 = el('table', {});
        table2.append(el('caption', { text: 'Quote' }));
        table2.append(el('thead', {}, el('tr', {}, el('th', { text: 'Style' }), el('th', { text: 'Quantity' }), el('th', { text: 'Unit price' }), el('th', { text: 'VAT' }), el('th', { text: 'Line total' }))));
        const tb = el('tbody');
        table2.append(tb);
        quoteWrap.append(table2, el('p', { class: 'note', text: `Prices from the list in force on ${dateWords(new Date().toISOString().slice(0, 10))}` }));
        const invoicingStatus = liveRegion('Invoicing status');
        void apiOk<{ lines: { styleNumber: string; quantity: number; unitPriceMinor: number; vatMinor: number; lineTotalMinor: number }[]; totalMinor: number; currency: string; priceListEffectiveDate: string }>('GET', `/api/allocations/${allocId}/quote`).then(q => {
          for (const l of q.lines ?? []) {
            tb.append(el('tr', {}, el('td', { text: l.styleNumber }), el('td', { class: 'mono', text: String(l.quantity) }),
              el('td', { class: 'mono', text: money(l.unitPriceMinor, q.currency) }),
              el('td', { class: 'mono', text: money(l.vatMinor, q.currency) }),
              el('td', { class: 'mono', text: money(l.lineTotalMinor, q.currency) })));
          }
        }).catch(() => undefined);
        const confirmAndInvoice = buttonEl({ class: 'btn btn-primary', text: 'Confirm and invoice', onclick: () => {
          confirmAndInvoice.disabled = true;
          dlg.onResult(api('POST', `/api/allocations/${allocId}/confirm`, { version }), (ok, fail) => {
            if (ok) announce(invoicingStatus, `Allocation confirmed. Invoice created; the confirmation email is on its way.`);
            else if (fail?.status === 503) announce(invoicingStatus, fail.message, true);
            else announce(invoicingStatus, fail?.message ?? 'Confirming failed', true);
          });
        } });
        const cancel = buttonEl({ class: 'btn', text: 'Cancel', onclick: () => dlg.close() });
        return el('div', {}, quoteWrap, invoicingStatus, el('div', { class: 'btn-row' }, confirmAndInvoice, cancel));
      }
    });
  } });

  const sheetLink = el('a', { class: 'btn', href: `/api/allocations/${allocId}/line-sheet.csv`, text: 'Download line sheet' });
  root.append(h, el('section', { class: 'panel col-12' }, table,
    el('label', { class: 'field' }, el('span', { class: 'label', text: 'Internal note' }), note),
    el('div', { class: 'btn-row', style: 'margin-top: 14px;' }, saveBtn, confirmBtn, sheetLink), status));
    return h;
}
