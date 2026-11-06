// Counterparties: the list, the page with previous names and cases sent, the
// add and edit sheets, and the spreadsheet import with its preview.
import { h, inputText, selectEl, radioGroup, radioValue } from './dom.js';
import { api } from './api.js';
import { navigate } from './router.js';
import { openDialog, type PanelHandle } from './panels.js';
import { problemsRegion, fieldErrorsClear } from './feedback.js';
import { staffView, h1 } from './staff-frame.js';
import { startPolling, registerDialogOpener } from './state.js';
import { fieldWrap, handleAuth } from './screens-cases.js';
import { formatStamp } from './format.js';

interface Counterparty { id: string; legalName: string; lei: string; jurisdictionCode: string; licenceNumber: string; dueDiligence: string; network: string; contactEmail: string | null; notes: string; updatedAt: string }

export async function renderCounterparties(root: HTMLElement, slug: string): Promise<void> {
  const view = await staffView(root, slug);
  if (view === null) return;
  const { desk } = view;
  const role = (await import('./state.js')).getSession()?.member.role ?? '';
  const canEdit = role === 'compliance_officer' || role === 'compliance_analyst';
  const tableWrap = h('div', { class: 'table-wrap' });

  const addButton = h('button', { type: 'button', class: 'btn btn-primary', 'aria-label': 'Add counterparty', onclick: (e: Event) => openAddSheet(e.currentTarget as HTMLElement) }, 'Add counterparty');
  registerDialogOpener('add-counterparty', (values) => {
    openAddSheet(addButton, values);
  });
  const importLink = h('a', { href: `/w/${slug}/counterparties/import`, class: 'link' }, 'Import spreadsheet');

  view.work.append(h('div', { class: 'screen-head' }, h1('Counterparties'),
    h('div', { class: 'head-actions' }, canEdit ? [addButton, importLink] : [])), tableWrap);

  async function load(): Promise<void> {
    const res = await api<{ counterparties: Counterparty[] }>('GET', `/api/w/${slug}/counterparties`);
    if (res.ok && res.body !== null) {
      const rows = res.body.counterparties;
      const headers = ['Legal name', 'LEI', 'Jurisdiction', 'Due diligence', 'Network'];
      tableWrap.replaceChildren(h('table', { 'aria-label': 'Counterparties', class: 'table' },
        h('thead', {}, h('tr', {}, headers.map((x) => h('th', { scope: 'col' }, x)))),
        h('tbody', {}, rows.length === 0
          ? h('tr', {}, h('td', { colspan: '5', class: 'empty' }, 'Nothing here yet.'))
          : rows.map((c) => h('tr', {},
            h('td', {}, h('a', { href: `/w/${slug}/counterparties/${c.id}` }, c.legalName)),
            h('td', { class: 'mono' }, c.lei),
            h('td', {}, c.jurisdictionCode),
            h('td', {}, c.dueDiligence),
            h('td', {}, c.network === 'on_network' ? 'On network' : 'Off network'))))));
      desk.repaint();
    } else if (res.status === 401) {
      handleAuth(res.error?.code ?? '', desk, 'none', {});
    }
  }

  function openAddSheet(opener: HTMLElement, initial: Record<string, string> = {}): void {
    let panel!: PanelHandle;
    panel = openDialog({
      name: 'Add counterparty', kind: 'sheet', opener, onClose: () => {},
      build: (dialog) => {
        const legalName = inputText({ id: 'legalName', 'aria-label': 'Legal name', class: 'input', value: initial.legalName ?? '' });
        const lei = inputText({ id: 'lei', 'aria-label': 'LEI', class: 'input mono', value: initial.lei ?? '' });
        const jurisdiction = selectEl({ id: 'jurisdictionCode', 'aria-label': 'Jurisdiction', class: 'select' }, [h('option', { value: '' }, 'Choose a jurisdiction')]);
        const licenceNumber = inputText({ id: 'licenceNumber', 'aria-label': 'Licence number', class: 'input' });
        const dueDiligence = radioGroup('Due diligence', [
          { value: 'pending', label: 'Pending', checked: true },
          { value: 'trusted', label: 'Trusted', checked: false },
          { value: 'restricted', label: 'Restricted', checked: false },
          { value: 'blocked', label: 'Blocked', checked: false },
        ]);
        const contactEmail = inputText({ id: 'contactEmail', 'aria-label': 'Contact email', class: 'input' });
        const notes = h('textarea', { id: 'notes', 'aria-label': 'Notes', class: 'input', rows: '3' }) as HTMLTextAreaElement;
        const counter = h('span', { class: 'notes-counter mono', 'aria-live': 'polite' }, `${codePoints(notes.value)} of 2,000`);
        notes.addEventListener('input', () => {
          counter.textContent = `${codePoints(notes.value)} of 2,000`;
        });
        const addresses = h('textarea', { id: 'addresses', 'aria-label': 'Wallet addresses', class: 'input mono', rows: '2' }) as HTMLTextAreaElement;

        dialog.append(h('h2', {}, 'Add counterparty'), problemsRegion(),
          fieldWrap(legalName, 'Legal name'), fieldWrap(lei, 'LEI'), fieldWrap(jurisdiction, 'Jurisdiction'),
          fieldWrap(licenceNumber, 'Licence number'), fieldWrap(dueDiligence, 'Due diligence'),
          fieldWrap(contactEmail, 'Contact email'),
          h('div', { class: 'field' }, h('label', { for: 'notes' }, 'Notes'), notes, counter),
          h('div', { class: 'field' }, h('label', { for: 'addresses' }, 'Wallet addresses'), addresses,
            h('div', { class: 'field-error', 'data-error-for': 'addresses' })),
          h('div', { class: 'dialog-actions' },
            h('button', { type: 'button', class: 'btn btn-primary', 'aria-label': 'Save counterparty', onclick: async () => {
              desk.announce('Saving…');
              fieldErrorsClear(dialog);
              const res = await api<{ counterparty: { id: string } }>('POST', `/api/w/${slug}/counterparties`, {
                legalName: legalName.value, lei: lei.value, jurisdictionCode: jurisdiction.value,
                licenceNumber: licenceNumber.value, dueDiligence: radioValue('Due diligence') ?? 'pending',
                contactEmail: contactEmail.value, notes: notes.value,
                addresses: addresses.value.split('\n').map((a) => a.trim()).filter((a) => a !== ''),
              });
              if (res.ok && res.body !== null) {
                desk.announce('Counterparty added.');
                panel.close();
                navigate(`/w/${slug}/counterparties/${res.body.counterparty.id}`);
              } else if (res.error !== null) {
                if (res.status === 401) { handleAuth(res.error.code, desk, 'add-counterparty', { legalName: legalName.value, lei: lei.value, notes: notes.value }); return; }
                desk.announce(res.error.message, 'error');
                if (Object.keys(res.error.fields).length > 0) desk.inlineErrors(dialog, res.error.fields);
              }
            } }, 'Save counterparty'),
            h('button', { type: 'button', class: 'btn', 'aria-label': 'Cancel', onclick: () => panel.close() }, 'Cancel')));
      },
    });
  }

  await load();
  startPolling(async () => {
    await load();
  });
}

