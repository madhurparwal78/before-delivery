import { api, newIdempotencyKey } from '../api';
import { announce, h, qsa, showAlert } from '../dom';
import { currentMember } from '../state';
import { S } from '../strings';
import { richText, timeElement, type Mention } from './text';

export type CommentData = {
  id: string;
  post_id: string;
  parent_id: string | null;
  author?: { id: string; handle: string; name: string; headline: string };
  text?: string;
  mentions?: Mention[];
  created_at?: string;
  deleted: boolean;
  replies: CommentData[];
};

type TreeState = { expanded: Set<string>; shownAll: Set<string>; focused: string | null };

/** Comments are a keyboard tree with one tab stop and collapsed replies. */
export function commentTreeNode(
  postId: string,
  postAuthorId: string,
  comments: CommentData[],
  reload: () => void,
): HTMLElement {
  const state: TreeState = { expanded: new Set(), shownAll: new Set(), focused: null };
  for (const comment of comments) {
    if (comment.replies.length > 0) state.expanded.add(comment.id);
  }
  const tree = h('div', { role: 'tree', 'aria-label': 'Comments', class: 'comment-tree' });
  tree.addEventListener('keydown', onTreeKey);
  draw();
  return tree;

  function visibleItems(): HTMLElement[] {
    return qsa<HTMLElement>('[role="treeitem"]', tree).filter(
      (node) => node.closest('[role="group"][hidden]') === null,
    );
  }

  function setTabStop(): void {
    const items = visibleItems();
    for (const item of items) item.setAttribute('tabindex', '-1');
    const chosen = items.find((item) => item.getAttribute('data-comment-id') === state.focused);
    (chosen ?? items[0])?.setAttribute('tabindex', '0');
  }

  function focusItem(node: HTMLElement | undefined): void {
    if (!node) return;
    state.focused = node.getAttribute('data-comment-id');
    setTabStop();
    node.focus();
  }

  function replyBox(comment: CommentData, item: HTMLElement): void {
    const existing = item.querySelector('.reply-box');
    if (existing) {
      (existing.querySelector('textarea') as HTMLTextAreaElement | null)?.focus();
      return;
    }
    const prefill = comment.parent_id && comment.author ? `@${comment.author.handle} ` : '';
    const box = h('div', { class: 'reply-box' });
    const field = h('textarea', {
      'aria-label': 'Add a comment',
      class: 'input',
      rows: '2',
      value: prefill,
      keydown: (event: Event) => {
        const keyEvent = event as KeyboardEvent;
        if (keyEvent.key === 'Escape') {
          keyEvent.preventDefault();
          keyEvent.stopPropagation();
          box.remove();
          item.focus();
        }
      },
    }) as HTMLTextAreaElement;
    const submit = h(
      'button',
      {
        type: 'button',
        class: 'button',
        click: async () => {
          submit.setAttribute('disabled', '');
          const result = await api.post(
            `/api/posts/${postId}/comments`,
            { text: field.value, parent_id: comment.parent_id ?? comment.id },
            { 'Idempotency-Key': newIdempotencyKey() },
          );
          submit.removeAttribute('disabled');
          if (result.ok) {
            announce('Feed announcements', S.announce.commentPosted);
            reload();
          } else {
            showAlert(box, S.alert.somethingWrong);
            announce('Feed announcements', S.announce.commentNotPosted);
            field.focus();
          }
        },
      },
      ['Post comment'],
    );
    box.append(field, submit);
    item.append(box);
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }

  function itemNode(comment: CommentData, isReply: boolean): HTMLElement {
    const name = comment.deleted
      ? 'Deleted comment'
      : `${isReply ? 'Reply' : 'Comment'} by ${comment.author?.name ?? ''}`;
    const item = h('div', {
      role: 'treeitem',
      'aria-label': name,
      tabindex: '-1',
      class: isReply ? 'comment reply' : 'comment',
      'data-comment-id': comment.id,
      'data-parent-id': comment.parent_id ?? '',
      'data-deleted': comment.deleted ? 'true' : 'false',
    });
    if (comment.deleted) {
      item.append(h('p', { class: 'muted', text: S.placeholder.deletedComment }));
      return item;
    }
    item.append(
      h('div', { class: 'comment-head' }, [
        h('a', { href: `/in/${comment.author?.handle ?? ''}`, class: 'person-name small' }, [
          comment.author?.name ?? '',
        ]),
        comment.created_at ? timeElement(comment.created_at) : null,
      ]),
      richText(comment.text ?? '', comment.mentions ?? []),
    );
    const actions = h('div', { class: 'comment-actions' });
    actions.append(
      h(
        'button',
        { type: 'button', class: 'text-button', click: () => replyBox(comment, item) },
        ['Reply'],
      ),
    );
    const me = currentMember();
    if (me && (comment.author?.id === me.id || postAuthorId === me.id)) {
      actions.append(
        h(
          'button',
          {
            type: 'button',
            class: 'text-button',
            click: async () => {
              const result = await api.del(`/api/comments/${comment.id}`);
              if (result.ok) {
                announce('Feed announcements', S.announce.commentDeleted);
                reload();
              } else showAlert(item, S.alert.somethingWrong);
            },
          },
          ['Delete comment'],
        ),
      );
    }
    item.append(actions);
    return item;
  }

  function draw(): void {
    tree.replaceChildren();
    for (const comment of comments) {
      const item = itemNode(comment, false);
      const liveReplies = comment.replies;
      if (liveReplies.length > 0) {
        item.setAttribute('aria-expanded', state.expanded.has(comment.id) ? 'true' : 'false');
      }
      tree.append(item);
      if (liveReplies.length === 0) continue;
      const group = h('div', { role: 'group', class: 'reply-group' });
      const showAll = state.shownAll.has(comment.id);
      const shown = showAll ? liveReplies : liveReplies.slice(0, 2);
      for (const reply of shown) group.append(itemNode(reply, true));
      const hidden = liveReplies.length - shown.length;
      if (hidden > 0) {
        group.append(
          h(
            'button',
            {
              type: 'button',
              class: 'text-button',
              click: () => {
                state.shownAll.add(comment.id);
                const firstHiddenId = liveReplies[shown.length].id;
                draw();
                const node = qsa<HTMLElement>(
                  `[data-comment-id="${firstHiddenId}"]`,
                  tree,
                )[0];
                focusItem(node);
              },
            },
            [hidden === 1 ? 'Show 1 more reply' : `Show ${hidden} more replies`],
          ),
        );
      }
      if (!state.expanded.has(comment.id)) group.setAttribute('hidden', '');
      tree.append(group);
    }
    setTabStop();
  }

  function groupOf(item: HTMLElement): HTMLElement | null {
    const next = item.nextElementSibling;
    return next && next.getAttribute('role') === 'group' ? (next as HTMLElement) : null;
  }

  function onTreeKey(event: KeyboardEvent): void {
    const target = (event.target as HTMLElement).closest('[role="treeitem"]') as HTMLElement | null;
    if (!target) return;
    const items = visibleItems();
    const index = items.indexOf(target);
    const isReply = target.getAttribute('data-parent-id') !== '';
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusItem(items[index + 1]);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusItem(items[index - 1]);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusItem(items[0]);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusItem(items[items.length - 1]);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      const id = target.getAttribute('data-comment-id') ?? '';
      const group = groupOf(target);
      if (!group) return;
      if (!state.expanded.has(id)) {
        state.expanded.add(id);
        draw();
        focusItem(qsa<HTMLElement>(`[data-comment-id="${id}"]`, tree)[0]);
      } else {
        focusItem(qsa<HTMLElement>('[role="treeitem"]', group)[0]);
      }
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (isReply) {
        const parentId = target.getAttribute('data-parent-id') ?? '';
        focusItem(
          qsa<HTMLElement>('[role="treeitem"]', tree).find(
            (node) => node.getAttribute('data-comment-id') === parentId,
          ),
        );
        return;
      }
      const id = target.getAttribute('data-comment-id') ?? '';
      if (state.expanded.has(id)) {
        state.expanded.delete(id);
        draw();
        focusItem(qsa<HTMLElement>(`[data-comment-id="${id}"]`, tree)[0]);
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const id = target.getAttribute('data-comment-id') ?? '';
      const comment = findComment(comments, id);
      if (comment) replyBox(comment, target);
    }
  }
}

function findComment(list: CommentData[], id: string): CommentData | null {
  for (const comment of list) {
    if (comment.id === id) return comment;
    const found = findComment(comment.replies, id);
    if (found) return found;
  }
  return null;
}
