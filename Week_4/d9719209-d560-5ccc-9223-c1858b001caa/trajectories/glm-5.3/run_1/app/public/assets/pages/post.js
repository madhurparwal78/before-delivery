/* The post page: header, body, image gallery, comment tree with folds and live
   replies, and the continue-thread page for deep subtrees. */
import { api, announce, copy, el, idKey } from '../lib.js';
import { alertdialog, isTyping, menuButton, openDialog, voteControls } from '../ui.js';
import { handleAccountEvent, openReport } from './report.js';
import { display, formatTime } from './community.js';
const displayDepth = () => (window.innerWidth >= 768 ? 8 : 5);
export async function renderPostPage(frame, me, live, path, search, continueMode = false) {
    // /c/<name>/post/<id> or /c/<name>/post/<id>/comment/<commentId>
    const parts = path.split('/').filter(Boolean); // ['c', name, 'post', id, ...]
    const postId = Number(parts[3]);
    let commentId = null;
    if (continueMode)
        commentId = Number(parts[5]);
    const railEl = el('aside', { class: 'rail' });
    const feedCol = el('main', { class: 'feed' });
    const side = el('aside', { class: 'side' });
    frame.append(railEl, feedCol, side);
    let post;
    try {
        post = await api(`/api/posts/${postId}`);
    }
    catch {
        feedCol.append(el('p', { class: 'empty' }, 'This post does not exist.'));
        return;
    }
    const community = await api(`/api/communities/${post.communityName}`);
    const votes = voteControls('post', post.id);
    votes.update(post.score, post.myVote);
    const scoreEl = () => document.getElementById(`score-post-${post.id}`);
    const header = el('header', { class: 'post-head' });
    const removalBanner = el('div', {});
    const isAuthor = me !== null && post.author !== null && post.author.username === me.username;
    const showRemoval = post.state === 'removed' && (isAuthor || community.viewer.isModerator);
    const renderHead = (p) => {
        header.replaceChildren();
        if (continueMode) {
            header.append(el('a', { class: 'linklike', href: `/c/${p.communityName}/post/${p.id}` }, 'Back to full thread'));
        }
        if (p.state === 'removed' && showRemoval) {
            header.append(el('h1', {}, copy.removedHeading(p.removal?.publicReason ?? '')));
        }
        else if (p.state === 'deleted') {
            header.append(el('h1', {}, '[deleted by author]'));
        }
        else {
            header.append(el('h1', { class: 'title' }, p.title ?? ''));
        }
        header.append(el('p', { class: 'card-byline' }, el('a', { href: `/c/${p.communityName}` }, `c/${p.communityName}`), el('span', { class: 'sep' }, '·'), p.author !== null ? el('a', { href: `/u/${p.author.username}` }, p.author.username) : el('span', {}, '[deleted by author]'), el('span', { class: 'sep' }, '·'), el('span', { class: 'num' }, formatTime(p.createdAt)), p.editedAt !== null ? el('span', { class: 'edited-tag' }, 'edited') : null), el('div', { class: 'card-meta' }, votes.wrap, el('span', { class: 'num', id: `comments-post-${p.id}` }, `${p.commentCount} ${p.commentCount === 1 ? 'comment' : 'comments'}`), p.locked ? el('span', { class: 'pinned-tag' }, 'Locked') : null, p.pinned ? el('span', { class: 'pinned-tag' }, 'Pinned') : null, p.archived ? el('span', { class: 'edited-tag' }, 'Archived') : null));
        // Menus
        const actions = el('div', { class: 'card-meta' });
        const more = menuButton('More actions', [
            { label: 'Report illegal content', onPick: () => openReport({ targetType: 'post', targetId: post.id }, me) },
            { label: 'Edit post', show: isAuthor && post.state === 'published', onPick: () => openEditPost() },
            { label: 'Delete post', show: isAuthor && post.state !== 'deleted', onPick: () => confirmDeletePost() },
        ]);
        actions.append(more);
        if (community.viewer.isModerator && post.state !== 'deleted') {
            actions.append(moderatorMenu(post, me, community));
        }
        header.append(actions);
    };
    renderHead(post);
    const bodyEl = el('div', { class: 'post-body' });
    const renderBody = (p) => {
        bodyEl.replaceChildren();
        if (p.bodyHtml !== null && p.bodyHtml !== '') {
            const div = el('div', {});
            div.innerHTML = p.bodyHtml;
            bodyEl.append(div);
            wireSpoilers(bodyEl);
        }
    };
    renderBody(post);
    feedCol.append(header, removalBanner, bodyEl);
    if (post.images.length > 0)
        feedCol.append(gallery(post));
    // Lock banner
    const lockBanner = el('div', {});
    const renderLock = (p) => {
        lockBanner.replaceChildren();
        if (p.locked) {
            lockBanner.append(el('div', { class: 'banner', role: 'status' }, el('p', {}, copy.lockBanner), p.lockedUntil !== null ? el('p', { class: 'second-line' }, `Replies reopen ${formatTime(p.lockedUntil)}`) : null));
        }
        if (p.archived)
            lockBanner.append(el('div', { class: 'banner warn' }, el('p', {}, copy.archived)));
    };
    renderLock(post);
    feedCol.append(lockBanner);
    if (showRemoval) {
        removalBanner.append(el('div', { class: 'banner warn' }, el('p', {}, copy.removedHeading(post.removal?.publicReason ?? ''))));
    }
    /* --- Comments --- */
    const commentSortUrl = new URLSearchParams(search);
    let commentSort = commentSortUrl.get('sort') === 'new' ? 'new' : 'top';
    const treeWrap = el('div', { class: 'comment-tree' });
    const treeHeader = el('div', {});
    const composerWrap = el('div', {});
    feedCol.append(treeHeader, composerWrap, treeWrap);
    const treeEl = el('div', { role: 'tree', 'aria-label': 'Comments' });
    treeWrap.append(treeEl);
    const allComments = new Map();
    const pickSort = (next) => {
        const u = new URL(window.location.href);
        u.searchParams.set('sort', next);
        window.history.replaceState(null, '', u.toString());
        commentSort = next;
        void loadTree();
    };
    const renderSortTabs = () => {
        treeHeader.replaceChildren();
        const tabs = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Sort comments' });
        for (const s of ['top', 'new']) {
            const b = el('button', { class: 'tab', role: 'tab', type: 'button', 'aria-selected': s === commentSort ? 'true' : 'false' }, s === 'top' ? 'Top' : 'New');
            b.addEventListener('click', () => pickSort(s));
            b.addEventListener('keydown', (e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')
                    return;
                e.preventDefault();
                pickSort(s === 'top' ? 'new' : 'top');
            });
            tabs.append(b);
        }
        treeHeader.append(tabs);
    };
    renderSortTabs();
    async function loadTree() {
        const depth = displayDepth();
        const url = continueMode
            ? `/api/comments/${commentId}/thread?sort=${commentSort}&depth=${depth}`
            : `/api/posts/${post.id}/comments?sort=${commentSort}&depth=${depth}`;
        const res = await api(url);
        allComments.clear();
        treeEl.replaceChildren();
        const rootDepth = continueMode ? 1 : 1;
        const continueIds = new Set(res.more ?? []);
        // Restore folds from ?fold=.
        const folded = new Set();
        for (const id of (new URLSearchParams(window.location.search).get('fold') ?? '').split(',').filter(Boolean)) {
            const n = Number(id);
            if (Number.isInteger(n) && n > 0)
                folded.add(n);
        }
        const buildNode = (c, level) => {
            const kids = c.replies ?? [];
            const atCut = continueIds.has(c.id) || (level === depth && kids.length > 0);
            const node = commentNode(c, level, kids.length > 0);
            // Continue this thread at the deepest shown level.
            if (atCut) {
                node.root.append(el('div', { class: 'continue-link' }, el('a', { href: `/c/${post.communityName}/post/${post.id}/comment/${c.id}` }, 'Continue this thread')));
            }
            let repliesHost = null;
            if (kids.length > 0 && !atCut) {
                repliesHost = el('div', { class: 'comment-replies', 'data-replies': String(c.id) });
                for (const kid of kids) {
                    repliesHost.append(buildNode(kid, level + 1).root);
                }
                node.root.append(repliesHost);
            }
            allComments.set(c.id, c);
            if (folded.has(c.id) && repliesHost !== null) {
                applyFold(node.root, repliesHost, c, true);
            }
            return { root: node.root, repliesHost };
        };
        for (const c of res.tree) {
            treeEl.append(buildNode(c, rootDepth).root);
        }
        const firstItem = treeEl.querySelector('[role="treeitem"]');
        if (firstItem !== null)
            firstItem.setAttribute('tabindex', '0');
        renderComposer();
    }
    function renderComposer() {
        composerWrap.replaceChildren();
        const canReply = me !== null && post.state === 'published' && !post.locked && !post.archived;
        if (me === null) {
            composerWrap.append(el('p', { class: 'empty' }, el('a', { href: '/login' }, 'Sign in'), ' to join the conversation.'));
            return;
        }
        if (!canReply)
            return;
        const ta = el('textarea', { class: 'textarea', 'aria-label': 'Add a comment', placeholder: 'Add a comment' });
        const postBtn = el('button', { class: 'btn primary', type: 'button' }, 'Comment');
        const errEl = el('p', {});
        const send = async () => {
            const body = ta.value.trim();
            if (body === '')
                return;
            postBtn.textContent = 'Posting...';
            try {
                // On a continue page the top composer replies under the root comment,
                // so the reply stays in this subtree.
                const res = await api(`/api/posts/${post.id}/comments`, {
                    method: 'POST',
                    headers: { 'Idempotency-Key': idKey() },
                    body: JSON.stringify({ bodyMd: body, parentId: continueMode ? commentId : null }),
                });
                announce(copy.replyPosted);
                await loadTree();
                focusComment(res.comment.id);
                updateCommentCount(res.commentCount);
            }
            catch (err) {
                postBtn.textContent = 'Comment';
                if (err instanceof Error && 'fields' in err) {
                    const fields = err.fields;
                    errEl.replaceChildren(el('p', { class: 'field-error' }, fields.bodyMd ?? ''));
                }
            }
            finally {
                postBtn.textContent = 'Comment';
            }
        };
        postBtn.addEventListener('click', () => void send());
        ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey))
            void send(); });
        composerWrap.append(el('div', { class: 'reply-box' }, ta, el('div', { class: 'dialog-actions' }, postBtn), errEl));
    }
    function updateCommentCount(count) {
        const elc = document.getElementById(`comments-post-${post.id}`);
        if (elc !== null)
            elc.textContent = `${count} ${count === 1 ? 'comment' : 'comments'}`;
    }
    function focusComment(id) {
        const node = document.getElementById(`comment-${id}`);
        if (node === null)
            return;
        const item = node.matches('[role="treeitem"]') ? node : node.querySelector('[role="treeitem"]');
        if (item !== null) {
            setRovingTabindex(item);
            item.focus();
            item.classList.add('highlight');
            window.setTimeout(() => item.classList.remove('highlight'), 1400);
            if (!prefersReducedMotion())
                item.prepend(newTag());
        }
    }
    await loadTree();
    const topic = `post:${post.id}`;
    const communityTopic = `community:${post.communityName.toLowerCase()}`;
    live.subscribe(['home', communityTopic, topic], (event) => {
        const data = event.data;
        if (event.event === 'score') {
            const targetId = data.targetId;
            const score = data.score;
            if (data.targetType === 'post') {
                const s = document.getElementById(`score-post-${targetId}`);
                if (s !== null)
                    s.textContent = display(score);
            }
            else {
                const s = document.getElementById(`score-comment-${targetId}`);
                if (s !== null)
                    s.textContent = display(score);
            }
        }
        else if (event.event === 'comments') {
            updateCommentCount(data.commentCount);
        }
        else if (event.event === 'comment') {
            const incoming = data.comment;
            const parentId = data.parentId;
            if (me !== null && incoming.author !== null && incoming.author.username === me.username)
                return;
            insertLiveComment(incoming, parentId);
        }
        else if (event.event === 'post-state') {
            const state = data.state;
            const locked = data.locked;
            const lockedUntil = data.lockedUntil;
            post = { ...post, state: state, locked, lockedUntil, pinned: data.pinned, version: data.version };
            renderLock(post);
            if (state === 'removed' || state === 'deleted') {
                header.replaceChildren();
                header.append(el('h1', {}, state === 'deleted' ? '[deleted by author]' : copy.removedHeading(String(data.publicReason ?? ''))));
                bodyEl.replaceChildren();
            }
            else {
                renderHead(post);
            }
            renderComposer();
        }
        else if (event.event === 'account') {
            handleAccountEvent(data);
        }
    });
    /* --- Live comment insertion --- */
    function insertLiveComment(incoming, parentId) {
        const parent = parentId === null ? null : document.getElementById(`comment-${parentId}`);
        if (parent === null && parentId !== null) {
            // Possibly a folded parent: bump the pill count instead.
            const pill = parentPillFor(parentId);
            if (pill !== null) {
                bumpPill(pill);
                announce(copy.newReply(incoming.author?.username ?? 'someone'));
                return;
            }
        }
        // Folded branch check: any ancestor folded?
        const item = commentNode(incoming, incoming.depth, false).root;
        const mount = parent === null ? treeEl : parent.querySelector('[data-replies]') ?? treeEl;
        mount.append(item);
        if (!prefersReducedMotion()) {
            item.classList.add('highlight');
            window.setTimeout(() => item.classList.remove('highlight'), 1400);
            const rail = parent?.querySelector('.rail-line');
            rail?.classList.add('rail-glow');
            window.setTimeout(() => rail?.classList.remove('rail-glow'), 1200);
        }
        else {
            item.prepend(newTag());
        }
        announce(copy.newReply(incoming.author?.username ?? 'someone'));
        updateCommentCount(post.commentCount + 1);
    }
    function parentPillFor(commentId) {
        const commentEl = document.getElementById(`comment-${commentId}`);
        if (commentEl === null)
            return null;
        return commentEl.matches('.folded') ? commentEl.querySelector('.fold-pill') : null;
    }
    function bumpPill(pill) {
        const countEl = pill.querySelector('.count');
        const current = Number(countEl?.textContent ?? '0');
        if (countEl !== null)
            rollCount(countEl, current + 1);
    }
    function rollCount(node, value) {
        node.classList.remove('score-anim');
        void node.offsetWidth;
        node.classList.add('score-anim');
        node.textContent = value === 1 ? '1 reply' : `${value} replies`;
    }
    /* --- Edit / delete post --- */
    function openEditPost() {
        const overlayWrap = el('div', {});
        const dialogHost = el('div', {});
        overlayWrap.append(dialogHost);
        const { close, dialog } = openHostedDialog(dialogHost, 'Edit post');
        const bodyTa = el('textarea', { class: 'textarea', 'aria-label': 'Body' });
        bodyTa.value = post.bodyMd ?? '';
        const errEl = el('p', {});
        const save = el('button', { class: 'btn primary', type: 'button' }, 'Save');
        save.addEventListener('click', () => {
            void (async () => {
                save.textContent = 'Saving...';
                try {
                    const fresh = await api(`/api/posts/${post.id}`, { method: 'PATCH', body: JSON.stringify({ bodyMd: bodyTa.value }) });
                    post = fresh;
                    renderBody(fresh);
                    renderHead(fresh);
                    announce('Post updated');
                    close();
                }
                catch (err) {
                    save.textContent = 'Save';
                    if (err instanceof Error && 'fields' in err)
                        errEl.replaceChildren(el('span', { class: 'field-error' }, 'The edit window has closed'));
                }
            })();
        });
        const cancel = el('button', { class: 'btn', type: 'button' }, 'Cancel');
        cancel.addEventListener('click', close);
        dialog.append(el('p', { class: 'card-byline' }, copy.titleNote), el('p', { class: 'card-byline' }, post.title ?? ''), bodyTa, el('div', { class: 'dialog-actions' }, cancel, save), errEl);
    }
    function confirmDeletePost() {
        alertdialog({
            title: 'Delete post',
            message: 'Delete this post? The comments stay and the title is replaced.',
            confirmLabel: 'Delete',
            confirm: async () => {
                const fresh = await api(`/api/posts/${post.id}`, { method: 'DELETE' });
                post = fresh;
                renderHead(fresh);
                renderBody(fresh);
                announce('Post deleted');
            },
        });
    }
    function openHostedDialog(host, title) {
        const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const overlay = el('div', { class: 'overlay' });
        const dialog = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
        dialog.append(el('h2', {}, title));
        host.append(overlay);
        overlay.append(dialog);
        const close = () => { overlay.remove(); opener?.focus(); };
        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                window.removeEventListener('keydown', onKey, true);
                close();
            }
        };
        window.addEventListener('keydown', onKey, true);
        overlay.addEventListener('mousedown', (e) => { if (e.target === overlay)
            close(); });
        return { close, dialog };
    }
}
export function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
export function newTag() {
    return el('span', { class: 'new-tag' }, 'New');
}
export function wireSpoilers(root) {
    for (const span of Array.from(root.querySelectorAll('.spoiler'))) {
        span.setAttribute('tabindex', '0');
        span.setAttribute('role', 'button');
        if (span.getAttribute('aria-label') === null)
            span.setAttribute('aria-label', 'Reveal spoiler');
        span.addEventListener('click', () => span.classList.add('revealed'));
        span.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            span.classList.add('revealed');
        } });
    }
}
export function setRovingTabindex(item) {
    for (const t of Array.from(document.querySelectorAll('[role="treeitem"]')))
        t.setAttribute('tabindex', '-1');
    item.setAttribute('tabindex', '0');
}
/* Build one comment node with its fold rail, votes, actions and replies. */
/* Fold and unfold a branch into the pill. The three-step FLIP sequence runs as
   CSS transitions; reduced motion makes it instant. */
