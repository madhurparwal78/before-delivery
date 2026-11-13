/**
 * The editor desk: import, settle, draft, preview, publish, correct, rename,
 * batch registration, and the Desk bar. All focus moves are worked out from
 * the server's answer.
 */
import { el, input, select, option, dialog, api, rupees, displayDate, type Catalogue, type NoticeVersion } from './lib.js';

interface SheetRow {
  rowNumber: number;
  raw: { code: string; description: string; newMrp: string; oldGst: string; newGst: string };
  status: string;
  matchedBy: string | null;
  skuCode: string | null;
  candidates: string[];
  reason: string | null;
  newMrpPaise: number | null;
  oldRate: number | null;
  newRate: number | null;
  mergedIntoRow: number | null;
  ignored: boolean;
}
interface SheetData {
  id: string;
  filename: string;
  sha256: string;
  counts: { matched: number; ambiguous: number; unmatched: number; settled: number };
  rows: SheetRow[];
}
interface DraftRow {
  skuCode: string;
  name: string;
  kind: string;
  oldMrpPaise: number;
  revisedMrpPaise: number;
  oldRate: number | null;
  newRate: number | null;
  ceilingPaise: number | null;
}
interface Draft {
  id: string;
  revision: number;
  title: string;
  effectiveDate: string;
  runOutUntil: string | null;
  sheet: { id: string; sha256: string } | null;
  rows: DraftRow[];
}
interface PreviewBody {
  blocking: { message: string; rows?: unknown } | null;
  rows: Array<{ skuCode: string; name: string; kind: string; oldMrpPaise: number; ceilingPaise: number | null; revisedMrpPaise: number; stickerBatches: string[] }>;
}

