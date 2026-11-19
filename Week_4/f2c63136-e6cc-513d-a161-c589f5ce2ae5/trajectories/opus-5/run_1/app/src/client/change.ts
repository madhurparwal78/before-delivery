import { act, call, clearFieldErrors, fieldError } from './api.js';
import { actionRow, button, dialogIsOpen, labelledField, openDialog } from './dialogs.js';

interface PageInfo {
  repo: string;
  changeNumber: number;
  role: string;
  isAuthor: boolean;
}

let cursor: HTMLElement | null = null;
const batch = new Set<number>();

export function pageInfo(): PageInfo | null {
  const root = document.querySelector<HTMLElement>('[data-page="change"]');
  if (!root) return null;
  return {
    repo: root.dataset.repo ?? '',
    changeNumber: Number(root.dataset.changeNumber ?? '0'),
    role: root.dataset.role ?? 'reader',
    isAuthor: root.dataset.isAuthor === 'true',
  };
}

function base(): string {
  const info = pageInfo()!;
  return `/api/repos/${info.repo}/changes/${info.changeNumber}`;
}

function visibleTables(): HTMLTableElement[] {
  return [...document.querySelectorAll<HTMLTableElement>('table.diff')].filter((table) => !table.hidden);
}

function navigableRows(): HTMLElement[] {
  const rows: HTMLElement[] = [];
  for (const table of visibleTables()) {
    rows.push(...[...table.querySelectorAll<HTMLElement>('tr.row')].filter((row) => row.dataset.kind !== 'hunk'));
  }
  return rows;
}

function fileSections(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('section.file')];
}

function rowLine(row: HTMLElement): number {
  const value = row.dataset.kind === 'removed' ? row.dataset.oldLine : row.dataset.newLine;
  return Number(value ?? '0');
}

function clearCommentButtons(): void {
  document.querySelectorAll('.commentonline').forEach((node) => node.remove());
}

export function setCursor(row: HTMLElement | null, focus = true): void {
  if (cursor && cursor !== row) {
    delete cursor.dataset.cursor;
    cursor.tabIndex = -1;
  }
  cursor = row;
  if (!row) return;
  row.dataset.cursor = 'true';
  row.tabIndex = 0;
  if (focus) row.focus({ preventScroll: false });
}

function currentCursor(): HTMLElement | null {
  if (cursor && cursor.isConnected && !(cursor.closest('table') as HTMLTableElement | null)?.hidden) return cursor;
  return null;
}

function firstRowOfFile(section: HTMLElement): HTMLElement | null {
  const table = [...section.querySelectorAll<HTMLTableElement>('table.diff')].find((item) => !item.hidden);
  if (!table) return null;
  return [...table.querySelectorAll<HTMLElement>('tr.row')].find((row) => row.dataset.kind !== 'hunk') ?? null;
}

function moveByFile(direction: 1 | -1): void {
  const sections = fileSections();
  const current = currentCursor()?.closest('section.file') ?? null;
  let index = current ? sections.indexOf(current as HTMLElement) : -1;
  if (index === -1) {
    for (const section of sections) {
      const row = firstRowOfFile(section);
      if (row) {
        setCursor(row);
        return;
      }
    }
    return;
  }
  for (let next = index + direction; next >= 0 && next < sections.length; next += direction) {
    const row = firstRowOfFile(sections[next]);
    if (row) {
      setCursor(row);
      return;
    }
  }
}

function moveByRow(direction: 1 | -1): void {
  const rows = navigableRows();
  if (rows.length === 0) return;
  const current = currentCursor();
  if (!current) {
    setCursor(rows[0]);
    return;
  }
  const index = rows.indexOf(current);
  const next = index + direction;
  if (next < 0 || next >= rows.length) return;
  setCursor(rows[next]);
}

