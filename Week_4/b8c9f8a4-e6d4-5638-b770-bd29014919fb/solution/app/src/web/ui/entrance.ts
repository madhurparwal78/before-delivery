// Entrances: a heading or card rises a short way and fades in over about a second, once, on
// first entering the view, and is removed entirely under reduced motion. The rise and the fade
// are a CSS animation on the document's own timeline, so a heading never waits on a script frame
// to become legible; this module only decides when an element has first come into view.

import { prefersReducedMotion } from '../dom.js';

let watcher: IntersectionObserver | null = null;

function observer(): IntersectionObserver {
  if (!watcher) {
    watcher = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          watcher?.unobserve(entry.target);
          entry.target.classList.add('is-in');
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
  }
  return watcher;
}

/** Marks an element to enter once when it first comes into view. */
export function entrance(node: HTMLElement): HTMLElement {
  if (prefersReducedMotion()) {
    node.classList.add('is-in');
    return node;
  }
  node.classList.add('enters');
  observer().observe(node);
  return node;
}
