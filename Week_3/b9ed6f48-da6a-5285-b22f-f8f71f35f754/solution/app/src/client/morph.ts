// The numeral morph (brief: Motion › Numeral morph): the numeral a visitor followed travels and
// grows from its card or rail position into the chapter header over 650 ms, or swaps at once.

let pending: { numeral: string; rect: DOMRect; at: number } | null = null;

export function rememberNumeral(numeral: string, element: Element | null): void {
  pending = element ? { numeral, rect: element.getBoundingClientRect(), at: performance.now() } : null;
}

/** Plays the morph onto `target` if the visitor arrived by following that numeral. */
export function playMorph(numeral: string, target: HTMLElement, reducedMotion: boolean): void {
  const from = pending;
  pending = null;
  if (!from || from.numeral !== numeral || reducedMotion) return;
  const to = target.getBoundingClientRect();
  if (!to.width || !to.height) return;
  const scale = from.rect.height / to.height;
  const dx = from.rect.left - to.left;
  const dy = from.rect.top - to.top;
  target.animate(
    [
      { transformOrigin: "top left", transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
      { transformOrigin: "top left", transform: "translate(0, 0) scale(1)" },
    ],
    { duration: 650, easing: "cubic-bezier(.16, 1, .3, 1)" },
  );
}
