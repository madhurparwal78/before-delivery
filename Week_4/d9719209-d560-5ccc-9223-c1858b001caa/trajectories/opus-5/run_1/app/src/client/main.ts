import { copy } from '../shared/copy.js';
import { countLabel } from '../shared/format.js';
import type { CommentView } from '../shared/types.js';
import { request } from './api.js';
import { initAccount } from './account.js';
import { initAdmin } from './admin.js';
import { initComments, insertComment } from './comments.js';
import { initComposer } from './composer.js';
import { initCreateCommunity } from './community.js';
import { initFeed, removeCard } from './feed.js';
import { initGallery } from './gallery.js';
import { alertAnnounce, announce, on, qs, qsa, setPressed } from './dom.js';
import { startLive } from './live.js';
import { commentModerationItems, dropModeratorTools, moderatorMenuItems } from './moderation.js';
import { initModTools } from './modtools.js';
import { initMenuButtons, openDialog, type MenuItem } from './overlays.js';
import { openReportDialog } from './reports.js';
import { page } from './state.js';
import { applyScore, initVotes } from './votes.js';

function initDrawer(): void {
  const toggle = qs<HTMLElement>('[data-drawer-toggle]');
  const drawer = qs<HTMLElement>('[data-drawer]');
  if (!toggle || !drawer) return;

  const setOpen = (open: boolean) => {
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    drawer.hidden = !open;
    if (open) drawer.removeAttribute('inert');
    else drawer.setAttribute('inert', '');
    drawer.classList.toggle('is-open', open);
  };

  const applyViewport = () => {
    if (window.innerWidth >= 768) {
      drawer.hidden = false;
      drawer.removeAttribute('inert');
      drawer.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    } else if (!drawer.classList.contains('is-open')) {
      setOpen(false);
    }
  };

  applyViewport();
  on(window, 'resize', applyViewport);
  on(toggle, 'click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  on(document, 'keydown', (event) => {
    if ((event as KeyboardEvent).key !== 'Escape') return;
    if (!drawer.classList.contains('is-open')) return;
    setOpen(false);
    toggle.focus();
  });
}

function applyMemberCount(name: string, count: number): void {
  for (const element of qsa(`#members-${name}`)) {
    element.textContent = countLabel(count, 'member', 'members');
  }
}

function initJoinButtons(): void {
  on(document, 'click', (event) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest<HTMLElement>('[data-join]');
    if (!button) return;
    const name = button.dataset.join ?? '';
    const joined = button.getAttribute('aria-pressed') === 'true';
    void request<{ joined: boolean; memberCount: number }>(`/api/communities/${name}/membership`, {
      method: joined ? 'DELETE' : 'PUT',
    }).then((result) => {
      if (!result.ok || !result.data) {
        if (result.error?.code === 'UNAUTHENTICATED') announce(copy.vote.signedOut);
        else alertAnnounce(result.error?.message ?? 'That did not work');
        return;
      }
      setPressed(button, result.data.joined);
      button.textContent = result.data.joined ? 'Joined' : 'Join';
      applyMemberCount(name, result.data.memberCount);
    });
  });
}

/** Inline spoilers in a body reveal on click or Enter. */
function initSpoilerReveal(): void {
  for (const spoiler of qsa<HTMLElement>('.spoiler')) {
    spoiler.tabIndex = 0;
    const reveal = () => spoiler.classList.add('is-revealed');
    on(spoiler, 'click', reveal);
    on(spoiler, 'keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') reveal();
    });
  }
}

function flatten(comment: CommentView): CommentView[] {
  return [comment, ...comment.replies.flatMap(flatten)];
}

function startPostEdit(): void {
  const post = page.post;
  const body = qs<HTMLElement>('[data-post-body]');
  if (!post || !body) return;
  const form = document.createElement('form');
  form.className = 'post-edit';
  form.innerHTML = `
    <p class="settings-note">${copy.post.titleNote}</p>
    <label for="edit-body">Body</label>
    <textarea id="edit-body" rows="8"></textarea>
    <div class="dialog-actions">
      <button type="submit" data-save>Save</button>
      <button type="button" data-cancel>Cancel</button>
    </div>`;
  body.replaceChildren(form);
  const field = qs<HTMLTextAreaElement>('#edit-body', form);
  if (field) {
    field.value = post.bodyMd ?? '';
    field.focus();
  }
  qs('[data-cancel]', form)?.addEventListener('click', () => window.location.reload());
  on(form, 'submit', (event) => {
    event.preventDefault();
    const save = qs<HTMLButtonElement>('[data-save]', form);
    if (save) save.textContent = copy.post.editPending;
    void request(`/api/posts/${post.id}`, { method: 'PATCH', body: { bodyMd: field?.value ?? '' } }).then(
      (result) => {
        if (result.ok) {
          announce(copy.post.updated);
          window.location.reload();
          return;
        }
        if (save) save.textContent = 'Save';
        alertAnnounce(result.error?.fields?.bodyMd ?? result.error?.message ?? copy.post.bodyInvalid);
      },
    );
  });
}