function applyFold(item, repliesHost, comment, instant = false) {
    const pill = el('button', { class: 'fold-pill', type: 'button', 'aria-expanded': 'false' }, el('span', { class: 'count', 'aria-hidden': 'true' }, pillCount(comment.descendantCount)));
    pill.setAttribute('aria-label', pillCount(comment.descendantCount));
    const reduced = prefersReducedMotion() || instant;
    const fold = () => {
        if (reduced) {
            repliesHost.hidden = true;
        }
        else {
            repliesHost.style.transition = 'opacity 200ms ease, transform 200ms ease';
            repliesHost.style.opacity = '0';
            repliesHost.style.transform = 'translateY(-6px)';
            window.setTimeout(() => { repliesHost.hidden = true; repliesHost.style.opacity = ''; repliesHost.style.transform = ''; }, 210);
        }
        item.classList.add('folded');
        item.setAttribute('aria-expanded', 'false');
        const inner = item.querySelector('.comment-inner');
        if (inner !== null) {
            for (const child of Array.from(inner.children)) {
                if (child.classList.contains('comment-meta'))
                    continue;
                child.inert = true;
            }
        }
        const meta = item.querySelector('.comment-meta');
        meta?.after(pill);
        writeFoldParam();
    };
    fold();
    pill.addEventListener('click', () => { unfold(item, repliesHost, comment, pill); });
    return pill;
}
function unfold(item, repliesHost, comment, pill) {
    const reduced = prefersReducedMotion();
    repliesHost.hidden = false;
    if (!reduced) {
        repliesHost.style.transition = 'opacity 200ms ease, transform 200ms ease';
        repliesHost.style.opacity = '0';
        requestAnimationFrame(() => { repliesHost.style.opacity = '1'; });
        window.setTimeout(() => { repliesHost.style.opacity = ''; repliesHost.style.transition = ''; }, 240);
    }
    item.classList.remove('folded');
    item.setAttribute('aria-expanded', 'true');
    const inner = item.querySelector('.comment-inner');
    if (inner !== null) {
        for (const child of Array.from(inner.children)) {
            child.inert = false;
        }
    }
    pill.remove();
    writeFoldParam();
    const railBtn = item.querySelector('.fold-btn');
    railBtn?.focus();
    void comment;
}
function pillCount(n) {
    return n === 1 ? '1 reply folded' : `${n} replies folded`;
}
function writeFoldParam() {
    const foldedIds = Array.from(document.querySelectorAll('[role="treeitem"].folded'))
        .map((n) => (n.id ?? '').replace('comment-', ''))
        .filter(Boolean);
    const u = new URL(window.location.href);
    if (foldedIds.length === 0)
        u.searchParams.delete('fold');
    else
        u.searchParams.set('fold', foldedIds.join(','));
    window.history.replaceState(null, '', u.toString());
}
/* Build one comment node: meta, body, votes, actions, fold rail and replies. */
function commentNode(c, level, hasReplies) {
    const votes = voteControls('comment', c.id, { compact: true });
    votes.update(c.score, c.myVote);
    const scoreEl = votes.wrap.querySelector('.score-inline');
    scoreEl.id = `score-comment-${c.id}`;
    const item = el('div', { role: 'treeitem', id: `comment-${c.id}`, 'aria-level': String(level), 'aria-label': `Comment by ${c.author?.username ?? 'unknown'}`, tabindex: '-1', 'aria-posinset': '1', 'aria-setsize': '1' });
    if (hasReplies)
        item.setAttribute('aria-expanded', 'true');
    const meta = el('div', { class: 'comment-meta' }, el('span', { class: 'author' }, c.author?.username ?? '[deleted]'), el('span', { class: 'num' }, formatTime(c.createdAt)), c.editedAt !== null ? el('span', { class: 'edited-tag' }, 'edited') : null);
    const body = el('div', { class: 'comment-body' });
    if (c.state === 'removed' && c.bodyHtml === null)
        body.append(el('p', {}, copy.removedCommentLabel));
    else if (c.state === 'deleted')
        body.append(el('p', {}, copy.deletedCommentLabel));
    else if (c.bodyHtml !== null) {
        const d = el('div', {});
        d.innerHTML = c.bodyHtml;
        wireSpoilers(d);
        body.append(d);
    }
    // Actions: votes, Reply, More actions.
    const replyBtn = el('button', { class: 'mini', type: 'button' }, 'Reply');
    const moreBtn = menuButton('More actions', [
        { label: 'Report illegal content', onPick: () => { void openReport({ targetType: 'comment', targetId: c.id }, null); } },
        { label: 'Edit comment', show: c.canEdit, onPick: () => { void openEditComment(c); } },
        { label: 'Delete comment', show: c.canEdit, onPick: () => confirmDeleteComment(c) },
    ]);
    const actions = el('div', { class: 'comment-actions' }, votes.wrap, replyBtn, moreBtn);
    const inner = el('div', { class: 'comment-inner' }, meta, body, actions);
    item.append(inner);
    // The inline reply box.
    replyBtn.addEventListener('click', () => {
        const existing = item.querySelector('.reply-box');
        if (existing !== null) {
            existing.remove();
            replyBtn.focus();
            return;
        }
        const ta = el('textarea', { class: 'textarea', 'aria-label': `Reply to ${c.author?.username ?? 'unknown'}` });
        const send = el('button', { class: 'btn primary', type: 'button' }, 'Post reply');
        const cancel = el('button', { class: 'btn', type: 'button' }, 'Cancel');
        const errEl = el('p', {});
        const box = el('div', { class: 'reply-box' }, ta, el('div', { class: 'dialog-actions' }, cancel, send), errEl);
        item.append(box);
        ta.focus();
        cancel.addEventListener('click', () => { box.remove(); replyBtn.focus(); });
        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                box.remove();
                replyBtn.focus();
            }
        };
        box.addEventListener('keydown', onKey);
        send.addEventListener('click', () => {
            void (async () => {
                if (ta.value.trim() === '')
                    return;
                send.textContent = 'Posting...';
                try {
                    await api(`/api/posts/${c.postId}/comments`, {
                        method: 'POST',
                        headers: { 'Idempotency-Key': idKey() },
                        body: JSON.stringify({ bodyMd: ta.value.trim(), parentId: c.id }),
                    });
                    announce(copy.replyPosted);
                    await reloadTreeFromOutside();
                }
                catch (err) {
                    send.textContent = 'Post reply';
                    if (err instanceof Error && 'fields' in err) {
                        const fields = err.fields;
                        errEl.replaceChildren(el('span', { class: 'field-error' }, fields.bodyMd ?? ''));
                    }
                }
            })();
        });
    });
    // Tree-view keyboard navigation on the treeitem itself.
    item.addEventListener('keydown', (e) => {
        if (isTyping(e))
            return;
        const items = Array.from(document.querySelectorAll('[role="treeitem"]'));
        const visible = items.filter((n) => n.offsetParent !== null);
        const idx = visible.indexOf(item);
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setRovingTabindex(visible[(idx + 1) % visible.length] ?? item);
            (visible[(idx + 1) % visible.length] ?? item).focus();
        }
        else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setRovingTabindex(visible[(idx - 1 + visible.length) % visible.length] ?? item);
            (visible[(idx - 1 + visible.length) % visible.length] ?? item).focus();
        }
        else if (e.key === 'Home') {
            e.preventDefault();
            setRovingTabindex(visible[0]);
            visible[0].focus();
        }
        else if (e.key === 'End') {
            e.preventDefault();
            const last = visible[visible.length - 1];
            setRovingTabindex(last);
            last.focus();
        }
        else if (e.key === 'ArrowRight') {
            e.preventDefault();
            if (item.getAttribute('aria-expanded') === 'false') {
                const pillBtn = item.querySelector('.fold-pill');
                pillBtn?.click();
            }
            else if (hasReplies) {
                const firstReply = item.querySelector('[data-replies] [role="treeitem"]');
                if (firstReply !== null) {
                    setRovingTabindex(firstReply);
                    firstReply.focus();
                }
            }
        }
        else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            if (item.getAttribute('aria-expanded') === 'true' && !item.classList.contains('folded')) {
                const railBtn = item.querySelector('.fold-btn');
                railBtn?.click();
            }
            else {
                // Move to the parent treeitem.
                let parent = item.parentElement;
                while (parent !== null && parent.getAttribute('role') !== 'treeitem')
                    parent = parent.parentElement;
                parent?.focus();
            }
        }
    });
    // The fold rail button.
    if (hasReplies) {
        const rail = el('span', { class: 'rail-line', 'aria-hidden': 'true' });
        const railBtn = el('button', { class: 'fold-btn', type: 'button', 'aria-label': `Fold replies to ${c.author?.username ?? 'unknown'}` });
        item.append(rail, railBtn);
        railBtn.addEventListener('click', () => {
            const repliesHost = item.querySelector('[data-replies]');
            if (repliesHost === null)
                return;
            if (item.classList.contains('folded')) {
                const pillBtn = item.querySelector('.fold-pill');
                if (pillBtn !== null)
                    unfold(item, repliesHost, c, pillBtn);
            }
            else {
                applyFold(item, repliesHost, c);
                const pillBtn = item.querySelector('.fold-pill');
                pillBtn?.focus();
            }
        });
    }
    return { root: item };
}
/* The whole page reloads its tree after a reply (simplest correct approach
   for counts and ordering). */
