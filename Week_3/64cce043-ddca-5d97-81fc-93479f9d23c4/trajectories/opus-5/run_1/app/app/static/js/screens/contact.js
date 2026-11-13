// The trusted contact panel: granting, narrowing, revoking and the server's remaining time.

import { ApiError, FAILED_REQUEST, api } from '../api.js';
import { h } from '../dom.js';
import { openDialog, pending, showFieldErrors } from '../dialog.js';
import { levels } from '../vocab.js';

const REFRESH_INTERVAL = 15_000;
const DURATIONS = [
    ['24h', '24 hours'],
    ['7d', '7 days'],
    ['30d', '30 days'],
];

// The server's remaining_seconds, written in the published units.
export function remainingText(seconds) {
    if (seconds >= 86_400) {
        return `${Math.floor(seconds / 86_400)}d ${Math.floor((seconds % 86_400) / 3600)}h`;
    }
    if (seconds >= 3600) {
        return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
    }
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export async function contactScreen(mount, app) {
    const panel = h('div', { class: 'panel' });
    const alertSlot = h('div', {});
    const grantUpdates = h('p', {
        class: 'notice-line',
        role: 'status',
        'aria-label': 'Grant updates',
    });
    mount.append(
        h(
            'div',
            { class: 'screen' },
            h('h1', { text: 'Trusted contact' }),
            alertSlot,
            grantUpdates,
            panel,
        ),
    );

    let grant = null;
    let dialogOpen = false;

    async function load() {
        const answer = await api.get('/api/grant');
        grant = answer.grant;
        render();
    }

    function render() {
        panel.replaceChildren();
        if (grant === null) {
            panel.append(
                h('p', {
                    class: 'empty-state',
                    text: 'No trusted contact. Add one to share a read-only view while you are away.',
                }),
                addButton(),
            );
            return;
        }
        const active = grant.status === 'active';
        const statusWord = grant.status.charAt(0).toUpperCase() + grant.status.slice(1);
        panel.append(
            h(
                'dl',
                { class: 'detail-list' },
                h('dt', { text: 'Contact' }),
                h('dd', { text: grant.contact_name }),
                h('dt', { text: 'Email' }),
                h('dd', { text: grant.contact_email }),
                h('dt', { text: 'Status' }),
                h('dd', {}, h('span', { class: 'status-word', text: statusWord })),
            ),
        );
        if (active) {
            panel.append(
                h('p', {
                    class: 'remaining',
                    text: `Access ends in ${remainingText(grant.remaining_seconds)}`,
                }),
            );
            const boxes = new Map();
            const group = h(
                'fieldset',
                { class: 'kind-grid', role: 'group', 'aria-label': 'Levels shown' },
                h('legend', { text: 'Levels shown' }),
            );
            for (const level of levels()) {
                const box = h('input', {
                    type: 'checkbox',
                    checked: grant.levels.includes(level.code),
                });
                boxes.set(level.code, box);
                group.append(h('label', { class: 'tick' }, box, h('span', { text: level.label })));
            }
            panel.append(
                group,
                h(
                    'div',
                    { class: 'actions-row' },
                    h('button', {
                        type: 'button',
                        text: 'Narrow scope',
                        onclick: () => narrow([...boxes.entries()]
                            .filter(([, box]) => box.checked)
                            .map(([code]) => code)),
                    }),
                    h('button', {
                        type: 'button',
                        class: 'danger',
                        text: 'Revoke access',
                        onclick: () => confirmRevoke(),
                    }),
                ),
            );
        } else {
            panel.append(addButton());
        }
    }

    function addButton() {
        return h('button', {
            type: 'button',
            text: 'Add trusted contact',
            onclick: () => openGrantDialog(),
        });
    }

    function problem(error) {
        if (!(error instanceof ApiError)) throw error;
        if (error.isSignedOut) {
            const next = encodeURIComponent(location.pathname);
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

    async function narrow(chosen) {
        alertSlot.replaceChildren();
        try {
            const answer = await api.patch('/api/grant', { levels: chosen });
            grant = answer.grant;
            render();
            grantUpdates.textContent = 'Scope narrowed.';
        } catch (error) {
            if (error instanceof ApiError && error.fields) {
                alertSlot.replaceChildren(
                    h('p', { class: 'alert', role: 'alert', text: error.fields.levels || error.message }),
                );
                return;
            }
            problem(error);
        }
    }

    function confirmRevoke() {
        openDialog({
            name: 'Revoke access?',
            alert: true,
            build(panelNode, dialog) {
                const revoke = h('button', { type: 'button', class: 'danger', text: 'Revoke' });
                revoke.addEventListener('click', async () => {
                    if (revoke.disabled) return;
                    revoke.disabled = true;
                    const name = grant.contact_name;
                    try {
                        const answer = await api.delete('/api/grant');
                        grant = answer.grant;
                        dialog.close('revoked');
                        render();
                        grantUpdates.textContent = `Access ended for ${name}.`;
                    } catch (error) {
                        revoke.disabled = false;
                        dialog.close('failed');
                        problem(error);
                        await load();
                    }
                });
                panelNode.append(
                    h('h2', { text: 'Revoke access?' }),
                    h('p', { text: 'Their sessions end at once and the shared view closes.' }),
                    h(
                        'div',
                        { class: 'dialog-actions' },
                        revoke,
                        h('button', {
                            type: 'button',
                            text: 'Keep',
                            dataset: { safe: 'true' },
                            onclick: () => dialog.close('keep'),
                        }),
                    ),
                );
            },
        });
    }

    function openGrantDialog() {
        dialogOpen = true;
        openDialog({
            name: 'Grant access',
            onClose: () => {
                dialogOpen = false;
                load();
            },
            build(panelNode, dialog) {
                const name = h('input', { type: 'text', 'aria-label': 'Contact name' });
                const email = h('input', { type: 'text', 'aria-label': 'Contact email' });
                const durationGroup = h('div', {
                    role: 'radiogroup',
                    'aria-label': 'Duration',
                    class: 'kind-grid',
                });
                const radios = DURATIONS.map(([value, label], index) => {
                    const radio = h('input', {
                        type: 'radio',
                        name: 'duration',
                        value,
                        checked: index === 0,
                    });
                    durationGroup.append(
                        h('label', { class: 'tick' }, radio, h('span', { text: label })),
                    );
                    return radio;
                });
                const levelBoxes = new Map();
                const levelGroup = h(
                    'fieldset',
                    { class: 'kind-grid', role: 'group', 'aria-label': 'Levels shown' },
                    h('legend', { text: 'Levels shown' }),
                );
                for (const level of levels()) {
                    const box = h('input', { type: 'checkbox', checked: true });
                    levelBoxes.set(level.code, box);
                    levelGroup.append(
                        h('label', { class: 'tick' }, box, h('span', { text: level.label })),
                    );
                }
                const summarySlot = h('div', {});
                const dialogAlert = h('div', {});
                const save = h('button', { type: 'submit', class: 'primary', text: 'Grant access' });
                const fieldNodes = {
                    contact_name: name,
                    contact_email: email,
                    duration: durationGroup,
                    levels: levelGroup,
                };
                const form = h(
                    'form',
                    { novalidate: true },
                    h('h2', { text: 'Grant access' }),
                    summarySlot,
                    dialogAlert,
                    h('div', { class: 'field' }, h('label', { text: 'Contact name' }), name),
                    h('div', { class: 'field' }, h('label', { text: 'Contact email' }), email),
                    h('div', { class: 'field' }, h('span', { text: 'Duration' }), durationGroup),
                    levelGroup,
                    h(
                        'div',
                        { class: 'dialog-actions' },
                        save,
                        h('button', {
                            type: 'button',
                            text: 'Cancel',
                            onclick: () => dialog.close('cancel'),
                        }),
                    ),
                );
                panelNode.append(form);
                form.addEventListener('submit', async (event) => {
                    event.preventDefault();
                    summarySlot.replaceChildren();
                    dialogAlert.replaceChildren();
                    pending(save);
                    try {
                        const answer = await api.post('/api/grant', {
                            contact_name: name.value,
                            contact_email: email.value,
                            duration: radios.find((radio) => radio.checked).value,
                            levels: [...levelBoxes.entries()]
                                .filter(([, box]) => box.checked)
                                .map(([code]) => code),
                        });
                        grant = answer.grant;
                        grantUpdates.textContent = `Access granted to ${answer.grant.contact_name}.`;
                        const done = h('button', {
                            type: 'button',
                            class: 'primary',
                            text: 'Done',
                            onclick: () => dialog.close('done'),
                        });
                        panelNode.replaceChildren(
                            h('h2', { text: 'Grant access' }),
                            h('p', { text: 'Pass this on to your trusted contact. It is shown once.' }),
                            h('p', {
                                class: 'temporary-password',
                                text: `Temporary password: ${answer.temporary_password}`,
                            }),
                            h('div', { class: 'dialog-actions' }, done),
                        );
                        done.focus();
                        render();
                    } catch (error) {
                        pending(save, false);
                        if (!(error instanceof ApiError)) throw error;
                        if (error.isSignedOut) {
                            const next = encodeURIComponent(location.pathname);
                            location.assign(`/auth/login?next=${next}`);
                            return;
                        }
                        if (error.fields) {
                            showFieldErrors(error.fields, fieldNodes, summarySlot);
                            return;
                        }
                        const alert = h('p', {
                            class: 'alert',
                            role: 'alert',
                            tabindex: '-1',
                            text: error.isUnexplained ? FAILED_REQUEST : error.message,
                        });
                        dialogAlert.replaceChildren(alert);
                        alert.focus();
                    }
                });
            },
        });
    }

    await load();
    // The open dialog is never redrawn away, so the panel refresh waits for it.
    const timer = window.setInterval(() => {
        if (!dialogOpen) load();
    }, REFRESH_INTERVAL);

    return {
        path: '/vault/contact',
        onChange: () => {
            if (!dialogOpen) load();
        },
        destroy: () => window.clearInterval(timer),
    };
}
