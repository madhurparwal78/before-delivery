/**
 * Open dialogs and the phone sheet form a stack. The top layer holds Tab inside itself, closes on Escape and
 * gives focus back to what had it before. Adapted from the kit's a11y_dialog module (a hand-built dialog).
 */
export interface Layer {
  element: HTMLElement;
  close: () => void;
  /** Where focus returns when the layer closes. */
  restore: HTMLElement | null;
}

const stack: Layer[] = [];

const FOCUSABLE =
  'button, input:not([type="hidden"]), select, textarea, a[href], [tabindex]:not([tabindex="-1"]), summary, [contenteditable="true"]';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) =>
      !(element as HTMLButtonElement).disabled &&
      !element.hidden &&
      !element.closest("[hidden], [inert]") &&
      element.getClientRects().length > 0,
  );
}

function onKeyDown(event: KeyboardEvent): void {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    top.close();
    return;
  }
  if (event.key !== "Tab") return;
  const items = focusables(top.element);
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) {
    event.preventDefault();
    return;
  }
  const active = document.activeElement;
  const outside = !(active instanceof HTMLElement) || !top.element.contains(active);
  if (event.shiftKey && (active === first || outside)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || outside)) {
    event.preventDefault();
    first.focus();
  }
}

let installed = false;

export function pushLayer(layer: Layer): void {
  if (!installed) {
    document.addEventListener("keydown", onKeyDown, true);
    installed = true;
  }
  stack.push(layer);
}

export function popLayer(layer: Layer): void {
  const at = stack.indexOf(layer);
  if (at >= 0) stack.splice(at, 1);
}

/** Whether a modal dialog (not the sheet) is open: room keys never act then. */
export const dialogOpen = (): boolean => stack.some((layer) => layer.element.getAttribute("role") === "dialog" && !layer.element.hasAttribute("data-sheet"));

export const anyLayerOpen = (): boolean => stack.length > 0;

export function focusFirst(root: HTMLElement): void {
  const preferred = root.querySelector<HTMLElement>("[data-autofocus]");
  (preferred ?? focusables(root)[0] ?? root).focus();
}