async function reloadTreeFromOutside() {
    window.location.reload();
}
/* Edit a comment inside its edit window. */
function openEditComment(c) {
    void (async () => {
        const { openDialog } = await import('../ui.js');
        const ta = el('textarea', { class: 'textarea', 'aria-label': 'Body' });
        const errEl = el('p', {});
        openDialog({
            title: 'Edit comment',
            fields: () => [ta, errEl],
            actions: (close) => {
                const save = el('button', { class: 'btn primary', type: 'button' }, 'Save');
                const cancel = el('button', { class: 'btn', type: 'button' }, 'Cancel');
                cancel.addEventListener('click', close);
                save.addEventListener('click', () => {
                    void (async () => {
                        save.textContent = 'Saving...';
                        try {
                            await api(`/api/comments/${c.id}`, { method: 'PATCH', body: JSON.stringify({ bodyMd: ta.value }) });
                            announce('Comment updated');
                            close();
                            window.location.reload();
                        }
                        catch (err) {
                            save.textContent = 'Save';
                            const message = err instanceof Error && 'fields' in err ? Object.values(err.fields)[0] ?? '' : 'The edit window has closed';
                            errEl.replaceChildren(el('span', { class: 'field-error' }, message));
                        }
                    })();
                });
                return [cancel, save];
            },
        });
    })();
}
function confirmDeleteComment(c) {
    alertdialog({
        title: 'Delete comment',
        message: 'Delete this comment?',
        confirmLabel: 'Delete',
        confirm: async () => {
            await api(`/api/comments/${c.id}`, { method: 'DELETE' });
            announce('Comment deleted');
            window.location.reload();
        },
    });
}
/* The image gallery: one image at a time, arrows and swipe, spoiler blur. */
function gallery(post) {
    let index = 0;
    let revealed = false;
    const img = el('img', { src: post.images[0]?.src ?? '', alt: '', srcset: post.images[0]?.srcset ?? '', sizes: '(min-width: 768px) 640px, 92vw' });
    const counter = el('span', { class: 'gallery-counter', id: 'gallery-counter' });
    const region = el('div', { class: 'gallery', role: 'region', 'aria-label': 'Images', tabindex: '0' }, img);
    const cover = el('div', { class: 'gallery-cover' });
    const revealBtn = el('button', { class: 'btn', type: 'button' }, 'Show spoiler');
    const render = () => {
        const image = post.images[index];
        if (image === undefined)
            return;
        img.setAttribute('src', image.src);
        img.setAttribute('srcset', image.srcset);
        img.setAttribute('alt', image.alt ?? `Image ${index + 1} of ${post.images.length} posted by ${post.author?.username ?? 'unknown'}`);
        counter.textContent = `Image ${index + 1} of ${post.images.length}`;
        const blurred = post.spoiler && !revealed;
        region.classList.toggle('blurred', blurred);
        if (blurred) {
            region.append(cover);
            cover.append(revealBtn);
        }
        else
            cover.remove();
    };
    const prev = el('button', { class: 'btn', type: 'button', 'aria-label': 'Previous image' }, '←');
    const next = el('button', { class: 'btn', type: 'button', 'aria-label': 'Next image' }, '→');
    prev.addEventListener('click', () => { index = (index - 1 + post.images.length) % post.images.length; render(); });
    next.addEventListener('click', () => { index = (index + 1) % post.images.length; render(); });
    revealBtn.addEventListener('click', () => { revealed = true; render(); });
    region.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') {
            e.preventDefault();
            next.click();
        }
        else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            prev.click();
        }
    });
    // Swipe: a horizontal move across more than a quarter of the width.
    let startX = null;
    region.addEventListener('touchstart', (e) => { startX = e.touches[0]?.clientX ?? null; }, { passive: true });
    region.addEventListener('touchend', (e) => {
        if (startX === null)
            return;
        const endX = e.changedTouches[0]?.clientX ?? startX;
        const width = region.getBoundingClientRect().width;
        if (Math.abs(endX - startX) > width / 4) {
            if (endX < startX)
                next.click();
            else
                prev.click();
        }
        startX = null;
    }, { passive: true });
    render();
    return el('section', {}, region, el('div', { class: 'gallery-nav' }, prev, counter, next));
}
/* The moderator actions menu: Remove, Restore, Lock, Unlock, Pin, Unpin. */
function moderatorMenu(post, me, community) {
    const refresh = async () => {
        const fresh = await api(`/api/posts/${post.id}`);
        const headerEl = document.querySelector('.post-head');
        if (headerEl !== null) {
            window.location.reload();
            void headerEl;
        }
        void fresh;
    };
    const items = [
        { label: 'Remove post', show: post.state === 'published', onPick: () => removalDialog(post, community, 'post') },
        { label: 'Restore post', show: post.state === 'removed', onPick: () => { void moderatorAction(post, `/api/posts/${post.id}/removal`, 'DELETE', { version: post.version }).then(refresh); } },
        { label: 'Lock thread', show: post.state === 'published' && !post.locked, onPick: () => lockDialog(post, community) },
        { label: 'Unlock thread', show: post.locked, onPick: () => { void moderatorAction(post, `/api/posts/${post.id}/lock`, 'DELETE', { version: post.version }).then(refresh); } },
        { label: 'Pin post', show: post.state === 'published' && !post.pinned, onPick: () => { void pinFlow(post, refresh); } },
        { label: 'Unpin post', show: post.pinned, onPick: () => { void moderatorAction(post, `/api/posts/${post.id}/pin`, 'DELETE', { version: post.version }).then(refresh); } },
    ];
    return menuButton('Moderator actions', items);
}
async function moderatorAction(post, url, method, body, fallbackMessage) {
    void post;
    try {
        await api(url, { method, body: JSON.stringify(body) });
    }
    catch (err) {
        if (err instanceof Error && 'code' in err) {
            const code = err.code;
            if (code === 'SLOT_TAKEN')
                return; // handled by the caller
            announce(fallbackMessage ?? copy.anotherModActed, true);
        }
    }
}
/* Remove post / comment dialog with the rule radios. */
function removalDialog(post, community, kind, commentId) {
    const publicNote = el('input', { class: 'input', type: 'text', 'aria-label': 'Public note' });
    const privateNote = el('input', { class: 'input', type: 'text', 'aria-label': 'Private note (moderators only)' });
    const errEl = el('p', {});
    const open = openDialog({
        title: kind === 'post' ? 'Remove post' : 'Remove comment',
        fields: () => {
            const group = el('div', { class: 'field', role: 'radiogroup', 'aria-label': 'Reason' });
            community.rules.forEach((r) => {
                const input = el('input', { type: 'radio', name: 'remove-reason', id: `rule-${r.id}`, value: `rule:${r.id}` });
                group.append(el('label', { class: 'radio-opt', for: `rule-${r.id}` }, input, r.title));
            });
            const spam = el('input', { type: 'radio', name: 'remove-reason', id: 'rule-spam', value: 'spam' });
            group.append(el('label', { class: 'radio-opt', for: 'rule-spam' }, spam, 'Spam'));
            const other = el('input', { type: 'radio', name: 'remove-reason', id: 'rule-other', value: 'other' });
            group.append(el('label', { class: 'radio-opt', for: 'rule-other' }, other, 'Other'));
            return [group, errEl, publicNote, privateNote];
        },
        actions: (close) => {
            const remove = el('button', { class: 'btn primary', type: 'button' }, 'Remove');
            const cancel = el('button', { class: 'btn', type: 'button' }, 'Cancel');
            cancel.addEventListener('click', close);
            remove.addEventListener('click', () => {
                void (async () => {
                    const dialogEl = remove.closest('.dialog');
                    const picked = dialogEl?.querySelector('input[name="remove-reason"]:checked');
                    if (picked === null || picked === undefined) {
                        errEl.replaceChildren(el('span', { class: 'field-error' }, 'Choose a reason'));
                        return;
                    }
                    const value = picked.value;
                    const body = { version: post.version, reason: value.split(':')[0] };
                    if (value.startsWith('rule:'))
                        body.ruleId = Number(value.split(':')[1]);
                    if (value === 'other') {
                        const note = publicNote.value.trim();
                        if (note === '') {
                            errEl.replaceChildren(el('span', { class: 'field-error' }, 'Add a public note for Other'));
                            return;
                        }
                        body.publicNote = note;
                    }
                    if (privateNote.value !== '')
                        body.privateNote = privateNote.value;
                    const url = kind === 'post' ? `/api/posts/${post.id}/removal` : `/api/comments/${commentId}/removal`;
                    try {
                        await api(url, { method: 'POST', body: JSON.stringify(body) });
                        announce(kind === 'post' ? 'Post removed' : 'Comment removed');
                        close();
                        window.location.reload();
                    }
                    catch (err) {
                        if (err instanceof Error && 'fields' in err) {
                            const fields = err.fields;
                            for (const message of Object.values(fields))
                                errEl.replaceChildren(el('span', { class: 'field-error' }, message));
                        }
                        else {
                            errEl.replaceChildren(el('span', { class: 'field-error' }, copy.anotherModActed));
                        }
                    }
                })();
            });
            return [cancel, remove];
        },
    });
    void open;
}
/* Lock thread dialog with duration radios. */
function lockDialog(post, community) {
    const errEl = el('p', {});
    openDialog({
        title: 'Lock thread',
        fields: () => {
            const group = el('div', { class: 'field', role: 'radiogroup', 'aria-label': 'Duration' });
            const options = [['indefinite', 'Until unlocked'], ['1h', '1 hour'], ['24h', '24 hours'], ['7d', '7 days']];
            for (const [value, label] of options) {
                const input = el('input', { type: 'radio', name: 'lock-duration', id: `lock-${value}`, value });
                group.append(el('label', { class: 'radio-opt', for: `lock-${value}` }, input, label));
            }
            return [group, errEl];
        },
        actions: (close) => {
            const lock = el('button', { class: 'btn primary', type: 'button' }, 'Lock');
            const cancel = el('button', { class: 'btn', type: 'button' }, 'Cancel');
            cancel.addEventListener('click', close);
            lock.addEventListener('click', () => {
                void (async () => {
                    const dialogEl = lock.closest('.dialog');
                    const picked = dialogEl?.querySelector('input[name="lock-duration"]:checked');
                    if (picked === null || picked === undefined)
                        return;
                    try {
                        await api(`/api/posts/${post.id}/lock`, { method: 'POST', body: JSON.stringify({ version: post.version, duration: picked.value }) });
                        announce('Thread locked');
                        close();
                        window.location.reload();
                    }
                    catch {
                        errEl.replaceChildren(el('span', { class: 'field-error' }, copy.anotherModActed));
                    }
                })();
            });
            return [cancel, lock];
        },
    });
    void community;
}
/* Pin flow: on SLOT_TAKEN, open the "Replace a pin" dialog. */
async function pinFlow(post, refresh) {
    try {
        await api(`/api/posts/${post.id}/pin`, { method: 'POST', body: JSON.stringify({ version: post.version }) });
        announce('Post pinned');
        await refresh();
    }
    catch (err) {
        if (err instanceof Error && 'code' in err && err.code === 'SLOT_TAKEN') {
            const current = err.current;
            const pins = current?.pinned ?? [];
            openDialog({
                title: 'Replace a pin',
                fields: () => {
                    const group = el('div', { class: 'field', role: 'radiogroup', 'aria-label': 'Pinned post to replace' });
                    for (const pin of pins) {
                        const input = el('input', { type: 'radio', name: 'replace-pin', id: `pin-${pin.id}`, value: String(pin.id) });
                        group.append(el('label', { class: 'radio-opt', for: `pin-${pin.id}` }, input, pin.title));
                    }
                    return [group];
                },
                actions: (close) => {
                    const replace = el('button', { class: 'btn primary', type: 'button' }, 'Replace pin');
                    const cancel = el('button', { class: 'btn', type: 'button' }, 'Cancel');
                    cancel.addEventListener('click', close);
                    replace.addEventListener('click', () => {
                        void (async () => {
                            const dialogEl = replace.closest('.dialog');
                            const picked = dialogEl?.querySelector('input[name="replace-pin"]:checked');
                            if (picked === null || picked === undefined)
                                return;
                            try {
                                await api(`/api/posts/${post.id}/pin`, { method: 'POST', body: JSON.stringify({ version: post.version, replacePostId: Number(picked.value) }) });
                                announce('Post pinned');
                                close();
                                await refresh();
                            }
                            catch {
                                announce(copy.anotherModActed, true);
                            }
                        })();
                    });
                    return [cancel, replace];
                },
            });
        }
        else {
            announce(copy.anotherModActed, true);
        }
    }
}