function visibleThreads(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('article.thread')].filter((thread) => {
    if (thread.dataset.state !== 'unresolved') return false;
    const region = thread.closest<HTMLElement>('[data-outdated-region]');
    return region === null || !region.hidden;
  });
}

function anchorRow(thread: HTMLElement): HTMLElement | null {
  const path = thread.dataset.path;
  const line = thread.dataset.line;
  const side = thread.dataset.side;
  for (const table of visibleTables()) {
    if (table.dataset.path !== path) continue;
    for (const row of table.querySelectorAll<HTMLElement>('tr.row')) {
      if (row.dataset.kind === 'hunk') continue;
      const matches = side === 'old' ? row.dataset.oldLine === line : row.dataset.newLine === line;
      if (matches) return row;
    }
  }
  return null;
}

function moveByThread(direction: 1 | -1): void {
  const threads = visibleThreads();
  if (threads.length === 0) return;
  const active = document.activeElement as HTMLElement | null;
  const currentThread = active?.closest<HTMLElement>('article.thread') ?? null;
  let index = currentThread ? threads.indexOf(currentThread) : -1;
  if (index === -1) index = direction === 1 ? -1 : threads.length;
  const next = index + direction;
  if (next < 0 || next >= threads.length) return;
  const thread = threads[next];
  const row = anchorRow(thread);
  if (row) setCursor(row, false);
  thread.focus();
}

function toggleViewedForCursor(): void {
  const section = currentCursor()?.closest<HTMLElement>('section.file');
  if (!section) return;
  const checkbox = section.querySelector<HTMLInputElement>('input[data-viewed-path]');
  if (checkbox) checkbox.click();
}

function commentDialog(row: HTMLElement, opener: HTMLElement | null): void {
  const path = row.dataset.path ?? '';
  const side = row.dataset.kind === 'removed' ? 'old' : 'new';
  const line = rowLine(row);
  const content = document.createElement('div');
  const comment = labelledField('textarea', 'Comment');
  content.append(comment);

  let suggestionToggle: HTMLInputElement | null = null;
  let suggestionLines: HTMLTextAreaElement | null = null;
  let throughLine: HTMLInputElement | null = null;
  if (side === 'new') {
    const toggleHolder = document.createElement('label');
    toggleHolder.className = 'checkboxfield';
    suggestionToggle = document.createElement('input');
    suggestionToggle.type = 'checkbox';
    suggestionToggle.setAttribute('aria-label', 'Add a suggestion');
    const toggleText = document.createElement('span');
    toggleText.textContent = 'Add a suggestion';
    toggleHolder.append(suggestionToggle, toggleText);
    const linesField = labelledField('textarea', 'Suggested lines');
    const throughField = labelledField('number', 'Through line', { value: String(line), min: String(line) });
    suggestionLines = linesField.querySelector('textarea');
    throughLine = throughField.querySelector('input');
    content.append(toggleHolder, linesField, throughField);
  }

  const add = button('Add comment', 'primary');
  const cancel = button('Cancel');
  content.append(actionRow([add, cancel]));

  const submit = () => {
    const text = comment.querySelector('textarea')!.value;
    clearFieldErrors(content);
    if (text.trim() === '') {
      fieldError(comment.querySelector('textarea'), 'Comment cannot be empty');
      return;
    }
    const suggestion =
      suggestionToggle && suggestionToggle.checked && suggestionLines
        ? { lines: suggestionLines.value.split('\n') }
        : undefined;
    const endLine = throughLine && throughLine.value !== '' ? Number(throughLine.value) : line;
    void act(add, 'Submitting...', async () => {
      await call('POST', `${base()}/threads`, {
        path,
        side,
        line,
        end_line: endLine,
        body: text,
        suggestion,
      });
      handle.close();
      return 'Comment added.';
    });
  };

  const handle = openDialog({
    label: `Comment on ${path} line ${line}`,
    content,
    opener: opener ?? row,
    onSubmit: submit,
    focusFirst: 'textarea[aria-label="Comment"]',
  });
  add.addEventListener('click', submit);
  cancel.addEventListener('click', () => handle.close());
}

