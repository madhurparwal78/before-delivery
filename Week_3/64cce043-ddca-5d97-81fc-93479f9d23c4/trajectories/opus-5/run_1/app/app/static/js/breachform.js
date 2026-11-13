// Logging a breach: company suggestions, the blast preview and the committed score.

import { ApiError, FAILED_REQUEST, api, newIdempotencyKey } from './api.js';
import { Latest, announce, debounce, h, reducedMotion } from './dom.js';
import { pending, showFieldErrors } from './dialog.js';
import * as drafts from './drafts.js';
import { kinds } from './vocab.js';

const COMPANY_DELAY = 200;
const STAGGER = 40;
const STAGGER_LIMIT = 12;
const SUGGESTION_LIMIT = 8;
const SCORE_MISMATCH = 'The saved score differs from the preview. Showing the saved score.';

export function createBreachForm({
    exposure,
    ledger,
    companies,
    today,
    email,
    onSaved,
    onClose,
    draft,
}) {
    const state = {
        company: draft ? draft.values.company : '',
        announced_on: draft ? draft.values.announced_on : today,
        ticked: new Set(draft ? draft.values.data_kinds : []),
        key: draft ? draft.idempotencyKey : newIdempotencyKey(),
        lit: [],
        previewScore: null,
    };
    const latest = new Latest();

    const company = h('input', {
        type: 'text',
        role: 'combobox',
        'aria-label': 'Company',
        'aria-expanded': 'false',
        'aria-autocomplete': 'list',
        'aria-controls': 'company-suggestions',
        autocomplete: 'off',
        value: state.company,
    });
    const listbox = h('ul', {
        class: 'suggestions',
        id: 'company-suggestions',
        role: 'listbox',
        'aria-label': 'Company suggestions',
        hidden: true,
    });
    const announced = h('input', {
        type: 'text',
        'aria-label': 'Announced on',
        value: state.announced_on,
        class: 'mono',
    });
    const kindGroup = h(
        'fieldset',
        { class: 'kind-grid', role: 'group', 'aria-label': 'Data kinds' },
        h('legend', { text: 'Data kinds' }),
    );
    const boxes = new Map();
    for (const kind of kinds()) {
        const box = h('input', {
            type: 'checkbox',
            checked: state.ticked.has(kind.code),
        });
        box.addEventListener('change', () => {
            if (box.checked) state.ticked.add(kind.code);
            else state.ticked.delete(kind.code);
            requestPreview();
        });
        boxes.set(kind.code, box);
        kindGroup.append(h('label', { class: 'tick' }, box, h('span', { text: kind.label })));
    }
    const previewStatus = h('p', {
        class: 'notice-line',
        role: 'status',
        'aria-label': 'Breach preview',
    });
    const summarySlot = h('div', {});
    const save = h('button', { type: 'submit', class: 'primary', text: 'Save breach' });
    const cancel = h('button', { type: 'button', text: 'Cancel' });
    const form = h(
        'form',
        { class: 'breach-form fade-rise', 'aria-label': 'Log breach', novalidate: true },
        summarySlot,
        h(
            'div',
            { class: 'field combo-wrap' },
            h('label', { text: 'Company' }),
            company,
            listbox,
        ),
        h('div', { class: 'field' }, h('label', { text: 'Announced on' }), announced),
        kindGroup,
        previewStatus,
        h('div', { class: 'form-actions' }, save, cancel),
    );

    const fieldNodes = { company, announced_on: announced, data_kinds: kindGroup };

    // -- suggestions -----------------------------------------------------

    let activeIndex = -1;

    function suggestionNames() {
        const typed = company.value.trim().toLowerCase();
        return companies()
            .filter((name) => name.toLowerCase().includes(typed))
            .sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()))
            .slice(0, SUGGESTION_LIMIT);
    }

    function openSuggestions() {
        const opening = listbox.hidden;
        const names = suggestionNames();
        listbox.replaceChildren(
            ...names.map((name, index) =>
                h('li', {
                    role: 'option',
                    id: `company-option-${index}`,
                    'aria-selected': index === activeIndex ? 'true' : 'false',
                    text: name,
                    onmousedown: (event) => {
                        event.preventDefault();
                        pick(name);
                    },
                }),
            ),
        );
        const open = names.length > 0;
        listbox.hidden = !open;
        if (opening && open) {
            listbox.classList.remove('fade-rise');
            void listbox.offsetWidth;
            listbox.classList.add('fade-rise');
        }
        company.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (!open) company.removeAttribute('aria-activedescendant');
    }

    function closeSuggestions() {
        listbox.hidden = true;
        activeIndex = -1;
        company.setAttribute('aria-expanded', 'false');
        company.removeAttribute('aria-activedescendant');
    }

    function moveActive(offset) {
        const options = [...listbox.children];
        if (options.length === 0) return;
        activeIndex = (activeIndex + offset + options.length) % options.length;
        options.forEach((option, index) =>
            option.setAttribute('aria-selected', index === activeIndex ? 'true' : 'false'),
        );
        company.setAttribute('aria-activedescendant', options[activeIndex].id);
        options[activeIndex].scrollIntoView({ block: 'nearest' });
    }

    function pick(name) {
        company.value = name;
        state.company = name;
        closeSuggestions();
        company.focus();
        requestPreview();
    }

    const companyTyped = debounce(() => requestPreview(), COMPANY_DELAY);
    company.addEventListener('input', () => {
        state.company = company.value;
        activeIndex = -1;
        openSuggestions();
        companyTyped();
    });
    company.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (listbox.hidden) openSuggestions();
            moveActive(1);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (!listbox.hidden) moveActive(-1);
        } else if (event.key === 'Enter') {
            event.preventDefault();
            const options = [...listbox.children];
            if (!listbox.hidden && activeIndex >= 0 && options[activeIndex]) {
                pick(options[activeIndex].textContent);
            }
        } else if (event.key === 'Escape') {
            if (!listbox.hidden) {
                event.preventDefault();
                event.stopPropagation();
                closeSuggestions();
            }
        }
    });
    announced.addEventListener('input', () => {
        state.announced_on = announced.value;
    });

    form.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && listbox.hidden) {
            event.preventDefault();
            close();
        }
    });

    // -- blast preview ---------------------------------------------------

    function light(row) {
        row.classList.add('touched');
        const cell = row.querySelector('[role="cell"]');
        if (cell && !cell.querySelector('.touched-flag')) {
            cell.append(h('span', { class: 'touched-flag', text: 'Touched' }));
        }
    }

    function unlight(row) {
        row.classList.remove('touched');
        const flag = row.querySelector('.touched-flag');
        if (flag) flag.remove();
    }

    function paint(affected) {
        const wanted = affected.filter((id) => ledger.rowFor(id));
        const added = wanted.filter((id) => !state.lit.includes(id));
        const removed = state.lit.filter((id) => !wanted.includes(id));
        const still = reducedMotion();
        // Rows redrawn under a live refresh keep their edge without staggering again.
        for (const id of wanted) {
            if (added.includes(id)) continue;
            const row = ledger.rowFor(id);
            if (row && !row.classList.contains('touched')) light(row);
        }
        added.forEach((id, index) => {
            const row = ledger.rowFor(id);
            if (!row) return;
            if (still) light(row);
            else window.setTimeout(() => light(row), Math.min(index, STAGGER_LIMIT - 1) * STAGGER);
        });
        [...removed].reverse().forEach((id, index) => {
            const row = ledger.rowFor(id);
            if (!row) return;
            if (still) unlight(row);
            else window.setTimeout(() => unlight(row), Math.min(index, STAGGER_LIMIT - 1) * STAGGER);
        });
        state.lit = wanted;
    }

    function clearLit() {
        const still = reducedMotion();
        [...state.lit].reverse().forEach((id, index) => {
            const row = ledger.rowFor(id);
            if (!row) return;
            if (still) unlight(row);
            else window.setTimeout(() => unlight(row), Math.min(index, STAGGER_LIMIT - 1) * STAGGER);
        });
        state.lit = [];
    }

    async function requestPreview() {
        const token = latest.next();
        const body = {
            company: state.company.trim(),
            data_kinds: [...state.ticked],
        };
        try {
            const answer = await api.post('/api/breaches/preview', body);
            if (!latest.current(token)) return;
            state.previewScore = answer.score;
            paint(answer.affected_holding_ids);
            exposure.showPreviewScore(answer.score);
            announce(
                previewStatus,
                `Preview: holdings touched ${answer.affected_holding_ids.length}, projected score ${answer.score}.`,
            );
        } catch (error) {
            if (error instanceof ApiError && error.isSignedOut) return;
            if (!latest.current(token)) return;
            announce(previewStatus, '');
        }
    }

    // -- saving ----------------------------------------------------------

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        summarySlot.replaceChildren();
        pending(save);
        try {
            const answer = await api.post(
                '/api/breaches',
                {
                    company: state.company.trim(),
                    announced_on: state.announced_on.trim(),
                    data_kinds: [...state.ticked],
                },
                { idempotencyKey: state.key },
            );
            const previewed = state.previewScore;
            clearLit();
            exposure.apply(answer.exposure, { animate: false });
            if (previewed !== null && previewed !== answer.exposure.score) {
                exposure.showAlert(SCORE_MISMATCH);
            }
            exposure.announce(
                `Breach logged. Holdings touched: ${answer.breach.affected_holding_ids.length}. Exposure score ${answer.exposure.score}.`,
            );
            onSaved(answer);
            close({ keepLit: true });
        } catch (error) {
            pending(save, false);
            if (!(error instanceof ApiError)) throw error;
            if (error.isSignedOut) {
                drafts.store({
                    kind: 'breach',
                    email,
                    idempotencyKey: state.key,
                    values: {
                        company: state.company,
                        announced_on: state.announced_on,
                        data_kinds: [...state.ticked],
                    },
                });
                drafts.signInAgain();
                return;
            }
            if (error.fields) showFieldErrors(error.fields, fieldNodes, summarySlot);
            else exposure.showAlert(error.isUnexplained ? FAILED_REQUEST : error.message);
        }
    });

    cancel.addEventListener('click', () => close());

    function close({ keepLit = false } = {}) {
        if (!keepLit) {
            clearLit();
            exposure.clearPreview();
        }
        onClose();
    }

    return {
        node: form,
        focusCompany: () => company.focus(),
        // A redraw keeps the entries and asks for the preview again.
        refresh: () => requestPreview(),
        focusSave: () => save.focus(),
        get key() {
            return state.key;
        },
    };
}
