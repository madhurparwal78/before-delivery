/**
 * A linear opacity fade driven by animation frames and finished by a timer, both on the page's own clock, so a test that
 * pauses and steps the clock steps the fade too. Returns a function that cancels it.
 */
export function fadeOnClock(element: HTMLElement, from: number, to: number, ms: number, done: () => void): () => void {
  const start = performance.now();
  element.style.opacity = String(from);
  let frame = 0;
  const step = () => {
    const progress = Math.min(1, (performance.now() - start) / ms);
    element.style.opacity = String(from + (to - from) * progress);
    frame = window.requestAnimationFrame(step);
  };
  frame = window.requestAnimationFrame(step);
  const timer = window.setTimeout(() => {
    window.cancelAnimationFrame(frame);
    element.style.opacity = String(to);
    done();
  }, ms);
  return () => {
    window.cancelAnimationFrame(frame);
    window.clearTimeout(timer);
  };
}