function codePoints(value: string): number {
  let n = 0;
  for (const _ of value) n++;
  return n;
}

export async function renderCounterpartyPage(root: HTMLElement, slug: string, id: string): Promise<void> {
  const view = await staffView(root, slug);
  if (view === null) return;
  const { desk, ws } = view;
  const role = (await import('./state.js')).getSession()?.member.role ?? '';
  const canEdit = role === 'compliance_officer' || role === 'compliance_analyst';
  const res = await api<{ counterparty: Counterparty & { previousNames: { name: string; from: string; until: string | null }[]; addresses: string[]; casesSent: { id: string; reference: string; dataSentAt: string; nameAsSent: string | null }[] } }>('GET', `/api/w/${slug}/counterparties/${id}`);
  if (res.status === 401) { handleAuth(res.error?.code ?? '', desk, 'none', {}); return; }
  const counterpartyData = res.body?.counterparty;
  if (counterpartyData === undefined) {
    view.work.append(h1('Not found'));
    return;
  }
  const counterparty = counterpartyData;
  view.work.append(h('div', { class: 'screen-head' }, h1(counterparty.legalName),
    canEdit ? h('div', { class: 'head-actions' }, h('button', { type: 'button', class: 'btn', 'aria-label': 'Edit counterparty', onclick: (e: Event) => openEditSheet(e.currentTarget as HTMLElement) }, 'Edit counterparty')) : ''));

  view.work.append(factPairs([
    ['Legal name', counterparty.legalName],
    ['LEI', counterparty.lei],
    ['Jurisdiction', counterparty.jurisdictionCode],
    ['Licence number', counterparty.licenceNumber],
    ['Due diligence', counterparty.dueDiligence],
    ['Network', counterparty.network === 'on_network' ? 'On network' : 'Off network'],
    ['Contact email', counterparty.contactEmail ?? '—'],
    ['Notes', counterparty.notes === '' ? '—' : counterparty.notes],
    ['Updated', formatStamp(counterparty.updatedAt, ws.timeZone, ws.city)],
    ...counterparty.addresses.map((a): [string, string] => ['Wallet address', a]),
  ]));

  view.evidence.append(
    h('div', { class: 'evidence-section' },
      h('h2', {}, 'Previous names'),
      h('ul', { 'aria-label': 'Previous names', class: 'prev-names' },
        counterparty.previousNames.map((n) => h('li', { class: 'mono' }, `${n.name} (from ${n.from}${n.until !== null ? ` until ${n.until}` : ''})`)))),
    h('div', { class: 'evidence-section' },
      h('h2', {}, 'Cases sent'),
      h('table', { 'aria-label': 'Cases sent', class: 'table' },
        h('tbody', {}, counterparty.casesSent.length === 0
          ? h('tr', {}, h('td', { class: 'empty' }, 'Nothing here yet.'))
          : counterparty.casesSent.map((c) => h('tr', {},
            h('td', {}, h('a', { href: `/w/${slug}/cases/${c.id}` }, c.reference)),
            h('td', { class: 'mono' }, formatStamp(c.dataSentAt, ws.timeZone, ws.city)),
            h('td', {}, c.nameAsSent ?? '—')))))));

  function openEditSheet(opener: HTMLElement): void {
    let panel!: PanelHandle;
    panel = openDialog({
      name: 'Edit counterparty', kind: 'sheet', opener, onClose: () => {},
      build: (dialog) => {
        const legalName = inputText({ id: 'legalName', 'aria-label': 'Legal name', class: 'input', value: counterparty.legalName });
        const licenceNumber = inputText({ id: 'licenceNumber', 'aria-label': 'Licence number', class: 'input', value: counterparty.licenceNumber });
        const dueDiligence = radioGroup('Due diligence', [
          { value: 'trusted', label: 'Trusted', checked: counterparty.dueDiligence === 'trusted' },
          { value: 'pending', label: 'Pending', checked: counterparty.dueDiligence === 'pending' },
          { value: 'restricted', label: 'Restricted', checked: counterparty.dueDiligence === 'restricted' },
          { value: 'blocked', label: 'Blocked', checked: counterparty.dueDiligence === 'blocked' },
        ]);
        const contactEmail = inputText({ id: 'contactEmail', 'aria-label': 'Contact email', class: 'input', value: counterparty.contactEmail ?? '' });
        const notes = h('textarea', { id: 'notes', 'aria-label': 'Notes', class: 'input', rows: '3' }) as HTMLTextAreaElement;
        notes.value = counterparty.notes;

        dialog.append(h('h2', {}, 'Edit counterparty'), problemsRegion(),
          fieldWrap(legalName, 'Legal name'), fieldWrap(licenceNumber, 'Licence number'),
          fieldWrap(dueDiligence, 'Due diligence'), fieldWrap(contactEmail, 'Contact email'),
          fieldWrap(notes, 'Notes'),
          h('div', { class: 'dialog-actions' },
            h('button', { type: 'button', class: 'btn btn-primary', 'aria-label': 'Save changes', onclick: async () => {
              desk.announce('Saving…');
              fieldErrorsClear(dialog);
              const res = await api('PATCH', `/api/w/${slug}/counterparties/${id}`, {
                legalName: legalName.value, licenceNumber: licenceNumber.value,
                dueDiligence: radioValue('Due diligence') ?? 'pending',
                contactEmail: contactEmail.value, notes: notes.value,
              });
              if (res.ok) {
                desk.announce('Changes saved.');
                panel.close();
                await renderRoute();
              } else if (res.error !== null) {
                if (res.status === 401) { handleAuth(res.error.code, desk, 'edit-counterparty', { legalName: legalName.value, notes: notes.value }); return; }
                desk.announce(res.error.message, 'error');
                if (Object.keys(res.error.fields).length > 0) desk.inlineErrors(dialog, res.error.fields);
              }
            } }, 'Save changes'),
            h('button', { type: 'button', class: 'btn', 'aria-label': 'Cancel', onclick: () => panel.close() }, 'Cancel')));
      },
    });
  }
}

