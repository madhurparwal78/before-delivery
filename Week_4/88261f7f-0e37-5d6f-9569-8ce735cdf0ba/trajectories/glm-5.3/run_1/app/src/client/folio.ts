import { ApiRequest, errorText } from './api.js';
import { el, status, dollarsToCents, centsToDollars } from './ui.js';
import type { Stay, Folio, Entry, Invoice } from './types.js';
import { formatMoney } from './types.js';
import { setNotice, refreshDeskData, renderTimeline, renderToday } from './desk.js';
import { trapTab } from './newStay.js';
import { setPanelFolioStatus } from './stayPanel.js';

/** Write a folio status message that survives re-renders. */
function setFolioStatusText(node: HTMLElement, text: string): void {
  setPanelFolioStatus(text);
  node.textContent = text;
}

export function openFolioRegion(stay: Stay, folio: Folio, folioStatus: HTMLElement, reload: () => Promise<void>): HTMLElement {
  const region = el('section', { class: 'folio', 'aria-label': folio.name });

  const render = () => renderFolioBody(region, stay, folio, folioStatus, reload);
  render();
  return region;
}

export function renderFolioBody(region: HTMLElement, stay: Stay, folio: Folio, folioStatus: HTMLElement, reload: () => Promise<void>): void {
  region.replaceChildren();
  const entriesTable = el('table', { class: 'data', 'aria-label': `${folio.name} entries` });
  entriesTable.append(el('thead', {}, el('tr', {},
    el('th', { text: 'Date' }), el('th', { text: 'Description' }), el('th', { class: 'num', text: 'Amount' }))));
  const tbody = el('tbody');
  for (const entry of folio.entries) {
    const row = el('tr', {});
    row.setAttribute('data-entry-id', entry.id);
    row.append(
      el('td', { text: entry.date }),
      el('td', { text: entry.description }),
      el('td', { class: 'num', text: formatMoney(entry.amountCents) })
    );
    if (entry.kind === 'charge' && !entry.reversesEntryId && !entry.splitOfEntryId) {
      const splitBtn = el('button', { text: `Split ${entry.description}` }) as HTMLButtonElement;
      splitBtn.addEventListener('click', () => openSplitDialog(stay, folio, entry, folioStatus, reload));
      const revBtn = el('button', { text: `Reverse ${entry.description}` }) as HTMLButtonElement;
      revBtn.addEventListener('click', async () => {
        setFolioStatusText(folioStatus, 'Posting reversal…');
        const res = await ApiRequest.post(`/api/entries/${entry.id}/reverse`);
        setFolioStatusText(folioStatus, res.status === 201 ? 'Reversal posted.' : errorText(res.data) ?? 'Reverse failed.');
        await reload();
      });
      row.append(el('td', {}, splitBtn, revBtn));
    } else {
      row.append(el('td', {}));
    }
    const otherFolios = stay.folios.filter(f => f.id !== folio.id);
    if (otherFolios.length > 0) {
      const moveBtn = el('button', { text: `Move ${entry.description}` }) as HTMLButtonElement;
      moveBtn.addEventListener('click', () => openMoveEntryDialog(stay, folio, entry, folioStatus, reload));
      row.append(el('td', {}, moveBtn));
    } else {
      row.append(el('td', {}));
    }
    tbody.append(row);
  }
  entriesTable.append(tbody);

  const balance = status(formatMoney(folio.balanceCents));
  balance.setAttribute('role', 'status');
  balance.setAttribute('aria-label', `${folio.name} balance`);
  const invoiceState = status(folio.invoice ? 'Issued' : 'Draft');
  invoiceState.setAttribute('role', 'status');
  invoiceState.setAttribute('aria-label', 'Invoice state');
  const mailState = status(folio.invoice ? (folio.invoice.mailState === 'sent' ? 'Sent' : 'Not sent') : 'Not sent');
  mailState.setAttribute('role', 'status');
  mailState.setAttribute('aria-label', 'Mail state');

  const payerName = el('input', { type: 'text', value: folio.payerName, 'aria-label': 'Payer name' }) as HTMLInputElement;
  const payerEmail = el('input', { type: 'text', value: folio.payerEmail, 'aria-label': 'Payer email' }) as HTMLInputElement;
  const savePayer = el('button', { text: 'Save payer' }) as HTMLButtonElement;
  savePayer.addEventListener('click', async () => {
    setFolioStatusText(folioStatus, 'Saving payer…');
    const res = await ApiRequest.patch(`/api/folios/${folio.id}`, { payerName: payerName.value, payerEmail: payerEmail.value });
    setFolioStatusText(folioStatus, res.status === 200 ? 'Payer saved.' : errorText(res.data) ?? 'Save failed.');
    await reload();
  });

  const addCharge = el('button', { text: 'Add charge' }) as HTMLButtonElement;
  addCharge.addEventListener('click', () => openChargeDialog(folio, folioStatus, reload));
  const recordPayment = el('button', { text: 'Record payment' }) as HTMLButtonElement;
  recordPayment.addEventListener('click', () => openPaymentDialog(folio, folioStatus, reload));
  const closeFolio = el('button', { text: 'Close folio' }) as HTMLButtonElement;
  closeFolio.addEventListener('click', async () => {
    closeFolio.setAttribute('aria-busy', 'true');
    setFolioStatusText(folioStatus, 'Creating invoice…');
    const res = await ApiRequest.post(`/api/folios/${folio.id}/close`);
    closeFolio.removeAttribute('aria-busy');
    if (res.status === 200) {
      setFolioStatusText(folioStatus, `Invoice ${res.data.invoice.number} issued.`);
    } else {
      setFolioStatusText(folioStatus, errorText(res.data) ?? 'Close failed.');
    }
    await reload();
  });
  const emailInvoice = el('button', { text: 'Email invoice' }) as HTMLButtonElement;
  emailInvoice.addEventListener('click', async () => {
    if (!folio.invoice) return;
    emailInvoice.setAttribute('aria-busy', 'true');
    setFolioStatusText(folioStatus, 'Sending invoice…');
    const res = await ApiRequest.post(`/api/invoices/${folio.invoice.id}/email`);
    emailInvoice.removeAttribute('aria-busy');
    if (res.status === 200) {
      setFolioStatusText(folioStatus, `Invoice ${res.data.number} sent to ${res.data.payerEmail}.`);
    } else {
      setFolioStatusText(folioStatus, errorText(res.data) ?? 'Email failed.');
    }
    await reload();
  });
  const downloadLink = folio.invoice
    ? el('a', { href: folio.invoice.pdfUrl, text: 'Download invoice' })
    : null;

  const disabled = folio.state === 'closed';
  for (const btn of [savePayer, addCharge, recordPayment]) btn.disabled = disabled;
  closeFolio.disabled = disabled;

  region.append(
    el('div', { class: 'folio-head' },
      el('h3', { text: folio.name }),
      balance, invoiceState, mailState),
    entriesTable,
    el('div', { class: 'form-row' }, el('label', { text: 'Payer name' }), payerName),
    el('div', { class: 'form-row' }, el('label', { text: 'Payer email' }), payerEmail),
    el('div', {}, savePayer, addCharge, recordPayment, closeFolio, emailInvoice, downloadLink)
  );
}

