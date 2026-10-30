/**
 * Moves focus to a published focus target once the screen has rendered it, so a
 * target that is created or enabled by the action still receives focus.
 */

const MAX_FRAMES = 30;

export function focusWhenReady(selector: string): void {
  const attempt = (framesLeft: number): void => {
    const node = document.querySelector<HTMLElement>(selector);
    const unavailable =
      node === null ||
      (node instanceof HTMLButtonElement && node.disabled) ||
      node.offsetParent === null;
    if (!unavailable) {
      node.focus();
      return;
    }
    if (framesLeft > 0) window.requestAnimationFrame(() => attempt(framesLeft - 1));
  };
  window.requestAnimationFrame(() => attempt(MAX_FRAMES));
}
