/** The fixed header is 64 pixels tall; a focused element's top edge keeps 8 pixels clear below it. */
const CLEAR_TOP = 72;

/** Scrolls just enough to bring the element into the clear zone, and not at all when it is already there. */
function scrollIntoClear(element: HTMLElement): void {
  if (element.closest(".site-header, dialog")) return;
  const box = element.getBoundingClientRect();
  const available = window.innerHeight - CLEAR_TOP;
  if (box.top < CLEAR_TOP) {
    window.scrollBy({ top: box.top - CLEAR_TOP, behavior: "instant" });
  } else if (box.height <= available && box.bottom > window.innerHeight) {
    window.scrollBy({ top: box.bottom - window.innerHeight, behavior: "instant" });
  }
}

/** A scripted focus move: focuses the element, then keeps it clear of the header. */
export function focusClear(element: HTMLElement | null | undefined): void {
  if (!element) return;
  element.focus({ preventScroll: true });
  scrollIntoClear(element);
}

/** Keyboard focus (Tab, arrows) is kept clear of the header too; a pointer click never scrolls. */
export function guardKeyboardFocus(): void {
  document.addEventListener("focusin", (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.matches(":focus-visible")) scrollIntoClear(target);
  });
}

export function isTextEntry(element: Element | null): boolean {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement || (element instanceof HTMLElement && element.isContentEditable);
}