function confirmDeletePost(opener: HTMLElement): void {
  const post = page.post;
  if (!post) return;
  const dialog = openDialog({
    title: 'Delete post',
    alert: true,
    opener,
    body: `<p>This leaves a placeholder and keeps the comments.</p>
      <div class="dialog-actions">
        <button type="button" data-confirm>Delete</button>
        <button type="button" data-dialog-cancel>Cancel</button>
      </div>`,
  });
  qs('[data-confirm]', dialog.element)?.addEventListener('click', () => {
    void request(`/api/posts/${post.id}`, { method: 'DELETE' }).then((result) => {
      dialog.close();
      if (result.ok) {
        announce(copy.post.deleted);
        window.location.reload();
      } else {
        alertAnnounce(result.error?.message ?? 'That did not work');
      }
    });
  });
}

function startCommentEdit(commentId: string): void {
  const item = qs<HTMLElement>(`#comment-${commentId}`);
  const text = item ? qs<HTMLElement>('.comment-text', item) : null;
  if (!item || !text) return;
  const source = (page.comments ?? []).flatMap(flatten).find((comment) => comment.id === commentId);
  const form = document.createElement('form');
  form.className = 'comment-edit';
  form.innerHTML = `
    <label for="edit-comment-${commentId}">Body</label>
    <textarea id="edit-comment-${commentId}" rows="4"></textarea>
    <div class="dialog-actions">
      <button type="submit" data-save>Save</button>
      <button type="button" data-cancel>Cancel</button>
    </div>`;
  text.replaceWith(form);
  const field = qs<HTMLTextAreaElement>('textarea', form);
  if (field) {
    field.value = source?.bodyMd ?? '';
    field.focus();
  }
  qs('[data-cancel]', form)?.addEventListener('click', () => window.location.reload());
  on(form, 'submit', (event) => {
    event.preventDefault();
    void request(`/api/comments/${commentId}`, { method: 'PATCH', body: { bodyMd: field?.value ?? '' } }).then(
      (result) => {
        if (result.ok) {
          announce(copy.comment.updated);
          window.location.reload();
          return;
        }
        alertAnnounce(
          result.error?.code === 'CONFLICT'
            ? copy.comment.editWindowClosed
            : result.error?.fields?.bodyMd ?? copy.comment.bodyInvalid,
        );
      },
    );
  });
}

function confirmDeleteComment(commentId: string, opener: HTMLElement): void {
  const dialog = openDialog({
    title: 'Delete comment',
    alert: true,
    opener,
    body: `<p>Replies below it stay in the thread.</p>
      <div class="dialog-actions">
        <button type="button" data-confirm>Delete</button>
        <button type="button" data-dialog-cancel>Cancel</button>
      </div>`,
  });
  qs('[data-confirm]', dialog.element)?.addEventListener('click', () => {
    void request(`/api/comments/${commentId}`, { method: 'DELETE' }).then((result) => {
      dialog.close();
      if (result.ok) {
        announce(copy.comment.deleted);
        window.location.reload();
      } else {
        alertAnnounce(result.error?.message ?? 'That did not work');
      }
    });
  });
}

function initPostMenus(): void {
  initMenuButtons((button): MenuItem[] => {
    const kind = button.dataset.menuButton;
    if (kind === 'moderator') return moderatorMenuItems(button);

    if (kind === 'comment') {
      const commentId = button.dataset.commentId ?? '';
      const item = button.closest<HTMLElement>('[data-comment]');
      const items: MenuItem[] = [
        {
          label: 'Report illegal content',
          run: () => openReportDialog({ type: 'comment', id: commentId }, button),
        },
      ];
      const own = item?.dataset.author === page.account?.username && item?.dataset.state === 'published';
      if (own && item?.dataset.canEdit === 'true') {
        items.push({ label: 'Edit comment', run: () => startCommentEdit(commentId) });
      }
      if (own) items.push({ label: 'Delete comment', run: () => confirmDeleteComment(commentId, button) });
      if (page.community?.viewer.isModerator) items.push(...commentModerationItems(commentId, button));
      return items;
    }

    const post = page.post;
    if (!post) return [];
    const items: MenuItem[] = [
      { label: 'Report illegal content', run: () => openReportDialog({ type: 'post', id: post.id }, button) },
    ];
    if (page.account && post.author && post.author.username === page.account.username) {
      items.push({ label: 'Edit post', run: () => startPostEdit() });
      items.push({ label: 'Delete post', run: () => confirmDeletePost(button) });
    }
    return items;
  });
}

