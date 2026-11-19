import { copy } from '../shared/copy.js';
import { countLabel } from '../shared/format.js';
import { commentTreeMarkup } from '../shared/render.js';
import type { CommentView } from '../shared/types.js';
import { newIdempotencyKey, request } from './api.js';
import { announce, displayDepth, on, parseFragment, qs, qsa, setFieldError } from './dom.js';
import { foldSequence, glowRail, growIn } from './motion.js';
import { page } from './state.js';
import { initVotes } from './votes.js';

function tree(): HTMLElement | null {
  return qs<HTMLElement>('[data-comment-tree]');
}

function items(): HTMLElement[] {
  return qsa<HTMLElement>('[data-comment]').filter((item) => item.offsetParent !== null);
}

function foldedIds(): string[] {
  return qsa<HTMLElement>('[data-comment].is-folded').map((item) => item.dataset.commentId ?? '');
}

/** Every fold and unfold rewrites ?fold= without adding a history entry. */
function writeFoldParameter(): void {
  const url = new URL(window.location.href);
  const folded = foldedIds().filter((id) => id !== '');
  if (folded.length === 0) url.searchParams.delete('fold');
  else url.searchParams.set('fold', folded.join(','));
  window.history.replaceState({}, '', url);
}

function pillLabel(item: HTMLElement): string {
  const count = Number(item.dataset.descendants ?? '0');
  return countLabel(count, 'reply folded', 'replies folded');
}

/** The comment's own body, pill and rail, never those of a comment nested inside it. */
function parts(item: HTMLElement): { content: HTMLElement | null; pill: HTMLElement | null; rail: HTMLElement | null } {
  return {
    content: qs<HTMLElement>(':scope > .comment-row > .comment-main > .comment-content', item),
    pill: qs<HTMLElement>(':scope > .comment-row > .comment-main > [data-fold-pill]', item),
    rail: qs<HTMLElement>(':scope > .comment-row > [data-fold-rail]', item),
  };
}

function refreshPill(item: HTMLElement): void {
  const pill = parts(item).pill;
  if (!pill) return;
  pill.innerHTML = `<span aria-hidden="true">▶</span> ${pillLabel(item)}`;
}

export function setFolded(item: HTMLElement, folded: boolean, moveFocus: boolean): void {
  const { content, pill, rail } = parts(item);
  if (!content || !pill) return;

  item.classList.toggle('is-folded', folded);
  item.setAttribute('aria-expanded', folded ? 'false' : 'true');
  refreshPill(item);

  if (folded) {
    content.setAttribute('inert', '');
    pill.hidden = false;
  } else {
    content.removeAttribute('inert');
  }

  foldSequence({ content, rail, pill }, folded);
  writeFoldParameter();

  if (!moveFocus) return;
  if (folded) {
    focusItem(item);
    pill.focus();
  } else {
    rail?.focus();
  }
}

/** Controls that belong to this comment rather than to a comment nested inside it. */
function ownControls(item: HTMLElement): HTMLElement[] {
  return qsa<HTMLElement>('button, a[href], textarea, input, select', item).filter(
    (control) => control.closest('[data-comment]') === item,
  );
}

/** Roving tabindex: one treeitem is tabbable, and only its own controls are in the Tab sequence. */
function focusItem(item: HTMLElement): void {
  for (const candidate of qsa<HTMLElement>('[data-comment]')) {
    candidate.tabIndex = candidate === item ? 0 : -1;
    for (const control of ownControls(candidate)) {
      if (candidate === item) control.removeAttribute('tabindex');
      else control.tabIndex = -1;
    }
  }
}

function parentItem(item: HTMLElement): HTMLElement | null {
  return item.parentElement?.closest<HTMLElement>('[data-comment]') ?? null;
}

function firstReply(item: HTMLElement): HTMLElement | null {
  return qs<HTMLElement>(':scope > .comment-row > .comment-main > .comment-content > .comment-group > [data-comment]', item);
}

