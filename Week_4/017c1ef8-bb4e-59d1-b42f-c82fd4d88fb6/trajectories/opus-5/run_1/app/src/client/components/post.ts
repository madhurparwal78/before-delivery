import { REACTION_LABELS, REACTION_TYPES, type ReactionType } from '../../shared/format';
import { api, newIdempotencyKey } from '../api';
import { announce, dialog, h, menu, qs, showAlert } from '../dom';
import { currentMember } from '../state';
import { S } from '../strings';
import { commentTreeNode, type CommentData } from './comments';
import { richTextWithSeeMore, timeElement, type Mention } from './text';
import { openComposer } from './composer';

export type ReactionSummaryData = {
  count: number;
  mine: ReactionType | null;
  top_types: ReactionType[];
  text: string;
};

export type PostData = {
  id: string;
  author: { id: string; handle: string; name: string; headline: string; degree: string };
  text: string;
  mentions: Mention[];
  hashtags: string[];
  created_at: string;
  edited_at: string | null;
  editable: boolean;
  photo_url: string | null;
  reactions: ReactionSummaryData;
  comment_count: number;
  repost_count: number;
  reposted_by_me: boolean;
  shared: PostData | { unavailable: true } | null;
};

export type EntryData = {
  entry_id: string;
  kind: 'post' | 'repost';
  created_at: string;
  post: PostData;
  reposter: { id: string; name: string; handle: string } | null;
};

function summaryNode(summary: ReactionSummaryData): HTMLElement {
  return h('p', {
    'data-reaction-summary': '',
    'data-count': String(summary.count),
    'data-top-types': summary.top_types.join(','),
    class: 'reaction-summary',
    text: summary.text,
  });
}

