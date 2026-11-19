// Tab order helpers, adapted from kit/modules/a11y_dialog: the focusable elements of a container,
// and the Tab / Shift+Tab wrap that keeps focus inside an open dialog or expanded sheet.

function isFocusable(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement) || el.hasAttribute("disabled") || el.closest("[hidden],[inert]") !== null) return false;
  const tabindex = el.getAttribute("tabindex");
  if (tabindex !== null) return Number(tabindex) >= 0;
  const tag = el.tagName.toLowerCase();
  if (tag === "a") return el.hasAttribute("href");
  if (tag === "input") return el.getAttribute("type") !== "hidden";
  return ["button", "select", "textarea", "summary"].includes(tag) || el.getAttribute("contenteditable") === "true";
}

export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll("*")].filter(isFocusable);
}

/** Wraps Tab at the ends of `root` and pulls stray focus back in; returns true when it handled the key. */
export function trapTab(root: HTMLElement, event: KeyboardEvent): boolean {
  if (event.key !== "Tab") return false;
  const items = focusables(root);
  const first = items[0];
  const last = items[items.length - 1];
  if (first === undefined || last === undefined) {
    event.preventDefault();
    return true;
  }
  const active = document.activeElement;
  const edge = event.shiftKey ? first : last;
  if (active === edge || !root.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return true;
  }
  return false;
}

/** Whether a dialog is open (a leaving one no longer counts). */
export function dialogOpen(): boolean {
  return document.querySelector(".backdrop:not([inert])") !== null;
}

/** Whether a keystroke is being typed into a text field (where shortcuts must not fire). */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !["button", "checkbox", "radio", "submit", "reset", "file", "range"].includes(target.type);
}
