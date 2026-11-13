import { api } from '../api.ts';
import { shell, notice, openDialog, closeDialog, errorSummary, clearErrorSummary, isApiFailure } from '../shell.ts';

/** Studio: the editorial lifecycle, the new event dialog and uploads. */

interface StudioItem {
  id: string;
  type: string;
  title: string;
  status: string;
  owner_email: string;
  publish_at: string | null;
  chapter: number | null;
}

export async function initStudioPage(): Promise<void> {
  await renderItems();
  wireChapterPanel();
  wireNewEventDialog();
  wireScheduleDialog();
  wireWithdrawDialog();
  wireUploadForm();
  wireSourceForm();
}

async function renderItems(): Promise<void> {
  const table = document.querySelector<HTMLElement>('[data-role="items-table"]');
  if (!table) return;
  const typeFilter = document.querySelector<HTMLSelectElement>('[data-role="filter-type"]')?.value ?? '';
  const statusFilter = document.querySelector<HTMLSelectElement>('[data-role="filter-status"]')?.value ?? '';
  const params = new URLSearchParams();
  if (typeFilter) params.set('type', typeFilter);
  if (statusFilter) params.set('status', statusFilter);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  let items: StudioItem[] = [];
  try {
    const res = await api.get<{ items: StudioItem[] }>(`/api/curator/items${suffix}`);
    items = res.items;
  } catch {
    items = [];
  }
  const body = table.querySelector<HTMLElement>('[data-role="items-body"]');
  if (!body) return;
  body.textContent = '';
  const legal = legalTransitions(items);
  for (const item of items) {
    const tr = document.createElement('tr');
    const titleCell = document.createElement('td');
    titleCell.textContent = item.title;
    const typeCell = document.createElement('td');
    typeCell.textContent = item.type;
    const statusCell = document.createElement('td');
    statusCell.textContent = item.status;
    const ownerCell = document.createElement('td');
    ownerCell.textContent = item.owner_email;
    const actionsCell = document.createElement('td');
    for (const action of legal.get(item.id) ?? []) {
      const button = document.createElement('button');
      button.textContent = action.label;
      button.addEventListener('click', () => void transition(item, action.to));
      actionsCell.appendChild(button);
    }
    tr.append(titleCell, typeCell, statusCell, ownerCell, actionsCell);
    body.appendChild(tr);
  }
}

/** Only the buttons legal for the signed-in curator are shown. */
function legalTransitions(items: StudioItem[]): Map<string, Array<{ to: string; label: string }>> {
  const out = new Map<string, Array<{ to: string; label: string }>>();
  const isLead = shell.user?.role === 'lead_curator';
  const email = shell.user?.email ?? '';
  for (const item of items) {
    const owner = item.owner_email === email;
    if (!owner && !isLead) {
      out.set(item.id, []);
      continue;
    }
    const moves: Array<{ to: string; label: string }> = [];
    if (item.status === 'draft') {
      moves.push({ to: 'review', label: 'Send to review' });
    } else if (item.status === 'review') {
      moves.push({ to: 'draft', label: 'Return to draft' });
      if (isLead) moves.push({ to: 'scheduled', label: 'Schedule' });
    } else if (item.status === 'scheduled') {
      moves.push({ to: 'draft', label: 'Unschedule' });
    } else if (item.status === 'published') {
      moves.push({ to: 'withdrawn', label: 'Withdraw' });
    } else if (item.status === 'withdrawn') {
      moves.push({ to: 'draft', label: 'Move to draft' });
    }
    out.set(item.id, moves);
  }
  return out;
}

