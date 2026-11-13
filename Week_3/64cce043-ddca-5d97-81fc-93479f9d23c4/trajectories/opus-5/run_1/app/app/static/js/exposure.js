// The exposure column: the score numeral, its band and the ordered next steps.

import { ApiError, FAILED_REQUEST, api } from './api.js';
import { announce, countTo, h, reducedMotion } from './dom.js';
import { kindLabel } from './vocab.js';

const STEP_CHANGED_ELSEWHERE = 'This step was already changed in another window.';

export function createExposure({ interactive, onExposure }) {
    const scoreNode = h('span', { class: 'score', text: '0' });
    const bandNode = h('span', { class: 'band', text: '' });
    const previewTag = h('span', { class: 'preview-tag', text: 'Preview', hidden: true });
    const factsNode = h('p', { class: 'score-facts' });
    const actionsSlot = h('span', {});
    const scoreBand = h(
        'div',
        { class: 'score-band' },
        h('span', { class: 'score-line' }, scoreNode, bandNode, previewTag),
        actionsSlot,
    );
    const formSlot = h('div', {});
    const alertSlot = h('div', {});
    const updates = h('p', {
        class: 'notice-line',
        role: 'status',
        'aria-live': 'polite',
        'aria-label': 'Exposure updates',
    });
    const stepsList = h('ul', { class: 'steps', role: 'list', 'aria-label': 'Next steps' });
    const region = h(
        'section',
        { class: 'exposure', role: 'region', 'aria-label': 'Exposure' },
        h('h2', { text: 'Exposure score' }),
        scoreBand,
        factsNode,
        formSlot,
        alertSlot,
        interactive ? updates : null,
        stepsList,
    );

    let committed = { score: 0, band: '', steps: [], affected_count: 0, open_steps: 0 };
    const inFlight = new Set();

    function showAlert(text) {
        alertSlot.replaceChildren(h('p', { class: 'alert', role: 'alert', text }));
    }

    function clearAlert() {
        alertSlot.replaceChildren();
    }

    function stepName(step) {
        return `${step.text}, ${step.company}`;
    }

    function renderSteps(steps) {
        const focusedId = document.activeElement && document.activeElement.dataset
            ? document.activeElement.dataset.stepId
            : null;
        stepsList.replaceChildren();
        if (steps.length === 0) {
            stepsList.append(
                h('li', {}, h('p', {
                    class: 'empty-state',
                    text: 'Nothing to do. No logged breach touches your holdings.',
                })),
            );
            return;
        }
        for (const step of steps) {
            const meta = h(
                'span',
                { class: 'step-meta' },
                `${step.company} · ${kindLabel(step.data_kind)} · `,
                h('span', { class: 'points', text: String(step.points) }),
                ' points',
            );
            if (!interactive) {
                stepsList.append(
                    h(
                        'li',
                        { class: 'step-item' },
                        h(
                            'div',
                            { class: `step${step.status === 'done' ? ' done' : ''}` },
                            h('span', { class: 'step-text' }, h('span', { text: step.text }), meta),
                            h('span', {
                                class: 'step-state',
                                text: step.status === 'done' ? 'Done' : 'Open',
                            }),
                        ),
                    ),
                );
                continue;
            }
            const state = h('span', {
                class: 'step-state',
                text: step.status === 'done' ? 'Done' : 'Open',
            });
            const control = h(
                'div',
                {
                    class: 'step',
                    role: 'checkbox',
                    'aria-checked': step.status === 'done' ? 'true' : 'false',
                    'aria-label': stepName(step),
                    tabindex: '-1',
                    dataset: { stepId: step.id },
                },
                h('span', { class: 'box', 'aria-hidden': 'true', text: step.status === 'done' ? '✓' : '' }),
                h('span', { class: 'step-text' }, h('span', { text: step.text }), meta),
                state,
            );
            control.addEventListener('click', () => toggle(control));
            control.addEventListener('keydown', onStepKeyDown);
            stepsList.append(h('li', { class: 'step-item' }, control));
        }
        setRoving(focusedId, Boolean(focusedId));
    }

    function stepControls() {
        return [...stepsList.querySelectorAll('.step[role="checkbox"]')];
    }

    // The list is a single Tab stop: the first open step, or the first step.
    function setRoving(preferredId, keepFocus = false) {
        const controls = stepControls();
        if (controls.length === 0) return;
        const preferred = preferredId
            ? controls.find((control) => control.dataset.stepId === preferredId)
            : null;
        const open = controls.find((control) => control.getAttribute('aria-checked') === 'false');
        const target = preferred || open || controls[0];
        for (const control of controls) {
            control.tabIndex = control === target ? 0 : -1;
        }
        if (preferred && keepFocus) preferred.focus();
    }

    function moveFocus(control, offset) {
        const controls = stepControls();
        const index = controls.indexOf(control);
        const next = controls[index + offset];
        if (!next) return;
        for (const item of controls) item.tabIndex = item === next ? 0 : -1;
        next.focus();
    }

    function onStepKeyDown(event) {
        const control = event.currentTarget;
        const controls = stepControls();
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            moveFocus(control, 1);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            moveFocus(control, -1);
        } else if (event.key === 'Home') {
            event.preventDefault();
            moveFocus(control, -controls.indexOf(control));
        } else if (event.key === 'End') {
            event.preventDefault();
            moveFocus(control, controls.length - 1 - controls.indexOf(control));
        } else if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            toggle(control);
        }
    }

    async function toggle(control) {
        const stepId = control.dataset.stepId;
        if (inFlight.has(stepId)) return;
        const wasDone = control.getAttribute('aria-checked') === 'true';
        const state = control.querySelector('.step-state');
        const box = control.querySelector('.box');
        inFlight.add(stepId);
        clearAlert();
        control.setAttribute('aria-checked', wasDone ? 'false' : 'true');
        box.textContent = wasDone ? '' : '✓';
        control.classList.add('working');
        state.textContent = 'Working...';
        const settle = (done) => {
            control.setAttribute('aria-checked', done ? 'true' : 'false');
            box.textContent = done ? '✓' : '';
            control.classList.remove('working');
            state.textContent = done ? 'Done' : 'Open';
        };
        try {
            const answer = await api.post(
                `/api/steps/${encodeURIComponent(stepId)}/${wasDone ? 'reopen' : 'done'}`,
            );
            apply(answer.exposure, { animate: true });
            announce(
                updates,
                `${wasDone ? 'Step reopened' : 'Step marked done'}. Exposure score ${answer.exposure.score}.`,
            );
        } catch (error) {
            if (!(error instanceof ApiError)) throw error;
            if (error.isSignedOut) {
                const next = encodeURIComponent(location.pathname + location.search);
                location.assign(`/auth/login?next=${next}`);
                return;
            }
            if (error.code === 'step_already_done' || error.code === 'step_already_open') {
                const fresh = await api.get('/api/exposure');
                apply(fresh, { animate: true });
                showAlert(STEP_CHANGED_ELSEWHERE);
            } else if (error.code === 'step_out_of_order') {
                settle(wasDone);
                showAlert(error.message);
            } else if (error.code === 'not_found') {
                const fresh = await api.get('/api/exposure');
                apply(fresh, { animate: false });
                showAlert(STEP_CHANGED_ELSEWHERE);
            } else {
                settle(wasDone);
                showAlert(error.isUnexplained ? FAILED_REQUEST : error.message);
            }
        } finally {
            inFlight.delete(stepId);
            const again = stepControls().find((item) => item.dataset.stepId === stepId);
            if (again) {
                again.tabIndex = 0;
                again.focus();
            }
        }
    }

    function apply(exposure, { animate = true } = {}) {
        committed = exposure;
        previewTag.hidden = true;
        countTo(scoreNode, exposure.score, { animate });
        bandNode.textContent = exposure.band;
        factsNode.textContent = `${exposure.affected_count} holdings affected · ${exposure.open_steps} steps open`;
        renderSteps(exposure.steps);
        if (onExposure) onExposure(exposure);
    }

    return {
        node: region,
        formSlot,
        actionsSlot,
        updates,
        get committed() {
            return committed;
        },
        apply,
        showAlert,
        clearAlert,
        announce: (text) => announce(updates, text),
        showPreviewScore(score) {
            previewTag.hidden = false;
            countTo(scoreNode, score, { animate: !reducedMotion() });
        },
        clearPreview() {
            previewTag.hidden = true;
            countTo(scoreNode, committed.score, { animate: !reducedMotion() });
        },
    };
}
