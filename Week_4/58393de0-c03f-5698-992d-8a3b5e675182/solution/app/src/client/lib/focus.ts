const FOCUSABLE = [
  "a[href]", "button:not([disabled])", "input:not([disabled]):not([type='hidden'])", "select:not([disabled])",
  "textarea:not([disabled])", "[tabindex]:not([tabindex='-1'])", "summary",
].join(",");

/** Enabled, visible, tabbable elements inside a root, in document order. */
export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    if (el.closest("[hidden], [inert]")) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none" && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0);
  });
}