function openChargeDialog(folio: Folio, folioStatus: HTMLElement, reload: () => Promise<void>): void {
  const dialog = el('div', { class: 'dialog overlay-full', role: 'dialog', 'aria-label': 'Add charge' });
  const opener = document.activeElement as HTMLElement | null;
  const description = el('input', { type: 'text', 'aria-label': 'Description' }) as HTMLInputElement;
  const amount = el('input', { type: 'text', 'aria-label': 'Amount', placeholder: '123.45' }) as HTMLInputElement;
  const save = el('button', { text: 'Save charge', class: 'primary' }) as HTMLButtonElement;
  const close = () => { dialog.remove(); if (opener) opener.focus(); };
  save.addEventListener('click', async () => {
    const cents = dollarsToCents(amount.value);
    if (Number.isNaN(cents)) {
      setFolioStatusText(folioStatus, 'Enter an amount above zero.');
      return;
    }
    setFolioStatusText(folioStatus, 'Saving charge…');
    const res = await ApiRequest.post(`/api/folios/${folio.id}/charges`, { description: description.value, amountCents: cents });
    setFolioStatusText(folioStatus, res.status === 201 ? `Charge of ${formatMoney(cents)} added.` : errorText(res.data) ?? 'Charge failed.');
    close();
    await reload();
  });
  const closeBtn = el('button', { text: 'Close' }) as HTMLButtonElement;
  closeBtn.addEventListener('click', close);
  dialog.append(el('h2', { text: 'Add charge' }),
    el('div', { class: 'form-row' }, el('label', { text: 'Description' }), description),
    el('div', { class: 'form-row' }, el('label', { text: 'Amount' }), amount),
    el('div', {}, save, closeBtn));
  dialog.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { ev.stopPropagation(); close(); }
    if (ev.key === 'Tab') trapTab(ev, dialog);
  });
  document.body.append(dialog);
  description.focus();
}

