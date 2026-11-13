import { COMMENT_COPY, LIMITS } from '../../shared/copy';
import type { CommentDto, PostDto } from '../../shared/types';
import { commentError } from '../../shared/validate';
import { RequestFailed, api } from '../api';
import { clear, el, on, svg } from '../dom';
import { icons } from '../icons';
import type { BoardView } from './view';

interface LoupeControl {
  postId: string;
  update: (post: PostDto, comments: CommentDto[]) => void;
}

const controls = new WeakMap<HTMLElement, LoupeControl>();

const build = (view: BoardView, frame: HTMLElement, post: PostDto): LoupeControl => {
  clear(frame);
  const heading = el('h2', { text: post.title, tabindex: '-1' });
  const author = el('p', { class: 'muted', text: post.author.display_name });
  const body = el('p', { text: post.body });
  const countLine = el('p', { class: 'frame-counts' });
  const actions = el('div', { class: 'loupe-actions' });
  const commentList = el('ul', { 'aria-label': 'Comments' });
  const wrapper = el('div', { class: 'loupe' }, [heading, author, body]);

  if (post.attachment !== null) {
    if (post.attachment.content_type.startsWith('image/')) {
      wrapper.append(el('img', { class: 'loupe-image', src: post.attachment.url, alt: post.title }));
    } else {
      wrapper.append(el('a', { href: post.attachment.url, text: post.attachment.file_name, download: post.attachment.file_name }));
    }
  }
  wrapper.append(countLine, actions, commentList);

  const likeButton = el('button', { type: 'button', 'aria-label': `Like ${post.title}` });
  const voteUp = el('button', { type: 'button', 'aria-label': `Vote up ${post.title}` });
  const voteDown = el('button', { type: 'button', 'aria-label': `Vote down ${post.title}` });

  if (view.canReact()) {
    on(likeButton, 'click', () => {
      const liked = likeButton.getAttribute('aria-pressed') === 'true';
      void (liked ? api.del(`/api/posts/${post.id}/like`) : api.put(`/api/posts/${post.id}/like`)).then(() =>
        view.refresh(),
      );
    });
    on(voteUp, 'click', () => {
      const pressed = voteUp.getAttribute('aria-pressed') === 'true';
      void (pressed
        ? api.del(`/api/posts/${post.id}/vote`)
        : api.put(`/api/posts/${post.id}/vote`, { value: 1 })
      ).then(() => view.refresh());
    });
    on(voteDown, 'click', () => {
      const pressed = voteDown.getAttribute('aria-pressed') === 'true';
      void (pressed
        ? api.del(`/api/posts/${post.id}/vote`)
        : api.put(`/api/posts/${post.id}/vote`, { value: -1 })
      ).then(() => view.refresh());
    });
    actions.append(likeButton, voteUp, voteDown);
  }

  if (view.canEdit(post)) {
    const edit = el('button', { type: 'button', 'aria-label': `Edit ${post.title}`, text: 'Edit' });
    on(edit, 'click', () => view.editPost(post, edit));
    actions.append(edit);
  }
  if (view.canDelete(post)) {
    const remove = el('button', { type: 'button', 'aria-label': `Delete ${post.title}`, text: 'Delete' });
    on(remove, 'click', () => void view.deletePost(post));
    actions.append(remove);
  }

  if (view.canComment()) {
    const box = el('textarea', { 'aria-label': 'Add a comment', rows: '2' });
    const counter = el('p', { class: 'muted', text: `0/${LIMITS.comment}` });
    const message = el('p', { class: 'field-message' });
    const send = el('button', { type: 'button', text: 'Send comment' });
    const submit = async (): Promise<void> => {
      message.textContent = '';
      const problem = commentError(box.value);
      if (problem !== null) {
        message.textContent = problem;
        return;
      }
      send.textContent = COMMENT_COPY.pending;
      try {
        const saved = await api.post<CommentDto>(`/api/posts/${post.id}/comments`, { text: box.value });
        view.addComment(post.id, saved);
        box.value = '';
        counter.textContent = `0/${LIMITS.comment}`;
        await view.refresh();
      } catch (error) {
        if (error instanceof RequestFailed) message.textContent = error.fieldError('text') ?? COMMENT_COPY.required;
      } finally {
        send.textContent = 'Send comment';
        view.frameFor(post.id)?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
      }
    };
    on(box, 'input', () => {
      counter.textContent = `${Array.from(box.value).length}/${LIMITS.comment}`;
    });
    on(box, 'keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void submit();
      }
    });
    on(send, 'click', () => void submit());
    wrapper.append(el('div', { class: 'comment-row' }, [box, counter, message, send]));
  }

  const close = el('button', { type: 'button', text: 'Close' });
  on(close, 'click', () => view.closeLoupe());
  wrapper.append(close);
  frame.append(wrapper);

  const control: LoupeControl = {
    postId: post.id,
    update: (current, comments) => {
      heading.textContent = current.title;
      author.textContent = current.author.display_name;
      body.textContent = current.body;
      clear(countLine);
      countLine.append(
        svg(icons.heart, 'count-icon'),
        String(current.likes),
        svg(icons.votes, 'count-icon'),
        String(current.score),
        svg(icons.comments, 'count-icon'),
        String(current.comments),
      );
      likeButton.setAttribute('aria-pressed', current.liked ? 'true' : 'false');
      voteUp.setAttribute('aria-pressed', current.my_vote === 1 ? 'true' : 'false');
      voteDown.setAttribute('aria-pressed', current.my_vote === -1 ? 'true' : 'false');
      clear(likeButton);
      likeButton.append(svg(icons.heart, 'count-icon'), String(current.likes));
      clear(voteUp);
      voteUp.append(svg(icons.voteUp, 'count-icon'), String(current.score));
      clear(voteDown);
      voteDown.append(svg(icons.voteDown, 'count-icon'), String(current.score));
      commentList.replaceChildren(
        ...comments.map((comment) =>
          el('li', {}, [el('strong', { text: comment.author.display_name }), ' ', comment.text]),
        ),
      );
    },
  };
  return control;
};

export const renderLoupe = (view: BoardView, frame: HTMLElement, post: PostDto): void => {
  let control = controls.get(frame);
  if (control === undefined || control.postId !== post.id) {
    control = build(view, frame, post);
    controls.set(frame, control);
    frame.removeAttribute('data-render');
  }
  control.update(post, view.commentsFor(post.id));
};

export const closeLoupeContent = (frame: HTMLElement): void => {
  controls.delete(frame);
  frame.removeAttribute('data-render');
};
