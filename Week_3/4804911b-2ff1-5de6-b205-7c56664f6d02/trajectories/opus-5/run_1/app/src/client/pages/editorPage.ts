import { failureOf, LostRequest, ok, request, type ApiFailure } from '../api.js';
import { copy, countsLine, printChangeSentence } from '../copy.js';
import { announce, focusWithoutScroll } from '../dom.js';
import { dayMonthYear, rupees } from '../format.js';
import { LinkKeeper } from '../links.js';
import type { Catalogue, NoticeDetail, NoticeVersion, SessionInfo } from '../types.js';
import { EDITOR_SKELETON, EMPTY_DRAFTS, EMPTY_SHEETS, openRowsText } from './editorShell.js';

interface SheetRow {
  rowNumber: number;
  raw: { code: string | null; description: string | null; newMrp: string | null; oldGst: string | null; newGst: string | null };
  status: 'matched' | 'ambiguous' | 'unmatched' | 'settled';
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

interface Sheet {
  id: string;
  filename: string;
  sha256: string;
  sizeBytes: number;
  importedAt: string;
  rowCount: number;
  counts: { matched: number; ambiguous: number; unmatched: number; settled: number };
  reused: boolean;
  rows?: SheetRow[];
}

interface DraftRow {
  skuCode: string;
  name: string;
  kind: 'sticker' | 'new_print';
  oldMrpPaise: number;
  revisedMrpPaise: number;
  oldRate: number | null;
  newRate: number | null;
  ceilingPaise: number | null;
}

interface Draft {
  id: string;
  state: 'draft';
  revision: number;
  title: string;
  effectiveDate: string;
  runOutUntil: string | null;
  sheet: { id: string; sha256: string } | null;
  rows: DraftRow[];
}

interface PreviewRow {
  skuCode: string;
  name: string;
  kind: 'sticker' | 'new_print';
  oldMrpPaise: number;
  ceilingPaise: number | null;
  revisedMrpPaise: number;
  stickerBatches: string[];
}

interface Preview {
  blocking: ApiFailure | null;
  rows: PreviewRow[];
}

interface EditorState {
  copyId: string;
  messagesQueued: boolean;
  workQueued: boolean;
  searchState: string;
  heldWork: number;
  counts: { drinks: number; skus: number; notices: number; scheduledRevisions: number };
  drafts: Draft[];
  notices: NoticeDetail[];
}

const HELD_KEY = 'interval.editor.held';

interface HeldWork {
  accountId: string;
  drafts: Record<string, { title: string; effectiveDate: string; runOutUntil: string; rows: Record<string, string>; revision: number }>;
}

export function renderEditor(root: HTMLElement, session: SessionInfo): void {
  root.innerHTML = EDITOR_SKELETON;
  const pick = <T extends Element>(selector: string): T => root.querySelector(selector) as T;

  const importStatus = pick<HTMLElement>('[data-import-status]');
  const publishStatus = pick<HTMLElement>('[data-publish-status]');
  const printStatus = pick<HTMLElement>('[data-print-status]');
  const renameStatus = pick<HTMLElement>('[data-rename-status]');
  const batchStatus = pick<HTMLElement>('[data-batch-status]');
  const workStatus = pick<HTMLElement>('[data-work-status]');
  const heldWorkRegion = pick<HTMLElement>('[data-held-work]');
  const messageAlert = pick<HTMLElement>('[data-message-alert]');
  const workAlert = pick<HTMLElement>('[data-work-alert]');
  const countsNode = pick<HTMLElement>('[data-counts]');
  const deskBar = pick<HTMLElement>('[data-desk-bar]');
  const openRowsNode = pick<HTMLElement>('[data-open-rows]');
  const draftsHolder = pick<HTMLElement>('[data-drafts]');
  const noticesHolder = pick<HTMLElement>('[data-notices]');
  const sheetsHolder = pick<HTMLElement>('[data-sheets]');
  const draftButtons = pick<HTMLElement>('[data-draft-buttons]');
  const confirmDialog = pick<HTMLElement>('[data-confirm-dialog]');
  const confirmStatus = pick<HTMLElement>('[data-confirm-status]');
  const stickerPacks = pick<HTMLElement>('[data-sticker-packs]');
  const publishNow = pick<HTMLButtonElement>('[data-publish-now]');
  const keepEditing = pick<HTMLButtonElement>('[data-keep-editing]');
  const correctDialog = pick<HTMLElement>('[data-correct-dialog]');
  const correctFields = pick<HTMLElement>('[data-correct-fields]');
  const correctPreview = pick<HTMLElement>('[data-correct-preview]');
  const correctPreviewStatus = pick<HTMLElement>('[data-correct-preview-status]');
  const correctRefused = pick<HTMLElement>('[data-correct-refused]');
  const publishCorrection = pick<HTMLButtonElement>('[data-publish-correction]');

  let catalogue: Catalogue | null = null;
  let sheets: Sheet[] = [];
  const sheetRows = new Map<string, SheetRow[]>();
  let state: EditorState | null = null;
  const printStates = new Map<string, string>();
  let lastHeldWork = 0;
  let firstLoad = true;
  const settleChoices = new Map<string, string>();
  const keepers = new Map<string, LinkKeeper>();
  const draftGroups = new Map<string, HTMLElement>();
  const draftRevisions = new Map<string, number>();
  const pending = new Set<string>();
  let lastDeskFocus: { sheetId: string; rowNumber: number } | null = null;
  let confirmFor: string | null = null;
  let correctionFor: { number: string; version: NoticeVersion } | null = null;

  pick<HTMLButtonElement>('[data-sign-out]').addEventListener('click', () => {
    window.sessionStorage.removeItem(HELD_KEY);
    void request('DELETE', '/api/session', { silentAuth: true }).then(() => window.location.assign('/'));
  });

  window.addEventListener('beforeunload', () => holdTypedWork());

  function holdTypedWork(): void {
    const held: HeldWork = { accountId: session.accountId, drafts: {} };
    for (const [id, group] of draftGroups) {
      const draft = state?.drafts.find((entry) => entry.id === id);
      if (draft === undefined) continue;
      const typed = readDraftFields(group);
      const changed =
        typed.title !== draft.title ||
        typed.effectiveDate !== draft.effectiveDate ||
        typed.runOutUntil !== (draft.runOutUntil ?? '') ||
        draft.rows.some((row) => typed.rows[row.skuCode] !== rupees(row.revisedMrpPaise));
      if (changed) {
        held.drafts[id] = { ...typed, revision: draftRevisions.get(id) ?? draft.revision };
      }
    }
    if (Object.keys(held.drafts).length > 0) {
      window.sessionStorage.setItem(HELD_KEY, JSON.stringify(held));
    }
  }

  function readDraftFields(group: HTMLElement): {
    title: string;
    effectiveDate: string;
    runOutUntil: string;
    rows: Record<string, string>;
  } {
    const rows: Record<string, string> = {};
    for (const input of [...group.querySelectorAll('[data-row-price]')] as HTMLInputElement[]) {
      rows[input.dataset.rowPrice as string] = input.value;
    }
    return {
      title: (group.querySelector('[data-draft-field="title"]') as HTMLInputElement).value,
      effectiveDate: (group.querySelector('[data-draft-field="effective"]') as HTMLInputElement).value,
      runOutUntil: (group.querySelector('[data-draft-field="runout"]') as HTMLInputElement).value,
      rows,
    };
  }

  function heldWorkForDrafts(): HeldWork | null {
    const raw = window.sessionStorage.getItem(HELD_KEY);
    if (raw === null) return null;
    try {
      const held = JSON.parse(raw) as HeldWork;
      return held.accountId === session.accountId ? held : null;
    } catch {
      return null;
    }
  }

  const held = heldWorkForDrafts();
  window.sessionStorage.removeItem(HELD_KEY);

  function paiseFrom(value: string): number {
    const text = value.trim().replace(/,/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(text)) return Number.NaN;
    const [whole, fraction = ''] = text.split('.');
    return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  }

  // ----- import desk --------------------------------------------------------

  pick<HTMLFormElement>('[data-import-form]').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = pick<HTMLInputElement>('[data-sheet-file]');
    const file = input.files?.[0];
    if (file === undefined) return;
    announce(importStatus, 'Reading the sheet.');
    const form = new FormData();
    form.append('file', file, file.name);
    void request<{ sheet: Sheet }>('POST', '/api/editor/price-sheets', { formData: form })
      .then((result) => {
        if (!ok(result)) {
          announce(importStatus, failureOf(result).message);
          return;
        }
        const sheet = result.body.sheet;
        if (result.status === 200) {
          announce(importStatus, 'This sheet is already on file. Nothing new was stored.');
        } else {
          announce(
            importStatus,
            `${sheet.rowCount} rows read: ${sheet.counts.matched} matched, ${sheet.counts.ambiguous} ambiguous, ${sheet.counts.unmatched} unmatched.`,
          );
        }
        sheetRows.set(sheet.id, sheet.rows ?? []);
        void loadSheets();
      })
      .catch(() => announce(importStatus, 'That did not reach the server. Try again.'));
  });

  async function loadSheets(): Promise<void> {
    const result = await request<{ sheets: Sheet[] }>('GET', '/api/editor/price-sheets').catch(() => null);
    if (result === null || !ok(result)) return;
    sheets = result.body.sheets;
    for (const sheet of sheets) {
      if (!sheetRows.has(sheet.id)) {
        const detail = await request<{ sheet: Sheet }>('GET', `/api/editor/price-sheets/${sheet.id}`).catch(
          () => null,
        );
        if (detail !== null && ok(detail)) sheetRows.set(sheet.id, detail.body.sheet.rows ?? []);
      }
    }
    renderSheets();
    renderDesk();
  }

  function renderSheets(): void {
    if (sheets.length === 0) {
      sheetsHolder.innerHTML = EMPTY_SHEETS;
      draftButtons.replaceChildren();
      return;
    }
    const list = document.createElement('ul');
    for (const sheet of sheets) {
      const item = document.createElement('li');
      const name = document.createElement('p');
      name.textContent = `${sheet.filename} — ${sheet.sha256}`;
      const linkHolder = document.createElement('p');
      item.append(name, linkHolder);
      list.append(item);
      let keeper = keepers.get(sheet.id);
      const report = (): void => {
        const current = keepers.get(sheet.id)?.current();
        if (current === undefined) return;
        if (current.kind === 'link') {
          const link = document.createElement('a');
          link.href = current.url;
          link.textContent = `Download sheet ${sheet.filename}`;
          link.dataset.focusKey = `sheet-link-${sheet.id}`;
          linkHolder.replaceChildren(link);
          return;
        }
        if (current.kind === 'storage') linkHolder.textContent = copy.storageOutage;
        else if (current.kind === 'expired') {
          linkHolder.textContent = '';
          announce(printStatus, copy.expiredLink);
        }
      };
      if (keeper === undefined) {
        keeper = new LinkKeeper(`/api/editor/price-sheets/${sheet.id}/link`, () => report());
        keepers.set(sheet.id, keeper);
        keeper.start();
      }
      report();
    }
    sheetsHolder.replaceChildren(list);

    draftButtons.replaceChildren(
      ...sheets.map((sheet) => {
        const button = document.createElement('button');
        button.type = 'submit';
        button.textContent = `Draft notice from sheet ${sheet.filename}`;
        button.dataset.focusKey = `draft-from-${sheet.id}`;
        const open = (sheetRows.get(sheet.id) ?? []).filter(
          (row) => row.status === 'ambiguous' || row.status === 'unmatched',
        ).length;
        button.disabled = open > 0;
        button.addEventListener('click', (event) => {
          event.preventDefault();
          announce(publishStatus, 'Drafting from the sheet.');
          void request<Draft>('POST', `/api/editor/price-sheets/${sheet.id}/draft`, {
            body: {
              title: pick<HTMLInputElement>('[data-draft-title]').value,
              effectiveDate: pick<HTMLInputElement>('[data-draft-effective]').value,
              runOutUntil: null,
            },
          })
            .then((result) => {
              if (!ok(result)) {
                announce(publishStatus, failureOf(result).message);
                return;
              }
              announce(publishStatus, 'Draft created from the sheet.');
              void refresh().then(() => {
                const group = draftGroups.get(result.body.id);
                focusWithoutScroll(group?.querySelector('[data-draft-field="title"]') as HTMLElement);
              });
            })
            .catch(() => announce(publishStatus, 'That did not reach the server. Try again.'));
        });
        return button;
      }),
    );
  }

  function openRows(): { sheet: Sheet; row: SheetRow }[] {
    const rows: { sheet: Sheet; row: SheetRow }[] = [];
    for (const sheet of sheets) {
      for (const row of sheetRows.get(sheet.id) ?? []) {
        if (row.status === 'ambiguous' || row.status === 'unmatched') rows.push({ sheet, row });
      }
    }
    return rows;
  }

  function renderDesk(): void {
    const sections: Record<string, HTMLElement> = {
      matched: pick<HTMLElement>('[data-matched]'),
      ambiguous: pick<HTMLElement>('[data-ambiguous]'),
      unmatched: pick<HTMLElement>('[data-unmatched]'),
    };
    for (const holder of Object.values(sections)) holder.replaceChildren();
    for (const sheet of sheets) {
      for (const row of sheetRows.get(sheet.id) ?? []) {
        const bucket =
          row.status === 'ambiguous'
            ? sections.ambiguous
            : row.status === 'unmatched'
              ? sections.unmatched
              : sections.matched;
        bucket.append(rowBlock(sheet, row));
      }
    }
    const count = openRows().length;
    const narrow = window.innerWidth < 1280;
    deskBar.hidden = !(narrow && count > 0);
    openRowsNode.textContent = openRowsText(count);
  }

  function rowBlock(sheet: Sheet, row: SheetRow): HTMLElement {
    const block = document.createElement('div');
    block.className = 'desk-row';
    block.dataset.sheet = sheet.id;
    block.dataset.row = String(row.rowNumber);
    const summary = document.createElement('p');
    const price = row.newMrpPaise === null ? 'unreadable' : `Rs ${rupees(row.newMrpPaise)}`;
    summary.textContent = `Row ${row.rowNumber}: ${row.raw.description ?? ''} — ${price}${
      row.reason === null ? '' : ` (${row.reason})`
    }${row.skuCode === null ? '' : ` → ${row.skuCode}`}${row.ignored ? ' (ignored)' : ''}${
      row.mergedIntoRow === null ? '' : ` (merged into row ${row.mergedIntoRow})`
    }`;
    block.append(summary);
    if (row.status !== 'ambiguous' && row.status !== 'unmatched') return block;

    const key = `${sheet.id}:${row.rowNumber}`;
    const select = document.createElement('select');
    select.setAttribute('aria-label', `Settle row ${row.rowNumber} to`);
    select.dataset.focusKey = `settle-select-${key}`;
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Choose a pack';
    select.append(blank);
    for (const drink of catalogue?.drinks ?? []) {
      for (const sku of drink.skus) {
        const option = document.createElement('option');
        option.value = sku.code;
        option.textContent = `${sku.code} ${sku.name}`;
        select.append(option);
      }
    }
    select.value = settleChoices.get(key) ?? '';
    select.addEventListener('change', () => settleChoices.set(key, select.value));

    const settle = document.createElement('button');
    settle.type = 'button';
    settle.textContent = `Settle row ${row.rowNumber}`;
    settle.addEventListener('click', () => {
      void settleRow(sheet, row.rowNumber, { skuCode: select.value });
    });
    const ignore = document.createElement('button');
    ignore.type = 'button';
    ignore.textContent = `Ignore row ${row.rowNumber}`;
    ignore.addEventListener('click', () => {
      void settleRow(sheet, row.rowNumber, { ignore: true });
    });
    block.append(select, settle, ignore);
    return block;
  }

  async function settleRow(sheet: Sheet, rowNumber: number, body: Record<string, unknown>): Promise<void> {
    announce(importStatus, `Saving row ${rowNumber}.`);
    const result = await request<{ sheet: Sheet }>(
      'POST',
      `/api/editor/price-sheets/${sheet.id}/rows/${rowNumber}/settle`,
      { body },
    ).catch(() => null);
    if (result === null) {
      announce(importStatus, 'That did not reach the server. Try again.');
      return;
    }
    if (!ok(result)) {
      announce(importStatus, failureOf(result).message);
      return;
    }
    announce(importStatus, `Row ${rowNumber} settled.`);
    sheetRows.set(sheet.id, result.body.sheet.rows ?? []);
    await loadSheets();
    focusNextOpenRow(sheet.id, rowNumber);
  }

  function focusNextOpenRow(sheetId: string, afterRow: number): void {
    const rows = (sheetRows.get(sheetId) ?? []).filter(
      (row) => row.status === 'ambiguous' || row.status === 'unmatched',
    );
    const above = rows.filter((row) => row.rowNumber > afterRow);
    const target = above.length > 0 ? above[0] : rows[0];
    if (target !== undefined) {
      lastDeskFocus = { sheetId, rowNumber: target.rowNumber };
      focusWithoutScroll(
        root.querySelector(`[data-focus-key="settle-select-${sheetId}:${target.rowNumber}"]`) as HTMLElement,
      );
      return;
    }
    const others = openRows();
    if (others.length > 0) {
      const first = others[0];
      lastDeskFocus = { sheetId: first.sheet.id, rowNumber: first.row.rowNumber };
      focusWithoutScroll(
        root.querySelector(
          `[data-focus-key="settle-select-${first.sheet.id}:${first.row.rowNumber}"]`,
        ) as HTMLElement,
      );
      return;
    }
    focusWithoutScroll(root.querySelector(`[data-focus-key="draft-from-${sheetId}"]`) as HTMLElement);
  }

  pick<HTMLButtonElement>('[data-next-open-row]').addEventListener('click', () => {
    const rows = openRows();
    if (rows.length === 0) return;
    let index = 0;
    if (lastDeskFocus !== null) {
      const at = rows.findIndex(
        (entry) =>
          entry.sheet.id === lastDeskFocus?.sheetId && entry.row.rowNumber === lastDeskFocus?.rowNumber,
      );
      index = at < 0 ? 0 : (at + 1) % rows.length;
    }
    const next = rows[index];
    lastDeskFocus = { sheetId: next.sheet.id, rowNumber: next.row.rowNumber };
    focusWithoutScroll(
      root.querySelector(
        `[data-focus-key="settle-select-${next.sheet.id}:${next.row.rowNumber}"]`,
      ) as HTMLElement,
    );
  });

  // ----- drafts -------------------------------------------------------------

  function draftBody(group: HTMLElement, draft: Draft): Record<string, unknown> {
    const typed = readDraftFields(group);
    return {
      baseRevision: draftRevisions.get(draft.id) ?? draft.revision,
      title: typed.title,
      effectiveDate: typed.effectiveDate,
      runOutUntil: typed.runOutUntil.trim() === '' ? null : typed.runOutUntil.trim(),
      rows: draft.rows.map((row) => ({
        skuCode: row.skuCode,
        kind: row.kind,
        revisedMrpPaise: paiseFrom(typed.rows[row.skuCode] ?? ''),
        oldRate: row.oldRate,
        newRate: row.newRate,
      })),
    };
  }

  const previewSequence = new Map<string, number>();
  const previewTimers = new Map<string, number>();
  const lastPreview = new Map<string, string>();

  async function runPreview(draft: Draft): Promise<void> {
    const group = draftGroups.get(draft.id);
    if (group === undefined) return;
    const mine = (previewSequence.get(draft.id) ?? 0) + 1;
    previewSequence.set(draft.id, mine);
    const result = await request<Preview>('POST', `/api/editor/notices/${draft.id}/preview`, {
      body: draftBody(group, draft),
    }).catch(() => null);
    if (result === null || !ok(result)) return;
    if (previewSequence.get(draft.id) !== mine) return;
    showPreview(
      group.querySelector('[data-preview]') as HTMLElement,
      group.querySelector('[data-preview-status]') as HTMLElement,
      group.querySelector('[data-refused]') as HTMLElement,
      draft.id,
      result.body,
      (skuCode) =>
        group.querySelector(`[data-row-price="${skuCode}"]`) as HTMLElement | null,
    );
  }

  function schedulePreview(draft: Draft): void {
    const existing = previewTimers.get(draft.id);
    if (existing !== undefined) window.clearTimeout(existing);
    previewTimers.set(
      draft.id,
      window.setTimeout(() => void runPreview(draft), 400),
    );
  }

  function showPreview(
    region: HTMLElement,
    status: HTMLElement,
    refused: HTMLElement,
    key: string,
    preview: Preview,
    fieldFor: (skuCode: string) => HTMLElement | null,
  ): void {
    const table = document.createElement('table');
    table.setAttribute('aria-label', `Publish preview ${key}`);
    const head = document.createElement('tr');
    for (const header of ['Pack', 'Old MRP', 'Ceiling', 'Packs that take the sticker']) {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = header;
      head.append(cell);
    }
    table.append(head);
    for (const row of preview.rows) {
      const line = document.createElement('tr');
      for (const value of [
        row.name,
        `Rs ${rupees(row.oldMrpPaise)}`,
        row.ceilingPaise === null ? 'None' : `Rs ${rupees(row.ceilingPaise)}`,
        row.stickerBatches.length === 0 ? 'None' : row.stickerBatches.join(', '),
      ]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        line.append(cell);
      }
      table.append(line);
    }
    region.replaceChildren(table);

    const message = preview.blocking === null ? copy.previewClear : preview.blocking.message;
    const changed = lastPreview.get(key) !== message;
    lastPreview.set(key, message);
    if (changed) announce(status, message);

    const named = namedRows(preview.blocking);
    refused.replaceChildren();
    for (const field of [...root.querySelectorAll('[data-row-price]')] as HTMLElement[]) {
      if (!named.includes(field.dataset.rowPrice as string)) {
        field.removeAttribute('aria-invalid');
        field.removeAttribute('aria-describedby');
      }
    }
    if (named.length > 0 && preview.blocking !== null) {
      const list = document.createElement('ul');
      list.setAttribute('aria-label', `Refused rows ${key}`);
      for (const skuCode of named) {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = '#';
        link.textContent = `Fix ${skuCode}`;
        link.addEventListener('click', (event) => {
          event.preventDefault();
          focusWithoutScroll(fieldFor(skuCode));
        });
        item.append(link);
        list.append(item);
        const field = fieldFor(skuCode);
        if (field !== null) {
          const errorId = `row-error-${key}-${skuCode}`.replace(/[^a-zA-Z0-9-]/g, '-');
          let errorNode = root.querySelector(`#${errorId}`) as HTMLElement | null;
          if (errorNode === null) {
            errorNode = document.createElement('p');
            errorNode.id = errorId;
            errorNode.className = 'field-error';
            field.after(errorNode);
          }
          errorNode.textContent = preview.blocking.message;
          field.setAttribute('aria-invalid', 'true');
          field.setAttribute('aria-describedby', errorId);
        }
      }
      refused.append(list);
    }
  }

  function namedRows(failure: ApiFailure | null): string[] {
    if (failure === null || failure.error === 'run_out_batches_exist') return [];
    const rows = failure.rows;
    if (!Array.isArray(rows)) return [];
    const codes: string[] = [];
    for (const row of rows) {
      if (typeof row === 'string') codes.push(row);
      else if (typeof row === 'object' && row !== null && typeof (row as { skuCode?: string }).skuCode === 'string') {
        codes.push((row as { skuCode: string }).skuCode);
      }
    }
    return codes;
  }

  function renderDrafts(): void {
    const drafts = state?.drafts ?? [];
    if (drafts.length === 0) {
      draftsHolder.innerHTML = EMPTY_DRAFTS;
      draftGroups.clear();
      return;
    }
    for (const [id, group] of draftGroups) {
      if (!drafts.some((draft) => draft.id === id)) {
        group.remove();
        draftGroups.delete(id);
      }
    }
    if (draftsHolder.querySelector('.slide') !== null) draftsHolder.replaceChildren();
    for (const draft of drafts) {
      let group = draftGroups.get(draft.id);
      if (group === undefined) {
        group = buildDraftGroup(draft);
        draftGroups.set(draft.id, group);
        draftsHolder.append(group);
        draftRevisions.set(draft.id, draft.revision);
        const heldDraft = held?.drafts[draft.id];
        if (heldDraft !== undefined) {
          (group.querySelector('[data-draft-field="title"]') as HTMLInputElement).value = heldDraft.title;
          (group.querySelector('[data-draft-field="effective"]') as HTMLInputElement).value =
            heldDraft.effectiveDate;
          (group.querySelector('[data-draft-field="runout"]') as HTMLInputElement).value =
            heldDraft.runOutUntil;
          for (const [skuCode, value] of Object.entries(heldDraft.rows)) {
            const field = group.querySelector(`[data-row-price="${skuCode}"]`) as HTMLInputElement | null;
            if (field !== null) field.value = value;
          }
          draftRevisions.set(draft.id, heldDraft.revision);
          announce(publishStatus, copy.workKept);
        }
        void runPreview(draft);
      } else {
        for (const row of draft.rows) {
          const label = group.querySelector(`[data-row-name="${row.skuCode}"]`);
          if (label !== null) label.textContent = row.name;
        }
        const publishButton = group.querySelector('[data-publish-draft]') as HTMLButtonElement | null;
        if (publishButton !== null) {
          publishButton.textContent = `Publish ${
            (group.querySelector('[data-draft-field="title"]') as HTMLInputElement).value || draft.title
          }`;
        }
      }
    }
  }

  function buildDraftGroup(draft: Draft): HTMLElement {
    const group = document.createElement('section');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', `Draft ${draft.id}`);
    group.className = 'draft';

    const field = (label: string, key: string, value: string): HTMLElement => {
      const holder = document.createElement('div');
      holder.className = 'field';
      const id = `draft-${draft.id}-${key}`;
      const labelNode = document.createElement('label');
      labelNode.htmlFor = id;
      labelNode.textContent = label;
      const input = document.createElement('input');
      input.id = id;
      input.type = 'text';
      input.value = value;
      input.setAttribute('aria-label', label);
      input.dataset.draftField = key;
      input.dataset.focusKey = `${key}-${draft.id}`;
      input.addEventListener('input', () => schedulePreview(draft));
      holder.append(labelNode, input);
      return holder;
    };

    group.append(
      field('Notice title', 'title', draft.title),
      field('Effective date', 'effective', draft.effectiveDate),
      field('Old wrappers until', 'runout', draft.runOutUntil ?? ''),
    );

    for (const row of draft.rows) {
      const holder = document.createElement('div');
      holder.className = 'field';
      const id = `draft-${draft.id}-row-${row.skuCode}`;
      const label = document.createElement('label');
      label.htmlFor = id;
      label.textContent = `Revised MRP for ${row.skuCode}`;
      const name = document.createElement('span');
      name.dataset.rowName = row.skuCode;
      name.textContent = row.name;
      const input = document.createElement('input');
      input.id = id;
      input.type = 'text';
      input.value = rupees(row.revisedMrpPaise);
      input.setAttribute('aria-label', `Revised MRP for ${row.skuCode}`);
      input.dataset.rowPrice = row.skuCode;
      input.dataset.focusKey = `price-${draft.id}-${row.skuCode}`;
      input.addEventListener('input', () => schedulePreview(draft));
      holder.append(label, name, input);
      group.append(holder);
    }

    const save = document.createElement('button');
    save.type = 'button';
    save.textContent = 'Save draft';
    save.dataset.focusKey = `save-${draft.id}`;
    save.addEventListener('click', () => void saveDraft(draft));

    const publish = document.createElement('button');
    publish.type = 'button';
    publish.dataset.publishDraft = draft.id;
    publish.dataset.focusKey = `publish-${draft.id}`;
    publish.textContent = `Publish ${draft.title}`;
    publish.addEventListener('click', () => openConfirm(draft, publish));

    const preview = document.createElement('div');
    preview.setAttribute('role', 'region');
    preview.setAttribute('aria-label', `Publish preview ${draft.id}`);
    preview.dataset.preview = draft.id;

    const previewStatus = document.createElement('div');
    previewStatus.setAttribute('role', 'status');
    previewStatus.setAttribute('aria-label', `Preview status ${draft.id}`);
    previewStatus.dataset.previewStatus = draft.id;

    const refused = document.createElement('div');
    refused.dataset.refused = draft.id;

    group.append(save, publish, preview, previewStatus, refused);
    return group;
  }

  async function saveDraft(draft: Draft): Promise<void> {
    const group = draftGroups.get(draft.id);
    if (group === undefined) return;
    announce(publishStatus, 'Saving draft.');
    const result = await request<Draft>('PUT', `/api/editor/notices/${draft.id}`, {
      body: draftBody(group, draft),
    }).catch(() => null);
    if (result === null) {
      announce(publishStatus, 'That did not reach the server. Try again.');
      return;
    }
    if (!ok(result)) {
      announce(publishStatus, failureOf(result).message);
      return;
    }
    draftRevisions.set(draft.id, result.body.revision);
    announce(publishStatus, 'Draft saved.');
    await refresh();
  }

  // ----- confirm publish ----------------------------------------------------

  function draftIsUnsaved(group: HTMLElement, draft: Draft): boolean {
    const typed = readDraftFields(group);
    if (typed.title !== draft.title) return true;
    if (typed.effectiveDate !== draft.effectiveDate) return true;
    if (typed.runOutUntil !== (draft.runOutUntil ?? '')) return true;
    return draft.rows.some((row) => typed.rows[row.skuCode] !== rupees(row.revisedMrpPaise));
  }

  let confirmOpener: HTMLElement | null = null;
  let confirmTimer: number | null = null;

  function openConfirm(draft: Draft, opener: HTMLElement): void {
    const group = draftGroups.get(draft.id);
    if (group === undefined) return;
    confirmFor = draft.id;
    confirmOpener = opener;
    confirmDialog.hidden = false;
    confirmStatus.textContent = '';
    publishNow.removeAttribute('aria-disabled');
    if (draftIsUnsaved(group, draft)) {
      confirmStatus.textContent = copy.unsavedDraft;
      publishNow.setAttribute('aria-disabled', 'true');
    }
    void savedPreview(draft);
    if (confirmTimer !== null) window.clearInterval(confirmTimer);
    confirmTimer = window.setInterval(() => void savedPreview(draft), 8_000);
    focusWithoutScroll(keepEditing);
  }

  async function savedPreview(draft: Draft): Promise<void> {
    const result = await request<Preview>('POST', `/api/editor/notices/${draft.id}/preview`, {
      body: {
        baseRevision: draftRevisions.get(draft.id) ?? draft.revision,
        title: draft.title,
        effectiveDate: draft.effectiveDate,
        runOutUntil: draft.runOutUntil,
        rows: draft.rows.map((row) => ({
          skuCode: row.skuCode,
          kind: row.kind,
          revisedMrpPaise: row.revisedMrpPaise,
          oldRate: row.oldRate,
          newRate: row.newRate,
        })),
      },
    }).catch(() => null);
    if (result === null || !ok(result) || confirmDialog.hidden) return;
    const batches = result.body.rows.flatMap((row) => row.stickerBatches);
    stickerPacks.replaceChildren();
    if (batches.length === 0) {
      const item = document.createElement('li');
      item.textContent = copy.noStickerPacks;
      stickerPacks.append(item);
    } else {
      for (const batch of batches) {
        const item = document.createElement('li');
        item.textContent = batch;
        stickerPacks.append(item);
      }
    }
    const group = draftGroups.get(draft.id);
    if (result.body.blocking !== null) {
      if (confirmStatus.textContent !== result.body.blocking.message) {
        announce(confirmStatus, result.body.blocking.message);
      }
      publishNow.setAttribute('aria-disabled', 'true');
    } else if (group !== undefined && draftIsUnsaved(group, draft)) {
      confirmStatus.textContent = copy.unsavedDraft;
      publishNow.setAttribute('aria-disabled', 'true');
    } else {
      confirmStatus.textContent = '';
      publishNow.removeAttribute('aria-disabled');
    }
  }

  function closeConfirm(): void {
    confirmDialog.hidden = true;
    if (confirmTimer !== null) window.clearInterval(confirmTimer);
    confirmTimer = null;
    confirmFor = null;
  }

  keepEditing.addEventListener('click', () => {
    closeConfirm();
    focusWithoutScroll(confirmOpener);
  });

  confirmDialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !pending.has('publish')) {
      event.preventDefault();
      closeConfirm();
      focusWithoutScroll(confirmOpener);
      return;
    }
    if (event.key !== 'Tab') return;
    const order = [publishNow, keepEditing];
    const index = order.indexOf(document.activeElement as HTMLButtonElement);
    event.preventDefault();
    focusWithoutScroll(
      event.shiftKey ? order[(index <= 0 ? order.length : index) - 1] : order[(index + 1) % order.length],
    );
  });

  publishNow.addEventListener('click', () => {
    if (publishNow.getAttribute('aria-disabled') === 'true' || pending.has('publish')) return;
    const draft = state?.drafts.find((entry) => entry.id === confirmFor);
    if (draft === undefined) return;
    pending.add('publish');
    announce(publishStatus, 'Publishing.');
    void request<{ number: string; version: NoticeVersion }>(
      'POST',
      `/api/editor/notices/${draft.id}/publish`,
      { body: { baseRevision: draftRevisions.get(draft.id) ?? draft.revision } },
    )
      .then((result) => {
        if (!ok(result)) {
          const failure = failureOf(result);
          announce(publishStatus, failure.message);
          announce(confirmStatus, failure.message);
          return;
        }
        announce(
          publishStatus,
          `Notice ${result.body.number} version ${result.body.version.version} published.`,
        );
        closeConfirm();
        void refresh().then(() => {
          focusWithoutScroll(
            root.querySelector(`[data-focus-key="correct-${result.body.number}"]`) as HTMLElement,
          );
        });
      })
      .catch(() => announce(publishStatus, 'That did not reach the server. Try again.'))
      .finally(() => pending.delete('publish'));
  });

  // ----- published notices --------------------------------------------------

  function renderNotices(): void {
    const notices = state?.notices ?? [];
    const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.focusKey ?? null;
    noticesHolder.replaceChildren(
      ...notices.map((notice) => {
        const block = document.createElement('article');
        block.className = 'notice-block';
        const heading = document.createElement('h3');
        heading.textContent = `${notice.number} — ${notice.versions[0].title}`;
        block.append(heading);
        for (const version of notice.versions) {
          const line = document.createElement('p');
          const printLabel =
            version.printState === 'printable'
              ? 'Printable'
              : version.printState === 'failed'
                ? 'Print failed'
                : 'Print pending';
          const stateLabel =
            version.state === 'superseded'
              ? 'Superseded'
              : version.state === 'scheduled'
                ? 'Scheduled'
                : 'In effect';
          line.textContent = `Version ${version.version} · ${stateLabel} · ${printLabel} · Effective ${dayMonthYear(
            version.effectiveDate,
          )}`;
          block.append(line);
          if (version.printState === 'failed') {
            const outage = document.createElement('p');
            outage.textContent = copy.printOutage;
            block.append(outage);
            const retry = document.createElement('button');
            retry.type = 'button';
            retry.textContent = `Retry print ${notice.number} version ${version.version}`;
            retry.dataset.focusKey = `retry-${notice.number}-${version.version}`;
            retry.addEventListener('click', () => {
              if (pending.has(retry.dataset.focusKey as string)) return;
              pending.add(retry.dataset.focusKey as string);
              retry.setAttribute('aria-disabled', 'true');
              announce(printStatus, 'Asking for a new print.');
              void request('POST', `/api/editor/notices/${notice.number}/versions/${version.version}/print`, {
                body: {},
              })
                .then((result) => {
                  if (result.status === 202) {
                    announce(printStatus, 'Print requested. Check the print state shortly.');
                    focusWithoutScroll(printStatus);
                  } else {
                    announce(printStatus, failureOf(result).message);
                    focusWithoutScroll(printStatus);
                  }
                  void refresh();
                })
                .catch((error: unknown) => {
                  if (error instanceof LostRequest) announce(printStatus, copy.lostPrintRequest);
                  retry.removeAttribute('aria-disabled');
                })
                .finally(() => pending.delete(retry.dataset.focusKey as string));
            });
            block.append(retry);
          }
          const known = printStates.get(`${notice.number}:${version.version}`);
          if (!firstLoad && known !== undefined && known !== version.printState && version.printState !== 'pending') {
            announce(
              printStatus,
              printChangeSentence(notice.number, version.version, version.printState as 'printable' | 'failed'),
            );
          }
          printStates.set(`${notice.number}:${version.version}`, version.printState);
        }
        const correct = document.createElement('button');
        correct.type = 'button';
        correct.textContent = `Correct notice ${notice.number}`;
        correct.dataset.focusKey = `correct-${notice.number}`;
        correct.addEventListener('click', () => openCorrection(notice, correct));
        block.append(correct);
        return block;
      }),
    );
    if (focusKey !== null) {
      const again = root.querySelector(`[data-focus-key="${focusKey}"]`) as HTMLElement | null;
      if (again !== null) focusWithoutScroll(again);
      else focusWithoutScroll(printStatus);
    }
  }

  // ----- corrections --------------------------------------------------------

  let correctionOpener: HTMLElement | null = null;
  let correctionTimer: number | null = null;

  function openCorrection(notice: NoticeDetail, opener: HTMLElement): void {
    const version = notice.versions[0];
    correctionFor = { number: notice.number, version };
    correctionOpener = opener;
    correctDialog.hidden = false;
    correctRefused.replaceChildren();
    correctPreviewStatus.textContent = '';

    const field = (label: string, key: string, value: string): HTMLElement => {
      const holder = document.createElement('div');
      holder.className = 'field';
      const id = `correct-${key}`;
      const labelNode = document.createElement('label');
      labelNode.htmlFor = id;
      labelNode.textContent = label;
      const input = document.createElement('input');
      input.id = id;
      input.type = 'text';
      input.value = value;
      input.setAttribute('aria-label', label);
      input.dataset.correctField = key;
      input.addEventListener('input', () => scheduleCorrectionPreview());
      holder.append(labelNode, input);
      return holder;
    };

    correctFields.replaceChildren(
      field('Effective date', 'effective', version.effectiveDate),
      field('Old wrappers until', 'runout', version.runOutUntil ?? ''),
      ...version.rows.map((row) =>
        field(`Revised MRP for ${row.skuCode}`, `row-${row.skuCode}`, rupees(row.revisedMrpPaise)),
      ),
      field('Correction reason', 'reason', ''),
    );
    for (const input of [...correctFields.querySelectorAll('[data-correct-field^="row-"]')] as HTMLInputElement[]) {
      input.dataset.rowPrice = (input.dataset.correctField as string).replace('row-', '');
    }
    scheduleCorrectionPreview();
    if (correctionTimer !== null) window.clearInterval(correctionTimer);
    correctionTimer = window.setInterval(() => void runCorrectionPreview(), 8_000);
    focusWithoutScroll(correctFields.querySelector('input') as HTMLElement);
  }

  function correctionBody(): Record<string, unknown> {
    const current = correctionFor;
    if (current === null) return {};
    const value = (key: string): string =>
      (correctFields.querySelector(`[data-correct-field="${key}"]`) as HTMLInputElement | null)?.value ?? '';
    return {
      baseVersion: current.version.version,
      reason: value('reason'),
      effectiveDate: value('effective'),
      runOutUntil: value('runout').trim() === '' ? null : value('runout').trim(),
      rows: current.version.rows.map((row) => ({
        skuCode: row.skuCode,
        kind: row.kind,
        revisedMrpPaise: paiseFrom(value(`row-${row.skuCode}`)),
        oldRate: row.oldRate,
        newRate: row.newRate,
      })),
    };
  }

  let correctionPreviewTimer: number | null = null;

  function scheduleCorrectionPreview(): void {
    if (correctionPreviewTimer !== null) window.clearTimeout(correctionPreviewTimer);
    correctionPreviewTimer = window.setTimeout(() => void runCorrectionPreview(), 400);
  }

  let correctionSequence = 0;

  async function runCorrectionPreview(): Promise<void> {
    const current = correctionFor;
    if (current === null || correctDialog.hidden) return;
    correctionSequence += 1;
    const mine = correctionSequence;
    const result = await request<Preview>(
      'POST',
      `/api/editor/notices/${current.number}/corrections/preview`,
      { body: correctionBody() },
    ).catch(() => null);
    if (result === null || !ok(result) || mine !== correctionSequence) return;
    showPreview(correctPreview, correctPreviewStatus, correctRefused, current.number, result.body, (skuCode) =>
      correctFields.querySelector(`[data-correct-field="row-${skuCode}"]`) as HTMLElement | null,
    );
  }

  correctDialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !pending.has('correction')) {
      event.preventDefault();
      correctDialog.hidden = true;
      if (correctionTimer !== null) window.clearInterval(correctionTimer);
      focusWithoutScroll(correctionOpener);
      return;
    }
    if (event.key !== 'Tab') return;
    const order = [
      ...(correctFields.querySelectorAll('input') as NodeListOf<HTMLElement>),
      publishCorrection,
    ];
    const index = order.indexOf(document.activeElement as HTMLElement);
    event.preventDefault();
    focusWithoutScroll(
      event.shiftKey ? order[(index <= 0 ? order.length : index) - 1] : order[(index + 1) % order.length],
    );
  });

  publishCorrection.addEventListener('click', () => {
    const current = correctionFor;
    if (current === null || pending.has('correction')) return;
    pending.add('correction');
    publishCorrection.setAttribute('aria-disabled', 'true');
    announce(publishStatus, 'Publishing.');
    void request<{ number: string; version: NoticeVersion }>(
      'POST',
      `/api/editor/notices/${current.number}/corrections`,
      { body: correctionBody() },
    )
      .then((result) => {
        if (result.status !== 201) {
          const failure = failureOf(result);
          announce(publishStatus, failure.message);
          announce(correctPreviewStatus, failure.message);
          return;
        }
        announce(
          publishStatus,
          `Notice ${result.body.number} version ${result.body.version.version} published.`,
        );
        correctDialog.hidden = true;
        if (correctionTimer !== null) window.clearInterval(correctionTimer);
        void refresh().then(() =>
          focusWithoutScroll(
            root.querySelector(`[data-focus-key="correct-${current.number}"]`) as HTMLElement,
          ),
        );
      })
      .catch(() => announce(publishStatus, 'That did not reach the server. Try again.'))
      .finally(() => {
        pending.delete('correction');
        publishCorrection.removeAttribute('aria-disabled');
      });
  });

  // ----- renames and batches ------------------------------------------------

  const drinkSelect = pick<HTMLSelectElement>('[data-drink-select]');
  const packSelect = pick<HTMLSelectElement>('[data-pack-select]');
  const batchPackSelect = pick<HTMLSelectElement>('[data-batch-pack]');
  const packHistory = pick<HTMLElement>('[data-pack-history]');
  let historySequence = 0;

  function renderSelects(): void {
    if (catalogue === null) return;
    const chosenDrink = drinkSelect.value;
    drinkSelect.replaceChildren(
      ...catalogue.drinks.map((drink) => {
        const option = document.createElement('option');
        option.value = drink.id;
        option.textContent = drink.name;
        return option;
      }),
    );
    drinkSelect.value = chosenDrink === '' ? catalogue.drinks[0].id : chosenDrink;
    renderPackOptions();
    const chosenBatchPack = batchPackSelect.value;
    batchPackSelect.replaceChildren(
      ...catalogue.drinks.flatMap((drink) =>
        drink.skus.map((sku) => {
          const option = document.createElement('option');
          option.value = sku.code;
          option.textContent = `${sku.code} ${sku.name}`;
          return option;
        }),
      ),
    );
    if (chosenBatchPack !== '') batchPackSelect.value = chosenBatchPack;
  }

  function renderPackOptions(): void {
    if (catalogue === null) return;
    const drink = catalogue.drinks.find((entry) => entry.id === drinkSelect.value) ?? catalogue.drinks[0];
    const chosen = packSelect.value;
    packSelect.replaceChildren(
      ...drink.skus.map((sku) => {
        const option = document.createElement('option');
        option.value = sku.code;
        option.textContent = `${sku.code} ${sku.variant}`;
        return option;
      }),
    );
    if (drink.skus.some((sku) => sku.code === chosen)) packSelect.value = chosen;
    void loadHistory();
  }

  async function loadHistory(): Promise<void> {
    const code = packSelect.value;
    if (code === '') return;
    historySequence += 1;
    const mine = historySequence;
    const result = await request<{ history: { at: string; field: string; from: string; to: string }[] }>(
      'GET',
      `/api/editor/skus/${code}/history`,
    ).catch(() => null);
    if (result === null || !ok(result) || mine !== historySequence) return;
    const list = document.createElement('ul');
    for (const entry of result.body.history) {
      const item = document.createElement('li');
      item.textContent = `${entry.field}: ${entry.from} → ${entry.to}`;
      list.append(item);
    }
    packHistory.replaceChildren(list);
  }

  drinkSelect.addEventListener('change', () => renderPackOptions());
  packSelect.addEventListener('change', () => void loadHistory());

  pick<HTMLFormElement>('[data-rename-drink-form]').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = pick<HTMLInputElement>('[data-new-drink-name]').value;
    announce(renameStatus, 'Renaming.');
    void request('PATCH', `/api/editor/drinks/${drinkSelect.value}`, { body: { name } })
      .then((result) => {
        announce(
          renameStatus,
          ok(result) ? 'Renamed. Published notices keep their old name.' : failureOf(result).message,
        );
        if (ok(result)) void refresh();
      })
      .catch(() => announce(renameStatus, 'That did not reach the server. Try again.'));
  });

  pick<HTMLFormElement>('[data-rename-pack-form]').addEventListener('submit', (event) => {
    event.preventDefault();
    const variant = pick<HTMLInputElement>('[data-new-pack-wording]').value;
    announce(renameStatus, 'Renaming.');
    void request('PATCH', `/api/editor/skus/${packSelect.value}`, { body: { variant } })
      .then((result) => {
        announce(
          renameStatus,
          ok(result) ? 'Renamed. Published notices keep their old name.' : failureOf(result).message,
        );
        if (ok(result)) void refresh();
      })
      .catch(() => announce(renameStatus, 'That did not reach the server. Try again.'));
  });

  pick<HTMLFormElement>('[data-batch-form]').addEventListener('submit', (event) => {
    event.preventDefault();
    const code = pick<HTMLInputElement>('[data-new-batch-code]').value.trim().toUpperCase();
    announce(batchStatus, 'Registering.');
    void request('POST', '/api/editor/batches', {
      body: {
        code,
        skuCode: batchPackSelect.value,
        oldWrapper: pick<HTMLInputElement>('[data-old-wrapper]').checked,
      },
    })
      .then((result) => {
        announce(
          batchStatus,
          result.status === 201 ? `Batch ${code} registered.` : failureOf(result).message,
        );
      })
      .catch(() => announce(batchStatus, 'That did not reach the server. Try again.'));
  });

  // ----- refreshing ---------------------------------------------------------

  async function refresh(): Promise<void> {
    const [editorResult, catalogueResult] = await Promise.all([
      request<EditorState>('GET', '/api/editor/notices').catch(() => null),
      request<Catalogue>('GET', '/api/catalogue').catch(() => null),
    ]);
    if (catalogueResult !== null && ok(catalogueResult)) {
      catalogue = catalogueResult.body;
      renderSelects();
    }
    if (editorResult === null || !ok(editorResult)) return;
    state = editorResult.body;
    countsNode.textContent = countsLine(state.counts);
    messageAlert.hidden = !state.messagesQueued;
    messageAlert.textContent = state.messagesQueued ? copy.messageOutage : '';
    workAlert.hidden = !state.workQueued;
    workAlert.textContent = state.workQueued ? copy.workOutage : '';
    heldWorkRegion.textContent = `Work set aside: ${state.heldWork}.`;
    if (state.heldWork > lastHeldWork && !firstLoad) announce(workStatus, copy.workSetAside);
    lastHeldWork = state.heldWork;
    renderDrafts();
    renderNotices();
    firstLoad = false;
  }

  window.addEventListener('resize', () => renderDesk());

  void refresh().then(() => loadSheets());
  window.setInterval(() => void refresh(), 5_000);
  window.setInterval(() => void loadSheets(), 5_000);
  window.setInterval(() => {
    void request<SessionInfo>('GET', '/api/session', { silentAuth: true }).then((result) => {
      if (ok(result) && result.body.accountId !== session.accountId) {
        window.sessionStorage.removeItem(HELD_KEY);
        window.location.assign(result.body.role === 'editor' ? '/editor' : '/stockist');
      }
    });
  }, 5_000);
}
