// The owner's ledger: holdings beside the exposure column.

import { api, filterQuery, serverToday } from '../api.js';
import { Latest, h } from '../dom.js';
import * as drafts from '../drafts.js';
import { createBreachForm } from '../breachform.js';
import { createExposure } from '../exposure.js';
import { createLedger } from '../ledgertable.js';
import { ADD, openHoldingDialog } from '../holdingdialog.js';
import { kinds, levels } from '../vocab.js';

// Values the address cannot carry are dropped and the address is rewritten in place.
export function readFilters() {
    const params = new URLSearchParams(location.search);
    const filters = {
        q: params.get('q') || '',
        company: params.get('company') || '',
        data_kind: params.get('data_kind') || '',
        level: params.get('level') || '',
    };
    let rewritten = false;
    if (filters.q.length > 100) {
        filters.q = '';
        rewritten = true;
    }
    if (filters.data_kind && !kinds().some((kind) => kind.code === filters.data_kind)) {
        filters.data_kind = '';
        rewritten = true;
    }
    if (filters.level && !levels().some((level) => level.code === filters.level)) {
        filters.level = '';
        rewritten = true;
    }
    if (rewritten) history.replaceState({}, '', location.pathname + filterQuery(filters));
    return filters;
}

export async function ledgerScreen(mount, app) {
    const filters = readFilters();
    const latest = new Latest();
    let allCompanies = [];
    let breachForm = null;

    const exposure = createExposure({ interactive: true });
    const ledger = createLedger({
        owner: true,
        filters,
        onFilters: (next, options) => applyFilters(next, options),
        onAddHolding: () => openAdd(),
    });
    const logBreach = h('button', {
        type: 'button',
        text: 'Log breach',
        onclick: () => openBreachForm(),
    });
    exposure.actionsSlot.append(logBreach);

    mount.append(
        h(
            'div',
            { class: 'screen two-column' },
            h('div', { class: 'exposure-pane' }, exposure.node),
            h(
                'div',
                { class: 'ledger-pane' },
                h('h1', { class: 'visually-hidden', text: 'Ledger' }),
                ledger.node,
            ),
        ),
    );

    async function fetchLedger() {
        const token = latest.next();
        const data = await api.get(`/api/holdings${filterQuery(ledger.filters)}`);
        if (!latest.current(token)) return null;
        ledger.setData(data);
        return data;
    }

    async function refreshCompanies() {
        const all = await api.get('/api/holdings');
        allCompanies = Object.keys(all.facets.company);
    }

    async function applyFilters(next, { replace = false } = {}) {
        const target = location.pathname + filterQuery(next);
        if (replace) history.replaceState({}, '', target);
        else history.pushState({}, '', target);
        await fetchLedger();
    }

    async function refresh() {
        const [, exposureData] = await Promise.all([
            fetchLedger(),
            api.get('/api/exposure'),
            refreshCompanies(),
        ]);
        exposure.apply(exposureData, { animate: !breachForm });
        // A redraw asks for the preview again against the new vault state.
        if (breachForm) breachForm.refresh();
    }

    function openBreachForm({ draft = null } = {}) {
        if (breachForm) return;
        breachForm = createBreachForm({
            exposure,
            ledger,
            email: app.me.email,
            companies: () => allCompanies,
            today: serverToday(),
            draft,
            onSaved: () => refresh(),
            onClose: () => {
                const node = breachForm.node;
                breachForm = null;
                node.remove();
                logBreach.focus();
            },
        });
        exposure.formSlot.append(breachForm.node);
        if (draft) {
            breachForm.focusSave();
            app.draftRestored();
            breachForm.refresh();
        } else {
            breachForm.focusCompany();
        }
    }

    function openAdd(draft = null) {
        openHoldingDialog({
            mode: ADD,
            email: app.me.email,
            draft,
            onRestored: () => app.draftRestored(),
            onSaved: async (answer) => {
                exposure.apply(answer.exposure, { animate: true });
                exposure.announce(`Holding saved. Exposure score ${answer.exposure.score}.`);
                await refresh();
            },
        });
    }

    ledger.setData(await api.get(`/api/holdings${filterQuery(filters)}`));
    exposure.apply(await api.get('/api/exposure'), { animate: false });
    await refreshCompanies();

    const carried = app.takeAnnouncement();
    if (carried) exposure.announce(carried);

    const breachDraft = drafts.take('breach', app.me.email);
    if (breachDraft) openBreachForm({ draft: breachDraft });
    const addDraft = drafts.take('holding-add', app.me.email);
    if (addDraft) openAdd(addDraft);

    return {
        path: '/vault',
        onChange: () => refresh(),
        onQuery: () => {
            ledger.setFilters(readFilters());
            fetchLedger();
        },
    };
}
