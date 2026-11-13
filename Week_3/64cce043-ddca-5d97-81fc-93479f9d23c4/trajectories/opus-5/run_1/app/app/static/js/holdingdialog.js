// Add holding and Edit holding share one dialog.

import { ApiError, FAILED_REQUEST, api } from './api.js';
import { h } from './dom.js';
import { openDialog, pending, showFieldErrors } from './dialog.js';
import * as drafts from './drafts.js';
import { kinds } from './vocab.js';

export const ADD = 'Add holding';
export const EDIT = 'Edit holding';

export function openHoldingDialog({ mode, holding, email, draft, onSaved, onRestored }) {
    const editing = mode === EDIT;
    const values = draft
        ? draft.values
        : {
              company: editing ? holding.company : '',
              data_kind: editing ? holding.data_kind : kinds()[0].code,
              value: editing ? holding.value : '',
              notes: editing ? holding.notes : '',
          };
    // An open Edit dialog keeps the version it was opened with.
    const version = draft ? draft.version : editing ? holding.version : null;

    return openDialog({
        name: mode,
        build(panel, dialog) {
            const company = h('input', { type: 'text', 'aria-label': 'Company', value: values.company });
            const dataKind = h(
                'select',
                { 'aria-label': 'Data kind' },
                kinds().map((kind) =>
                    h('option', {
                        value: kind.code,
                        text: kind.label,
                        selected: kind.code === values.data_kind,
                    }),
                ),
            );
            const value = h('input', {
                type: 'text',
                'aria-label': 'Value',
                class: 'mono',
                value: values.value,
            });
            const notes = h('textarea', { 'aria-label': 'Notes' });
            notes.value = values.notes || '';
            const summarySlot = h('div', {});
            const alertSlot = h('div', {});
            const save = h('button', { type: 'submit', class: 'primary', text: 'Save holding' });
            const cancel = h('button', {
                type: 'button',
                text: 'Cancel',
                onclick: () => dialog.close('cancel'),
            });
            const fieldNodes = { company, data_kind: dataKind, value, notes };

            const form = h(
                'form',
                { novalidate: true },
                h('h2', { text: mode }),
                summarySlot,
                alertSlot,
                h('div', { class: 'field' }, h('label', { text: 'Company' }), company),
                h('div', { class: 'field' }, h('label', { text: 'Data kind' }), dataKind),
                h('div', { class: 'field' }, h('label', { text: 'Value' }), value),
                h('div', { class: 'field' }, h('label', { text: 'Notes' }), notes),
                h('div', { class: 'dialog-actions' }, save, cancel),
            );
            panel.append(form);

            form.addEventListener('submit', async (event) => {
                event.preventDefault();
                summarySlot.replaceChildren();
                alertSlot.replaceChildren();
                pending(save);
                const body = {
                    company: company.value,
                    data_kind: dataKind.value,
                    value: value.value,
                    notes: notes.value,
                };
                try {
                    const answer = editing
                        ? await api.patch(`/api/holdings/${holding.id}`, { ...body, version })
                        : await api.post('/api/holdings', body);
                    dialog.close('saved');
                    onSaved(answer);
                } catch (error) {
                    pending(save, false);
                    if (!(error instanceof ApiError)) throw error;
                    if (error.isSignedOut) {
                        drafts.store({
                            kind: editing ? 'holding-edit' : 'holding-add',
                            email,
                            version,
                            values: body,
                        });
                        drafts.signInAgain();
                        return;
                    }
                    if (error.fields) {
                        showFieldErrors(error.fields, fieldNodes, summarySlot);
                        return;
                    }
                    const summary = h('p', { class: 'alert', role: 'alert', tabindex: '-1' });
                    summary.textContent = error.isUnexplained ? FAILED_REQUEST : error.message;
                    alertSlot.replaceChildren(summary);
                    if (error.code === 'stale_version') summary.focus();
                }
            });

            if (draft) {
                window.setTimeout(() => {
                    save.focus();
                    if (onRestored) onRestored();
                }, 0);
            }
        },
    });
}