/** One feed or page entry, with every published control. */
export function entryNode(
  entry: EntryData,
  options: { withComments?: boolean; reload?: () => void } = {},
): HTMLElement {
  const post = entry.post;
  const me = currentMember();
  const reload = options.reload ?? (() => undefined);
  const article = h('article', {
    'aria-label': `Post by ${post.author.name}`,
    tabindex: '-1',
    class: 'entry',
    'data-entry-id': entry.entry_id,
    'data-entry-kind': entry.kind,
    'data-post-id': entry.kind === 'repost' ? post.id : post.id,
    'data-author-id': post.author.id,
    'data-repost-of':
      entry.kind === 'repost'
        ? post.id
        : post.shared && !('unavailable' in post.shared)
          ? post.shared.id
          : '',
    'data-reposter-id': entry.reposter ? entry.reposter.id : '',
  });

  if (entry.kind === 'repost' && entry.reposter) {
    article.append(h('p', { class: 'credit', text: `${entry.reposter.name} reposted this` }));
  }

  article.append(
    h('div', { class: 'entry-head' }, [
      h('a', { href: `/in/${post.author.handle}`, class: 'person-name' }, [post.author.name]),
      h('p', { class: 'headline', text: post.author.headline }),
      h('a', { href: `/posts/${post.id}`, class: 'time-link' }, [
        timeElement(entry.created_at, post.edited_at !== null),
      ]),
    ]),
  );

  article.append(richTextWithSeeMore(post.text, post.mentions));

  if (post.photo_url) {
    article.append(h('img', { src: post.photo_url, alt: '', class: 'post-photo' }));
  }

  if (post.shared) {
    const shared = h('section', { 'aria-label': 'Shared post', class: 'shared' });
    if ('unavailable' in post.shared) {
      shared.append(h('p', { class: 'big-sentence small', text: S.empty.postUnavailable }));
    } else {
      const original = post.shared;
      shared.append(
        h('a', { href: `/in/${original.author.handle}`, class: 'person-name small' }, [
          original.author.name,
        ]),
        richTextWithSeeMore(original.text, original.mentions),
      );
    }
    article.append(shared);
  }

  const counts = h('div', { class: 'counts tabular' });
  if (post.comment_count > 0) {
    counts.append(
      h('span', {
        text: post.comment_count === 1 ? '1 comment' : `${post.comment_count} comments`,
      }),
    );
  }
  if (post.repost_count > 0) {
    counts.append(
      h('span', { text: post.repost_count === 1 ? '1 repost' : `${post.repost_count} reposts` }),
    );
  }
  article.append(counts, summaryNode(post.reactions));

  const actions = h('div', { class: 'entry-actions' });

  const reactButton = h(
    'button',
    {
      type: 'button',
      class: 'text-button',
      'aria-pressed': post.reactions.mine ? 'true' : 'false',
      click: () => void toggleReaction(),
    },
    ['React'],
  );
  const chooseButton = h(
    'button',
    { type: 'button', class: 'text-button', click: () => openToolbar() },
    ['Choose reaction'],
  );
  const commentButton = h(
    'button',
    { type: 'button', class: 'text-button', click: () => openCommentBox() },
    ['Comment'],
  );
  const repostButton = h(
    'button',
    {
      type: 'button',
      class: 'text-button',
      click: () => {
        menu(repostButton, [
          { label: 'Repost', run: () => void plainRepost() },
          {
            label: 'Repost with your thoughts',
            run: () =>
              openComposer({ sharedPost: post, opener: repostButton, onDone: () => reload() }),
          },
        ]);
      },
    },
    ['Repost'],
  );
  actions.append(reactButton, chooseButton, commentButton, repostButton);

  if (me && post.author.id === me.id) {
    const postActions = h(
      'button',
      {
        type: 'button',
        class: 'text-button',
        click: () => {
          const items = [] as { label: string; run: () => void }[];
          if (post.editable) items.push({ label: 'Edit post', run: () => openEditDialog() });
          items.push({ label: 'Delete post', run: () => openDeleteDialog() });
          menu(postActions, items);
        },
      },
      ['Post actions'],
    );
    actions.append(postActions);
  }
  article.append(actions);

  const toolbarHost = h('div', { class: 'toolbar-host' });
  article.append(toolbarHost);

  const commentHost = h('div', { class: 'comment-host' });
  article.append(commentHost);

  if (options.withComments) void loadComments();

  return article;

  async function toggleReaction(): Promise<void> {
    reactButton.setAttribute('disabled', '');
    if (post.reactions.mine) {
      const result = await api.del<{ reactions: ReactionSummaryData }>(
        `/api/posts/${post.id}/reaction`,
      );
      reactButton.removeAttribute('disabled');
      if (result.ok) {
        announce('Feed announcements', S.announce.reactionRemoved);
        reload();
      } else showAlert(article, S.alert.somethingWrong);
      return;
    }
    const result = await api.put<{ reactions: ReactionSummaryData }>(
      `/api/posts/${post.id}/reaction`,
      { type: 'like' },
    );
    reactButton.removeAttribute('disabled');
    if (result.ok) {
      announce('Feed announcements', S.announce.reactionSet(REACTION_LABELS.like));
      reload();
    } else showAlert(article, S.alert.somethingWrong);
  }

  async function applyReaction(type: ReactionType): Promise<void> {
    if (post.reactions.mine === type) {
      const result = await api.del(`/api/posts/${post.id}/reaction`);
      if (result.ok) {
        announce('Feed announcements', S.announce.reactionRemoved);
        reload();
      }
      return;
    }
    const result = await api.put(`/api/posts/${post.id}/reaction`, { type });
    if (result.ok) {
      announce('Feed announcements', S.announce.reactionSet(REACTION_LABELS[type]));
      reload();
    } else showAlert(article, S.alert.somethingWrong);
  }

  function openToolbar(): void {
    toolbarHost.replaceChildren();
    const toolbar = h('div', { role: 'toolbar', 'aria-label': 'Reactions', class: 'toolbar' });
    const buttons = REACTION_TYPES.map((type) =>
      h(
        'button',
        {
          type: 'button',
          class: 'button quiet',
          tabindex: '-1',
          'aria-pressed': post.reactions.mine === type ? 'true' : 'false',
          click: () => {
            close();
            void applyReaction(type);
          },
        },
        [REACTION_LABELS[type]],
      ),
    );
    let index = post.reactions.mine ? REACTION_TYPES.indexOf(post.reactions.mine) : 0;
    const close = (): void => {
      toolbar.remove();
      chooseButton.focus();
    };
    toolbar.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        index =
          event.key === 'ArrowRight'
            ? (index + 1) % buttons.length
            : (index - 1 + buttons.length) % buttons.length;
        buttons[index].focus();
      } else if (event.key === 'Home') {
        event.preventDefault();
        index = 0;
        buttons[index].focus();
      } else if (event.key === 'End') {
        event.preventDefault();
        index = buttons.length - 1;
        buttons[index].focus();
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        const type = REACTION_TYPES[index];
        close();
        void applyReaction(type);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    });
    for (const button of buttons) toolbar.append(button);
    toolbarHost.append(toolbar);
    buttons[index].focus();
  }

  function openCommentBox(): void {
    const existing = qs<HTMLTextAreaElement>('textarea', commentHost);
    if (existing) {
      existing.focus();
      return;
    }
    const box = h('div', { class: 'comment-box' });
    const field = h('textarea', {
      'aria-label': 'Add a comment',
      class: 'input',
      rows: '2',
    }) as HTMLTextAreaElement;
    const submit = h(
      'button',
      {
        type: 'button',
        class: 'button',
        click: async () => {
          submit.setAttribute('disabled', '');
          const result = await api.post(
            `/api/posts/${post.id}/comments`,
            { text: field.value },
            { 'Idempotency-Key': newIdempotencyKey() },
          );
          submit.removeAttribute('disabled');
          if (result.ok) {
            announce('Feed announcements', S.announce.commentPosted);
            field.value = '';
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
    commentHost.prepend(box);
    field.focus();
  }

  async function plainRepost(): Promise<void> {
    const result = await api.post(`/api/posts/${post.id}/reposts`);
    if (result.ok) {
      announce('Feed announcements', S.announce.reposted);
      reload();
    } else showAlert(article, S.alert.somethingWrong);
  }

  function openEditDialog(): void {
    dialog(
      'Edit post',
      (close) => {
        const field = h('textarea', {
          'aria-label': 'What do you want to talk about?',
          class: 'input',
          rows: '5',
          value: post.text,
        }) as HTMLTextAreaElement;
        const host = h('div', { class: 'dialog-body' }, [field]);
        const save = h(
          'button',
          {
            type: 'button',
            class: 'button',
            click: async () => {
              save.setAttribute('disabled', '');
              const result = await api.patch<{ error?: string }>(`/api/posts/${post.id}`, {
                text: field.value,
              });
              save.removeAttribute('disabled');
              if (result.ok) {
                announce('Feed announcements', S.announce.postUpdated);
                close();
                reload();
                return;
              }
              showAlert(
                host,
                result.body.error === 'edit_window_closed'
                  ? S.alert.editWindowClosed
                  : S.alert.somethingWrong,
              );
            },
          },
          ['Save changes'],
        );
        return [h('h2', { text: 'Edit post' }), host, save];
      },
      null,
    );
  }

  function openDeleteDialog(): void {
    dialog(
      'Delete post?',
      (close) => {
        const host = h('div', { class: 'dialog-body' });
        const confirm = h(
          'button',
          {
            type: 'button',
            class: 'button',
            click: async () => {
              confirm.setAttribute('disabled', '');
              const result = await api.del(`/api/posts/${post.id}`);
              if (result.ok) {
                announce('Feed announcements', S.announce.postDeleted);
                close();
                reload();
                return;
              }
              confirm.removeAttribute('disabled');
              showAlert(host, S.alert.somethingWrong);
            },
          },
          ['Delete'],
        );
        return [
          h('h2', { text: 'Delete post?' }),
          host,
          confirm,
          h('button', { type: 'button', class: 'button quiet', click: () => close() }, ['Cancel']),
        ];
      },
      null,
    );
  }

  async function loadComments(): Promise<void> {
    const result = await api.get<{ comments: CommentData[] }>(`/api/posts/${post.id}/comments`);
    if (!result.ok) return;
    const tree = commentTreeNode(post.id, post.author.id, result.body.comments, reload);
    const box = qs<HTMLElement>('.comment-box', commentHost);
    commentHost.replaceChildren();
    if (box) commentHost.append(box);
    commentHost.append(tree);
  }
}
