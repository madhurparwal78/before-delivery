// A calculated value in the Lit path counts from the figure it showed to the figure it now has, in a page timer
// (requestAnimationFrame). `data-final` holds the final text from the first frame, so nothing waits on the count.

const COUNT_MS = 320;
const FIGURE = /-?\d+(?:\.\d+)?/;
const running = new WeakMap<HTMLElement, number>();

interface Figure { before: string; after: string; value: number; places: number }

export const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function figureOf(text: string): Figure | null {
  const found = FIGURE.exec(text);
  if (!found) return null;
  return {
    before: text.slice(0, found.index),
    after: text.slice(found.index + found[0].length),
    value: Number(found[0]),
    places: found[0].split('.')[1]?.length ?? 0,
  };
}

const easeOut = (progress: number): number => 1 - (1 - progress) ** 3;

/** Shows `final` in `element`: at once, or by counting from what it shows now when both texts hold one figure. */
export function countTo(element: HTMLElement, final: string): void {
  const shown = element.textContent ?? '';
  element.dataset['final'] = final;
  const earlier = running.get(element);
  if (earlier !== undefined) cancelAnimationFrame(earlier);
  running.delete(element);
  const from = figureOf(shown);
  const to = figureOf(final);
  if (reducedMotion() || shown === final || !from || !to || from.before !== to.before || from.after !== to.after) {
    element.textContent = final;
    return;
  }
  let begin: number | null = null;
  const step = (now: number): void => {
    begin ??= now;
    const progress = Math.min((now - begin) / COUNT_MS, 1);
    if (progress >= 1) {
      element.textContent = final;
      running.delete(element);
      return;
    }
    const value = from.value + (to.value - from.value) * easeOut(progress);
    element.textContent = `${to.before}${value.toFixed(Math.max(from.places, to.places))}${to.after}`;
    running.set(element, requestAnimationFrame(step));
  };
  running.set(element, requestAnimationFrame(step));
}
