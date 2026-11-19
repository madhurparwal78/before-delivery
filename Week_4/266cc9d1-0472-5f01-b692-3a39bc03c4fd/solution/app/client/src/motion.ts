// The operating system's reduce-motion setting, read live, and the exit step shared by dialogs and
// the phone sheet (their entry and exit are CSS animations of --dur-entry, removed under reduced motion).

const query = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;

export function prefersReducedMotion(): boolean {
  return query?.matches === true;
}

/** Plays the element's exit animation (the `leaving` class), then resolves; at once with reduced motion. */
export function playExit(element: HTMLElement): Promise<void> {
  if (prefersReducedMotion()) return Promise.resolve();
  return new Promise((resolve) => {
    element.classList.add("leaving");
    const running = element.getAnimations().filter((a) => a instanceof CSSAnimation);
    if (running.length === 0) {
      element.classList.remove("leaving");
      resolve();
      return;
    }
    void Promise.all(running.map((a) => a.finished.catch(() => undefined))).then(() => {
      element.classList.remove("leaving");
      resolve();
    });
  });
}
