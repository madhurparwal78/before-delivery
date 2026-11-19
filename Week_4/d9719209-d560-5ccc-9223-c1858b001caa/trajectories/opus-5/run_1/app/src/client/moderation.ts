import { copy, LOCK_DURATIONS } from '../shared/copy.js';
import type { PostView } from '../shared/types.js';
import { request } from './api.js';
import { alertAnnounce, announce, qs, qsa } from './dom.js';
import { openDialog, radioGroup, selectedRadio } from './overlays.js';
import { page } from './state.js';
import type { MenuItem } from './overlays.js';

function currentPost(): PostView | null {
  return page.post ?? null;
}

function versionOf(): number {
  const header = qs<HTMLElement>('[data-post-header]');
  return Number(header?.dataset.version ?? page.post?.version ?? 1);
}

function setVersion(version: number): void {
  const header = qs<HTMLElement>('[data-post-header]');
  if (header) header.dataset.version = String(version);
  if (page.post) page.post.version = version;
}

function reasonOptions(): Array<{ value: string; label: string }> {
  const rules = page.community ? page.community.rules : [];
  return [
    ...rules.map((rule) => ({ value: `rule:${rule.id}`, label: rule.title })),
    { value: 'spam', label: 'Spam' },
    { value: 'other', label: 'Other' },
  ];
}

async function act(path: string, body: Record<string, unknown>, method = 'POST'): Promise<PostView | null> {
  const result = await request<PostView>(path, { method, body: { version: versionOf(), ...body } });
  if (result.ok && result.data) {
    setVersion(result.data.version);
    return result.data;
  }
  if (result.error?.code === 'CONFLICT' || result.error?.code === 'SLOT_TAKEN') {
    const current = result.error.current as { version?: number } | undefined;
    if (current?.version) setVersion(current.version);
    if (result.error.code === 'CONFLICT') {
      alertAnnounce(copy.moderation.raceLost);
      window.setTimeout(() => window.location.reload(), 150);
      return null;
    }
    return null;
  }
  alertAnnounce(result.error?.message ?? copy.vote.failed);
  return null;
}

function removalDialog(kind: 'post' | 'comment', targetId: string, opener: HTMLElement | null): void {
  const title = kind === 'post' ? 'Remove post' : 'Remove comment';
  const dialog = openDialog({
    title,
    opener,
    body: `
      ${radioGroup('reason', 'Reason', reasonOptions())}
      <div class="field">
        <label for="public-note">Public note</label>
        <input id="public-note" type="text" />
        <p class="field-error" id="public-note-error" hidden></p>
      </div>
      <div class="field">
        <label for="private-note">Private note (moderators only)</label>
        <textarea id="private-note" rows="3"></textarea>
      </div>
      <p class="field-error" id="reason-error" hidden></p>
      <div class="dialog-actions">
        <button type="button" data-confirm>Remove</button>
        <button type="button" data-dialog-cancel>Cancel</button>
      </div>`,
  });

  qs('[data-confirm]', dialog.element)?.addEventListener('click', () => {
    const choice = selectedRadio(dialog.element, 'reason');
    const reasonError = qs<HTMLElement>('#reason-error', dialog.element);
    const publicNote = qs<HTMLInputElement>('#public-note', dialog.element);
    const privateNote = qs<HTMLTextAreaElement>('#private-note', dialog.element);
    if (choice === null) {
      if (reasonError) {
        reasonError.textContent = copy.moderation.reasonRequired;
        reasonError.hidden = false;
      }
      announce(copy.moderation.reasonRequired);
      return;
    }
    if (choice === 'other' && (publicNote?.value.trim() ?? '') === '') {
      publicNote?.setAttribute('aria-invalid', 'true');
      const noteError = qs<HTMLElement>('#public-note-error', dialog.element);
      if (noteError) {
        noteError.textContent = copy.moderation.publicNoteRequired;
        noteError.hidden = false;
      }
      publicNote?.focus();
      return;
    }

    const body: Record<string, unknown> = {
      reason: choice.startsWith('rule:') ? 'rule' : choice,
      publicNote: publicNote?.value.trim() || undefined,
      privateNote: privateNote?.value || undefined,
    };
    if (choice.startsWith('rule:')) body.ruleId = choice.slice(5);

    void (async () => {
      if (kind === 'post') {
        const updated = await act(`/api/posts/${targetId}/removal`, body);
        dialog.close();
        if (updated) {
          announce(copy.moderation.postRemoved);
          window.location.reload();
        }
        return;
      }
      const result = await request(`/api/comments/${targetId}/removal`, { method: 'POST', body });
      dialog.close();
      if (result.ok) {
        announce(copy.moderation.commentRemoved);
        window.location.reload();
      } else {
        alertAnnounce(result.error?.message ?? copy.vote.failed);
      }
    })();
  });
}

