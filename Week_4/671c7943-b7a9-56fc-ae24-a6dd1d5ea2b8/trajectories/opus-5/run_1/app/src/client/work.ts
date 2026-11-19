import { listen, query, queryAll } from './dom.js';
import { FILTER_FADE_MS, animate } from './motion.js';
import { writeParam } from './params.js';
import { announce } from './status.js';
import { onReveal } from './reveal.js';
import { emptyCategoryNotice, filterAnnouncement } from '../shared/copy.js';
import { SERVICES } from '../content/copy.js';
import type { CategoryId } from '../shared/types.js';

const COVER_REVEAL_MS = 700;

const serviceName = (id: CategoryId): string =>
  SERVICES.find((service) => service.id === id)!.name;

function applyFilter(root: ParentNode, value: string, speak: boolean): void {
  const gallery = query<HTMLElement>('[data-gallery]', root);
  const notice = query<HTMLElement>('[data-work-empty]', root);
  if (!gallery || !notice) return;
  const category = value === 'all' ? null : (value as CategoryId);
  const items = queryAll<HTMLElement>('[data-project]', gallery);
  const shown: HTMLElement[] = [];
  for (const item of items) {
    const visible = category === null || item.dataset.category === category;
    item.hidden = !visible;
    if (visible) shown.push(item);
  }
  gallery.hidden = shown.length === 0;
  notice.hidden = shown.length !== 0;
  notice.textContent = category === null ? '' : emptyCategoryNotice(serviceName(category));
  writeParam('category', category);
  for (const item of shown) {
    const cover = query<HTMLElement>('[data-cover]', item);
    if (cover) cover.dataset.revealed = 'done';
    animate(item, [{ opacity: '0' }, { opacity: '1' }], { duration: FILTER_FADE_MS });
  }
  for (const link of queryAll<HTMLAnchorElement>('[data-work-link]', gallery)) {
    const slug = link.dataset.workLink!;
    link.setAttribute('href', category === null ? `/work/${slug}` : `/work/${slug}?category=${category}`);
  }
  if (speak) {
    announce(
      filterAnnouncement(shown.length, category === null ? null : serviceName(category)),
    );
  }
}

export function chooseCategory(root: ParentNode, category: CategoryId, speak: boolean): void {
  const radio = query<HTMLInputElement>(`[data-filter="${category}"]`, root);
  if (!radio) return;
  radio.checked = true;
  applyFilter(root, category, speak);
}

export function initWork(root: ParentNode): void {
  for (const radio of queryAll<HTMLInputElement>('[data-filter]', root)) {
    listen(radio, 'change', () => {
      if (radio.checked) applyFilter(root, radio.value, true);
    });
  }
  for (const item of queryAll<HTMLElement>('[data-project]', root)) {
    const cover = query<HTMLElement>('[data-cover]', item);
    if (item.hidden || !cover || cover.dataset.revealed === 'done') continue;
    onReveal(item, 0.9, () => {
      cover.dataset.revealed = 'done';
      animate(cover, [{ clipPath: 'inset(100% 0 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], {
        duration: COVER_REVEAL_MS,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'backwards',
      });
    });
  }
}
