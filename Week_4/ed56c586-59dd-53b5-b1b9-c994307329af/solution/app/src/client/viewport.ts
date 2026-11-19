/** Scroll and resize rules run synchronously on every scroll and resize event, never through observers. */

type Listener = () => void;

const listeners: Listener[] = [];

export function onViewportChange(listener: Listener): void {
  listeners.push(listener);
}

export function applyViewportRules(): void {
  for (const listener of listeners) listener();
}

export function watchViewport(): void {
  window.addEventListener("scroll", applyViewportRules, { passive: true });
  window.addEventListener("resize", applyViewportRules);
}