/** The tree view pattern with roving tabindex. */
function initTreeKeys(): void {
  const root = tree();
  if (!root) return;

  on(root, 'keydown', (event) => {
    const keyboard = event as KeyboardEvent;
    const target = keyboard.target as HTMLElement | null;
    if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return;
    const item = target?.closest<HTMLElement>('[data-comment]');
    if (!item) return;

    const visible = items();
    const index = visible.indexOf(item);
    const move = (next: HTMLElement | null | undefined) => {
      if (!next) return;
      keyboard.preventDefault();
      focusItem(next);
      next.focus();
    };

    switch (keyboard.key) {
      case 'ArrowDown':
        move(visible[index + 1]);
        break;
      case 'ArrowUp':
        move(visible[index - 1]);
        break;
      case 'Home':
        move(visible[0]);
        break;
      case 'End':
        move(visible[visible.length - 1]);
        break;
      case 'ArrowRight': {
        if (item.classList.contains('is-folded')) {
          keyboard.preventDefault();
          setFolded(item, false, false);
          focusItem(item);
          item.focus();
          break;
        }
        move(firstReply(item));
        break;
      }
      case 'ArrowLeft': {
        if (!item.classList.contains('is-folded') && firstReply(item)) {
          keyboard.preventDefault();
          setFolded(item, true, true);
          break;
        }
        move(parentItem(item));
        break;
      }
      default:
        break;
    }
  });

  on(root, 'click', (event) => {
    const target = event.target as HTMLElement | null;
    const rail = target?.closest<HTMLElement>('[data-fold-rail]');
    if (rail) {
      const item = rail.closest<HTMLElement>('[data-comment]');
      if (item) setFolded(item, true, true);
      return;
    }
    const pill = target?.closest<HTMLElement>('[data-fold-pill]');
    if (pill) {
      const item = pill.closest<HTMLElement>('[data-comment]');
      if (item) setFolded(item, false, true);
      return;
    }
    const item = target?.closest<HTMLElement>('[data-comment]');
    if (item && !target?.closest('button, a, textarea, input')) focusItem(item);
  });
}

function renderTree(comments: CommentView[], folded: Set<string>): void {
  const root = tree();
  if (!root || !page.post || !page.community) return;
  const markup = commentTreeMarkup(comments, {
    displayDepth: displayDepth(),
    folded,
    postUrl: page.post.url,
    communityName: page.community.name,
    isModerator: page.community.viewer.isModerator,
    viewerUsername: page.account ? page.account.username : null,
    locked: page.post.locked,
    archived: page.post.archived,
  }).value;
  const fragment = parseFragment(markup);
  const replacement = fragment.firstElementChild;
  if (replacement) root.replaceWith(replacement);
  const fresh = tree();
  if (fresh) {
    const first = qs<HTMLElement>('[data-comment]', fresh);
    if (first) focusItem(first);
    for (const item of qsa<HTMLElement>('[data-comment].is-folded', fresh)) {
      parts(item).content?.setAttribute('inert', '');
    }
  }
  initTreeKeys();
}

async function reloadTree(sort: string): Promise<void> {
  if (!page.post) return;
  const depth = displayDepth();
  const path = page.rootCommentId
    ? `/api/comments/${page.rootCommentId}/thread?sort=${sort}&depth=${depth}`
    : `/api/posts/${page.post.id}/comments?sort=${sort}&depth=${depth}`;
  const result = await request<{ tree: CommentView[]; more: string[] }>(path);
  if (!result.ok || !result.data) return;
  page.comments = result.data.tree;
  renderTree(result.data.tree, new Set(foldedIds()));
}

