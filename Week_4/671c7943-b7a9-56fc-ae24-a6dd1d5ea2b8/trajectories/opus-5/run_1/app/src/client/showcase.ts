import { listen, need, query, queryAll } from './dom.js';
import { reduced } from './motion.js';
import { announce } from './status.js';
import { showcaseAnnouncement } from '../shared/copy.js';

const SWIPE_PX = 60;

export function initShowcase(root: ParentNode): void {
  const showcase = query<HTMLElement>('[data-showcase]', root);
  if (!showcase) return;
  const row = need<HTMLElement>('[data-showcase-row]', showcase);
  const screens = queryAll<HTMLElement>('[data-showcase-screen]', showcase);
  const previous = need<HTMLButtonElement>('[data-showcase-previous]', showcase);
  const next = need<HTMLButtonElement>('[data-showcase-next]', showcase);
  const counter = need<HTMLElement>('[data-showcase-counter]', showcase);
  const total = screens.length;

  const show = (screen: number, speak: boolean): void => {
    const target = Math.min(Math.max(screen, 1), total);
    showcase.dataset.screen = String(target);
    counter.textContent = `${target} / ${total}`;
    previous.disabled = target === 1;
    next.disabled = target === total;
    row.scrollTo({
      left: screens[target - 1]!.offsetLeft - row.offsetLeft,
      behavior: reduced() ? 'instant' : 'smooth',
    });
    if (speak) {
      const caption = need<HTMLElement>('figcaption', screens[target - 1]!).textContent ?? '';
      announce(showcaseAnnouncement(target, total, caption));
    }
  };

  const current = (): number => Number(showcase.dataset.screen);

  listen(previous, 'click', () => show(current() - 1, true));
  listen(next, 'click', () => show(current() + 1, true));

  let startX: number | null = null;
  listen(
    row,
    'touchstart',
    (event) => {
      startX = event.changedTouches[0]!.clientX;
    },
    { passive: true },
  );
  listen(row, 'touchend', (event) => {
    if (startX === null) return;
    const delta = event.changedTouches[0]!.clientX - startX;
    startX = null;
    if (Math.abs(delta) < SWIPE_PX) {
      show(current(), false);
      return;
    }
    show(current() + (delta < 0 ? 1 : -1), true);
  });
}
