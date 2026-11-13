import { BOARD_COPY } from '../../shared/copy';
import type { PostDto } from '../../shared/types';
import { openDialog } from '../dialog';
import { clear, el, on } from '../dom';
import { slideOut, slideSlide } from '../motion';
import type { BoardView } from './view';

export const openSlideshow = (view: BoardView, opener: HTMLElement): void => {
  let posts: PostDto[] = [];
  let index = 0;
  let unsubscribe = (): void => undefined;

  openDialog({
    name: 'Slideshow',
    opener,
    onClose: () => unsubscribe(),
    content: (handle) => {
      const position = el('p', { role: 'status', 'aria-label': 'Slide position' });
      const stage = el('div', { class: 'slides' });
      const previous = el('button', { type: 'button', text: 'Previous post' });
      const next = el('button', { type: 'button', text: 'Next post' });

      const renderSlide = (direction: 1 | -1 | 0): void => {
        posts = view.display.sections.flatMap((section) => section.posts);
        if (posts.length === 0) {
          clear(stage);
          position.textContent = BOARD_COPY.slideEmpty;
          return;
        }
        index = Math.min(Math.max(index, 0), posts.length - 1);
        const post = posts[index];
        const slide = el('div', { class: 'slide' }, [
          el('h2', { text: post.title }),
          el('p', { class: 'muted', text: post.author.display_name }),
          el('p', { text: post.body }),
        ]);
        if (post.attachment !== null && post.attachment.content_type.startsWith('image/')) {
          slide.append(el('img', { src: post.attachment.url, alt: post.title }));
        } else if (post.attachment !== null) {
          slide.append(el('p', { class: 'muted', text: post.attachment.file_name }));
        }
        const leaving = stage.firstElementChild;
        if (leaving instanceof HTMLElement && direction !== 0) slideOut(leaving, direction);
        stage.replaceChildren(slide);
        if (direction !== 0) slideSlide(slide, direction);
        position.textContent = BOARD_COPY.slidePosition(index + 1, posts.length);
      };

      const step = (delta: number): void => {
        const target = Math.min(Math.max(index + delta, 0), Math.max(posts.length - 1, 0));
        if (target === index) {
          renderSlide(0);
          return;
        }
        const direction: 1 | -1 = delta > 0 ? 1 : -1;
        index = target;
        renderSlide(direction);
      };

      on(next, 'click', () => step(1));
      on(previous, 'click', () => step(-1));

      on(handle.root, 'keydown', (event) => {
        switch (event.key) {
          case 'ArrowRight':
          case ' ':
          case 'PageDown':
            event.preventDefault();
            step(1);
            return;
          case 'ArrowLeft':
          case 'PageUp':
            event.preventDefault();
            step(-1);
            return;
          case 'Home':
            event.preventDefault();
            index = 0;
            renderSlide(-1);
            return;
          case 'End':
            event.preventDefault();
            index = Math.max(posts.length - 1, 0);
            renderSlide(1);
            return;
          default:
            return;
        }
      });

      let touchStart: number | null = null;
      handle.root.addEventListener(
        'touchstart',
        (event) => {
          touchStart = event.touches[0].clientX;
        },
        { passive: true },
      );
      handle.root.addEventListener(
        'touchend',
        (event) => {
          if (touchStart === null) return;
          const delta = event.changedTouches[0].clientX - touchStart;
          touchStart = null;
          if (Math.abs(delta) < 30) return;
          step(delta < 0 ? 1 : -1);
        },
        { passive: true },
      );

      unsubscribe = view.onUpdate(() => {
        const currentId = posts[index]?.id ?? null;
        const nextPosts = view.display.sections.flatMap((section) => section.posts);
        if (currentId !== null && !nextPosts.some((post) => post.id === currentId)) {
          index = Math.min(index, Math.max(nextPosts.length - 1, 0));
        } else if (currentId !== null) {
          index = Math.max(
            nextPosts.findIndex((post) => post.id === currentId),
            0,
          );
        }
        renderSlide(0);
      });

      renderSlide(0);
      return [el('h2', { text: 'Slideshow' }), position, stage, el('div', { class: 'dialog-actions' }, [previous, next])];
    },
    focus: (root) => root.querySelector<HTMLElement>('button'),
  });
};