function openPaymentDialog(folio: Folio, folioStatus: HTMLElement, reload: () => Promise<void>): void {
  const dialog = el('div', { class: 'dialog overlay-full', role: 'dialog', 'aria-label': 'Record payment' });
  const opener = document.activeElement as HTMLElement | null;
  const method = el('select', { 'aria-label': 'Payment method' }) as HTMLSelectElement;
  method.append(el('option', { value: 'cash', text: 'Cash' }), el('option', { value: 'card', text: 'Card' }));
  const amount = el('input', { type: 'text', 'aria-label': 'Amount', placeholder: '123.45' }) as HTMLInputElement;
  const reference = el('input', { type: 'text', 'aria-label': 'Terminal reference' }) as HTMLInputElement;
  const save = el('button', { text: 'Save payment', class: 'primary' }) as HTMLButtonElement;
  const close = () => { dialog.remove(); if (opener) opener.focus(); };
  save.addEventListener('click', async () => {
    const cents = dollarsToCents(amount.value);
    if (Number.isNaN(cents)) {
      setFolioStatusText(folioStatus, 'Enter an amount above zero.');
      return;
    }
    setFolioStatusText(folioStatus, 'Saving payment…');
    const body: Record<string, unknown> = { method: method.value, amountCents: cents };
    if (method.value === 'card') body.reference = reference.value;
    const res = await ApiRequest.post(`/api/folios/${folio.id}/payments`, body);
    setFolioStatusText(folioStatus, res.status === 201 ? `Payment of ${formatMoney(cents)} recorded.` : errorText(res.data) ?? 'Payment failed.');
    close();
    await reload();
  });
  const closeBtn = el('button', { text: 'Close' }) as HTMLButtonElement;
  closeBtn.addEventListener('click', close);
  dialog.append(el('h2', { text: 'Record payment' }),
    el('div', { class: 'form-row' }, el('label', { text: 'Payment method' }), method),
    el('div', { class: 'form-row' }, el('label', { text: 'Amount' }), amount),
    el('div', { class: 'form-row' }, el('label', { text: 'Terminal reference' }), reference),
    el('div', {}, save, closeBtn));
  dialog.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { ev.stopPropagation(); close(); }
    if (ev.key === 'Tab') trapTab(ev, dialog);
  });
  document.body.append(dialog);
  method.focus();
}

