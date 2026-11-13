// Logged breaches, newest announced date first.

import { api } from '../api.js';
import { h } from '../dom.js';

export async function breachesScreen(mount, app) {
    const list = h('ul', { class: 'record-list' });
    const empty = h('div', {});
    const updates = h('p', {
        class: 'notice-line',
        role: 'status',
        'aria-label': 'Exposure updates',
    });
    mount.append(
        h(
            'div',
            { class: 'screen' },
            h('h1', { text: 'Breaches' }),
            updates,
            list,
            empty,
        ),
    );

    async function load() {
        const answer = await api.get('/api/breaches');
        list.replaceChildren(
            ...answer.breaches.map((breach) =>
                h(
                    'li',
                    {},
                    h('a', {
                        href: `/vault/breaches/${breach.id}`,
                        text: `${breach.company} — ${breach.announced_on}`,
                    }),
                ),
            ),
        );
        empty.replaceChildren();
        if (answer.breaches.length === 0) {
            empty.append(h('p', { class: 'empty-state', text: 'No breaches logged.' }));
        }
    }

    await load();
    const carried = app.takeAnnouncement();
    if (carried) updates.textContent = carried;

    return { path: '/vault/breaches', onChange: () => load() };
}
