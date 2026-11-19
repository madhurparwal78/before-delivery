/* Community page: header with member count and Join, pinned posts first, the
   sorted feed, the description, rules and mod log summary sidebar. */
import { api, announce, copy, el } from '../lib.js';
import { actionLabel, postCard, rail, sortTabs } from '../ui.js';
import { display } from './feed.js';
import { handleAccountEvent } from './report.js';
export { display };
export async function renderCommunityPage(frame, me, live, path, search) {
    const name = path.split('/')[2] ?? '';
    const url = new URLSearchParams(search);
    const initialSort = (url.get('sort') === 'new' || url.get('sort') === 'top') ? url.get('sort') : 'hot';
    const railEl = el('aside', { class: 'rail' });
    const feedCol = el('main', { class: 'feed' });
    const side = el('aside', { class: 'side' });
    frame.append(railEl, feedCol, side);
    let community;
    try {
        community = await api(`/api/communities/${name}`);
    }
    catch {
        feedCol.append(el('p', { class: 'empty' }, 'This community does not exist.'));
        return;
    }
    if (me !== null) {
        try {
            const mine = await api('/api/communities/mine');
            railEl.append(rail(mine.items, false));
        }
        catch {
            railEl.append(rail([], false));
        }
    }
    else
        railEl.append(rail([], false));
    // --- Header ---
    const membersEl = el('span', { class: 'num', id: `members-${community.name}` }, `${community.memberCount} ${community.memberCount === 1 ? 'member' : 'members'}`);
    const joinBtn = el('button', { class: 'btn', type: 'button', 'aria-pressed': community.viewer.joined ? 'true' : 'false' }, community.viewer.joined ? 'Joined' : 'Join');
    joinBtn.addEventListener('click', async () => {
        const method = joinBtn.getAttribute('aria-pressed') === 'true' ? 'DELETE' : 'PUT';
        try {
            const res = await api(`/api/communities/${community.name}/membership`, { method });
            joinBtn.setAttribute('aria-pressed', res.joined ? 'true' : 'false');
            joinBtn.textContent = res.joined ? 'Joined' : 'Join';
            membersEl.textContent = `${res.memberCount} ${res.memberCount === 1 ? 'member' : 'members'}`;
        }
        catch { /* permission or conflict */ }
    });
    feedCol.append(el('header', { class: 'post-head' }, el('h1', {}, community.title), el('p', { class: 'card-byline' }, `c/${community.name}`, el('span', { class: 'sep' }, '·'), membersEl), el('div', { class: 'card-meta' }, joinBtn, community.type === 'restricted' ? el('span', { class: 'pinned-tag' }, 'Restricted') : null, me !== null && community.viewer.canPost ? el('a', { class: 'btn primary', href: `/c/${community.name}/submit` }, 'Submit') : null, el('a', { class: 'btn', href: `/c/${community.name}/about/log` }, 'Mod log'))));
    // --- Sidebar ---
    const sidePanel = el('section', { class: 'panel' });
    sidePanel.append(el('h3', {}, 'About'));
    sidePanel.append(el('p', {}, community.description));
    if (community.rules.length > 0) {
        sidePanel.append(el('h3', {}, 'Rules'));
        const ol = el('ol', { class: 'rules-list' });
        community.rules.forEach((r, i) => ol.append(el('li', {}, el('strong', {}, `${i + 1}. ${r.title}`), el('div', {}, r.description))));
        sidePanel.append(ol);
    }
    const logPanel = el('section', { class: 'panel log-summary' });
    logPanel.append(el('h3', {}, 'Moderation log'));
    side.append(sidePanel, logPanel);
    void api(`/api/communities/${community.name}/modlog`).then((log) => {
        const rows = log.items.slice(0, 5);
        if (rows.length === 0) {
            logPanel.append(el('p', {}, 'No moderator actions yet.'));
            return;
        }
        for (const row of rows) {
            logPanel.append(logSummaryRow(row));
        }
        logPanel.append(el('a', { href: `/c/${community.name}/about/log` }, 'Full moderation log'));
    }).catch(() => undefined);
    // --- Feed ---
    let sort = initialSort;
    const pinnedWrap = el('div', { class: 'card-list', id: 'pinned-group' });
    const listEl = el('div', { class: 'card-list' });
    const loadWrap = el('div', {});
    const cards = new Map();
    const feedHeader = el('div', {});
    const pickSort = (next) => {
        const u = new URL(window.location.href);
        u.searchParams.set('sort', next);
        window.history.replaceState(null, '', u.toString());
        sort = next;
        cards.clear();
        listEl.replaceChildren();
        pinnedWrap.replaceChildren();
        feedHeader.replaceChildren(sortTabs(sort, 'Sort posts', pickSort));
        void loadPage(null);
    };
    feedHeader.append(sortTabs(sort, 'Sort posts', pickSort));
    feedCol.append(feedHeader, pinnedWrap, listEl, loadWrap);
    async function loadPage(cursor) {
        const page = await api(`/api/communities/${community.name}/posts?sort=${sort}${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`);
        if (cursor === null) {
            for (const post of page.pinned ?? []) {
                const card = postCard(post, me);
                card.root.prepend(el('span', { class: 'pinned-tag' }, 'Pinned'));
                pinnedWrap.append(card.root);
                cards.set(post.id, card);
            }
        }
        for (const post of page.items) {
            if (cards.has(post.id))
                continue;
            const card = postCard(post, me);
            cards.set(post.id, card);
            listEl.append(card.root);
            if (cursor !== null && page.items.indexOf(post) === 0)
                card.root.focus();
        }
        loadWrap.replaceChildren();
        if (page.nextCursor === null)
            loadWrap.append(el('p', { class: 'end-of-feed' }, copy.endOfFeed));
        else {
            const more = el('button', { class: 'btn', type: 'button' }, 'Load more posts');
            more.addEventListener('click', () => { void loadPage(page.nextCursor); });
            loadWrap.append(more);
        }
        if (page.items.length === 0 && cursor === null && (page.pinned ?? []).length === 0) {
            listEl.append(el('p', { class: 'empty' }, 'No posts yet.'));
        }
    }
    await loadPage(null);
    const topic = `community:${community.name.toLowerCase()}`;
    live.subscribe(['home', topic], (event) => {
        const data = event.data;
        if (event.event === 'account') {
            handleAccountEvent(data);
            return;
        }
        if (event.event === 'score') {
            const targetId = data.targetId;
            const score = data.score;
            const scoreEl = document.getElementById(`score-post-${targetId}`);
            const meta = document.getElementById(`score-meta-post-${targetId}`);
            if (scoreEl !== null)
                scoreEl.textContent = display(score);
            if (meta !== null)
                meta.textContent = display(score);
        }
        else if (event.event === 'membership') {
            const count = data.memberCount;
            membersEl.textContent = `${count} ${count === 1 ? 'member' : 'members'}`;
        }
        else if (event.event === 'post-state') {
            const postId = data.postId;
            const state = data.state;
            if (state === 'removed' || state === 'deleted') {
                const card = cards.get(postId);
                if (card !== undefined) {
                    const focused = document.activeElement === card.root;
                    card.root.remove();
                    cards.delete(postId);
                    announce(copy.postRemovedWatchers);
                    if (focused)
                        listEl.querySelector('article[id^="post-"]')?.focus();
                }
            }
            else if (data.pinned === true || data.pinned === false) {
                // Reorder the pinned group by refetching the first page quietly.
                void api(`/api/communities/${community.name}/posts?sort=${sort}`).then((page) => {
                    pinnedWrap.replaceChildren();
                    for (const post of page.pinned ?? []) {
                        const card = postCard(post, me);
                        card.root.prepend(el('span', { class: 'pinned-tag' }, 'Pinned'));
                        pinnedWrap.append(card.root);
                    }
                }).catch(() => undefined);
            }
        }
    });
}
export function logSummaryRow(row) {
    return el('div', { class: 'row' }, el('span', { class: 'action' }, actionLabel(row.action)), el('span', { class: 'target' }, targetText(row)), el('span', { class: 'time' }, formatTime(row.at)));
}
export function targetText(row) {
    if (row.target.type === 'post')
        return `Post ${row.target.id}`;
    if (row.target.type === 'comment')
        return `Comment ${row.target.id}`;
    return `u/${row.target.id}`;
}
export function targetLink(row) {
    const text = targetText(row);
    const href = row.target.type === 'user' ? `/u/${row.target.id}` : text === `Post ${row.target.id}` ? `/c/-/post/${row.target.id}` : `/c/-/post/-/comment/${row.target.id}`;
    return el('a', { href }, text);
}
export function formatTime(iso) {
    const d = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    return `${d.getUTCDate()} ${months[d.getMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}
