/** Run an action as soon as the element it needs has rendered. */
export function whenReady(selector: string, action: () => void, tries = 20): void {
  const attempt = (left: number) => {
    if (document.querySelector(selector)) {
      action();
      return;
    }
    if (left > 0) window.setTimeout(() => attempt(left - 1), 16);
  };
  attempt(tries);
}

/** Focus a control as soon as the screen that holds it has rendered. */
export function focusWhenReady(selector: string, tries = 20): void {
  const attempt = (left: number) => {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) {
      element.focus();
      return;
    }
    if (left > 0) window.setTimeout(() => attempt(left - 1), 16);
  };
  attempt(tries);
}
