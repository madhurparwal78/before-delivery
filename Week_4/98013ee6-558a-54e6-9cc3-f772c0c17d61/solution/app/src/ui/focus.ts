const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.getClientRects().length > 0 && !element.closest("[inert]"));
}

/** Tab and Shift+Tab wrap inside `root`. Returns true when the key was handled. */
export function trapTab(event: { key: string; shiftKey: boolean; preventDefault: () => void }, root: HTMLElement): boolean {
  if (event.key !== "Tab") return false;
  const items = focusables(root);
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) {
    event.preventDefault();
    root.focus();
    return true;
  }
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !root.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !root.contains(active))) {
    event.preventDefault();
    first.focus();
  }
  return true;
}

/** Open dialogs, outermost first. Only the topmost one handles Escape and keeps focus. */
const open: symbol[] = [];
export const pushDialog = (token: symbol): void => {
  open.push(token);
};
export const popDialog = (token: symbol): void => {
  const index = open.indexOf(token);
  if (index >= 0) open.splice(index, 1);
};
export const isTopDialog = (token: symbol): boolean => open[open.length - 1] === token;
