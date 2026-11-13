// The ruled ledger: the filter bar, the Results status and the grouped rows.

import { debounce, h } from './dom.js';
import { kindLabel, levelLabel } from './vocab.js';

const SEARCH_DELAY = 250;
const EMPTY_LEDGER = 'Your ledger is empty. Add the first company that holds your data.';
const EMPTY_FILTERS = 'No holdings match these filters.';

export function normalizeCompany(company) {
    return company.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function createLedger({ owner, filters, onFilters, onAddHolding, emptyAll = EMPTY_LEDGER }) {
    const search = h('input', {
        type: 'search',
        'aria-label': 'Search holdings',
        value: filters.q || '',
        autocomplete: 'off',
    });
    const companySelect = h('select', { 'aria-label': 'Company' });
    const kindSelect = h('select', { 'aria-label': 'Data kind' });
    const levelSelect = h('select', { 'aria-label': 'Level' });
    const results = h('p', {
        class: 'notice-line',
        role: 'status',
        'aria-label': 'Results',
    });
    const head = h('div', { class: 'ledger-head' });
    if (owner) {
        head.append(
            h('button', { type: 'button', text: 'Add holding', onclick: () => onAddHolding() }),
        );
    }

    const body = h('tbody', { role: 'rowgroup' });
    const table = h(
        'table',
        { class: 'holdings', role: 'table', 'aria-label': 'Holdings' },
        h(
            'thead',
            { role: 'rowgroup' },
            h(
                'tr',
                { role: 'row' },
                h('th', { role: 'columnheader', scope: 'col', text: 'Data kind' }),
                h('th', { role: 'columnheader', scope: 'col', text: 'Level' }),
                h('th', { role: 'columnheader', scope: 'col', text: 'Value' }),
            ),
        ),
        body,
    );
    const emptySlot = h('div', {});
    const filterBar = h(
        'div',
        { class: 'filter-bar' },
        h('div', { class: 'field' }, h('label', { text: 'Search holdings' }), search),
        h('div', { class: 'field' }, h('label', { text: 'Company' }), companySelect),
        h('div', { class: 'field' }, h('label', { text: 'Data kind' }), kindSelect),
        h('div', { class: 'field' }, h('label', { text: 'Level' }), levelSelect),
    );
    const node = h('div', { class: 'ledger' }, head, filterBar, results, table, emptySlot);

    const current = { ...filters };

    const fire = (replace) => onFilters({ ...current }, { replace });
    const typed = debounce(() => fire(true), SEARCH_DELAY);
    search.addEventListener('input', () => {
        current.q = search.value;
        typed();
    });
    for (const [select, key] of [
        [companySelect, 'company'],
        [kindSelect, 'data_kind'],
        [levelSelect, 'level'],
    ]) {
        select.addEventListener('change', () => {
            current[key] = select.value;
            typed.cancel();
            fire(false);
        });
    }

    function fillSelect(select, options, chosen) {
        select.replaceChildren(h('option', { value: '', text: 'All' }));
        for (const [value, label, count] of options) {
            select.append(h('option', { value, text: `${label} (${count})` }));
        }
        if (chosen && !options.some(([value]) => value === chosen)) {
            select.append(h('option', { value: chosen, text: `${chosen} (0)` }));
        }
        select.value = chosen || '';
    }

    function setData(data) {
        const spellings = new Map(
            Object.keys(data.facets.company).map((name) => [normalizeCompany(name), name]),
        );
        body.replaceChildren();
        let group = null;
        for (const holding of data.items) {
            const key = normalizeCompany(holding.company);
            if (key !== group) {
                group = key;
                body.append(
                    h(
                        'tr',
                        { role: 'row', class: 'company-row' },
                        h('td', {
                            role: 'cell',
                            colspan: '3',
                            text: spellings.get(key) || holding.company,
                        }),
                    ),
                );
            }
            const label = kindLabel(holding.data_kind);
            const kindCell = h(
                'td',
                { role: 'cell' },
                owner
                    ? h('a', { href: `/vault/holdings/${holding.id}`, text: label })
                    : h('span', { text: label }),
            );
            body.append(
                h(
                    'tr',
                    {
                        role: 'row',
                        class: 'holding-row',
                        dataset: { holdingId: holding.id },
                    },
                    kindCell,
                    h(
                        'td',
                        { role: 'cell' },
                        h('span', {
                            class: `badge ${holding.level}`,
                            text: levelLabel(holding.level),
                        }),
                    ),
                    h('td', { role: 'cell', class: 'value mono', text: holding.value }),
                ),
            );
        }
        fillSelect(
            companySelect,
            Object.entries(data.facets.company).map(([name, count]) => [name, name, count]),
            current.company,
        );
        fillSelect(
            kindSelect,
            Object.entries(data.facets.data_kind).map(([code, count]) => [code, kindLabel(code), count]),
            current.data_kind,
        );
        fillSelect(
            levelSelect,
            Object.entries(data.facets.level).map(([code, count]) => [code, levelLabel(code), count]),
            current.level,
        );
        results.textContent = `Holdings shown: ${data.total}.`;
        const filtered = Boolean(current.q || current.company || current.data_kind || current.level);
        emptySlot.replaceChildren();
        if (data.items.length === 0) {
            emptySlot.append(
                h('p', { class: 'empty-state', text: filtered ? EMPTY_FILTERS : emptyAll }),
            );
        }
    }

    function setFilters(next) {
        Object.assign(current, { q: '', company: '', data_kind: '', level: '' }, next);
        search.value = current.q || '';
        companySelect.value = current.company || '';
        kindSelect.value = current.data_kind || '';
        levelSelect.value = current.level || '';
    }

    return {
        node,
        setData,
        setFilters,
        get filters() {
            return { ...current };
        },
        rowFor(holdingId) {
            return body.querySelector(`[data-holding-id="${CSS.escape(holdingId)}"]`);
        },
    };
}
