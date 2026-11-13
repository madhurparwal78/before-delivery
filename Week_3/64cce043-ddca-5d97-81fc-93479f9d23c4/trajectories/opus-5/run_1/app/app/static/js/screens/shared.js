// The trusted contact's masked, read-only view, and the Access ended screen.

import { ApiError, api, filterQuery } from '../api.js';
import { Latest, h } from '../dom.js';
import { createExposure } from '../exposure.js';
import { createLedger } from '../ledgertable.js';
import { readFilters } from './ledger.js';
import { remainingText } from './contact.js';

const REFRESH_INTERVAL = 15_000;

export async function sharedScreen(mount, app) {
    const latest = new Latest();
    const sharedUpdates = h('p', {
        class: 'notice-line',
        role: 'status',
        'aria-label': 'Shared updates',
    });
    let ended = false;
    let timer = 0;

    function showAccessEnded(copy = 'Access ended.') {
        ended = true;
        window.clearInterval(timer);
        mount.replaceChildren(
            h(
                'div',
                { class: 'screen notice' },
                h('h1', { text: 'Access ended' }),
                h('p', { text: 'This shared view has ended. Ask the vault owner for a new grant.' }),
                sharedUpdates,
            ),
        );
        sharedUpdates.textContent = copy;
    }

    let grant = null;
    try {
        grant = await api.get('/api/contact/grant');
    } catch (error) {
        if (error instanceof ApiError && (error.isAccessEnded || error.code === 'not_found')) {
            showAccessEnded();
            return { path: '/shared' };
        }
        throw error;
    }
    if (grant.status !== 'active' || app.accessEnded) {
        showAccessEnded();
        return { path: '/shared' };
    }

    const accessTime = h('p', {
        class: 'remaining',
        role: 'status',
        'aria-label': 'Access time',
    });
    const exposure = createExposure({ interactive: false });
    const ledger = createLedger({
        owner: false,
        filters: readFilters(),
        onFilters: (next, options) => applyFilters(next, options),
        emptyAll: 'Nothing is shared with you yet.',
    });
    const breachList = h('ul', { class: 'record-list' });

    mount.append(
        h(
            'div',
            { class: 'screen two-column' },
            h('div', { class: 'exposure-pane' }, exposure.node),
            h(
                'div',
                { class: 'ledger-pane' },
                h('h1', { text: `Shared by ${grant.owner_name}` }),
                accessTime,
                sharedUpdates,
                ledger.node,
                h('h2', { text: 'Breaches' }),
                breachList,
            ),
        ),
    );

    function showRemaining() {
        accessTime.textContent = `Access ends in ${remainingText(grant.remaining_seconds)}`;
    }

    async function fetchLedger() {
        const token = latest.next();
        const data = await api.get(`/api/holdings${filterQuery(ledger.filters)}`);
        if (!latest.current(token)) return;
        ledger.setData(data);
    }

    async function applyFilters(next, { replace = false } = {}) {
        const target = location.pathname + filterQuery(next);
        if (replace) history.replaceState({}, '', target);
        else history.pushState({}, '', target);
        await fetchLedger();
    }

    async function refresh() {
        if (ended) return;
        try {
            const [, exposureData, breaches, status] = await Promise.all([
                fetchLedger(),
                api.get('/api/exposure'),
                api.get('/api/breaches'),
                api.get('/api/contact/grant'),
            ]);
            exposure.apply(exposureData, { animate: false });
            breachList.replaceChildren(
                ...breaches.breaches.map((breach) =>
                    h('li', {}, h('span', { text: `${breach.company} — ${breach.announced_on}` })),
                ),
            );
            grant = status;
            if (grant.status !== 'active') {
                showAccessEnded();
                return;
            }
            showRemaining();
        } catch (error) {
            if (error instanceof ApiError && error.isAccessEnded) {
                showAccessEnded();
                return;
            }
            if (error instanceof ApiError && error.isSignedOut) {
                if (!app.accessEnded) location.assign('/');
                return;
            }
            throw error;
        }
    }

    showRemaining();
    await refresh();
    timer = window.setInterval(refresh, REFRESH_INTERVAL);

    return {
        path: '/shared',
        onChange: async (change) => {
            if (ended) return;
            await refresh();
            sharedUpdates.textContent =
                change.type === 'grant.updated'
                    ? 'The owner narrowed what you can see.'
                    : 'Shared view updated.';
        },
        onAccessEnded: () => showAccessEnded(),
        onQuery: () => {
            ledger.setFilters(readFilters());
            fetchLedger();
        },
        destroy: () => window.clearInterval(timer),
    };
}
