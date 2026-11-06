// The line sheet screen: table, export currency, CSV export, the Import line
// sheet dialog and the Import report table.
import { api, apiOk, failOf, type DropStaff } from './api.js';
import { el, buttonEl, liveRegion, announce, pending, openDialog, emptyRow } from './ui.js';
import { renderHeader, renderAuthNeeded, renderNotFoundScreen, ensureMember } from './staff-helpers.js';

interface ImportReport { rows: number; matched: number; updated: number; unchanged: number; merged: { styleNumber: string; lines: number[] }[]; orphans: { line: number; styleNumber: string }[]; invalid: { line: number; field: string; message: string }[]; report?: { line: number; styleNumber: string; outcome: string }[]; }

export async function renderLineSheet(root: HTMLElement, dropId: string): Promise<HTMLElement> {
  if (!(await ensureMember())) return renderAuthNeeded(root, `/studio/drops/${dropId}/line-sheet`);
  renderHeader('/studio/drops');
  let drop: DropStaff | null = null;
  try { drop = await apiOk<DropStaff>('GET', `/api/drops/${dropId}`); } catch { drop = null; }
  if (!drop) return renderNotFoundScreen(root);
  const h = el('h1', {}, `Line sheet · ${drop.name}`);
  const status = liveRegion('Line sheet status');
  const table = el('table', { class: 'table-to-cards' });
  table.append(el('caption', { text: 'Line sheet' }));
  table.append(el('thead', {}, el('tr', {}, el('th', { text: 'Style number' }), el('th', { text: 'Name' }), el('th', { text: 'Colour' }), el('th', { text: 'Wholesale edition' }), el('th', { text: 'RRP DKK (minor)' }))));
  const tbody = el('tbody');
  table.append(tbody);
  function drawRows(): void {
    tbody.replaceChildren();
    for (const s of drop!.styles) {
      tbody.append(el('tr', {},
        el('td', { 'data-label': 'Style number', class: 'mono', text: s.styleNumber }),
        el('td', { 'data-label': 'Name', text: s.name }),
        el('td', { 'data-label': 'Colour', text: s.colour }),
        el('td', { 'data-label': 'Wholesale edition', class: 'mono', text: String(s.wholesaleEdition) }),
        el('td', { 'data-label': 'RRP DKK (minor)', class: 'mono', text: String(s.rrpDkkMinor) })));
    }
    if (tbody.children.length === 0) tbody.append(emptyRow(5));
  }
  drawRows();

  const currency = el('select', { 'aria-label': 'Export currency' }) as HTMLSelectElement;
  for (const c of ['DKK', 'SEK', 'EUR', 'GBP', 'USD', 'JPY']) currency.append(el('option', { value: c, text: c, ...(c === 'DKK' ? { selected: true } : {}) }));
  const exportBtn = el('a', { class: 'btn', text: 'Export CSV', href: `/api/drops/${dropId}/line-sheet.csv?currency=DKK` });
  currency.addEventListener('change', () => { exportBtn.setAttribute('href', `/api/drops/${dropId}/line-sheet.csv?currency=${currency.value}`); });

  const reportPanel = el('section', { class: 'panel', hidden: true });
  const reportH2 = el('h2', {}, 'Import report');
  reportPanel.append(reportH2);

  const importBtn = buttonEl({ class: 'btn', text: 'Import line sheet', onclick: () => {
    openDialog({
      label: 'Import line sheet', opener: importBtn, successFocus: reportH2,
      body: (dlg) => {
        const file = el('input', { type: 'file', 'aria-label': 'Line sheet file' }) as HTMLInputElement;
        const submit = buttonEl({ class: 'btn btn-primary', text: 'Import', onclick: async () => {
          if (!file.files?.[0]) { const box = dlg.root.querySelector('.dialog-error') as HTMLElement; if (box) { box.hidden = false; box.textContent = 'This field is required.'; } return; }
          const fd = new FormData();
          fd.append('file', file.files[0]);
          const restore = pending(submit, 'Importing…');
          try {
            const res = await fetch(`/api/drops/${dropId}/line-sheet/import`, { method: 'POST', body: fd });
            if (!res.ok) {
              const text = await res.text();
              let msg = 'Choose a CSV file. Nothing was imported.';
              try { msg = (JSON.parse(text) as { error: { message: string } }).error.message; } catch { /* keep */ }
              const box = dlg.root.querySelector('.dialog-error') as HTMLElement;
              if (box) { box.hidden = false; box.textContent = msg; }
              return;
            }
            const report = await res.json() as ImportReport;
            dlg.root.close();
            reportPanel.hidden = false;
            drawReport(report);
            announce(status, `Import finished: ${report.matched} matched, ${report.updated} updated, ${report.unchanged} unchanged, ${report.orphans.length === 1 ? '1 orphan row' : `${report.orphans.length} orphan rows`}.`);
            const fresh = await apiOk<DropStaff>('GET', `/api/drops/${dropId}`);
            drop = fresh;
            drawRows();
          } finally { restore(); }
        } });
        const cancel = buttonEl({ class: 'btn', text: 'Cancel', onclick: () => dlg.close() });
        return el('div', {},
          el('label', { class: 'field' }, el('span', { class: 'label', text: 'Line sheet file' }), file),
          el('div', { class: 'btn-row' }, submit, cancel));
      }
    });
  } });

  function drawReport(report: ImportReport): void {
    reportPanel.replaceChildren(reportH2);
    const wrap = el('div', { class: 'report-wrap' });
    const t = el('table', { class: 'report-table' });
    t.append(el('caption', { text: 'Import report' }));
    t.append(el('thead', {}, el('tr', {}, el('th', { text: 'Line' }), el('th', { text: 'Style number' }), el('th', { text: 'Outcome' }))));
    const tb = el('tbody');
    t.append(tb);
    for (const row of report.report ?? []) {
      tb.append(el('tr', {}, el('td', { class: 'mono', text: String(row.line) }), el('td', { class: 'mono', text: row.styleNumber || '—' }), el('td', { text: row.outcome })));
    }
    if (tb.children.length === 0) tb.append(emptyRow(3));
    wrap.append(t);
    reportPanel.append(wrap);
  }

  void failOf;
  root.append(h,
    el('section', { class: 'panel col-12' }, table, el('div', { class: 'btn-row', style: 'margin: 14px 0;' }, exportBtn, importBtn), status),
    reportPanel);
  return h;
}
