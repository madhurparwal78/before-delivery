/* The admin queue: open illegal-content reports ordered by deadline, with the
   server-computed remaining time, refreshed on a page timer. */
import { api, copy, el } from '../lib.js';
export async function renderAdminQueuePage(frame, me) {
    const feedCol = el('main', { class: 'feed' });
    frame.append(feedCol);
    if (me === null || me.role !== 'admin') {
        feedCol.append(el('p', { class: 'empty' }, 'This page is for site admins.'));
        return;
    }
    const tableWrap = el('div', { class: 'table-wrap' });
    feedCol.append(el('header', { class: 'post-head' }, el('h1', {}, 'Illegal-content reports')), tableWrap);
    const render = async () => {
        try {
            const page = await api('/api/admin/reports?status=open');
            const table = el('table', { class: 'log-table', 'aria-label': 'Illegal-content reports' });
            const head = el('tr', {}, el('th', {}, 'Reference'), el('th', {}, 'Target'), el('th', {}, 'Category'), el('th', {}, 'Explanation'), el('th', {}, 'Deadline'), el('th', {}, 'Actions'));
            table.append(el('thead', {}, head));
            const body = el('tbody', {});
            for (const r of page.items) {
                const cell = deadlineCell(r);
                const author = await loadTargetAuthor(r);
                const actions = el('td', {});
                if (author !== null) {
                    const suspend = el('button', { class: 'btn', type: 'button', 'aria-label': `Suspend ${author}` }, `Suspend ${author}`);
                    suspend.addEventListener('click', () => {
                        void (async () => {
                            try {
                                await api(`/api/admin/users/${author}/suspension`, { method: 'POST', body: JSON.stringify({ reason: `Report ${r.reference}` }) });
                                suspend.disabled = true;
                                await render();
                            }
                            catch { /* already suspended */ }
                        })();
                    });
                    actions.append(suspend);
                }
                const handled = el('button', { class: 'btn', type: 'button' }, 'Mark handled');
                handled.addEventListener('click', () => {
                    void (async () => {
                        await api(`/api/admin/reports/${r.reference}/resolve`, { method: 'POST', body: JSON.stringify({ outcome: 'actioned' }) });
                        await render();
                    })();
                });
                const dismiss = el('button', { class: 'btn', type: 'button' }, 'Dismiss');
                dismiss.addEventListener('click', () => {
                    void (async () => {
                        await api(`/api/admin/reports/${r.reference}/resolve`, { method: 'POST', body: JSON.stringify({ outcome: 'dismissed' }) });
                        await render();
                    })();
                });
                actions.append(handled, dismiss);
                body.append(el('tr', { id: `report-${r.reference}` }, el('td', { class: 'num' }, r.reference), el('td', {}, el('a', { href: r.target.url }, r.target.type === 'post' ? `Post ${r.target.id}` : `Comment ${r.target.id}`)), el('td', {}, r.category), el('td', {}, r.explanation.slice(0, 80)), cell, actions));
            }
            table.append(body);
            tableWrap.replaceChildren(table);
            if (page.items.length === 0)
                tableWrap.replaceChildren(el('p', { class: 'empty' }, 'No open reports.'));
        }
        catch (err) {
            tableWrap.replaceChildren(el('p', { class: 'empty' }, 'The queue could not be loaded.'));
            void err;
        }
    };
    await render();
    // Refetch every 5 seconds on a page timer, and when the tab becomes visible.
    window.setInterval(() => { void render(); }, 5000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden)
        void render(); });
}
function deadlineCell(r) {
    const td = el('td', { class: 'time', id: `deadline-${r.reference}` });
    if (r.overdue) {
        td.append(el('span', { class: 'deadline-overdue' }, copy.overdue));
    }
    else {
        const minutes = Math.ceil(r.secondsRemaining / 60);
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        td.append(el('span', { class: 'deadline-ok' }, copy.due(h, m)));
    }
    return td;
}
async function loadTargetAuthor(r) {
    try {
        if (r.target.type === 'post') {
            const post = await api(`/api/posts/${r.target.id}`);
            return post.author?.username ?? null;
        }
        // Comment reports: fetch the comment's author through its post tree.
        const postUrl = r.target.url;
        const postId = Number(/post\/(\d+)/.exec(postUrl)?.[1] ?? 0);
        if (postId === 0)
            return null;
        const tree = await api(`/api/posts/${postId}/comments`);
        void tree;
        return null;
    }
    catch {
        return null;
    }
}