function reviewDialog(opener: HTMLElement | null): void {
  const info = pageInfo()!;
  const content = document.createElement('div');
  const group = document.createElement('div');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Review type');

  const options: Array<[string, string]> = [
    ['comment', 'Comment'],
    ['approve', 'Approve'],
    ['request_changes', 'Request changes'],
  ];
  const reasons = new Set<string>();
  for (const [value, label] of options) {
    const holder = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'reviewtype';
    radio.value = value;
    radio.setAttribute('aria-label', label);
    if (value === 'comment') radio.checked = true;
    let reason = '';
    if (info.role === 'reader' && value !== 'comment') reason = 'Readers cannot approve or request changes';
    if (info.isAuthor && value === 'approve') reason = 'You cannot approve your own change';
    if (reason !== '') {
      radio.disabled = true;
      reasons.add(reason);
    }
    const text = document.createElement('span');
    text.textContent = label;
    holder.append(radio, text);
    group.append(holder);
  }
  for (const reason of reasons) {
    const note = document.createElement('p');
    note.className = 'muted reviewreason';
    note.textContent = reason;
    group.append(note);
  }

  const summary = labelledField('textarea', 'Review summary');
  const submitButton = button('Submit review', 'primary');
  const cancel = button('Cancel');
  content.append(group, summary, actionRow([submitButton, cancel]));

  const submit = () => {
    const type = group.querySelector<HTMLInputElement>('input:checked')?.value ?? 'comment';
    const text = summary.querySelector('textarea')!.value;
    clearFieldErrors(content);
    if (type === 'request_changes' && text.trim() === '') {
      fieldError(summary.querySelector('textarea'), 'A summary is required to request changes');
      return;
    }
    void act(submitButton, 'Submitting...', async () => {
      await call('POST', `${base()}/reviews`, { type, summary: text });
      handle.close();
      return 'Review submitted.';
    });
  };

  const handle = openDialog({
    label: 'Submit review',
    content,
    opener,
    onSubmit: submit,
    focusFirst: 'input[type="radio"]',
  });
  submitButton.addEventListener('click', submit);
  cancel.addEventListener('click', () => handle.close());
}

function dismissDialog(reviewId: number, opener: HTMLElement): void {
  const content = document.createElement('div');
  const reason = labelledField('text', 'Reason');
  const confirm = button('Confirm dismissal', 'primary');
  const cancel = button('Cancel');
  content.append(reason, actionRow([confirm, cancel]));

  const submit = () => {
    const value = reason.querySelector('input')!.value;
    clearFieldErrors(content);
    if (value.trim() === '') {
      fieldError(reason.querySelector('input'), 'A reason is required');
      return;
    }
    void act(confirm, 'Working...', async () => {
      await call('POST', `${base()}/reviews/${reviewId}/dismiss`, { reason: value });
      handle.close();
      return 'Review dismissed.';
    });
  };

  const handle = openDialog({ label: 'Dismiss review', content, opener, onSubmit: submit });
  confirm.addEventListener('click', submit);
  cancel.addEventListener('click', () => handle.close());
}

export function refreshBatchButton(): void {
  const slot = document.querySelector<HTMLElement>('[data-batch-slot]');
  if (!slot) return;
  slot.textContent = '';
  if (batch.size === 0) return;
  const apply = button('Apply batch', 'flat');
  apply.dataset.applyBatch = 'true';
  slot.append(apply);
}

export function syncBatchLabels(): void {
  document.querySelectorAll<HTMLElement>('[data-suggestion-batch]').forEach((control) => {
    const id = Number(control.dataset.suggestionBatch);
    control.textContent = batch.has(id) ? 'Remove from batch' : 'Add to batch';
  });
  refreshBatchButton();
}