async function transition(item: StudioItem, to: string): Promise<void> {
  if (to === 'scheduled') {
    const dialog = document.querySelector<HTMLDialogElement>('#dialog-schedule');
    if (dialog) {
      (dialog as HTMLDialogElement & { _item?: StudioItem })._item = item;
      const input = dialog.querySelector<HTMLInputElement>('[data-role="publish-at"]');
      if (input) input.value = '';
      clearErrorSummary(dialog);
      openDialog('dialog-schedule', document.activeElement as HTMLElement | null);
    }
    return;
  }
  if (to === 'withdrawn') {
    const dialog = document.querySelector<HTMLDialogElement>('#dialog-withdraw');
    if (dialog) {
      (dialog as HTMLDialogElement & { _item?: StudioItem })._item = item;
      const input = dialog.querySelector<HTMLInputElement>('[data-role="withdraw-reason"]');
      if (input) input.value = '';
      clearErrorSummary(dialog);
      openDialog('dialog-withdraw', document.activeElement as HTMLElement | null);
    }
    return;
  }
  try {
    const res = await api.post<{ item: StudioItem }>(`/api/curator/items/${item.id}/transitions`, { to });
    const label = statusLabel(res.item.status);
    notice(`Moved to ${label}.`);
    await renderItems();
    await renderChapterPanel();
  } catch (e) {
    notice(isApiFailure(e) ? e.message : 'Something went wrong.');
  }
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    draft: 'Draft',
    review: 'Review',
    scheduled: 'Scheduled',
    published: 'Published',
    withdrawn: 'Withdrawn',
  };
  return map[status] ?? status;
}

function wireChapterPanel(): void {
  const select = document.querySelector<HTMLSelectElement>('[data-role="chapter-panel-select"]');
  select?.addEventListener('change', () => void renderChapterPanel());
}

async function renderChapterPanel(): Promise<void> {
  const region = document.querySelector<HTMLElement>('[data-role="chapter-events"]');
  const select = document.querySelector<HTMLSelectElement>('[data-role="chapter-panel-select"]');
  if (!region || !select) return;
  const chapter = select.value;
  if (!chapter) return;
  const title = region.querySelector<HTMLElement>('[data-role="chapter-events-title"]');
  if (title) title.textContent = `Chapter ${NUMERALS[Number(chapter)] ?? chapter} events`;
  const list = region.querySelector<HTMLElement>('[data-role="chapter-events-list"]');
  if (!list) return;
  try {
    const res = await api.get<{ items: StudioItem[] }>('/api/curator/items?type=event');
    const events = res.items.filter((i) => i.type === 'event' && String(i.chapter) === chapter);
    list.textContent = '';
    for (const item of events) {
      const li = document.createElement('li');
      li.textContent = `${item.title} — ${statusLabel(item.status)}`;
      list.appendChild(li);
    }
    if (!events.length) {
      const li = document.createElement('li');
      li.textContent = 'No timeline events in this chapter yet.';
      list.appendChild(li);
    }
  } catch {
    /* studio read unavailable */
  }
}

function wireNewEventDialog(): void {
  const opener = document.querySelector<HTMLButtonElement>('[data-role="new-event"]');
  const dialog = document.querySelector<HTMLDialogElement>('#dialog-new-event');
  if (!opener || !dialog) return;
  opener.addEventListener('click', () => {
    clearErrorSummary(dialog);
    openDialog('dialog-new-event', opener);
  });
  const form = dialog.querySelector<HTMLFormElement>('form');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrorSummary(dialog);
    const chapter = dialog.querySelector<HTMLSelectElement>('[data-role="new-event-chapter"]')?.value ?? '';
    const year = dialog.querySelector<HTMLInputElement>('[data-role="new-event-year"]')?.value ?? '';
    const title = dialog.querySelector<HTMLInputElement>('[data-role="new-event-title"]')?.value ?? '';
    const summary = dialog.querySelector<HTMLInputElement>('[data-role="new-event-summary"]')?.value ?? '';
    try {
      await api.post('/api/curator/events', {
        chapter: Number(chapter),
        year: Number(year),
        title,
        summary,
        source_ids: [],
      });
      notice('Draft saved.');
      closeDialog('dialog-new-event');
      await renderItems();
      await renderChapterPanel();
    } catch (e) {
      if (isApiFailure(e)) {
        if (e.fields) errorSummary(dialog, e.message, e.fields);
        else errorSummary(dialog, e.message);
      }
    }
  });
}

