/** Focus helpers shared by dialogs, menus and the editor (adapted from the kit's a11y_dialog module). */

function isFocusable(element: Element): element is HTMLElement {
  if (element.hasAttribute("disabled") || element.hasAttribute("hidden") || element.closest("[inert], [hidden]")) return false;
  const tabindex = element.getAttribute("tabindex");
  if (tabindex !== null) return Number(tabindex) >= 0;
  const tag = element.tagName.toLowerCase();
  if (tag === "a" || tag === "area") return element.hasAttribute("href");
  if (tag === "input") return element.getAttribute("type") !== "hidden";
  return ["button", "select", "textarea", "summary"].includes(tag) || element.getAttribute("contenteditable") === "true";
}

export function focusables(root: Element): HTMLElement[] {
  return [...root.querySelectorAll("*")].filter(isFocusable);
}

/** Keep Tab and Shift+Tab inside `root`, wrapping at both ends. */
export function trapTab(event: { key: string; shiftKey: boolean; preventDefault: () => void }, root: Element): void {
  if (event.key !== "Tab") return;
  const items = focusables(root);
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return event.preventDefault();
  const active = document.activeElement;
  if (!root.contains(active)) {
    event.preventDefault();
    first.focus();
  } else if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

export const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
