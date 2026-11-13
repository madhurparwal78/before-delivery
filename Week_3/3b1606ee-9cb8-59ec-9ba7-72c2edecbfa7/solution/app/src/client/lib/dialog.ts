/** Focus handling for dialogs, adapted from the kit's a11y_dialog module (focus trap, Escape, return of focus). */

function isFocusable(element: Element): boolean {
  if (element.hasAttribute('disabled') || element.hasAttribute('hidden') || element.hasAttribute('inert')) return false;
  const tabindex = element.getAttribute('tabindex');
  if (tabindex !== null) return Number(tabindex) >= 0;
  const tag = element.tagName.toLowerCase();
  if (tag === 'a') return element.hasAttribute('href');
  if (tag === 'input') return element.getAttribute('type') !== 'hidden';
  return ['button', 'select', 'textarea', 'summary'].includes(tag);
}

export function focusables(root: Element): HTMLElement[] {
  return [...root.querySelectorAll('*')].filter(isFocusable) as HTMLElement[];
}

/** Keeps Tab and Shift+Tab inside `dialog`: from the last control to the first, and from the first to the last. */
export function trapTab(dialog: HTMLElement, event: KeyboardEvent): void {
  const controls = focusables(dialog);
  const active = document.activeElement;
  if (controls.length === 0) {
    event.preventDefault();
    return;
  }
  const edge = event.shiftKey ? controls[0]! : controls[controls.length - 1]!;
  if (active === edge || !dialog.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? controls[controls.length - 1]! : controls[0]!).focus();
  }
}