function factPairs(pairs: [string, string][]): HTMLElement {
  const dl = h('dl', { class: 'facts-list' });
  for (const [k, v] of pairs) dl.append(h('dt', {}, k), h('dd', {}, v));
  return dl;
}

async function renderRoute(): Promise<void> {
  const { renderRoute: rr } = await import('./router.js');
  await rr();
}

// ---------- Spreadsheet import ----------

export async function renderImport(root: HTMLElement, slug: string): Promise<void> {
  const view = await staffView(root, slug);
  if (view === null) return;
  const { desk } = view;
  let file: File | null = null;
  const previewWrap = h('div', { class: 'table-wrap' });
  const previewTable = h('table', { 'aria-label': 'Preview rows', class: 'table' },
    h('thead', {}, h('tr', {}, ['Row', 'Legal name', 'Outcome', 'Reason'].map((x) => h('th', { scope: 'col' }, x)))),
    h('tbody', {}, h('tr', {}, h('td', { colspan: '4', class: 'empty' }, 'Nothing here yet.'))));
  previewWrap.append(previewTable);

  const fileInput = h('input', { type: 'file', id: 'spreadsheetFile', name: 'Spreadsheet file', class: 'file-input', 'aria-label': 'Spreadsheet file', onchange: (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    file = input.files !== null && input.files.length > 0 ? input.files[0] : null;
    fileName.textContent = file !== null ? file.name : '';
  } }) as HTMLInputElement;
  const fileName = h('span', { class: 'file-name', 'aria-live': 'polite' }, '');

  view.work.append(
    h('div', { class: 'screen-head' }, h1('Import counterparties')),
    h('div', { class: 'field' },
      h('button', { type: 'button', class: 'btn', 'aria-label': 'Choose file', onclick: () => fileInput.click() }, 'Choose file'),
      fileName,
      fileInput),
    h('div', { class: 'head-actions' },
      h('button', { type: 'button', class: 'btn', 'aria-label': 'Preview', onclick: async () => {
        if (file === null) {
          desk.announce('Choose a spreadsheet first.', 'error');
          return;
        }
        desk.announce('Reading file…');
        const text = await file.text();
        const res = await api<{ rows: PreviewRow[]; summary: { matched: number; new: number; refused: number } }>('POST', `/api/w/${slug}/counterparties/import/preview`, text, { contentType: 'text/csv' });
        if (res.ok && res.body !== null) {
          const s = res.body.summary;
          desk.announce(`${res.body.rows.length} rows read: ${s.matched} matched, ${s.new} new, ${s.refused} refused.`);
          previewTable.replaceChildren(
            h('thead', {}, h('tr', {}, ['Row', 'Legal name', 'Outcome', 'Reason'].map((x) => h('th', { scope: 'col' }, x)))),
            h('tbody', {}, res.body.rows.map((row) => h('tr', {},
              h('td', { class: 'mono' }, String(row.row)),
              h('td', {}, row.legalName),
              h('td', {}, row.outcome),
              h('td', {}, row.reason ?? '')))));
        } else if (res.error !== null) {
          if (res.status === 401) { handleAuth(res.error.code, desk, 'none', {}); return; }
          desk.announce(res.error.message, 'error');
          if (Object.keys(res.error.fields).length > 0) {
            previewTable.replaceChildren(
              h('thead', {}, h('tr', {}, ['Row', 'Legal name', 'Outcome', 'Reason'].map((x) => h('th', { scope: 'col' }, x)))),
              h('tbody', {}, h('tr', {}, h('td', { colspan: '4', class: 'empty' }, Object.values(res.error.fields).join(' ')))));
          }
        }
      } }, 'Preview'),
      h('button', { type: 'button', class: 'btn btn-primary', 'aria-label': 'Save import', onclick: async () => {
        if (file === null) {
          desk.announce('Choose a spreadsheet first.', 'error');
          return;
        }
        desk.announce('Saving import…');
        const text = await file.text();
        const res = await api<{ created: number; updated: number; unchanged: number; refused: number }>('POST', `/api/w/${slug}/counterparties/import`, text, { contentType: 'text/csv' });
        if (res.ok && res.body !== null) {
          desk.announce(`Import saved: ${res.body.created} created, ${res.body.updated} updated, ${res.body.unchanged} unchanged.`);
        } else if (res.error !== null) {
          if (res.status === 401) { handleAuth(res.error.code, desk, 'none', {}); return; }
          desk.announce(res.error.message, 'error');
        }
      } }, 'Save import')),
    previewWrap);
}

interface PreviewRow { row: number; legalName: string; outcome: string; matchedBy: string | null; changedFields: string[]; reason: string | null }
