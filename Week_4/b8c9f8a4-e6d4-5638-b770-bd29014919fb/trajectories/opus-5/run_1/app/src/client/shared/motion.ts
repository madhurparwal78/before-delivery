const QUERY = '(prefers-reduced-motion: reduce)';

export const prefersReducedMotion = (): boolean => window.matchMedia(QUERY).matches;

export const onMotionPreferenceChange = (handler: () => void): void => {
  window.matchMedia(QUERY).addEventListener('change', handler);
};

/** Entrances rise a short way and fade in once, on first entering the view. */
export const playEntrances = (root: ParentNode): void => {
  if (prefersReducedMotion()) {
    for (const node of root.querySelectorAll<HTMLElement>('[data-entrance]')) {
      node.dataset.entrance = 'done';
    }
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const node = entry.target as HTMLElement;
        node.dataset.entrance = 'done';
        observer.unobserve(node);
      }
    },
    { rootMargin: '0px 0px -10% 0px' },
  );
  for (const node of root.querySelectorAll<HTMLElement>('[data-entrance="waiting"]')) observer.observe(node);
};

export const markEntrance = (node: HTMLElement): HTMLElement => {
  node.dataset.entrance = prefersReducedMotion() ? 'done' : 'waiting';
  return node;
};