async function runEditor(): Promise<void> {
  const app = document.getElementById('app') as HTMLElement;
  const session = await api<{ role: string; accountId: string }>('/api/session');
  if (!session.ok) {
    location.href = '/sign-in';
    return;
  }
  const loadedAccount = session.body.accountId;
  app.textContent = '';

  const publishStatus = el('div', { role: 'status', 'aria-live': 'polite', id: 'publish-status', class: 'status-line live-region' });
  const printStatus = el('div', { role: 'status', 'aria-live': 'polite', id: 'print-status', class: 'status-line live-region' });
  printStatus.tabIndex = -1;
  const importStatus = el('div', { role: 'status', 'aria-live': 'polite', id: 'import-status', class: 'status-line live-region' });
  const renameStatus = el('div', { role: 'status', 'aria-live': 'polite', id: 'rename-status', class: 'status-line live-region' });
  const batchStatus = el('div', { role: 'status', 'aria-live': 'polite', id: 'batch-status', class: 'status-line live-region' });
  const heldWork = el('section', { 'aria-label': 'Held work', id: 'held-work', class: 'held-work-line' });
  const workStatusLine = el('div', { role: 'status', 'aria-live': 'polite', id: 'work-status', class: 'status-line live-region' });
  const messageAlert = el('div', { role: 'alert', id: 'message-status', class: 'outage-alert' });
  const workAlert = el('div', { role: 'alert', id: 'work-status-alert', class: 'outage-alert' });

  const desk = el('div', { class: 'desk' });
  const countsLine = el('p', { class: 'counts-line', id: 'counts-line' });
  const signOut = el('button', { class: 'rectangle-button', text: 'Sign out' });
  signOut.addEventListener('click', () => {
    void api('/api/session', { method: 'DELETE' }).then(() => {
      location.href = '/';
    });
  });
  const columns = el('div', { class: 'desk-columns' });
  const colA = el('div');
  const colB = el('div');
  columns.append(colA, colB);
  desk.append(countsLine, heldWork, signOut, columns);
  app.append(desk, messageAlert, workAlert);

  // ---- import desk ----
  const fileLabel = el('label', { class: 'form-label', for: 'price-sheet-file', text: 'Price sheet file' });
  const fileInput = input({ type: 'file', id: 'price-sheet-file', class: 'form-input' });
  const importButton = el('button', { class: 'rectangle-button', text: 'Import sheet' });
  const callSheet = el('div', { class: 'call-sheet' });
  const matchedRegion = el('section', { 'aria-label': 'Matched', class: 'desk-section' });
  const ambiguousRegion = el('section', { 'aria-label': 'Ambiguous', class: 'desk-section' });
  const unmatchedRegion = el('section', { 'aria-label': 'Unmatched', class: 'desk-section' });
  const sheetShaMap = new Map<string, string>();
  colA.append(el('h2', { text: 'Import desk' }), fileLabel, fileInput, importButton, importStatus, callSheet);
  callSheet.append(matchedRegion, ambiguousRegion, unmatchedRegion);

  const sheetsRegion = el('div');
  const draftTitleInput = input({ type: 'text', class: 'form-input', 'aria-label': 'Draft title', id: 'draft-title' });
  const draftDateInput = input({ type: 'text', class: 'form-input', 'aria-label': 'Draft effective date', id: 'draft-effective-date' });
  const draftingForm = el('div');
  draftingForm.append(
    el('label', { class: 'form-label', for: 'draft-title', text: 'Draft title' }),
    draftTitleInput,
    el('label', { class: 'form-label', for: 'draft-effective-date', text: 'Draft effective date' }),
    draftDateInput
  );
  colB.append(el('h2', { text: 'Sheets on file' }), sheetsRegion, draftingForm, el('h2', { text: 'Drafts' }));

  const draftsRegion = el('div');
  const noticesRegion = el('div');
  colB.append(draftsRegion, printStatus, publishStatus, el('h2', { text: 'Published notices' }), noticesRegion);

  // ---- renames ----
  const drinkSelect = select({ class: 'form-input', 'aria-label': 'Drink', id: 'drink-select' });
  const drinkNameInput = input({ type: 'text', class: 'form-input', 'aria-label': 'New drink name' });
  const renameDrinkButton = el('button', { class: 'rectangle-button', text: 'Rename drink' });
  const packSelect = select({ class: 'form-input', 'aria-label': 'Pack', id: 'pack-select' });
  const packWordingInput = input({ type: 'text', class: 'form-input', 'aria-label': 'New pack wording' });
  const renamePackButton = el('button', { class: 'rectangle-button', text: 'Rename pack' });
  const packHistory = el('section', { 'aria-label': 'Pack history', id: 'pack-history' });
  colA.append(el('h2', { text: 'Renames and history' }), drinkSelect, drinkNameInput, renameDrinkButton, packSelect, packWordingInput, renamePackButton, renameStatus, packHistory);

  // ---- batch registration ----
  const batchCodeInput = input({ type: 'text', class: 'form-input', 'aria-label': 'New batch code' });
  const batchPackSelect = select({ class: 'form-input', 'aria-label': 'Batch pack' });
  const oldWrapperCheck = input({ type: 'checkbox', id: 'old-wrapper' });
  const oldWrapperLabel = el('label', { for: 'old-wrapper', text: 'Old wrapper' });
  const registerBatchButton = el('button', { class: 'rectangle-button', text: 'Register batch' });
  colA.append(el('h2', { text: 'Batch registration' }), batchCodeInput, batchPackSelect, oldWrapperLabel, oldWrapperCheck, registerBatchButton, batchStatus);
  oldWrapperLabel.appendChild(oldWrapperCheck);

  // ---- Desk bar ----
  const deskBar = el('section', { 'aria-label': 'Desk bar', class: 'desk-bar', id: 'desk-bar' });
  const openRowsSentence = el('span', { id: 'open-rows-sentence' });
  const nextOpenRowButton = el('button', { text: 'Next open row' });
  deskBar.append(openRowsSentence, nextOpenRowButton);
  app.appendChild(deskBar);

  let lastFocusedRow = 0;
  const chosenSettles = new Map<string, string>();
  nextOpenRowButton.addEventListener('click', () => {
    const combos = Array.from(document.querySelectorAll<HTMLSelectElement>('select[data-row]'));
    if (combos.length === 0) return;
    const next = combos.find((c) => Number(c.dataset.row) > lastFocusedRow) ?? combos[0];
    lastFocusedRow = Number(next.dataset.row);
    next.focus();
  });

  let catalogue: Catalogue | null = null;
  const skuOptions = (): Array<{ code: string; label: string }> => {
    if (!catalogue) return [];
    const out: Array<{ code: string; label: string }> = [];
    for (const d of catalogue.drinks) for (const s of d.skus) out.push({ code: s.code, label: `${s.code} ${s.name}` });
    return out;
  };

  function openRowCount(sheet: SheetData | null): number {
    if (!sheet) return 0;
    return sheet.rows.filter((r) => (r.status === 'ambiguous' || r.status === 'unmatched') && !r.ignored && r.mergedIntoRow === null).length;
  }

  function updateDeskBar(open: number): void {
    if (open === 0) {
      deskBar.dataset.show = 'false';
      return;
    }
    deskBar.dataset.show = 'true';
    openRowsSentence.textContent = open === 1 ? '1 row open.' : `${open} rows open.`;
  }

  function drawSheet(sheet: SheetData): void {
    for (const section of [matchedRegion, ambiguousRegion, unmatchedRegion]) section.textContent = '';
    matchedRegion.appendChild(el('h3', { class: 'desk-heading', text: 'Matched' }));
    ambiguousRegion.appendChild(el('h3', { class: 'desk-heading', text: 'Ambiguous' }));
    unmatchedRegion.appendChild(el('h3', { class: 'desk-heading', text: 'Unmatched' }));
    const sections: Record<string, HTMLElement> = { matched: matchedRegion, settled: matchedRegion, ambiguous: ambiguousRegion, unmatched: unmatchedRegion };
    for (const row of sheet.rows) {
      if (row.ignored) continue;
      if (row.mergedIntoRow !== null) continue;
      const target = sections[row.status] ?? unmatchedRegion;
      const line = el('div', { class: 'row-line' });
      line.appendChild(el('div', { class: 'raw', text: `${row.rowNumber}. ${row.raw.description} — ${row.raw.newMrp}` }));
      const open = row.status === 'ambiguous' || row.status === 'unmatched';
      if (open) {
        const actions = el('div', { class: 'row-actions' });
        const combo = select({ class: 'form-input', 'aria-label': `Settle row ${row.rowNumber} to`, 'data-row': String(row.rowNumber) });
        for (const o of skuOptions()) combo.appendChild(option(o.code, o.label));
        const chosen = chosenSettles.get(`${sheet.id}#${row.rowNumber}`);
        if (chosen) combo.value = chosen;
        combo.addEventListener('change', () => chosenSettles.set(`${sheet.id}#${row.rowNumber}`, combo.value));
        const settleButton = el('button', { class: 'rectangle-button', text: `Settle row ${row.rowNumber}` });
        settleButton.addEventListener('click', () => {
          chosenSettles.set(`${sheet.id}#${row.rowNumber}`, combo.value);
          void settleRow(sheet.id, row.rowNumber, { skuCode: combo.value });
        });
        const ignoreButton = el('button', { class: 'rectangle-button', text: `Ignore row ${row.rowNumber}` });
        ignoreButton.addEventListener('click', () => {
          void settleRow(sheet.id, row.rowNumber, { ignore: true });
        });
        actions.append(combo, settleButton, ignoreButton);
        line.appendChild(actions);
      } else {
        const bits = [row.status];
        if (row.skuCode) bits.push(row.skuCode);
        if (row.reason) bits.push(row.reason);
        line.appendChild(el('div', { text: bits.join(' — ') }));
      }
      target.appendChild(line);
    }
    updateDeskBar(openRowCount(sheet));
  }

  async function settleRow(sheetId: string, rowNumber: number, body: Record<string, unknown>): Promise<void> {
    importStatus.textContent = `Saving row ${rowNumber}.`;
    const r = await api<{ sheet: SheetData }>(`/api/editor/price-sheets/${sheetId}/rows/${rowNumber}/settle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.status === 401) { location.href = '/sign-in'; return; }
    if (r.ok) {
      importStatus.textContent = `Row ${rowNumber} settled.`;
      drawSheet(r.body.sheet);
      focusNextRow(rowNumber, r.body.sheet);
    } else {
      importStatus.textContent = (r.body as { message?: string }).message ?? '';
    }
  }

  function focusNextRow(n: number, sheet: SheetData): void {
    const openRows = sheet.rows.filter((r) => (r.status === 'ambiguous' || r.status === 'unmatched') && !r.ignored && r.mergedIntoRow === null).map((r) => r.rowNumber);
    const higher = openRows.filter((x) => x > n);
    const next = higher.length > 0 ? Math.min(...higher) : openRows.length > 0 ? Math.min(...openRows) : null;
    if (next !== null) {
      const combo = document.querySelector(`select[data-row="${next}"]`) as HTMLElement | null;
      if (combo) {
        combo.focus();
        return;
      }
    }
    const btn = document.querySelector(`button[data-draft-sheet="${sheet.id}"]`) as HTMLElement | null;
    btn?.focus();
  }

  importButton.addEventListener('click', () => {
    const file = fileInput.files?.[0];
    if (!file) {
      importStatus.textContent = 'Choose a price sheet first.';
      return;
    }
    importStatus.textContent = 'Reading the sheet.';
    void (async () => {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/editor/price-sheets', { method: 'POST', body: fd, credentials: 'same-origin' });
      if (res.status === 401) { location.href = '/sign-in'; return; }
      const body = (await res.json()) as { sheet?: SheetData; message?: string };
      if (!res.ok) {
        importStatus.textContent = body.message ?? '';
        return;
      }
      if (res.status === 200) {
        importStatus.textContent = 'This sheet is already on file. Nothing new was stored.';
      } else if (body.sheet) {
        const c = body.sheet.counts;
        importStatus.textContent = `${body.sheet.rows.length} rows read: ${c.matched} matched, ${c.ambiguous} ambiguous, ${c.unmatched} unmatched.`;
      }
      if (body.sheet) {
        sheetShaMap.set(body.sheet.id, body.sheet.sha256);
        drawSheet(body.sheet);
      }
      await refresh();
    })();
  });

  // ---- renames ----
  async function drawRenameControls(keepDrink?: string, keepPack?: string): Promise<void> {
    const c = await api<Catalogue>('/api/catalogue');
    if (!c.ok) return;
    catalogue = c.body;
    const prevDrink = keepDrink ?? drinkSelect.value;
    const prevPack = keepPack ?? packSelect.value;
    drinkSelect.textContent = '';
    for (const d of c.body.drinks) drinkSelect.appendChild(option(d.id, d.name));
    if (prevDrink) drinkSelect.value = prevDrink;
    const drink = c.body.drinks.find((d) => d.id === drinkSelect.value) ?? c.body.drinks[0];
    packSelect.textContent = '';
    if (drink) {
      for (const s of drink.skus) packSelect.appendChild(option(s.code, `${s.code} ${s.variant}`));
      if (prevPack && drink.skus.some((s) => s.code === prevPack)) packSelect.value = prevPack;
    }
    batchPackSelect.textContent = '';
    for (const o of skuOptions()) batchPackSelect.appendChild(option(o.code, o.label));
  }
  await drawRenameControls();

  drinkSelect.addEventListener('change', () => {
    void drawRenameControls(drinkSelect.value, undefined);
    void drawHistory(packSelect.value);
  });
  packSelect.addEventListener('change', () => void drawHistory(packSelect.value));

  async function drawHistory(code: string): Promise<void> {
    if (!code) return;
    const r = await api<{ history: Array<{ at: string; field: string; from: string; to: string }> }>(`/api/editor/skus/${encodeURIComponent(code)}/history`);
    packHistory.textContent = '';
    if (!r.ok) return;
    for (const h of r.body.history) {
      packHistory.appendChild(el('div', { class: 'row-line', text: `${h.field}: ${h.from} → ${h.to}` }));
    }
  }
  await drawHistory(packSelect.value);

  renameDrinkButton.addEventListener('click', () => {
    renameStatus.textContent = 'Renaming.';
    void (async () => {
      const r = await api(`/api/editor/drinks/${encodeURIComponent(drinkSelect.value)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: drinkNameInput.value }),
      });
      if (r.status === 401) { location.href = '/sign-in'; return; }
      renameStatus.textContent = r.ok ? 'Renamed. Published notices keep their old name.' : (r.body as { message?: string }).message ?? '';
      await drawRenameControls(drinkSelect.value, packSelect.value);
      renameDrinkButton.focus();
    })();
  });

  renamePackButton.addEventListener('click', () => {
    renameStatus.textContent = 'Renaming.';
    void (async () => {
      const r = await api(`/api/editor/skus/${encodeURIComponent(packSelect.value)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variant: packWordingInput.value }),
      });
      if (r.status === 401) { location.href = '/sign-in'; return; }
      renameStatus.textContent = r.ok ? 'Renamed. Published notices keep their old name.' : (r.body as { message?: string }).message ?? '';
      await drawRenameControls(drinkSelect.value, packSelect.value);
      await drawHistory(packSelect.value);
      renamePackButton.focus();
    })();
  });

  registerBatchButton.addEventListener('click', () => {
    batchStatus.textContent = 'Registering.';
    void (async () => {
      const code = batchCodeInput.value.trim().toUpperCase();
      const r = await api('/api/editor/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, skuCode: batchPackSelect.value, oldWrapper: oldWrapperCheck.checked }),
      });
      if (r.status === 401) { location.href = '/sign-in'; return; }
      batchStatus.textContent = r.ok ? `Batch ${code} registered.` : (r.body as { message?: string }).message ?? '';
    })();
  });

  // ---- sheets on file, drafting, drafts, notices ----
  interface EditorBody {
    copyId: string;
    messagesQueued: boolean;
    workQueued: boolean;
    searchState: string;
    heldWork: number;
    counts: { drinks: number; skus: number; notices: number; scheduledRevisions: number };
    drafts: Draft[];
    notices: Array<{ number: string; versions: NoticeVersion[] }>;
  }

  async function refresh(): Promise<void> {
    const r = await api<EditorBody>('/api/editor/notices');
    if (r.status === 401) { location.href = '/sign-in'; return; }
    if (r.status === 403) { location.href = '/stockist'; return; }
    const s = await api<{ accountId: string }>('/api/session');
    if (s.status === 401) { location.href = '/sign-in'; return; }
    if (s.ok && s.body.accountId !== loadedAccount) { location.href = '/editor'; return; }
    if (!r.ok) return;
    messageAlert.textContent = r.body.messagesQueued ? 'Stockist messages are queued. Nothing has been lost.' : '';
    workAlert.textContent = r.body.workQueued ? 'Background work is queued. Nothing has been lost.' : '';
    countsLine.textContent = `Drinks: ${r.body.counts.drinks}. Packs: ${r.body.counts.skus}. Notices: ${r.body.counts.notices}. Scheduled revisions: ${r.body.counts.scheduledRevisions}.`;
    const heldText = `Work set aside: ${r.body.heldWork}.`;
    if (heldWork.textContent !== heldText) {
      const prev = Number(heldWork.dataset.count ?? '0');
      if (r.body.heldWork > prev) workStatusLine.textContent = 'A broken job was set aside. No notice was affected.';
      heldWork.textContent = heldText;
      heldWork.dataset.count = String(r.body.heldWork);
    }
    drawDrafts(r.body.drafts);
    drawNotices(r.body.notices);
    await drawSheetsOnFile();
  }

  async function drawSheetsOnFile(): Promise<void> {
    const r = await api<{ sheets: SheetData[] }>('/api/editor/price-sheets');
    if (!r.ok) return;
    sheetsRegion.textContent = '';
    if (r.body.sheets.length === 0) {
      sheetsRegion.appendChild(el('p', { class: 'runout-line', text: `CALL SHEET EMPTY — import the plant's price sheet to begin.` }));
      return;
    }
    for (const s of r.body.sheets) {
      sheetShaMap.set(s.id, s.sha256);
      const line = el('div', { class: 'row-line' });
      const dl = el('a', { class: 'download-link', text: `Download sheet ${s.filename}`, href: `/api/editor/price-sheets/${s.id}/download` });
      line.append(dl, el('div', { class: 'sha-line', text: s.sha256 }));
      const draftButton = el('button', { class: 'rectangle-button', text: `Draft notice from sheet ${s.filename}`, 'data-draft-sheet': s.id });
      const full = await api<{ sheet: SheetData }>(`/api/editor/price-sheets/${s.id}`);
      const open = full.ok ? openRowCount(full.body.sheet) : 0;
      updateDeskBar(open);
      if (open > 0) draftButton.setAttribute('aria-disabled', 'true');
      draftButton.addEventListener('click', () => {
        publishStatus.textContent = 'Drafting from the sheet.';
        void (async () => {
          const rr = await api<Draft>(`/api/editor/price-sheets/${s.id}/draft`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: draftTitleInput.value, effectiveDate: draftDateInput.value }),
          });
          if (rr.ok) {
            publishStatus.textContent = 'Draft created from the sheet.';
            await refresh();
            const first = document.querySelector('input[data-draft-title]') as HTMLElement | null;
            first?.focus();
          } else {
            publishStatus.textContent = (rr.body as { message?: string }).message ?? '';
          }
        })();
      });
      line.appendChild(draftButton);
      sheetsRegion.appendChild(line);
    }
  }

  function draftRowsBody(d: Draft, withRevision: boolean): Record<string, unknown> {
    const out: Record<string, unknown> = {
      title: d.title,
      effectiveDate: d.effectiveDate,
      runOutUntil: d.runOutUntil,
      rows: d.rows.map((r) => ({
        skuCode: r.skuCode,
        kind: r.kind,
        revisedMrpPaise: r.revisedMrpPaise,
        oldRate: r.oldRate,
        newRate: r.newRate,
      })),
    };
    if (withRevision) out.baseRevision = d.revision;
    return out;
  }

  function drawDrafts(drafts: Draft[]): void {
    draftsRegion.textContent = '';
    if (drafts.length === 0) {
      draftsRegion.appendChild(el('p', { class: 'runout-line', text: `NOTHING IN THE CAN — draft a notice from a settled sheet.` }));
      return;
    }
    for (const d of drafts) {
      const group = el('div', { class: 'row-line', role: 'group', 'aria-label': `Draft ${d.id}` });
      group.appendChild(el('h3', { text: d.title }));
      const titleInput = input({ type: 'text', class: 'form-input', 'aria-label': 'Notice title', 'data-draft-title': d.id, value: d.title });
      const effInput = input({ type: 'text', class: 'form-input', 'aria-label': 'Effective date', value: d.effectiveDate });
      const runInput = input({ type: 'text', class: 'form-input', 'aria-label': 'Old wrappers until', value: d.runOutUntil ?? '' });
      group.append(
        el('label', { class: 'form-label', text: 'Notice title' }),
        titleInput,
        el('label', { class: 'form-label', text: 'Effective date' }),
        effInput,
        el('label', { class: 'form-label', text: 'Old wrappers until' }),
        runInput
      );
      for (const row of d.rows) {
        const rowLine = el('div', { class: 'row-line' });
        rowLine.appendChild(el('span', { text: `${row.skuCode} ${row.name} — ${rupees(row.oldMrpPaise)} to ${rupees(row.revisedMrpPaise)} (${row.kind === 'sticker' ? 'Sticker' : 'New print'})` }));
        const field = input({
          type: 'text',
          class: 'form-input',
          'aria-label': `Revised MRP for ${row.skuCode}`,
          value: rupees(row.revisedMrpPaise).replace('Rs ', ''),
          'data-sku': row.skuCode,
        });
        rowLine.appendChild(field);
        group.appendChild(rowLine);
      }
      const previewRegion = el('section', { 'aria-label': `Publish preview ${d.id}` });
      const previewStatus = el('div', { role: 'status', 'aria-live': 'polite', id: `preview-status-${d.id}`, class: 'status-line live-region' });
      const refusedList = el('ol', { 'aria-label': `Refused rows ${d.id}` });
      group.append(previewRegion, previewStatus, refusedList);

      const liveDraft = (): Draft => ({
        ...d,
        title: titleInput.value,
        effectiveDate: effInput.value,
        runOutUntil: runInput.value === '' ? null : runInput.value,
        rows: d.rows.map((row, i) => {
          const input = (group.querySelectorAll(`input[data-sku="${row.skuCode}"]`) as NodeListOf<HTMLInputElement>)[i];
          const typed = (input?.value ?? '').trim();
          const rupeesNum = /^Rs?\s*([0-9]+(?:\.[0-9]{1,2})?)$/.exec(typed);
          return { ...row, revisedMrpPaise: rupeesNum ? Math.round(Number(rupeesNum[1]) * 100) : row.revisedMrpPaise };
        }),
      });

      const runPreview = async (): Promise<void> => {
        const body = draftRowsBody(liveDraft(), true);
        const r = await api<PreviewBody>(`/api/editor/notices/${d.id}/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!r.ok) return;
        drawPreview(previewRegion, previewStatus, refusedList, r.body, d.id);
      };

      for (const input of [titleInput, effInput, runInput, ...Array.from(group.querySelectorAll('input[data-sku]'))]) {
        input.addEventListener('input', () => {
          window.clearTimeout((input as unknown as { _t?: number })._t);
          (input as unknown as { _t?: number })._t = window.setTimeout(() => void runPreview(), 400);
        });
      }
      void runPreview();

      const saveButton = el('button', { class: 'rectangle-button', text: 'Save draft' });
      saveButton.addEventListener('click', () => {
        publishStatus.textContent = 'Saving draft.';
        void (async () => {
          const r = await api<Draft>(`/api/editor/notices/${d.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(draftRowsBody(liveDraft(), true)),
          });
          if (r.ok) {
            publishStatus.textContent = 'Draft saved.';
            await refresh();
          } else {
            publishStatus.textContent = (r.body as { message?: string }).message ?? '';
          }
        })();
      });
      const publishButton = el('button', { class: 'rectangle-button', text: `Publish ${d.title}` });
      publishButton.addEventListener('click', () => {
        openConfirmDialog(d, liveDraft());
      });
      group.append(saveButton, publishButton);
      draftsRegion.appendChild(group);
    }
  }

  function drawPreview(region: HTMLElement, status: HTMLElement, refusedList: HTMLElement, p: PreviewBody, id: string): void {
    region.textContent = '';
    const table = el('table', { 'aria-label': `Publish preview ${id}`, class: 'responsive' });
    const thead = el('thead');
    const hr = el('tr');
    for (const c of ['Pack', 'Old MRP', 'Ceiling', 'Packs that take the sticker']) hr.appendChild(el('th', { text: c }));
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = el('tbody');
    for (const row of p.rows) {
      const tr = el('tr');
      tr.append(
        el('td', { text: row.name }),
        el('td', { text: rupees(row.oldMrpPaise) }),
        el('td', { text: row.ceilingPaise === null ? 'None' : rupees(row.ceilingPaise) }),
        el('td', { text: row.stickerBatches.length === 0 ? 'None' : row.stickerBatches.join(', ') })
      );
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    region.appendChild(table);
    status.textContent = p.blocking ? p.blocking.message : 'Ready to publish.';

    refusedList.textContent = '';
    if (p.blocking && Array.isArray(p.blocking.rows) && typeof p.blocking.message === 'string' && !p.blocking.message.startsWith('Old the ceiling')) {
      const rows = p.blocking.rows as Array<Record<string, unknown>>;
      const codes: string[] = [];
      for (const rr of rows) {
        if (typeof rr === 'string') codes.push(rr);
        else if (typeof rr.skuCode === 'string') codes.push(rr.skuCode);
      }
      for (const code of codes) {
        const li = el('li');
        const link = el('a', { href: '#', text: `Fix ${code}` });
        link.addEventListener('click', (e) => {
          e.preventDefault();
          const field = document.querySelector(`input[data-sku="${code}"]`) as HTMLElement | null;
          field?.focus();
        });
        li.appendChild(link);
        refusedList.appendChild(li);
      }
    }
  }

  const confirmDialog = dialog({ 'aria-label': 'Confirm publish' });
  app.appendChild(confirmDialog);
  let confirmTarget: { draft: Draft; live: Draft; opener: HTMLElement } | null = null;
  let confirmPending = false;

  function openConfirmDialog(d: Draft, live: Draft): void {
    confirmTarget = { draft: d, live, opener: document.activeElement as HTMLElement };
    confirmPending = false;
    drawConfirmDialog();
    confirmDialog.showModal();
  }

  function drawConfirmDialog(): void {
    if (!confirmTarget) return;
    const d = confirmTarget.draft;
    const live = confirmTarget.live;
    confirmDialog.textContent = '';
    confirmDialog.appendChild(el('h3', { text: 'Confirm publish' }));
    const list = el('ul', { 'aria-label': 'Packs that take the sticker' });
    const stickerRows = live.rows.filter((r) => r.kind === 'sticker');
    if (stickerRows.length === 0) {
      list.appendChild(el('li', { text: 'No pack takes a sticker.' }));
    } else {
      for (const r of stickerRows) list.appendChild(el('li', { text: `${r.skuCode} ${r.name}` }));
    }
    const confirmStatus = el('div', { role: 'status', 'aria-live': 'polite', id: 'confirm-status', class: 'status-line live-region' });
    const warning = el('p', { class: 'dialog-warning', text: `This can't be undone. There is no way back to draft.` });
    const publishNow = el('button', { class: 'rectangle-button', text: 'Publish notice now' });
    const keepEditing = el('button', { class: 'rectangle-button', text: 'Keep editing' });
    keepEditing.addEventListener('click', () => {
      confirmDialog.close();
      confirmTarget?.opener.focus();
    });
    publishNow.addEventListener('click', () => {
      if (confirmPending || publishNow.getAttribute('aria-disabled') === 'true') return;
      confirmPending = true;
      void (async () => {
        const r = await api<{ number: string; version: { version: number } }>(`/api/editor/notices/${d.id}/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ baseRevision: live.revision }),
        });
        confirmPending = false;
        if (r.ok) {
          confirmDialog.close();
          publishStatus.textContent = `Notice ${r.body.number} version ${r.body.version.version} published.`;
          await refresh();
        } else {
          confirmStatus.textContent = (r.body as { message?: string }).message ?? '';
          publishStatus.textContent = (r.body as { message?: string }).message ?? '';
        }
      })();
    });
    confirmDialog.append(list, warning, confirmStatus, publishNow, keepEditing);
    keepEditing.focus();
  }

  function drawNotices(notices: Array<{ number: string; versions: NoticeVersion[] }>): void {
    noticesRegion.textContent = '';
    for (const n of notices) {
      const latest = n.versions[0];
      if (!latest) continue;
      const block = el('div', { class: 'row-line' });
      block.appendChild(el('h3', { text: `${latest.title} — ${n.number}` }));
      block.appendChild(el('div', { text: `${latest.printState === 'printable' ? 'Printable' : latest.printState === 'pending' ? 'Print pending' : 'Print failed'} · Effective ${displayDate(latest.effectiveDate)}` }));
      const correctButton = el('button', { class: 'rectangle-button', text: `Correct notice ${n.number}` });
      correctButton.addEventListener('click', () => openCorrectDialog(n, correctButton));
      block.appendChild(correctButton);
      if (latest.printState === 'failed') {
        const retryButton = el('button', { class: 'rectangle-button', text: `Retry print ${n.number} version ${latest.version}` });
        retryButton.addEventListener('click', () => {
          if (retryButton.getAttribute('aria-disabled') === 'true') return;
          retryButton.setAttribute('aria-disabled', 'true');
          printStatus.textContent = 'Asking for a new print.';
          void (async () => {
            const r = await api(`/api/editor/notices/${n.number}/versions/${latest.version}/print`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
            if (r.status === 202) {
              printStatus.textContent = 'Print requested. Check the print state shortly.';
              printStatus.focus();
            } else if (r.ok) {
              printStatus.textContent = (r.body as { message?: string }).message ?? '';
              printStatus.focus();
            } else {
              printStatus.textContent = (r.body as { message?: string }).message ?? 'Print request didn\u2019t reach the server. Try again.';
            }
          })();
        });
        block.appendChild(retryButton);
      }
      noticesRegion.appendChild(block);
    }
  }

  const correctDialog = dialog({ 'aria-label': 'Correct notice' });
  app.appendChild(correctDialog);
  let correctPending = false;

  function openCorrectDialog(n: { number: string; versions: NoticeVersion[] }, opener: HTMLElement): void {
    const latest = n.versions[0];
    if (!latest) return;
    correctPending = false;
    correctDialog.textContent = '';
    correctDialog.appendChild(el('h3', { text: `Correct notice ${n.number}` }));
    const effInput = input({ type: 'text', class: 'form-input', 'aria-label': 'Effective date', value: latest.effectiveDate });
    const runInput = input({ type: 'text', class: 'form-input', 'aria-label': 'Old wrappers until', value: latest.runOutUntil ?? '' });
    const reasonInput = input({ type: 'text', class: 'form-input', 'aria-label': 'Correction reason' });
    const previewRegion = el('section', { 'aria-label': `Publish preview ${n.number}` });
    const previewStatus = el('div', { role: 'status', 'aria-live': 'polite', id: `preview-status-${n.number}`, class: 'status-line live-region' });
    const refusedList = el('ol', { 'aria-label': `Refused rows ${n.number}` });
    correctDialog.append(
      el('label', { class: 'form-label', text: 'Effective date' }),
      effInput,
      el('label', { class: 'form-label', text: 'Old wrappers until' }),
      runInput,
      el('label', { class: 'form-label', text: 'Correction reason' }),
      reasonInput
    );
    const rowInputs: Array<{ code: string; input: HTMLInputElement; kind: string }> = [];
    for (const row of latest.rows) {
      correctDialog.appendChild(el('label', { class: 'form-label', text: `Revised MRP for ${row.skuCode}` }));
      const field = input({ type: 'text', class: 'form-input', value: rupees(row.revisedMrpPaise).replace('Rs ', '') });
      field.setAttribute('data-sku', row.skuCode);
      correctDialog.appendChild(field);
      rowInputs.push({ code: row.skuCode, input: field, kind: row.kind });
    }
    const publishCorrection = el('button', { class: 'rectangle-button', text: 'Publish correction' });
    correctDialog.append(previewRegion, previewStatus, refusedList, publishCorrection);

    const liveRows = (): DraftRow[] =>
      latest.rows.map((row, i) => {
        const typed = rowInputs[i]?.input.value.trim() ?? '';
        const m = /^Rs?\s*([0-9]+(?:\.[0-9]{1,2})?)$/.exec(typed);
        return { ...row, revisedMrpPaise: m ? Math.round(Number(m[1]) * 100) : row.revisedMrpPaise };
      });

    const runPreview = async (): Promise<void> => {
      const r = await api<PreviewBody>(`/api/editor/notices/${n.number}/corrections/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseVersion: latest.version,
          reason: reasonInput.value,
          effectiveDate: effInput.value,
          rows: liveRows().map((row) => ({
            skuCode: row.skuCode,
            kind: row.kind,
            revisedMrpPaise: row.revisedMrpPaise,
            oldRate: row.oldRate,
            newRate: row.newRate,
          })),
        }),
      });
      if (!r.ok) return;
      drawPreviewInDialog(previewRegion, previewStatus, refusedList, r.body, n.number);
    };

    for (const i of [effInput, runInput, reasonInput, ...rowInputs.map((r) => r.input)]) {
      i.addEventListener('input', () => {
        window.clearTimeout((i as unknown as { _t?: number })._t);
        (i as unknown as { _t?: number })._t = window.setTimeout(() => void runPreview(), 400);
      });
    }
    void runPreview();

    publishCorrection.addEventListener('click', () => {
      if (correctPending) return;
      correctPending = true;
      void (async () => {
        const r = await api<{ number: string; version: { version: number } }>(`/api/editor/notices/${n.number}/corrections`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            baseVersion: latest.version,
            reason: reasonInput.value,
            effectiveDate: effInput.value,
            rows: liveRows().map((row) => ({
              skuCode: row.skuCode,
              kind: row.kind,
              revisedMrpPaise: row.revisedMrpPaise,
              oldRate: row.oldRate,
              newRate: row.newRate,
            })),
          }),
        });
        correctPending = false;
        if (r.status === 201) {
          correctDialog.close();
          publishStatus.textContent = `Notice ${r.body.number} version ${r.body.version.version} published.`;
          await refresh();
          opener.focus();
        } else {
          publishStatus.textContent = (r.body as { message?: string }).message ?? '';
        }
      })();
    });
    correctDialog.showModal();
    effInput.focus();
  }

  function drawPreviewInDialog(region: HTMLElement, status: HTMLElement, refusedList: HTMLElement, p: PreviewBody, id: string): void {
    region.textContent = '';
    const table = el('table', { 'aria-label': `Publish preview ${id}`, class: 'responsive' });
    const thead = el('thead');
    const hr = el('tr');
    for (const c of ['Pack', 'Old MRP', 'Ceiling', 'Packs that take the sticker']) hr.appendChild(el('th', { text: c }));
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = el('tbody');
    for (const row of p.rows) {
      const tr = el('tr');
      tr.append(
        el('td', { text: row.name }),
        el('td', { text: rupees(row.oldMrpPaise) }),
        el('td', { text: row.ceilingPaise === null ? 'None' : rupees(row.ceilingPaise) }),
        el('td', { text: row.stickerBatches.length === 0 ? 'None' : row.stickerBatches.join(', ') })
      );
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    region.appendChild(table);
    status.textContent = p.blocking ? p.blocking.message : 'Ready to publish.';
    refusedList.textContent = '';
    if (p.blocking && Array.isArray(p.blocking.rows)) {
      const rows = p.blocking.rows as Array<Record<string, unknown>>;
      const codes: string[] = [];
      for (const rr of rows) {
        if (typeof rr === 'string') codes.push(rr);
        else if (typeof rr.skuCode === 'string') codes.push(rr.skuCode);
      }
      for (const code of codes) {
        const li = el('li');
        const link = el('a', { href: '#', text: `Fix ${code}` });
        link.addEventListener('click', (e) => {
          e.preventDefault();
          const field = correctDialog.querySelector(`input[data-sku="${code}"]`) as HTMLElement | null;
          field?.focus();
        });
        li.appendChild(link);
        refusedList.appendChild(li);
      }
    }
  }

  await refresh();
  setInterval(refresh, 5000);
}

export { runEditor };
