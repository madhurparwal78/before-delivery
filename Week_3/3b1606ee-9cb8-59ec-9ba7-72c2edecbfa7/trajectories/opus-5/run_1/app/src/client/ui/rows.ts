import { reducedMotion } from './motion.js';

function rowElement(conversationId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-testid="conversation-row"][data-conversation-id="${conversationId}"]`,
  );
}

export function rowRect(conversationId: string): DOMRect | null {
  return rowElement(conversationId)?.getBoundingClientRect() ?? null;
}

/** The same row element slides to the top of the list; nothing is copied. */
export function moveRowToTop(conversationId: string): void {
  const link = rowElement(conversationId);
  const item = link?.closest('li') ?? null;
  const list = item?.parentElement ?? null;
  if (item === null || list === null || list.firstElementChild === item) return;
  const before = item.getBoundingClientRect();
  list.prepend(item);
  const after = item.getBoundingClientRect();
  if (reducedMotion()) return;
  item.animate(
    [
      { transform: `translateY(${before.top - after.top}px)` },
      { transform: 'translateY(0)' },
    ],
    { duration: 400, easing: 'cubic-bezier(0.2, 0.9, 0.2, 1)' },
  );
}