function initCommentSortTabs(): void {
  const tablist = qs('[data-comment-sort]');
  if (!tablist) return;
  const tabs = qsa<HTMLElement>('[role="tab"]', tablist);
  const select = (tab: HTMLElement) => {
    for (const candidate of tabs) {
      const selected = candidate === tab;
      candidate.setAttribute('aria-selected', selected ? 'true' : 'false');
      candidate.tabIndex = selected ? 0 : -1;
    }
    tab.focus();
    void reloadTree(tab.dataset.commentSortValue ?? 'top');
  };
  for (const tab of tabs) on(tab, 'click', () => select(tab));
  on(tablist, 'keydown', (event) => {
    const keyboard = event as KeyboardEvent;
    const index = tabs.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    if (keyboard.key === 'ArrowRight' || keyboard.key === 'ArrowLeft') {
      keyboard.preventDefault();
      select(tabs[(index + (keyboard.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]);
    } else if (keyboard.key === 'Home') {
      keyboard.preventDefault();
      select(tabs[0]);
    } else if (keyboard.key === 'End') {
      keyboard.preventDefault();
      select(tabs[tabs.length - 1]);
    }
  });
}

function commentMarkupFor(comment: CommentView, level: number): string {
  if (!page.post || !page.community) return '';
  return commentTreeMarkup([comment], {
    displayDepth: displayDepth(),
    folded: new Set(),
    postUrl: page.post.url,
    communityName: page.community.name,
    isModerator: page.community.viewer.isModerator,
    viewerUsername: page.account ? page.account.username : null,
    locked: page.post.locked,
    archived: page.post.archived,
    baseLevel: level,
  }).value;
}

function groupFor(parent: HTMLElement): HTMLElement {
  const content = parts(parent).content;
  let group = qs<HTMLElement>(':scope > .comment-group', content ?? parent);
  if (!group) {
    group = document.createElement('ul');
    group.setAttribute('role', 'group');
    group.className = 'comment-group';
    content?.append(group);
  }
  return group;
}

/** Inserts a comment under its parent, or ticks a folded pill's count instead. */
export function insertComment(comment: CommentView, parentId: string | null, own: boolean): void {
  const root = tree();
  if (!root) return;
  if (qs(`#comment-${comment.id}`)) return;

  if (parentId === null) {
    const markup = commentMarkupFor(comment, 1);
    const fragment = parseFragment(markup);
    const item = fragment.firstElementChild?.firstElementChild as HTMLElement | null;
    if (!item) return;
    root.append(item);
    item.tabIndex = -1;
    for (const control of ownControls(item)) control.tabIndex = -1;
    growIn(item);
    initVotes(item);
    return;
  }

  const parent = qs<HTMLElement>(`#comment-${parentId}`);
  if (!parent) return;

  for (let ancestor: HTMLElement | null = parent; ancestor; ancestor = parentItem(ancestor)) {
    ancestor.dataset.descendants = String(Number(ancestor.dataset.descendants ?? '0') + 1);
    if (ancestor.classList.contains('is-folded')) {
      refreshPill(ancestor);
      if (!own) announce(copy.comment.liveReply(comment.author?.username ?? 'a member'));
      return;
    }
  }

  const level = Number(parent.dataset.depth ?? '1') + 1;
  if (level > displayDepth()) {
    parent.setAttribute('aria-expanded', 'true');
    refreshPill(parent);
    if (!own) announce(copy.comment.liveReply(comment.author?.username ?? 'a member'));
    return;
  }

  const group = groupFor(parent);
  const markup = commentMarkupFor(comment, level);
  const fragment = parseFragment(markup);
  const item = fragment.firstElementChild?.firstElementChild as HTMLElement | null;
  if (!item) return;
  group.append(item);
  item.tabIndex = -1;
  for (const control of ownControls(item)) control.tabIndex = -1;
  parent.setAttribute('aria-expanded', 'true');
  growIn(item);
  glowRail(parent);
  initVotes(item);
  if (own) {
    focusItem(item);
    item.classList.add('is-highlighted');
    item.focus();
  }
}

function closeReplyBox(box: HTMLElement, returnTo: HTMLElement | null): void {
  box.remove();
  returnTo?.focus();
}

async function postReply(parentId: string | null, bodyMd: string, key: string): Promise<CommentView | null> {
  if (!page.post) return null;
  const result = await request<{ comment: CommentView; commentCount: number }>(
    `/api/posts/${page.post.id}/comments`,
    { method: 'POST', body: { bodyMd, parentId }, headers: { 'Idempotency-Key': key } },
  );
  if (result.ok && result.data) {
    announce(copy.comment.posted);
    for (const element of qsa(`#comments-post-${page.post.id}`)) {
      element.textContent = countLabel(result.data.commentCount, 'comment', 'comments');
    }
    return result.data.comment;
  }
  if (result.error?.code === 'LOCKED') announce(copy.fixed.lockBanner);
  else if (result.error?.code === 'ARCHIVED') announce(copy.fixed.archived);
  else if (result.error?.fields?.bodyMd) announce(result.error.fields.bodyMd);
  else announce(result.error?.message ?? copy.comment.bodyInvalid);
  return null;
}

function initReplies(): void {
  on(document, 'click', (event) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest<HTMLElement>('[data-reply-to]');
    if (!button) return;
    const parentId = button.dataset.replyTo ?? null;
    const item = button.closest<HTMLElement>('[data-comment]');
    const author = item?.dataset.author ?? 'this comment';
    if (qs(`[data-reply-box="${parentId}"]`)) return;

    const box = document.createElement('form');
    box.className = 'reply-box';
    box.setAttribute('data-reply-box', parentId ?? '');
    box.innerHTML = `
      <label for="reply-${parentId}">Reply to ${author}</label>
      <textarea id="reply-${parentId}" rows="3"></textarea>
      <div class="reply-actions">
        <button type="submit" data-reply-submit>Post reply</button>
        <button type="button" data-reply-cancel>Cancel</button>
      </div>`;
    button.insertAdjacentElement('afterend', box);
    const field = qs<HTMLTextAreaElement>('textarea', box);
    field?.focus();
    const key = newIdempotencyKey();

    on(box, 'keydown', (event2) => {
      if ((event2 as KeyboardEvent).key === 'Escape') {
        event2.preventDefault();
        closeReplyBox(box, button);
      }
    });
    qs('[data-reply-cancel]', box)?.addEventListener('click', () => closeReplyBox(box, button));

    on(box, 'submit', (event2) => {
      event2.preventDefault();
      const value = field?.value.trim() ?? '';
      if (value === '') {
        announce(copy.comment.bodyInvalid);
        field?.focus();
        return;
      }
      const submit = qs<HTMLButtonElement>('[data-reply-submit]', box);
      if (submit) submit.textContent = copy.comment.pending;
      void postReply(parentId, value, key).then((comment) => {
        if (submit) submit.textContent = 'Post reply';
        if (!comment) return;
        box.remove();
        const level = Number(item?.dataset.depth ?? '0') + 1;
        if (level > displayDepth() && page.post && page.community) {
          const target2 = `${page.post.url}/comment/${parentId}?focus=${comment.id}`;
          window.location.assign(target2);
          return;
        }
        insertComment(comment, parentId, true);
      });
    });
  });
}

function initTopLevelComposer(): void {
  const form = qs<HTMLFormElement>('[data-comment-composer]');
  if (!form) return;
  const field = qs<HTMLTextAreaElement>('textarea', form);
  const submit = qs<HTMLButtonElement>('[data-submit]', form);
  let key = newIdempotencyKey();
  on(form, 'submit', (event) => {
    event.preventDefault();
    const value = field?.value.trim() ?? '';
    if (value === '') {
      setFieldError(field, copy.comment.bodyInvalid);
      field?.focus();
      return;
    }
    setFieldError(field, null);
    if (submit) submit.textContent = copy.comment.pending;
    void postReply(null, value, key).then((comment) => {
      if (submit) submit.textContent = 'Comment';
      if (!comment) return;
      if (field) field.value = '';
      key = newIdempotencyKey();
      insertComment(comment, null, true);
    });
  });
}

/** ?fold= restores folds, and ?focus= highlights a reply that landed on a continue page. */
function applyUrlState(): void {
  const url = new URL(window.location.href);
  const folded = (url.searchParams.get('fold') ?? '').split(',').filter((id) => id !== '');
  for (const id of folded) {
    const item = qs<HTMLElement>(`#comment-${id}`);
    if (item) setFolded(item, true, false);
  }
  const focus = url.searchParams.get('focus');
  if (focus) {
    const item = qs<HTMLElement>(`#comment-${focus}`);
    if (item) {
      focusItem(item);
      item.classList.add('is-highlighted');
      item.focus();
      growIn(item);
      const parent = parentItem(item);
      if (parent) glowRail(parent);
    }
  }
}

export function initComments(): void {
  if (!page.post) return;
  renderTree(page.comments ?? [], new Set());
  initCommentSortTabs();
  initReplies();
  initTopLevelComposer();
  applyUrlState();
}
