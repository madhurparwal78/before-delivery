// One holding: how it is graded, whether it is affected, and its edit and delete controls.

import { ApiError, FAILED_REQUEST, api } from '../api.js';
import { h } from '../dom.js';
import { openDialog } from '../dialog.js';
import * as drafts from '../drafts.js';
import { EDIT, openHoldingDialog } from '../holdingdialog.js';
import { kindLabel, levelLabel } from '../vocab.js';

export async function holdingScreen(mount, app, [holdingId]) {
    const panel = h('div', { class: 'panel' });
    const alertSlot = h('div', {});
    const updates = h('p', {
        class: 'notice-line',
        role: 'status',
        'aria-label': 'Exposure updates',
    });
    mount.append(h('div', { class: 'screen' }, alertSlot, panel, updates));

    let holding = null;
    let leaving = false;

    async function load() {
        const [answer, ruleList] = await Promise.all([
            api.get(`/api/holdings/${holdingId}`),
            api.get('/api/rules'),
        ]);
        holding = answer.holding;
        const rule = ruleList.rules.find((candidate) => candidate.id === holding.rule_id);
        render(rule ? `Graded by ${rule.label}` : 'No rule matched');
    }

    function render(gradedBy) {
        panel.replaceChildren(
            h('h1', { text: holding.company }),
            h(
                'dl',
                { class: 'detail-list' },
                h('dt', { text: 'Data kind' }),
                h('dd', { text: kindLabel(holding.data_kind) }),
                h('dt', { text: 'Level' }),
                h(
                    'dd',
                    {},
                    h('span', {
                        class: `badge ${holding.level}`,
                        text: levelLabel(holding.level),
                    }),
                ),
                h('dt', { text: 'Value' }),
                h('dd', { class: 'mono', text: holding.value }),
                h('dt', { text: 'Notes' }),
                h('dd', { text: holding.notes || '—' }),
                h('dt', { text: 'Grading' }),
                h('dd', { text: gradedBy }),
                h('dt', { text: 'Affected' }),
                h('dd', { text: holding.affected ? 'Yes' : 'No' }),
            ),
            h(
                'div',
                { class: 'actions-row' },
                h('button', { type: 'button', text: 'Edit holding', onclick: () => openEdit() }),
                h('button', {
                    type: 'button',
                    class: 'danger',
                    text: 'Delete holding',
                    onclick: () => confirmDelete(),
                }),
            ),
        );
    }

    function openEdit(draft = null) {
        openHoldingDialog({
            mode: EDIT,
            holding,
            email: app.me.email,
            draft,
            onRestored: () => app.draftRestored(),
            onSaved: async (answer) => {
                holding = answer.holding;
                await load();
                updates.textContent = `Holding saved. Exposure score ${answer.exposure.score}.`;
            },
        });
    }

    function confirmDelete() {
        openDialog({
            name: 'Delete holding?',
            alert: true,
            build(panelNode, dialog) {
                const remove = h('button', {
                    type: 'button',
                    class: 'danger',
                    text: 'Delete',
                });
                const keep = h('button', {
                    type: 'button',
                    text: 'Keep',
                    dataset: { safe: 'true' },
                    onclick: () => dialog.close('keep'),
                });
                remove.addEventListener('click', async () => {
                    // Disabled as soon as it is pressed, so a double click sends one request.
                    if (remove.disabled) return;
                    remove.disabled = true;
                    // This screen is on its way to the ledger, so the delete's own
                    // change event must not drag it to the not-found page.
                    leaving = true;
                    try {
                        await api.delete(`/api/holdings/${holdingId}`);
                        const exposure = await api.get('/api/exposure');
                        dialog.close('deleted');
                        app.announceNext(`Holding deleted. Exposure score ${exposure.score}.`);
                        await app.navigate('/vault');
                        const add = [...document.querySelectorAll('button')].find(
                            (button) => button.textContent === 'Add holding',
                        );
                        if (add) add.focus();
                    } catch (error) {
                        leaving = false;
                        remove.disabled = false;
                        dialog.close('failed');
                        showProblem(error);
                    }
                });
                panelNode.append(
                    h('h2', { text: 'Delete holding?' }),
                    h('p', {
                        text: 'This removes the holding, its steps and its done marks from every surface.',
                    }),
                    h('div', { class: 'dialog-actions' }, remove, keep),
                );
            },
        });
    }

    function showProblem(error) {
        if (!(error instanceof ApiError)) throw error;
        if (error.isSignedOut) {
            const next = encodeURIComponent(location.pathname + location.search);
            location.assign(`/auth/login?next=${next}`);
            return;
        }
        alertSlot.replaceChildren(
            h('p', {
                class: 'alert',
                role: 'alert',
                text: error.isUnexplained ? FAILED_REQUEST : error.message,
            }),
        );
    }

    await load();
    const editDraft = drafts.take('holding-edit', app.me.email);
    if (editDraft) openEdit(editDraft);

    return {
        path: location.pathname,
        onChange: async () => {
            if (leaving) return;
            try {
                await load();
            } catch (error) {
                if (error instanceof ApiError && error.code === 'not_found') {
                    location.assign('/vault');
                    return;
                }
                throw error;
            }
        },
    };
}