function lockDialog(postId: string, opener: HTMLElement | null): void {
  const dialog = openDialog({
    title: 'Lock thread',
    opener,
    body: `
      ${radioGroup('duration', 'Duration', LOCK_DURATIONS.map((option) => ({ value: option.value, label: option.label })))}
      <div class="dialog-actions">
        <button type="button" data-confirm>Lock</button>
        <button type="button" data-dialog-cancel>Cancel</button>
      </div>`,
  });
  qs('[data-confirm]', dialog.element)?.addEventListener('click', () => {
    const duration = selectedRadio(dialog.element, 'duration') ?? 'indefinite';
    void (async () => {
      const updated = await act(`/api/posts/${postId}/lock`, { duration });
      dialog.close();
      if (updated) {
        announce(copy.moderation.locked);
        window.location.reload();
      }
    })();
  });
}

function replacePinDialog(postId: string, pinned: Array<{ id: string; title: string }>, opener: HTMLElement | null): void {
  const dialog = openDialog({
    title: 'Replace a pin',
    opener,
    body: `
      ${radioGroup(
        'replace',
        'Pinned post to replace',
        pinned.map((pin) => ({ value: pin.id, label: pin.title })),
      )}
      <div class="dialog-actions">
        <button type="button" data-confirm>Replace pin</button>
        <button type="button" data-dialog-cancel>Cancel</button>
      </div>`,
  });
  qs('[data-confirm]', dialog.element)?.addEventListener('click', () => {
    const replacePostId = selectedRadio(dialog.element, 'replace');
    if (replacePostId === null) return;
    void (async () => {
      const updated = await act(`/api/posts/${postId}/pin`, { replacePostId });
      dialog.close();
      if (updated) {
        announce(copy.moderation.pinned);
        window.location.reload();
      }
    })();
  });
}

async function pin(postId: string, opener: HTMLElement | null): Promise<void> {
  const result = await request<PostView>(`/api/posts/${postId}/pin`, {
    method: 'POST',
    body: { version: versionOf() },
  });
  if (result.ok && result.data) {
    setVersion(result.data.version);
    announce(copy.moderation.pinned);
    window.location.reload();
    return;
  }
  if (result.error?.code === 'SLOT_TAKEN') {
    const current = result.error.current as { pinned?: Array<{ id: string; title: string }> } | undefined;
    replacePinDialog(postId, current?.pinned ?? [], opener);
    return;
  }
  if (result.error?.code === 'CONFLICT') {
    alertAnnounce(copy.moderation.raceLost);
    window.location.reload();
  }
}

export function moderatorMenuItems(button: HTMLElement): MenuItem[] {
  const post = currentPost();
  if (!post) return [];
  if (button.dataset.needsTwoFactor === 'true') {
    window.location.assign(`/settings/2fa?next=${encodeURIComponent(window.location.pathname)}`);
    return [];
  }
  const items: MenuItem[] = [];
  if (post.state === 'published') {
    items.push({ label: 'Remove post', run: () => removalDialog('post', post.id, button) });
    if (post.locked) {
      items.push({
        label: 'Unlock thread',
        run: () =>
          void act(`/api/posts/${post.id}/lock`, {}, 'DELETE').then((updated) => {
            if (updated) {
              announce(copy.moderation.unlocked);
              window.location.reload();
            }
          }),
      });
    } else {
      items.push({ label: 'Lock thread', run: () => lockDialog(post.id, button) });
    }
    if (post.pinned) {
      items.push({
        label: 'Unpin post',
        run: () =>
          void act(`/api/posts/${post.id}/pin`, {}, 'DELETE').then((updated) => {
            if (updated) {
              announce(copy.moderation.unpinned);
              window.location.reload();
            }
          }),
      });
    } else {
      items.push({ label: 'Pin post', run: () => void pin(post.id, button) });
    }
  } else if (post.state === 'removed') {
    items.push({
      label: 'Restore post',
      run: () =>
        void act(`/api/posts/${post.id}/removal`, {}, 'DELETE').then((updated) => {
          if (updated) {
            announce(copy.moderation.restored);
            window.location.reload();
          }
        }),
    });
  }
  return items;
}

export function commentModerationItems(commentId: string, button: HTMLElement): MenuItem[] {
  return [{ label: 'Remove comment', run: () => removalDialog('comment', commentId, button) }];
}

/** A revoked moderator role takes effect on the open page. */
export function dropModeratorTools(): void {
  for (const button of qsa<HTMLElement>('[data-menu-button="moderator"]')) button.closest('.menu')?.remove();
  for (const cell of qsa<HTMLElement>('.cell-note')) cell.remove();
  const table = qs<HTMLElement>('[data-mod-log]');
  if (table) {
    const headers = qsa<HTMLElement>('th', table);
    const index = headers.findIndex((header) => header.textContent === 'Private note');
    if (index >= 0) headers[index].remove();
  }
  if (page.community) page.community.viewer.isModerator = false;
  announce(copy.moderation.toolsRemoved);
}