function openSplitDialog(stay: Stay, folio: Folio, entry: Entry, folioStatus: HTMLElement, reload: () => Promise<void>): void {
  const dialog = el('div', { class: 'dialog overlay-full', role: 'dialog', 'aria-label': 'Split charge' });
  const opener = document.activeElement as HTMLElement | null;
  const percentInputs: Array<{ input: HTMLInputElement; letter: string }> = [];
  const fieldsWrap = el('div', {});
  const previewTable = el('table', { class: 'data', 'aria-label': 'Split preview' });
  previewTable.append(el('thead', {}, el('tr', {},
    el('th', { text: 'Folio' }), el('th', { class: 'num', text: 'Percent' }), el('th', { class: 'num', text: 'Share' }))));

  let previewTimer: number | null = null;
  const addPayerField = () => {
    if (percentInputs.length >= 4) return;
    const letter = String.fromCharCode(65 + percentInputs.length);
    const input = el('input', { type: 'number', min: '0', max: '100', 'aria-label': `Folio ${letter} percent`, value: '' }) as HTMLInputElement;
    percentInputs.push({ input, letter });
    input.addEventListener('input', refreshPreview);
    fieldsWrap.append(el('div', { class: 'form-row' }, el('label', { text: `Folio ${letter} percent` }), input));
    refreshPreview();
  };
  addPayerField();
  addPayerField();

  const addPayer = el('button', { text: 'Add payer' }) as HTMLButtonElement;
  addPayer.addEventListener('click', addPayerField);

  function refreshPreview(): void {
    if (previewTimer !== null) window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(renderPreview, 100);
  }

  function renderPreview(): void {
    const tbody = el('tbody');
    const percents = percentInputs.map(p => p.input.value === '' ? null : Number(p.input.value));
    const complete = percents.every(p => p !== null) && percents.reduce((s: number, p: number | null) => s + (p ?? 0), 0) === 100;
    const shares = percents.map(p => {
      if (p === null || !complete) return null;
      return Math.floor(entry.amountCents * p / 100);
    });
    let remainder = complete ? entry.amountCents - shares.reduce((s: number, x: number | null) => s + (x ?? 0), 0) : 0;
    const ordered = percentInputs.map((p, i) => ({ letter: p.letter, idx: i })).sort((a, b) => a.letter.localeCompare(b.letter));
    const adjusted = [...shares];
    let li = 0;
    while (remainder > 0 && complete) {
      const target = ordered[li % ordered.length];
      adjusted[target.idx] = (adjusted[target.idx] ?? 0) + 1;
      remainder--;
      li++;
    }
    percentInputs.forEach((p, i) => {
      tbody.append(el('tr', {},
        el('td', { text: `Folio ${p.letter}` }),
        el('td', { class: 'num', text: percents[i] === null ? '—' : `${percents[i]}%` }),
        el('td', { class: 'num', text: complete ? formatMoney(adjusted[i] ?? 0) : '—' })));
    });
    previewTable.querySelector('tbody')?.remove();
    previewTable.append(tbody);
  }
  renderPreview();

  const apply = el('button', { text: 'Apply split', class: 'primary' }) as HTMLButtonElement;
  const close = () => { dialog.remove(); if (opener && document.contains(opener)) opener.focus(); };
  apply.addEventListener('click', async () => {
    const percents = percentInputs.map(p => Number(p.input.value));
    setFolioStatusText(folioStatus, 'Splitting charge…');
    const res = await ApiRequest.post(`/api/entries/${entry.id}/split`, { percents });
    if (res.status === 201) {
      setFolioStatusText(folioStatus, `Split ${formatMoney(entry.amountCents)} across ${percents.length} folios.`);
    } else {
      setFolioStatusText(folioStatus, errorText(res.data) ?? 'Split failed.');
    }
    close();
    await reload();
  });
  const closeBtn = el('button', { text: 'Close' }) as HTMLButtonElement;
  closeBtn.addEventListener('click', close);
  dialog.append(el('h2', { text: 'Split charge' }), fieldsWrap,
    el('div', {}, addPayer), previewTable, el('div', {}, apply, closeBtn));
  dialog.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { ev.stopPropagation(); close(); }
    if (ev.key === 'Tab') trapTab(ev, dialog);
  });
  document.body.append(dialog);
  percentInputs[0].input.focus();
}

function openMoveEntryDialog(stay: Stay, folio: Folio, entry: Entry, folioStatus: HTMLElement, reload: () => Promise<void>): void {
  const dialog = el('div', { class: 'dialog overlay-full', role: 'dialog', 'aria-label': 'Move entry' });
  const opener = document.activeElement as HTMLElement | null;
  const toFolio = el('select', { 'aria-label': 'To folio' }) as HTMLSelectElement;
  for (const f of stay.folios) {
    if (f.id !== folio.id && f.state === 'open') {
      toFolio.append(el('option', { value: f.id, text: f.name }));
    }
  }
  const save = el('button', { text: 'Save move', class: 'primary' }) as HTMLButtonElement;
  const close = () => { dialog.remove(); if (opener) opener.focus(); };
  save.addEventListener('click', async () => {
    setFolioStatusText(folioStatus, 'Moving entry…');
    const res = await ApiRequest.post(`/api/entries/${entry.id}/move`, { toFolioId: toFolio.value });
    setFolioStatusText(folioStatus, res.status === 200
      ? `Entry moved to ${(stay.folios.find(f => f.id === toFolio.value) ?? { name: 'folio' }).name}.`
      : errorText(res.data) ?? 'Move failed.');
    close();
    await reload();
  });
  const closeBtn = el('button', { text: 'Close' }) as HTMLButtonElement;
  closeBtn.addEventListener('click', close);
  dialog.append(el('h2', { text: 'Move entry' }),
    el('div', { class: 'form-row' }, el('label', { text: 'To folio' }), toFolio),
    el('div', {}, save, closeBtn));
  dialog.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { ev.stopPropagation(); close(); }
    if (ev.key === 'Tab') trapTab(ev, dialog);
  });
  document.body.append(dialog);
  toFolio.focus();
}

export { setNotice, refreshDeskData, renderTimeline, renderToday };