async function applySuggestions(control: HTMLElement, ids: number[]): Promise<void> {
  await act(control, 'Working...', async () => {
    const result = await call<{ revision: string }>('POST', `${base()}/suggestions/apply`, { comments: ids });
    ids.forEach((id) => batch.delete(id));
    syncBatchLabels();
    return `Suggestions applied in revision ${result.revision}.`;
  });
}

function onKeydown(event: KeyboardEvent): void {
  if (!pageInfo()) return;
  if (dialogIsOpen()) return;
  const target = event.target as HTMLElement | null;
  if (target && target.closest('input, textarea, select')) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  switch (event.key) {
    case 'j':
      event.preventDefault();
      moveByFile(1);
      break;
    case 'k':
      event.preventDefault();
      moveByFile(-1);
      break;
    case 'ArrowDown':
      if (target?.closest('.stackrail')) return;
      event.preventDefault();
      moveByRow(1);
      break;
    case 'ArrowUp':
      if (target?.closest('.stackrail')) return;
      event.preventDefault();
      moveByRow(-1);
      break;
    case 'n':
      event.preventDefault();
      moveByThread(1);
      break;
    case 'p':
      event.preventDefault();
      moveByThread(-1);
      break;
    case 'c': {
      const row = currentCursor();
      if (!row) return;
      event.preventDefault();
      commentDialog(row, row);
      break;
    }
    case 'v':
      event.preventDefault();
      toggleViewedForCursor();
      break;
    case 'r':
      event.preventDefault();
      reviewDialog(null);
      break;
    default:
      break;
  }
}

function onRowClick(row: HTMLElement): void {
  setCursor(row);
  clearCommentButtons();
  const line = rowLine(row);
  const control = button(`Comment on line ${line}`, 'flat commentonline');
  control.addEventListener('click', (event) => {
    event.stopPropagation();
    commentDialog(row, control);
  });
  row.querySelector('td.code')?.append(control);
}

export function restoreCursor(path: string | null, line: string | null, side: string | null): void {
  if (path === null) return;
  for (const table of visibleTables()) {
    if (table.dataset.path !== path) continue;
    for (const row of table.querySelectorAll<HTMLElement>('tr.row')) {
      if (row.dataset.kind === 'hunk') continue;
      if (row.dataset.side !== side) continue;
      const value = side === 'old' ? row.dataset.oldLine : row.dataset.newLine;
      if (value === line) {
        setCursor(row, document.activeElement === document.body);
        return;
      }
    }
  }
}

export function cursorAddress(): { path: string | null; line: string | null; side: string | null } {
  const row = currentCursor();
  if (!row) return { path: null, line: null, side: null };
  return {
    path: row.dataset.path ?? null,
    line: (row.dataset.side === 'old' ? row.dataset.oldLine : row.dataset.newLine) ?? null,
    side: row.dataset.side ?? null,
  };
}

