// One breach: its data kinds, the holdings it touches and their steps.

import { ApiError, FAILED_REQUEST, api } from '../api.js';
import { Latest, h } from '../dom.js';
import { openDialog, pending } from '../dialog.js';
import * as drafts from '../drafts.js';
import { kindLabel, kinds, levelLabel } from '../vocab.js';

export async function breachScreen(mount, app, [breachId]) {
    const latest = new Latest();
    const heading = h('h1', {});
    const kindGroup = h(
        'fieldset',
        { class: 'kind-grid', role: 'group', 'aria-label': 'Data kinds' },
        h('legend', { text: 'Data kinds' }),
    );
    const projected = h('span', { class: 'projected' });
    const saveKinds = h('button', { type: 'button', class: 'primary', text: 'Save kinds' });
    const removeBreach = h('button', { type: 'button', class: 'danger', text: 'Remove breach' });
    const affectedBody = h('tbody', { role: 'rowgroup' });
    const affected = h(
        'table',
        { role: 'table', 'aria-label': 'Affected holdings' },
        h(
            'thead',
            { role: 'rowgroup' },
            h(
                'tr',
                { role: 'row' },
                h('th', { role: 'columnheader', scope: 'col', text: 'Company' }),
                h('th', { role: 'columnheader', scope: 'col', text: 'Data kind' }),
                h('th', { role: 'columnheader', scope: 'col', text: 'Level' }),
            ),
        ),
        affectedBody,
    );
    const stepList = h('ul', {
        class: 'steps',
        role: 'list',
        'aria-label': 'Steps for this breach',
    });
    const alertSlot = h('div', {});
    const updates = h('p', {
        class: 'notice-line',
        role: 'status',
        'aria-label': 'Exposure updates',
    });
    mount.append(
        h(
            'div',
            { class: 'screen' },
            alertSlot,
            heading,
            h(
                'div',
                { class: 'panel' },
                kindGroup,
                h('div', { class: 'actions-row' }, saveKinds, projected, removeBreach),
            ),
            updates,
            h('h2', { text: 'Affected holdings' }),
            affected,
            h('h2', { text: 'Steps for this breach' }),
            stepList,
        ),
    );

    let breach = null;
    let version = null;
    const boxes = new Map();
    let ticksTouched = false;
    let leaving = false;

    for (const kind of kinds()) {
        const box = h('input', { type: 'checkbox' });
        box.addEventListener('change', () => {
            ticksTouched = true;
            requestProjection();
        });
        boxes.set(kind.code, box);
        kindGroup.append(h('label', { class: 'tick' }, box, h('span', { text: kind.label })));
    }

    function ticked() {
        return [...boxes.entries()].filter(([, box]) => box.checked).map(([code]) => code);
    }

    function setTicks(codes) {
        for (const [code, box] of boxes) box.checked = codes.includes(code);
    }

    async function requestProjection() {
        const token = latest.next();
        try {
            const answer = await api.post('/api/breaches/preview', {
                company: breach.company,
                data_kinds: ticked(),
                breach_id: breach.id,
            });
            if (!latest.current(token)) return;
            projected.textContent = `Projected score ${answer.score}`;
        } catch (error) {
            if (!latest.current(token)) return;
            projected.textContent = '';
        }
    }

    async function load({ keepTicks = false } = {}) {
        const answer = await api.get(`/api/breaches/${breachId}`);
        breach = answer.breach;
        heading.textContent = `Breach at ${breach.company}`;
        if (!keepTicks) {
            // Unsaved ticks keep the version they were made against, so a save
            // afterwards meets the stale-edit rule.
            version = answer.breach.version;
            setTicks(breach.data_kinds);
            ticksTouched = false;
            projected.textContent = '';
        }
        affectedBody.replaceChildren(
            ...answer.holdings.map((holding) =>
                h(
                    'tr',
                    { role: 'row' },
                    h('td', { role: 'cell', text: holding.company }),
                    h('td', { role: 'cell', text: kindLabel(holding.data_kind) }),
                    h(
                        'td',
                        { role: 'cell' },
                        h('span', {
                            class: `badge ${holding.level}`,
                            text: levelLabel(holding.level),
                        }),
                    ),
                ),
            ),
        );
        stepList.replaceChildren(
            ...answer.steps.map((step) =>
                h(
                    'li',
                    {},
                    h(
                        'div',
                        { class: 'step' },
                        h(
                            'span',
                            { class: 'step-text' },
                            h('span', { text: step.text }),
                            h(
                                'span',
                                { class: 'step-meta' },
                                `${step.company} · ${kindLabel(step.data_kind)} · `,
                                h('span', { class: 'points', text: String(step.points) }),
                                ' points',
                            ),
                        ),
                        h('span', {
                            class: 'step-state',
                            text: step.status === 'done' ? 'Done' : 'Open',
                        }),
                    ),
                ),
            ),
        );
    }

    saveKinds.addEventListener('click', async () => {
        alertSlot.replaceChildren();
        pending(saveKinds);
        try {
            const answer = await api.patch(`/api/breaches/${breachId}`, {
                version,
                data_kinds: ticked(),
            });
            pending(saveKinds, false);
            version = answer.breach.version;
            ticksTouched = false;
            projected.textContent = '';
            await load();
            updates.textContent = `Breach updated. Exposure score ${answer.exposure.score}.`;
        } catch (error) {
            pending(saveKinds, false);
            if (!(error instanceof ApiError)) throw error;
            if (error.isSignedOut) {
                drafts.store({
                    kind: 'breach-kinds',
                    email: app.me.email,
                    version,
                    values: { data_kinds: ticked() },
                });
                drafts.signInAgain();
                return;
            }
            if (error.code === 'stale_version') {
                const alert = h('p', { class: 'alert', role: 'alert', text: error.message });
                alertSlot.replaceChildren(alert);
                await load();
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
    });

    removeBreach.addEventListener('click', () => {
        openDialog({
            name: 'Remove breach?',
            alert: true,
            build(panelNode, dialog) {
                const confirm = h('button', { type: 'button', class: 'danger', text: 'Remove' });
                const keep = h('button', {
                    type: 'button',
                    text: 'Keep',
                    dataset: { safe: 'true' },
                    onclick: () => dialog.close('keep'),
                });
                confirm.addEventListener('click', async () => {
                    if (confirm.disabled) return;
                    confirm.disabled = true;
                    // This screen is on its way to the breaches list, so the removal's
                    // own change event must not drag it to the not-found page.
                    leaving = true;
                    try {
                        await api.delete(`/api/breaches/${breachId}`);
                        const exposure = await api.get('/api/exposure');
                        dialog.close('removed');
                        app.announceNext(`Breach removed. Exposure score ${exposure.score}.`);
                        await app.navigate('/vault/breaches');
                    } catch (error) {
                        leaving = false;
                        confirm.disabled = false;
                        dialog.close('failed');
                        if (error instanceof ApiError && error.isSignedOut) {
                            const next = encodeURIComponent(location.pathname);
                            location.assign(`/auth/login?next=${next}`);
                            return;
                        }
                        alertSlot.replaceChildren(
                            h('p', { class: 'alert', role: 'alert', text: FAILED_REQUEST }),
                        );
                    }
                });
                panelNode.append(
                    h('h2', { text: 'Remove breach?' }),
                    h('p', { text: 'Its touched holdings, steps and score contribution go with it.' }),
                    h('div', { class: 'dialog-actions' }, confirm, keep),
                );
            },
        });
    });

    await load();
    const draft = drafts.take('breach-kinds', app.me.email);
    if (draft) {
        setTicks(draft.values.data_kinds);
        version = draft.version;
        ticksTouched = true;
        saveKinds.focus();
        app.draftRestored();
        requestProjection();
    }

    return {
        path: location.pathname,
        onChange: async () => {
            if (leaving) return;
            const focused = document.activeElement;
            try {
                await load({ keepTicks: ticksTouched });
            } catch (error) {
                if (error instanceof ApiError && error.code === 'not_found') {
                    location.assign('/vault/breaches');
                    return;
                }
                throw error;
            }
            if (focused && focused.isConnected) focused.focus();
            if (ticksTouched) requestProjection();
        },
    };
}
