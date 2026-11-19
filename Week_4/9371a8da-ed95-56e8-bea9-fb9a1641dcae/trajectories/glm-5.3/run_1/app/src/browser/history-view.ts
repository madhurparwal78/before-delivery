import { el } from './dom.js';
import * as api from './api.js';
import { ApiFailure } from './api.js';
import type { Label, LedgerEntry, Member, Invite, ShareLink, CitationReport, Role, TextFile, Suggestion, Thread, ExportShape } from '../shared/types.js';
import { navigate, requestFocus, rerender } from './app-state.js';
import { projectUrl } from './router.js';
import { formatDateTime } from './layout.js';
import { dialogFrame, wrapTab, mentionState, updateMention, buildMentionList, mentionKeydown, fieldError } from './dialogs.js';
import { isFailure, type ProjectHandle, type DialogState } from './actions.js';

export function slugTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** The History dialog: a live ledger with labels and restores. */
export function historyDialog(h: ProjectHandle, close: () => void): HTMLElement {
  return dialogFrame({ title: 'History', wide: true, close }, (body) => {
    const isOwner = h.role === 'owner';
    const labelField = el('div', { class: 'field' });
    let labelName = '';
    let labelError: string | undefined;
    if (isOwner) {
      const input = el('input', {
        type: 'text', id: 'label-name', 'aria-label': 'Label name', placeholder: 'Label name',
        oninput: (e: Event) => { labelName = (e.target as HTMLInputElement).value; },
        onkeydown: (e: Event) => {
          const kev = e as KeyboardEvent;
          if (kev.key === 'Enter') {
            kev.preventDefault();
            void submitLabel();
          }
        },
      }) as HTMLInputElement;
      const btn = el('button', {
        onclick: () => void submitLabel(),
      }, 'Label current revision');
      labelField.appendChild(el('label', { for: 'label-name' }, 'Label name'));
      labelField.appendChild(input);
      labelField.appendChild(btn);
      const err = el('div', { id: 'label-error' });
      labelField.appendChild(err);
      body.appendChild(labelField);
      input.focus();
    }
    async function submitLabel(): Promise<void> {
      const name = labelName.trim();
      if (name.length < 1 || name.length > 60) {
        labelError = 'Enter a label of 1 to 60 characters.';
        showLabelError();
        return;
      }
      const newest = h.historyEntries[0]?.projectRevision ?? h.citationReport?.projectRevision ?? 1;
      try {
        await api.postLabel(h.pid, name, newest);
        labelName = '';
        (document.getElementById('label-name') as HTMLInputElement).value = '';
        labelError = undefined;
        showLabelError();
        const labels = await api.getLabels(h.pid);
        h.labels = labels.labels;
        h.message(`Labelled r${newest} as ${name}`);
        rerender();
      } catch (e) {
        if (isFailure(e) && e.shape.status === 409) {
          labelError = 'That label is already used in this project.';
        } else if (isFailure(e) && e.shape.status === 422) {
          labelError = e.shape.errors?.name === 'unstorable character'
            ? 'This text contains a character that cannot be stored.'
            : 'Enter a label of 1 to 60 characters.';
        } else {
          labelError = undefined;
          h.message('Something went wrong. Try again.');
        }
        showLabelError();
      }
    }
    function showLabelError(): void {
      const err = document.getElementById('label-error');
      if (err) err.replaceChildren(fieldError(labelError) ?? el('span'));
      const input = document.getElementById('label-name') as HTMLInputElement | null;
      if (input && labelError) {
        input.setAttribute('aria-describedby', 'label-error');
        input.focus();
      }
    }
    void wrapTab;
    const table = el('table', { class: 'ledger', 'aria-label': 'Revisions' });
    const thead = el('thead', {},
      el('tr', {},
        el('th', {}, 'Revision'),
        el('th', {}, 'When'),
        el('th', {}, 'Who'),
        el('th', {}, 'What'),
        el('th', {}, 'Labels'),
      ));
    table.appendChild(thead);
    const tbody = el('tbody');
    for (const entry of h.historyEntries) {
      const row = el('tr', { 'data-rev': entry.projectRevision });
      const revCell = el('th', { scope: 'row', class: 'rev', id: `rev-${entry.projectRevision}`, tabindex: '-1' }, `r${entry.projectRevision}`);
      row.appendChild(revCell);
      row.appendChild(el('td', {}, formatDateTime(entry.at)));
      row.appendChild(el('td', {}, entry.actor.displayName));
      row.appendChild(el('td', {}, entry.summary));
      const labelCell = el('td', {});
      for (const labelName of entry.labels) {
        labelCell.appendChild(el('span', { class: 'mono' }, labelName, ' '));
        if (isOwner) {
          labelCell.appendChild(el('button', {
            'aria-label': `Restore ${labelName}`,
            onclick: () => {
              h.dialog = { kind: 'restore-confirm', label: { id: '', name: labelName, projectRevision: entry.projectRevision, createdAt: '', createdBy: { id: '', displayName: '', handle: '' } } };
              rerender();
            },
          }, `Restore ${labelName}`));
        }
      }
      row.appendChild(labelCell);
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    body.appendChild(table);
    if (!isOwner) {
      queueMicrotask(() => {
        const t = document.querySelector('[data-rev]') as HTMLElement | null;
        t?.setAttribute('tabindex', '-1');
        t?.focus();
      });
    }
  });
}

export function restoreConfirm(h: ProjectHandle, labelName: string, close: () => void): HTMLElement {
  return dialogFrame({ title: `Restore ${labelName}?`, close, alert: true }, (body) => {
    body.appendChild(el('p', {}, `This adds a new revision whose files match ${labelName} exactly. Nothing in the ledger is erased.`));
    const cancel = el('button', {
      onclick: () => { close(); requestFocus(`restore-${labelName}`); },
    }, 'Cancel');
    const confirm = el('button', {
      class: 'primary',
      onclick: () => void doRestore(),
    }, 'Restore');
    const actions = el('div', { class: 'actions-row' }, cancel, confirm);
    body.appendChild(actions);
    queueMicrotask(() => cancel.focus());
    async function doRestore(): Promise<void> {
      h.message(`Restoring ${labelName}…`);
      try {
        const labels = await api.getLabels(h.pid);
        const label = labels.labels.find((l) => l.name === labelName);
        if (!label) throw new Error('missing');
        const res = await api.postRestore(h.pid, label.id);
        h.historyEntries = await (await api.getHistory(h.pid)).entries;
        h.labels = labels.labels;
        h.message(`Restored ${labelName} as r${res.projectRevision}`);
        close();
        rerender();
        requestFocus(`rev-${res.projectRevision}`);
      } catch (e) {
        if (isFailure(e) && e.shape.status === 403) {
          h.message('You can no longer do that. Your role on this project is now viewer.');
          close();
          requestFocus('source-box');
        } else {
          h.message('Something went wrong. Try again.');
        }
        rerender();
      }
    }
  });
}