export function initChange(): void {
  if (!pageInfo()) return;
  document.addEventListener('keydown', onKeydown);

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLElement>('tr.row');
    if (row && row.dataset.kind !== 'hunk' && !target.closest('.commentonline')) {
      onRowClick(row);
      return;
    }

    const reviewChanges = target.closest<HTMLElement>('[data-review-changes]');
    if (reviewChanges) {
      reviewDialog(reviewChanges);
      return;
    }

    const dismiss = target.closest<HTMLElement>('[data-dismiss-review]');
    if (dismiss) {
      dismissDialog(Number(dismiss.dataset.dismissReview), dismiss);
      return;
    }

    const applyOne = target.closest<HTMLElement>('[data-suggestion-apply]');
    if (applyOne) {
      void applySuggestions(applyOne, [Number(applyOne.dataset.suggestionApply)]);
      return;
    }

    const toBatch = target.closest<HTMLElement>('[data-suggestion-batch]');
    if (toBatch) {
      const id = Number(toBatch.dataset.suggestionBatch);
      if (batch.has(id)) batch.delete(id);
      else batch.add(id);
      syncBatchLabels();
      return;
    }

    const applyBatch = target.closest<HTMLElement>('[data-apply-batch]');
    if (applyBatch) {
      void applySuggestions(applyBatch, [...batch]);
      return;
    }

    const send = target.closest<HTMLElement>('[data-thread-send]');
    if (send) {
      const id = Number(send.dataset.threadSend);
      const field = document.querySelector<HTMLTextAreaElement>(`[data-thread-reply="${id}"]`)!;
      if (field.value.trim() === '') {
        fieldError(field, 'Comment cannot be empty');
        return;
      }
      void act(send, 'Submitting...', async () => {
        await call('POST', `${base()}/threads/${id}/replies`, { body: field.value });
        field.value = '';
        return 'Reply sent.';
      });
      return;
    }

    const state = target.closest<HTMLElement>('[data-thread-state]');
    if (state) {
      const id = Number(state.dataset.threadState);
      const thread = document.querySelector<HTMLElement>(`article.thread[data-thread-id="${id}"]`);
      const next = thread?.dataset.state === 'resolved' ? 'unresolved' : 'resolved';
      void act(state, 'Working...', async () => {
        await call('PUT', `${base()}/threads/${id}/state`, { state: next });
      });
      return;
    }

    const merge = target.closest<HTMLElement>('[data-merge-change]');
    if (merge) {
      const info = pageInfo()!;
      void act(merge, 'Working...', async () => {
        await call('POST', `${base()}/merge`);
        return `Change #${info.changeNumber} merged.`;
      });
      return;
    }

    const queue = target.closest<HTMLElement>('[data-queue-change]');
    if (queue) {
      void act(queue, 'Working...', async () => {
        const entry = await call<{ position: number }>('POST', `${base()}/queue`);
        return `Added to the merge queue at position ${entry.position}.`;
      });
      return;
    }

    const ready = target.closest<HTMLElement>('[data-mark-ready]');
    if (ready) {
      void act(ready, 'Working...', async () => {
        await call('PUT', `${base()}/ready`);
      });
      return;
    }

    const request = target.closest<HTMLElement>('[data-request-review]');
    if (request) {
      const field = document.querySelector<HTMLInputElement>('[data-reviewer-username]')!;
      const username = field.value.trim();
      void act(
        request,
        'Working...',
        async () => {
          const result = await call<{ username: string }>('POST', `${base()}/review-requests`, { username });
          return `Review requested from ${result.username}.`;
        },
        (failure) => {
          if (failure.status === 404) {
            fieldError(field, `${username} was not found`);
            return true;
          }
          return false;
        },
      );
      return;
    }
  });

  document.addEventListener('change', (event) => {
    const target = event.target as HTMLElement;
    const viewed = target.closest<HTMLInputElement>('input[data-viewed-path]');
    if (viewed) {
      void act(viewed, 'Working...', async () => {
        await call('PUT', `${base()}/viewed`, { path: viewed.dataset.viewedPath, viewed: viewed.checked });
      });
      return;
    }
    const outdated = target.closest<HTMLInputElement>('[data-outdated-switch]');
    if (outdated) {
      const region = document.querySelector<HTMLElement>('[data-outdated-region]');
      if (region) region.hidden = !outdated.checked;
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
    const field = (event.target as HTMLElement).closest<HTMLTextAreaElement>('[data-thread-reply]');
    if (!field) return;
    event.preventDefault();
    const id = field.dataset.threadReply;
    document.querySelector<HTMLElement>(`[data-thread-send="${id}"]`)?.click();
  });
}

export function outdatedSwitchOn(): boolean {
  return document.querySelector<HTMLInputElement>('[data-outdated-switch]')?.checked ?? false;
}

export function reapplyOutdated(): void {
  const region = document.querySelector<HTMLElement>('[data-outdated-region]');
  if (region) region.hidden = !outdatedSwitchOn();
}
