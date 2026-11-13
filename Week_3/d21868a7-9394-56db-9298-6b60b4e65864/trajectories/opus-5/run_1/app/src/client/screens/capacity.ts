import { WINDOW_STATUS_LABELS } from '../../domain/time.ts';
import { api, failureOf } from '../api.ts';
import { copy } from '../copy.ts';
import { managedDialog } from '../dialog.ts';
import { clear, el, setText, trapFocus } from '../dom.ts';
import type { Screen } from '../screen.ts';
import { requireUser } from '../session.ts';
import { dataRow, dataTable } from '../table.ts';
import type { CapacityTable, ChannelRecord, WindowRecord } from '../types.ts';

/** A channel's capacity table beside its revision list. */

interface CellView {
  input: HTMLInputElement;
  savedNote: HTMLElement;
  typedNote: HTMLElement;
  error: HTMLElement;
  remaining: HTMLElement;
  capVolume: HTMLElement;
  committed: HTMLElement;
}

export async function capacityScreen(channelId: string): Promise<Screen> {
  const user = requireUser();
  const editable = user.role === 'dispatcher';

  const channels = await api.get<{ channels: ChannelRecord[] }>('/api/channels');
  const channel = channels.channels.find((entry) => entry.id === channelId);
  if (channel === undefined) throw new Error('unknown channel');

  const status = el('p', {
    class: 'status',
    attrs: { role: 'status', 'aria-label': 'Capacity status', 'aria-live': 'polite' },
  });
  const table = dataTable(`Capacity table ${channel.name}`, [
    'Window',
    'Remaining (ML)',
    'Cap (ML/day)',
    'Cap volume (ML)',
    'Committed (ML)',
  ], 'capacity-table');
  const revisionList = el('ul', { class: 'revisions', attrs: { role: 'list', 'aria-label': 'Revisions' } });
  const saveButton = el('button', { class: 'button button-primary', text: 'Save table', attrs: { type: 'button' } });
  const dialogHost = el('div');

  const element = el('main', {
    class: 'page capacity-page',
    children: [
      el('h1', { text: `Capacity table ${channel.name}` }),
      el('div', {
        class: 'capacity-grid',
        children: [
          el('section', {
            class: 'card',
            children: [table.element, editable ? saveButton : null, status],
          }),
          el('section', { class: 'card', children: [el('h2', { text: 'Revisions' }), revisionList] }),
        ],
      }),
      dialogHost,
    ],
  });

  const cells = new Map<string, CellView>();
  const dirty = new Set<string>();
  const typed = new Map<string, string>();
  let baseRevision = 0;
  let baseCaps = new Map<string, string>();
  let windows: WindowRecord[] = [];
  let conflictOpen = false;

  const load = async (): Promise<{ table: CapacityTable; windows: WindowRecord[] }> => {
    const [capacity, windowReply] = await Promise.all([
      api.get<CapacityTable>(`/api/channels/${encodeURIComponent(channelId)}/capacity`),
      api.get<{ windows: WindowRecord[] }>(`/api/windows?channel=${encodeURIComponent(channelId)}`),
    ]);
    return { table: capacity, windows: windowReply.windows };
  };

  const buildRows = (): void => {
    clear(table.body);
    cells.clear();
    for (const window of windows) {
      const closed = window.status === 'closed';
      const input = el('input', {
        class: 'input tabular cap-input',
        attrs: {
          type: 'text',
          inputmode: 'decimal',
          autocomplete: 'off',
          'aria-label': `Cap for ${window.label} (ML/day)`,
          readonly: closed || !editable,
        },
      });
      input.value = window.table_cap_ml_day;
      input.addEventListener('input', () => {
        dirty.add(window.id);
        typed.set(window.id, input.value.trim());
        paintNotes();
      });
      const savedNote = el('p', { class: 'cell-note' });
      const typedNote = el('p', { class: 'cell-note' });
      const error = el('p', { class: 'field-error' });
      const remaining = el('span', { class: 'tabular counter-value-small', text: window.remaining_ml });
      const capVolume = el('span', { class: 'tabular', text: window.cap_volume_ml });
      const committed = el('span', { class: 'tabular', text: window.committed_ml });

      table.body.appendChild(
        dataRow([
          {
            label: 'Window',
            content: [
              el('span', { class: 'window-label', text: window.label }),
              el('span', { class: 'cell-status', text: WINDOW_STATUS_LABELS[window.status] }),
            ],
          },
          { label: 'Remaining (ML)', content: remaining },
          { label: 'Cap (ML/day)', content: [input, savedNote, typedNote, error] },
          { label: 'Cap volume (ML)', content: capVolume },
          { label: 'Committed (ML)', content: committed },
        ]),
      );
      cells.set(window.id, { input, savedNote, typedNote, error, remaining, capVolume, committed });
    }
  };

  const paintNotes = (): void => {
    for (const window of windows) {
      const view = cells.get(window.id);
      if (view === undefined) continue;
      const baseCap = baseCaps.get(window.id);
      const movedAway = baseCap !== undefined && baseCap !== window.table_cap_ml_day;
      setText(view.savedNote, dirty.has(window.id) && movedAway ? copy.savedCapNow(window.table_cap_ml_day) : '');
      const typedValue = typed.get(window.id);
      setText(view.typedNote, !dirty.has(window.id) && typedValue !== undefined ? copy.youTyped(typedValue) : '');
    }
  };

  const paintRevisions = (capacity: CapacityTable): void => {
    const wanted = capacity.revisions
      .map((revision) => `${revision.revision}|${revision.saved_at}|${revision.saved_by}|${revision.restored_from ?? ''}`)
      .join('\u0001');
    if (revisionList.dataset.rendered === wanted) return;
    revisionList.dataset.rendered = wanted;
    clear(revisionList);
    for (const revision of capacity.revisions) {
      const isCurrent = revision.revision === capacity.revision;
      revisionList.appendChild(
        el('li', {
          class: 'revision-row',
          children: [
            el('span', { text: `Revision ${revision.revision}` }),
            el('span', { text: revision.saved_at }),
            el('span', { text: revision.saved_by }),
            revision.restored_from === null
              ? null
              : el('span', { text: `restored from ${revision.restored_from}` }),
            editable && !isCurrent ? restoreButton(revision.revision) : null,
          ],
        }),
      );
    }
  };

  const restoreButton = (revision: number): HTMLElement => {
    const button = el('button', {
      class: 'button',
      text: 'Restore',
      attrs: { type: 'button', 'aria-label': `Restore revision ${revision}` },
    });
    button.addEventListener('click', () => openRestoreDialog(revision, button));
    return button;
  };

  const openRestoreDialog = (revision: number, opener: HTMLElement): void => {
    const confirm = el('button', { class: 'button button-primary', text: 'Restore', attrs: { type: 'button' } });
    const cancel = el('button', { class: 'button', text: 'Cancel', attrs: { type: 'button' } });
    const dialog = el('div', {
      class: 'dialog',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': `Restore revision ${revision}` },
      children: [
        el('h2', { text: `Restore revision ${revision}` }),
        el('p', { text: 'This stores the caps of that revision as a new revision.' }),
        el('div', { class: 'dialog-actions', children: [cancel, confirm] }),
      ],
    });
    const overlay = el('div', { class: 'overlay', children: [dialog] });
    const release = trapFocus(dialog, () => close());
    const close = (): void => {
      release();
      overlay.remove();
      opener.focus();
    };
    cancel.addEventListener('click', close);
    confirm.addEventListener('click', () => {
      close();
      setText(status, copy.restoring);
      void (async () => {
        try {
          const reply = await api.post<{ revision: number; restored_from: number }>(
            `/api/channels/${encodeURIComponent(channelId)}/capacity/revisions/${revision}/restore`,
          );
          setText(status, copy.revisionRestored(reply.restored_from, reply.revision));
          dirty.clear();
          typed.clear();
          await refresh(true);
        } catch (cause) {
          const failure = failureOf(cause);
          setText(
            status,
            failure?.code === 'restore_below_committed'
              ? copy.restoreBelowCommitted(revision)
              : failure?.message ?? '',
          );
        }
      })();
    });
    dialogHost.appendChild(overlay);
    confirm.focus();
  };

  const conflictDialog = managedDialog(dialogHost, {
    role: 'alertdialog',
    label: 'Capacity table conflict',
    onEscape: () => closeConflict(),
  });
  const conflictTable = el('div', { class: 'conflict-columns' });
  const keepSettled = el('button', { class: 'button', text: 'Keep settled caps', attrs: { type: 'button' } });
  conflictDialog.element.append(
    el('h2', { text: 'Capacity table conflict' }),
    el('p', { text: copy.revisionConflict }),
    conflictTable,
    keepSettled,
  );

  let settledCaps: { window_id: string; cap_ml_day: string }[] = [];
  let settledRevision = 0;

  const closeConflict = (): void => {
    conflictOpen = false;
    conflictDialog.close();
    for (const [windowId, value] of typed) {
      const view = cells.get(windowId);
      const settled = settledCaps.find((cell) => cell.window_id === windowId);
      if (view !== undefined && settled !== undefined) view.input.value = settled.cap_ml_day;
      void value;
    }
    dirty.clear();
    baseRevision = settledRevision;
    baseCaps = new Map(settledCaps.map((cell) => [cell.window_id, cell.cap_ml_day]));
    paintNotes();
    saveButton.focus();
  };
  keepSettled.addEventListener('click', closeConflict);

  const openConflict = (
    submitted: { window_id: string; cap_ml_day: string }[],
    settled: { window_id: string; cap_ml_day: string }[],
  ): void => {
    settledCaps = settled;
    conflictOpen = true;
    clear(conflictTable);
    conflictTable.append(
      el('div', { class: 'conflict-column-head', text: 'Your numbers' }),
      el('div', { class: 'conflict-column-head', text: 'Settled caps' }),
    );
    for (const cell of submitted) {
      const window = windows.find((entry) => entry.id === cell.window_id);
      const settledCap = settled.find((entry) => entry.window_id === cell.window_id)?.cap_ml_day ?? '';
      conflictTable.append(
        el('div', {
          class: 'conflict-cell tabular',
          text: `${window?.label ?? cell.window_id}: ${cell.cap_ml_day}`,
        }),
        el('div', { class: 'conflict-cell tabular', text: `${window?.label ?? cell.window_id}: ${settledCap}` }),
      );
    }
    conflictDialog.open();
    keepSettled.focus();
  };

  saveButton.addEventListener('click', () => {
    const submitted = [...dirty].map((windowId) => ({
      window_id: windowId,
      cap_ml_day: (cells.get(windowId) as CellView).input.value.trim(),
    }));
    if (submitted.length === 0) return;
    setText(status, copy.saving);
    for (const view of cells.values()) setText(view.error, '');
    void (async () => {
      try {
        const reply = await api.put<{ revision: number }>(
          `/api/channels/${encodeURIComponent(channelId)}/capacity`,
          { base_revision: baseRevision, cells: submitted },
        );
        setText(status, copy.revisionSaved(reply.revision));
        dirty.clear();
        typed.clear();
        baseRevision = reply.revision;
        await refresh(true);
      } catch (cause) {
        const failure = failureOf(cause);
        if (failure === null) return;
        if (failure.code === 'revision_conflict') {
          settledRevision = failure.body.revision as number;
          openConflict(
            failure.body.submitted as { window_id: string; cap_ml_day: string }[],
            failure.body.cells as { window_id: string; cap_ml_day: string }[],
          );
          setText(status, copy.revisionConflict);
          await refresh(false);
          return;
        }
        if (failure.status === 422) {
          for (const [field, message] of Object.entries(failure.errors ?? {})) {
            const windowId = field.startsWith('cells.') ? field.slice('cells.'.length) : null;
            if (windowId === null) continue;
            const view = cells.get(windowId);
            if (view !== undefined) setText(view.error, message);
          }
          setText(status, '');
          return;
        }
        setText(status, failure.message ?? '');
      }
    })();
  });

  const refresh = async (resetBase: boolean): Promise<void> => {
    const loaded = await load();
    const changedWindows =
      windows.map((window) => window.id).join(',') !== loaded.windows.map((window) => window.id).join(',');
    windows = loaded.windows;
    if (cells.size === 0 || changedWindows) buildRows();
    if (resetBase || baseRevision === 0) {
      baseRevision = loaded.table.revision;
      baseCaps = new Map(loaded.table.cells.map((cell) => [cell.window_id, cell.cap_ml_day]));
    }
    for (const window of windows) {
      const view = cells.get(window.id);
      if (view === undefined) continue;
      setText(view.remaining, window.remaining_ml);
      setText(view.capVolume, window.cap_volume_ml);
      setText(view.committed, window.committed_ml);
      const closed = window.status === 'closed';
      if (closed || !editable) view.input.setAttribute('readonly', '');
      if (!dirty.has(window.id) && !conflictOpen) view.input.value = window.table_cap_ml_day;
    }
    paintRevisions(loaded.table);
    paintNotes();
  };

  await refresh(true);

  return {
    element,
    refresh: () => refresh(false),
    destroy: () => conflictDialog.destroy(),
  };
}
