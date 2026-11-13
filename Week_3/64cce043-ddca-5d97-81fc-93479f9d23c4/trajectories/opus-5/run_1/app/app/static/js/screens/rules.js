// Grading rules in order, with a preview of the levels and score an order would give.

import { ApiError, FAILED_REQUEST, api } from '../api.js';
import { Latest, announce, h } from '../dom.js';
import { openDialog, pending, showFieldErrors } from '../dialog.js';
import { kindLabel, kinds, levelLabel, levels } from '../vocab.js';

const PREVIEW_THROTTLE = 150;
const ORDER_REFUSED = 'The rules changed in another window. The order was not saved.';

export async function rulesScreen(mount, app) {
    const latest = new Latest();
    const list = h('ul', { class: 'rules', role: 'list', 'aria-label': 'Rules' });
    const previewBody = h('tbody', { role: 'rowgroup' });
    const projected = h('p', { class: 'projected' });
    const orderStatus = h('p', {
        class: 'notice-line',
        role: 'status',
        'aria-label': 'Rule order',
    });
    const updates = h('p', {
        class: 'notice-line',
        role: 'status',
        'aria-label': 'Exposure updates',
    });
    const alertSlot = h('div', {});
    const addRule = h('button', { type: 'button', text: 'Add rule', onclick: () => openRule(null) });

    const previewRegion = h(
        'section',
        { class: 'preview-region', role: 'region', 'aria-label': 'Preview' },
        h('h2', { text: 'Preview' }),
        projected,
        h(
            'table',
            { role: 'table', 'aria-label': 'Preview levels' },
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
            previewBody,
        ),
    );

    mount.append(
        h(
            'div',
            { class: 'screen two-column' },
            h('div', { class: 'exposure-pane' }, previewRegion),
            h(
                'div',
                { class: 'ledger-pane' },
                h('h1', { text: 'Grading rules' }),
                alertSlot,
                h('div', { class: 'ledger-head' }, addRule),
                list,
                orderStatus,
                updates,
            ),
        ),
    );

    let rules = [];
    let holdings = [];
    let working = null; // the tentative order while a rule is moved
    let moving = null; // the rule being moved, by pointer or keyboard
    let dragging = false;
    let deferredRedraw = false;

    async function loadAll() {
        const [ruleAnswer, holdingAnswer] = await Promise.all([
            api.get('/api/rules'),
            api.get('/api/holdings'),
        ]);
        rules = ruleAnswer.rules;
        holdings = holdingAnswer.items;
        renderRules(rules);
        renderPreview(
            holdings.map((holding) => ({ holding_id: holding.id, level: holding.level })),
            holdingAnswer.exposure.score,
        );
    }

    function renderRules(order) {
        list.replaceChildren(
            ...order.map((rule, index) =>
                h(
                    'li',
                    {
                        class: moving && moving.id === rule.id ? 'lifted' : '',
                        dataset: { ruleId: rule.id },
                    },
                    h('span', { class: 'rule-priority', text: String(index + 1) }),
                    h('span', { class: 'rule-label', text: rule.label }),
                    h(
                        'span',
                        { class: 'rule-actions' },
                        h('button', {
                            type: 'button',
                            class: 'handle',
                            'aria-label': `Move rule: ${rule.label}`,
                            text: '↕',
                            dataset: { handleFor: rule.id },
                            onpointerdown: (event) => startDrag(event, rule),
                            onkeydown: (event) => onHandleKey(event, rule),
                        }),
                        h('button', {
                            type: 'button',
                            'aria-label': `Edit rule: ${rule.label}`,
                            text: 'Edit',
                            onclick: () => openRule(rule),
                        }),
                        h('button', {
                            type: 'button',
                            class: 'danger',
                            'aria-label': `Delete rule: ${rule.label}`,
                            text: 'Delete',
                            onclick: () => removeRule(rule),
                        }),
                    ),
                ),
            ),
        );
    }

    function renderPreview(levelRows, score) {
        const byId = new Map(levelRows.map((row) => [row.holding_id, row.level]));
        previewBody.replaceChildren(
            ...holdings.map((holding) =>
                h(
                    'tr',
                    { role: 'row' },
                    h('td', { role: 'cell', text: holding.company }),
                    h('td', { role: 'cell', text: kindLabel(holding.data_kind) }),
                    h(
                        'td',
                        { role: 'cell' },
                        h('span', {
                            class: `badge ${byId.get(holding.id) || holding.level}`,
                            text: levelLabel(byId.get(holding.id) || holding.level),
                        }),
                    ),
                ),
            ),
        );
        projected.textContent = `Projected score ${score}`;
    }

    function focusHandle(ruleId) {
        const handle = list.querySelector(`[data-handle-for="${CSS.escape(ruleId)}"]`);
        if (handle) handle.focus();
    }

    let lastPreviewAt = 0;
    let previewTimer = 0;

    function requestOrderPreview() {
        const since = performance.now() - lastPreviewAt;
        window.clearTimeout(previewTimer);
        if (since < PREVIEW_THROTTLE) {
            previewTimer = window.setTimeout(requestOrderPreview, PREVIEW_THROTTLE - since);
            return;
        }
        lastPreviewAt = performance.now();
        const order = (working || rules).map((rule) => rule.id);
        const token = latest.next();
        api
            .post('/api/rules/preview', { rule_ids: order })
            .then((answer) => {
                if (!latest.current(token)) return;
                renderPreview(answer.levels, answer.score);
            })
            .catch(() => {});
    }

    function positionOf(ruleId) {
        return working.findIndex((rule) => rule.id === ruleId) + 1;
    }

    function announceMove(prefix) {
        announce(
            orderStatus,
            `${prefix}Position ${positionOf(moving.id)} of ${working.length}.`,
        );
    }

    // -- pointer drag ----------------------------------------------------

    function startDrag(event, rule) {
        if (moving) return;
        event.preventDefault();
        moving = rule;
        dragging = true;
        working = [...rules];
        renderRules(working);
        focusHandle(rule.id);
        announceMove(`Picked up ${rule.label}. `);
        requestOrderPreview();

        const onMove = (move) => {
            const items = [...list.children];
            const target = items.find((item) => {
                const box = item.getBoundingClientRect();
                return move.clientY >= box.top && move.clientY <= box.bottom;
            });
            if (!target) return;
            const targetId = target.dataset.ruleId;
            if (targetId === moving.id) return;
            const from = working.findIndex((rule_) => rule_.id === moving.id);
            const to = working.findIndex((rule_) => rule_.id === targetId);
            working.splice(to, 0, ...working.splice(from, 1));
            renderRules(working);
            focusHandle(moving.id);
            announceMove('');
            requestOrderPreview();
        };
        const onUp = (up) => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('keydown', onEscape, true);
            dragging = false;
            const box = list.getBoundingClientRect();
            const inside =
                up.clientX >= box.left &&
                up.clientX <= box.right &&
                up.clientY >= box.top &&
                up.clientY <= box.bottom;
            if (inside) dropMove();
            else cancelMove();
        };
        const onEscape = (key) => {
            if (key.key !== 'Escape') return;
            key.preventDefault();
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('keydown', onEscape, true);
            dragging = false;
            cancelMove();
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('keydown', onEscape, true);
    }

    // -- keyboard move ---------------------------------------------------

    function onHandleKey(event, rule) {
        if (!moving && event.key === ' ') {
            event.preventDefault();
            moving = rule;
            working = [...rules];
            renderRules(working);
            focusHandle(rule.id);
            announceMove(`Picked up ${rule.label}. `);
            requestOrderPreview();
            return;
        }
        if (!moving || moving.id !== rule.id) return;
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            const from = working.findIndex((candidate) => candidate.id === rule.id);
            const to = from + (event.key === 'ArrowUp' ? -1 : 1);
            if (to < 0 || to >= working.length) return;
            working.splice(to, 0, ...working.splice(from, 1));
            renderRules(working);
            focusHandle(rule.id);
            announceMove('');
            requestOrderPreview();
        } else if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            dropMove();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            cancelMove();
        }
    }

    async function dropMove() {
        const moved = moving;
        const order = working.map((rule) => rule.id);
        const position = positionOf(moved.id);
        const total = working.length;
        moving = null;
        try {
            const answer = await api.put('/api/rules/order', { rule_ids: order });
            rules = answer.rules;
            working = null;
            renderRules(rules);
            focusHandle(moved.id);
            announce(orderStatus, `Dropped ${moved.label}. Position ${position} of ${total}.`);
            updates.textContent = `Rule order saved. Exposure score ${answer.exposure.score}.`;
            const fresh = await api.get('/api/holdings');
            holdings = fresh.items;
            renderPreview(
                holdings.map((holding) => ({ holding_id: holding.id, level: holding.level })),
                fresh.exposure.score,
            );
            focusHandle(moved.id);
        } catch (error) {
            working = null;
            if (!(error instanceof ApiError)) throw error;
            if (error.isSignedOut) {
                const next = encodeURIComponent(location.pathname);
                location.assign(`/auth/login?next=${next}`);
                return;
            }
            announce(orderStatus, `Dropped ${moved.label}. Position ${position} of ${total}.`);
            await loadAll();
            alertSlot.replaceChildren(h('p', { class: 'alert', role: 'alert', text: ORDER_REFUSED }));
            focusHandle(moved.id);
        }
        if (deferredRedraw) {
            deferredRedraw = false;
            await loadAll();
        }
    }

    async function cancelMove({ previewAgain = true } = {}) {
        const moved = moving;
        moving = null;
        working = null;
        renderRules(rules);
        if (moved) focusHandle(moved.id);
        announce(orderStatus, 'Move cancelled.');
        if (previewAgain) requestOrderPreview();
        if (deferredRedraw) {
            deferredRedraw = false;
            await loadAll();
            if (moved) focusHandle(moved.id);
        }
    }

    // -- add, edit and delete --------------------------------------------

    function openRule(rule) {
        const editing = Boolean(rule);
        openDialog({
            name: editing ? 'Edit rule' : 'Add rule',
            build(panel, dialog) {
                const dataKind = h(
                    'select',
                    { 'aria-label': 'Data kind' },
                    h('option', {
                        value: 'any',
                        text: 'Any kind',
                        selected: editing && rule.data_kind === 'any',
                    }),
                    kinds().map((kind) =>
                        h('option', {
                            value: kind.code,
                            text: kind.label,
                            selected: editing && rule.data_kind === kind.code,
                        }),
                    ),
                );
                const contains = h('input', {
                    type: 'text',
                    'aria-label': 'Company contains',
                    value: editing ? rule.company_contains : '',
                });
                const level = h(
                    'select',
                    { 'aria-label': 'Level' },
                    levels().map((entry) =>
                        h('option', {
                            value: entry.code,
                            text: entry.label,
                            selected: editing && rule.level === entry.code,
                        }),
                    ),
                );
                const priority = h('input', {
                    type: 'number',
                    'aria-label': 'Priority',
                    min: '1',
                    max: '999',
                    value: editing ? String(rule.priority) : String(rules.length + 1),
                });
                const summarySlot = h('div', {});
                const dialogAlert = h('div', {});
                const save = h('button', { type: 'submit', class: 'primary', text: 'Save rule' });
                const fieldNodes = {
                    data_kind: dataKind,
                    company_contains: contains,
                    level,
                    priority,
                };
                const form = h(
                    'form',
                    { novalidate: true },
                    h('h2', { text: editing ? 'Edit rule' : 'Add rule' }),
                    summarySlot,
                    dialogAlert,
                    h('div', { class: 'field' }, h('label', { text: 'Data kind' }), dataKind),
                    h('div', { class: 'field' }, h('label', { text: 'Company contains' }), contains),
                    h('div', { class: 'field' }, h('label', { text: 'Level' }), level),
                    h('div', { class: 'field' }, h('label', { text: 'Priority' }), priority),
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
                panel.append(form);
                form.addEventListener('submit', async (event) => {
                    event.preventDefault();
                    summarySlot.replaceChildren();
                    dialogAlert.replaceChildren();
                    pending(save);
                    const body = {
                        data_kind: dataKind.value,
                        company_contains: contains.value,
                        level: level.value,
                        priority: Number.parseInt(priority.value, 10),
                    };
                    try {
                        const answer = editing
                            ? await api.patch(`/api/rules/${rule.id}`, { ...body, version: rule.version })
                            : await api.post('/api/rules', body);
                        dialog.close('saved');
                        await loadAll();
                        updates.textContent = `Rules updated. Exposure score ${answer.exposure.score}.`;
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

    async function removeRule(rule) {
        try {
            await api.delete(`/api/rules/${rule.id}`);
            const exposure = await api.get('/api/exposure');
            await loadAll();
            updates.textContent = `Rules updated. Exposure score ${exposure.score}.`;
        } catch (error) {
            if (error instanceof ApiError && error.isSignedOut) {
                const next = encodeURIComponent(location.pathname);
                location.assign(`/auth/login?next=${next}`);
                return;
            }
            alertSlot.replaceChildren(
                h('p', { class: 'alert', role: 'alert', text: FAILED_REQUEST }),
            );
        }
    }

    await loadAll();

    return {
        path: '/vault/rules',
        onChange: async (change) => {
            if (dragging) {
                deferredRedraw = true;
                return;
            }
            if (moving && change.type.startsWith('rule.')) {
                await cancelMove({ previewAgain: false });
                await loadAll();
                return;
            }
            await loadAll();
        },
    };
}
