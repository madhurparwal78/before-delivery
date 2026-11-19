/* Shared UI components: vote controls, post cards, dialogs, menus, the
   masthead and the community rail. */
import { api, announce, copy, displayScore, el, formatUtc, plural, ApiFailure, trapFocus } from './lib.js';
const ACTION_LABELS = {
    remove_post: 'Removed post',
    restore_post: 'Restored post',
    remove_comment: 'Removed comment',
    lock: 'Locked thread',
    unlock: 'Unlocked thread',
    pin: 'Pinned post',
    unpin: 'Unpinned post',
    add_moderator: 'Added moderator',
    remove_moderator: 'Removed moderator',
    approve_poster: 'Approved poster',
    unapprove_poster: 'Removed approved poster',
};
export function actionLabel(action) {
    return ACTION_LABELS[action] ?? action;
}
export function voteControls(targetType, targetId, opts = {}) {
    const scoreEl = el('span', { class: opts.compact === true ? 'score-inline' : 'score', id: `score-${targetType}-${targetId}`, 'aria-live': 'false' });
    const up = el('button', { class: 'vote-btn up', 'aria-label': 'Upvote', 'aria-pressed': 'false' });
    const down = el('button', { class: 'vote-btn down', 'aria-label': 'Downvote', 'aria-pressed': 'false' });
    up.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 L20 14 H15 V20 H9 V14 H4 Z"/></svg>';
    down.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20 L4 10 H9 V4 H15 V10 H20 Z"/></svg>';
    let state = { score: 0, myVote: 0 };
    const apply = (score, myVote) => {
        state = { score, myVote };
        rollScore(scoreEl, score);
        up.setAttribute('aria-pressed', myVote === 1 ? 'true' : 'false');
        down.setAttribute('aria-pressed', myVote === -1 ? 'true' : 'false');
    };
    const send = async (value) => {
        const prev = { ...state };
        apply(prev.score + (value - prev.myVote), value);
        try {
            const res = await api(`/api/${targetType === 'post' ? 'posts' : 'comments'}/${targetId}/vote`, {
                method: 'PUT',
                body: JSON.stringify({ value }),
            });
            apply(res.score, res.myVote);
            const n = displayScore(res.score);
            announce(value === 1 ? copy.upvoted(n) : value === -1 ? copy.downvoted(n) : copy.voteRemoved(n));
        }
        catch (err) {
            apply(prev.score, prev.myVote);
            if (err instanceof ApiFailure) {
                if (err.code === 'RATE_LIMITED')
                    announce(copy.voteSlowDown(err.retryAfter ?? 1));
                else if (err.code === 'EMAIL_UNVERIFIED')
                    announce(copy.voteVerify);
                else if (err.code === 'UNAUTHENTICATED')
                    announce(copy.voteSignIn);
                else if (err.code === 'ARCHIVED')
                    announce(copy.voteArchive);
                else
                    announce(copy.voteNoSave, true);
            }
            else {
                announce(copy.voteNoSave, true);
            }
        }
    };
    up.addEventListener('click', () => void send(state.myVote === 1 ? 0 : 1));
    down.addEventListener('click', () => void send(state.myVote === -1 ? 0 : -1));
    const wrap = el('div', { class: 'vote-col' }, scoreEl, up, down);
    return { wrap, update: apply };
}
export function rollScore(node, score) {
    const target = displayScore(score);
    if (node.textContent === target)
        return;
    node.classList.remove('score-anim');
    // Re-trigger the roll animation.
    void node.offsetWidth;
    node.classList.add('score-anim');
    node.textContent = target;
}
export function postCard(post, me, events = {}) {
    const votes = voteControls('post', post.id);
    const titleLink = el('a', { href: post.url }, post.title ?? '');
    const commentsEl = el('a', { href: post.url, class: 'linklike', id: `comments-post-${post.id}` }, plural(post.commentCount, 'comment', 'comments'));
    const scoreInMeta = el('span', { class: 'num', id: `score-meta-post-${post.id}` });
    const root = el('article', { id: `post-${post.id}`, class: 'post-card', tabindex: '0' }, votes.wrap, el('div', { class: 'card-main' }, el('h3', { class: 'card-title' }, titleLink), el('p', { class: 'card-byline' }, el('span', {}, `c/${post.communityName}`), el('span', { class: 'sep' }, '·'), post.author !== null ? el('span', {}, post.author.username) : el('span', {}, '[deleted by author]'), el('span', { class: 'sep' }, '·'), el('span', { class: 'num' }, formatUtc(post.createdAt))), el('div', { class: 'card-meta' }, commentsEl, scoreInMeta)));
    const cardKeydown = (e) => {
        if (isTyping(e))
            return;
        if (e.key === 'a') {
            votes.wrap.querySelector('.vote-btn.up').click();
        }
        else if (e.key === 'z') {
            votes.wrap.querySelector('.vote-btn.down').click();
        }
        else if (e.key === 'Enter') {
            window.location.href = post.url;
        }
        else if (e.key === 'j')
            focusCard(root, 1);
        else if (e.key === 'k')
            focusCard(root, -1);
    };
    root.addEventListener('keydown', cardKeydown);
    const apply = (p) => {
        votes.update(p.score, p.myVote);
        scoreInMeta.textContent = displayScore(p.score);
        commentsEl.textContent = plural(p.commentCount, 'comment', 'comments');
        titleLink.textContent = p.title ?? '';
    };
    apply(post);
    return { root, update: apply };
}
export function isTyping(e) {
    const t = e.target;
    if (t === null)
        return false;
    return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
}
export function focusCard(current, delta) {
    const cards = Array.from(document.querySelectorAll('article[id^="post-"]'));
    const idx = cards.indexOf(current);
    const next = cards[idx + delta];
    if (next !== undefined)
        next.focus();
}
/* --- Sort tabs --- */
export function sortTabs(current, label, onPick, name = 'Hot') {
    const tabs = ['hot', 'new', 'top'];
    const wrap = el('div', { class: 'tabs', role: 'tablist', 'aria-label': label });
    for (const s of tabs) {
        const btn = el('button', { class: 'tab', role: 'tab', 'aria-selected': s === current ? 'true' : 'false', type: 'button', tabindex: s === current ? '0' : '-1' }, s === 'hot' ? 'Hot' : s === 'new' ? 'New' : 'Top');
        btn.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')
                return;
            e.preventDefault();
            const i = tabs.indexOf(s);
            const nextTab = e.key === 'ArrowRight' ? tabs[(i + 1) % 3] : tabs[(i + 2) % 3];
            onPick(nextTab);
        });
        btn.addEventListener('click', () => onPick(s));
        wrap.append(btn);
    }
    return wrap;
}
/* --- Dialog --- */
export function openDialog(opts) {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overlay = el('div', { class: 'overlay' });
    const dialog = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title });
    dialog.append(el('h2', {}, opts.title));
    for (const field of opts.fields?.() ?? [])
        dialog.append(field);
    const close = () => {
        overlay.remove();
        releaseTrap();
        opener?.focus();
        opts.onCancel?.();
    };
    const actionsEl = el('div', { class: 'dialog-actions' }, ...(opts.actions?.(close) ?? []));
    dialog.append(actionsEl);
    overlay.append(dialog);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay)
        close(); });
    document.body.append(overlay);
    const releaseTrap = trapFocus(dialog, opener);
    const onKey = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            window.removeEventListener('keydown', onKey, true);
            close();
        }
    };
    window.addEventListener('keydown', onKey, true);
    const first = dialog.querySelector('input, button, [href], select, textarea');
    if (first !== null)
        window.setTimeout(() => first.focus(), 30);
    return { close, dialog };
}
export function alertdialog(opts) {
    openDialog({
        title: opts.title,
        fields: () => [el('p', {}, opts.message)],
        actions: (close) => {
            const ok = el('button', { class: 'btn primary', type: 'button' }, opts.confirmLabel);
            ok.addEventListener('click', () => { void (async () => { await opts.confirm(); close(); })(); });
            const cancel = el('button', { class: 'btn', type: 'button' }, 'Cancel');
            cancel.addEventListener('click', close);
            return [cancel, ok];
        },
    });
}
/* --- Menu button --- */
export function menuButton(label, items) {
    const btn = el('button', { class: 'btn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, label);
    let menu = null;
    const closeMenu = () => {
        menu?.remove();
        menu = null;
        btn.setAttribute('aria-expanded', 'false');
        btn.focus();
    };
    const openMenu = () => {
        if (menu !== null)
            return;
        menu = el('div', { class: 'menu', role: 'menu' });
        for (const item of items) {
            if (item.show === false)
                continue;
            const mi = el('button', { class: 'menu-item', role: 'menuitem', type: 'button' }, item.label);
            mi.addEventListener('click', () => { closeMenu(); item.onPick(); });
            menu?.append(mi);
        }
        btn.after(menu);
        btn.setAttribute('aria-expanded', 'true');
        menu?.firstElementChild?.focus();
    };
    btn.addEventListener('click', () => { if (menu === null)
        openMenu();
    else
        closeMenu(); });
    btn.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openMenu();
        }
    });
    document.addEventListener('click', (e) => {
        if (menu !== null && !menu.contains(e.target) && e.target !== btn)
            closeMenu();
    });
    const menuKeys = (e) => {
        if (menu === null)
            return;
        const focusables = Array.from(menu.querySelectorAll('[role="menuitem"]'));
        const current = focusables.indexOf(document.activeElement);
        if (e.key === 'Escape') {
            e.preventDefault();
            closeMenu();
        }
        else if (e.key === 'ArrowDown') {
            e.preventDefault();
            focusables[(current + 1) % focusables.length]?.focus();
        }
        else if (e.key === 'ArrowUp') {
            e.preventDefault();
            focusables[(current - 1 + focusables.length) % focusables.length]?.focus();
        }
    };
    document.addEventListener('keydown', menuKeys);
    return btn;
}
/* --- Masthead --- */
export function masthead(me, live) {
    const indicator = el('span', { class: 'live-indicator', id: 'live-indicator' });
    const setIndicator = (paused) => {
        indicator.className = `live-indicator${paused ? ' paused' : ''}`;
        indicator.replaceChildren(el('span', { class: 'dot', 'aria-hidden': 'true' }), document.createTextNode(paused ? copy.livePausedLabel : copy.live));
    };
    setIndicator(live.paused);
    const links = el('div', { class: 'masthead-links' });
    const drawerBtn = el('button', { class: 'btn drawer-toggle', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'community-drawer' }, 'Communities');
    const root = el('header', { class: 'masthead' }, drawerBtn, el('a', { class: 'wordmark', href: '/' }, 'Moothall'), el('span', { class: 'masthead-spacer' }), indicator, links);
    const update = (account) => {
        links.replaceChildren();
        if (account === null) {
            links.append(el('a', { class: 'linklike', href: '/login' }, 'Sign in'), el('a', { class: 'linklike', href: '/signup' }, 'Create account'), el('a', { class: 'linklike', href: '/communities' }, 'Communities'));
        }
        else {
            const out = el('button', { class: 'btn quiet', type: 'button' }, 'Sign out');
            out.addEventListener('click', () => { void api('/api/auth/logout', { method: 'POST' }).then(() => navigate('/')); });
            links.append(el('a', { class: 'linklike', href: '/communities/new' }, 'Create community'));
            if (account.role === 'admin')
                links.append(el('a', { class: 'linklike', href: '/admin/reports' }, 'Admin'));
            links.append(out);
        }
    };
    update(me);
    return { root, indicator, update };
}
export function navigate(path) {
    window.location.href = path;
}
/* --- Community rail / drawer --- */
export function rail(communities, asDrawer) {
    const nav = el('nav', { 'aria-label': 'Communities' });
    const list = el('div', {});
    if (!asDrawer)
        list.className = 'rail';
    list.append(el('p', { class: 'rail-title' }, 'Your communities'));
    for (const c of communities) {
        list.append(el('a', { href: `/c/${c.name}` }, `c/${c.name}`));
    }
    if (communities.length === 0)
        list.append(el('p', {}, 'You have not joined any communities yet.'));
    nav.append(list);
    return nav;
}