/** A lock or unlock shows or hides the reply controls and the banner on the open page. */
function applyLockState(locked: boolean, lockedUntil: string | null): void {
  if (page.post) {
    page.post.locked = locked;
    page.post.lockedUntil = lockedUntil;
  }
  const existing = qs<HTMLElement>('[data-lock-banner]');
  if (locked) {
    for (const control of qsa<HTMLElement>('[data-comment-composer], [data-reply-to], .reply-box')) {
      control.hidden = true;
    }
    if (!existing) {
      const banner = document.createElement('div');
      banner.className = 'lock-banner';
      banner.setAttribute('data-lock-banner', '');
      banner.innerHTML = `<p>${copy.fixed.lockBanner}</p>${
        lockedUntil ? `<p>${copy.fixed.lockReopen(lockedUntil)}</p>` : ''
      }`;
      qs<HTMLElement>('[data-post-header]')?.insertAdjacentElement('afterend', banner);
    }
    announce(copy.moderation.locked);
    return;
  }
  existing?.remove();
  for (const control of qsa<HTMLElement>('[data-comment-composer], [data-reply-to]')) control.hidden = false;
  announce(copy.moderation.unlocked);
}

function startLiveUpdates(): void {
  startLive(page.topics, {
    score: (data) => applyScore(data.targetType, data.targetId, data.score),
    comments: (data) => {
      for (const element of qsa(`#comments-post-${data.postId}`)) {
        element.textContent = countLabel(data.commentCount, 'comment', 'comments');
      }
    },
    comment: (data) => {
      if (!page.post || data.postId !== page.post.id) return;
      const comment = data.comment as unknown as CommentView;
      if (page.account && comment.author?.username === page.account.username) return;
      insertComment(comment, data.parentId, false);
      announce(copy.comment.liveReply(comment.author?.username ?? 'a member'));
    },
    postState: (data) => {
      if (page.post && data.postId === page.post.id) {
        page.post.version = data.version;
        const header = qs<HTMLElement>('[data-post-header]');
        if (header) header.dataset.version = String(data.version);
        if (data.state !== page.post.state) {
          window.location.reload();
          return;
        }
        if (data.locked !== page.post.locked) applyLockState(data.locked, data.lockedUntil);
        if (data.pinned !== page.post.pinned) {
          page.post.pinned = data.pinned;
          announce(data.pinned ? copy.moderation.pinned : copy.moderation.unpinned);
        }
        return;
      }
      if (data.state === 'removed' || data.state === 'deleted') {
        removeCard(data.postId);
        return;
      }
      if (qs(`#post-${data.postId}`) === null && data.pinned) window.location.reload();
    },
    membership: (data) => applyMemberCount(data.communityName, data.memberCount),
    account: (data) => {
      if (data.kind === 'suspended') {
        alertAnnounce(copy.account.suspendedLive);
        page.account = null;
        window.setTimeout(() => window.location.assign('/login'), 400);
        return;
      }
      if (data.kind === 'moderator-removed') {
        dropModeratorTools();
        return;
      }
      if (data.kind === 'approved' && data.communityName) {
        if (page.community) page.community.viewer.canPost = true;
        const notice = qs<HTMLElement>('[data-restricted-notice]');
        if (notice) notice.hidden = true;
        for (const control of qsa<HTMLButtonElement>('[data-composer] [data-submit]')) control.disabled = false;
        announce(copy.moderation.approved(data.communityName));
        return;
      }
      if (data.kind === 'unapproved' && data.communityName) {
        if (page.community) page.community.viewer.canPost = false;
        const notice = qs<HTMLElement>('[data-restricted-notice]');
        if (notice) notice.hidden = false;
      }
    },
    resync: () => window.location.reload(),
  });
}

function start(): void {
  initDrawer();
  initVotes();
  initFeed();
  initGallery();
  initSpoilerReveal();
  initJoinButtons();
  initPostMenus();
  initComments();
  initComposer();
  initCreateCommunity();
  initModTools();
  initAccount();
  initAdmin();
  startLiveUpdates();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