function wireScheduleDialog(): void {
  const dialog = document.querySelector<HTMLDialogElement>('#dialog-schedule');
  if (!dialog) return;
  const button = dialog.querySelector<HTMLButtonElement>('[data-role="confirm-schedule"]');
  button?.addEventListener('click', async () => {
    const item = (dialog as HTMLDialogElement & { _item?: StudioItem })._item;
    if (!item) return;
    const value = dialog.querySelector<HTMLInputElement>('[data-role="publish-at"]')?.value ?? '';
    const { toOffsetIso } = await import('../lisbon.ts');
    const iso = toOffsetIso(value);
    if (iso === null) {
      errorSummary(dialog, 'Choose a time after now.', { publish_at: 'Choose a time after now.' });
      return;
    }
    try {
      const res = await api.post<{ item: StudioItem }>(`/api/curator/items/${item.id}/transitions`, {
        to: 'scheduled',
        publish_at: iso,
      });
      notice(`Moved to ${statusLabel(res.item.status)}.`);
      closeDialog('dialog-schedule');
      await renderItems();
      await renderChapterPanel();
    } catch (e) {
      if (isApiFailure(e)) {
        if (e.fields) errorSummary(dialog, e.message, e.fields);
        else errorSummary(dialog, e.message);
      }
    }
  });
}

function wireWithdrawDialog(): void {
  const dialog = document.querySelector<HTMLDialogElement>('#dialog-withdraw');
  if (!dialog) return;
  const button = dialog.querySelector<HTMLButtonElement>('[data-role="confirm-withdraw"]');
  button?.addEventListener('click', async () => {
    const item = (dialog as HTMLDialogElement & { _item?: StudioItem })._item;
    if (!item) return;
    const reason = dialog.querySelector<HTMLInputElement>('[data-role="withdraw-reason"]')?.value ?? '';
    try {
      const res = await api.post<{ item: StudioItem }>(`/api/curator/items/${item.id}/transitions`, {
        to: 'withdrawn',
        reason,
      });
      notice(`Moved to ${statusLabel(res.item.status)}.`);
      closeDialog('dialog-withdraw');
      await renderItems();
      await renderChapterPanel();
    } catch (e) {
      if (isApiFailure(e)) {
        if (e.fields) errorSummary(dialog, e.message, e.fields);
        else errorSummary(dialog, e.message);
      }
    }
  });
}

function wireUploadForm(): void {
  const form = document.querySelector<HTMLFormElement>('[data-role="upload-form"]');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = form.querySelector<HTMLElement>('[data-role="upload-status"]');
    const fileInput = form.querySelector<HTMLInputElement>('[data-role="upload-file"]');
    const kind = form.querySelector<HTMLSelectElement>('[data-role="upload-kind"]')?.value ?? 'image';
    const item = form.querySelector<HTMLSelectElement>('[data-role="upload-item"]')?.value ?? '';
    const transcript = form.querySelector<HTMLInputElement>('[data-role="upload-transcript"]')?.value ?? '';
    const file = fileInput?.files?.[0];
    if (!file) {
      if (status) status.textContent = '';
      errorSummary(form as unknown as HTMLElement, 'Check the highlighted fields.', { file: 'Check the highlighted fields.' });
      return;
    }
    if (status) status.textContent = `Uploading ${file.name}.`;
    const body = new FormData();
    body.append('file', file);
    body.append('kind', kind);
    body.append('item_id', item);
    body.append('transcript', transcript);
    try {
      const res = await fetch('/api/curator/media', { method: 'POST', body, credentials: 'same-origin' });
      if (!res.ok) {
        const data = (await res.json()) as { error?: { code: string; message: string; fields?: Record<string, string> } };
        const message = data.error?.message ?? 'Something went wrong.';
        errorSummary(form as unknown as HTMLElement, message, data.error?.fields);
        if (status) status.textContent = '';
        return;
      }
      if (status) status.textContent = `Upload complete: ${file.name}.`;
      notice(`Upload complete: ${file.name}.`);
    } catch {
      if (status) status.textContent = '';
      errorSummary(form as unknown as HTMLElement, 'Something went wrong.');
    }
  });
}

function wireSourceForm(): void {
  const form = document.querySelector<HTMLFormElement>('[data-role="source-form"]');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const citation = form.querySelector<HTMLInputElement>('[data-role="source-citation"]')?.value ?? '';
    try {
      await api.post('/api/curator/sources', { citation });
      notice('Draft saved.');
      form.reset();
    } catch (e) {
      notice(isApiFailure(e) ? e.message : 'Something went wrong.');
    }
  });
}

const NUMERALS: Record<number, string> = {
  1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI', 7: 'VII', 8: 'VIII',
};
