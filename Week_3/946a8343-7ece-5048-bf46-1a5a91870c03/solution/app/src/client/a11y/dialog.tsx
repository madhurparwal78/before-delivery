// Modal dialog and bottom sheet.
//   <Dialog name open onClose opener? initialFocus? class?>   role=dialog named by `name` (aria-label). While open: Tab and
//       Shift+Tab wrap inside, Escape and a click on the scrim call onClose, focus moves in (initialFocus, else the first
//       control, else the dialog) and returns to `opener` on close (a ref or element; default: whatever had focus at open),
//       and everything behind it is `inert`. It renders nothing when `open` is false.
//   <Sheet ... motion?>   the same behaviour as a bottom sheet. `motion(el)` runs once when the sheet opens (layout phase) so the
//       caller can start its own element.animate() with the id it needs; closing is instant.
//   hasOpenDialog()       true while any dialog or sheet is open (landmark keys and shortcuts stand down).
// Elements marked data-never-inert (the announcements and notifications regions) stay live behind a dialog.
import type { ComponentChildren, RefObject } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

interface DialogProps {
  name: string;
  open: boolean;
  onClose: () => void;
  opener?: RefObject<HTMLElement> | HTMLElement | null;
  initialFocus?: RefObject<HTMLElement>;
  class?: string;
  children?: ComponentChildren;
}

interface SheetProps extends DialogProps {
  motion?: (element: HTMLElement) => void;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

const stack: HTMLElement[] = [];

export function hasOpenDialog(): boolean {
  return stack.length > 0;
}

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0 && !el.closest("[inert]"));
}

function inertAround(layer: HTMLElement): () => void {
  const marked: HTMLElement[] = [];
  let node: HTMLElement | null = layer;
  while (node && node !== document.body) {
    const parent: HTMLElement | null = node.parentElement;
    if (!parent) break;
    for (const sibling of parent.children) {
      if (sibling === node || !(sibling instanceof HTMLElement)) continue;
      if (sibling.hasAttribute("inert") || sibling.hasAttribute("data-never-inert")) continue;
      sibling.setAttribute("inert", "");
      marked.push(sibling);
    }
    node = parent;
  }
  return () => {
    for (const element of marked) element.removeAttribute("inert");
  };
}

let scrollLocks = 0;

function resolveOpener(opener: DialogProps["opener"], fallback: Element | null): HTMLElement | null {
  const candidate = opener && "current" in opener ? opener.current : opener;
  if (candidate instanceof HTMLElement) return candidate;
  return fallback instanceof HTMLElement ? fallback : null;
}

function Layer(props: SheetProps & { variant: "dialog" | "sheet" }) {
  const layer = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;

  useLayoutEffect(() => {
    const layerEl = layer.current;
    const boxEl = box.current;
    if (!layerEl || !boxEl) return;
    const previouslyFocused = document.activeElement;
    stack.push(boxEl);
    const restoreInert = inertAround(layerEl);
    if (scrollLocks++ === 0) document.documentElement.classList.add("sp-scroll-locked");
    const first = latest.current.initialFocus?.current ?? focusables(boxEl)[0] ?? boxEl;
    first.focus();
    latest.current.motion?.(boxEl);

    const onKey = (event: KeyboardEvent) => {
      if (stack[stack.length - 1] !== boxEl) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        latest.current.onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const list = focusables(boxEl);
      const active = document.activeElement;
      const firstEl = list[0];
      const lastEl = list[list.length - 1];
      if (!firstEl || !lastEl) {
        event.preventDefault();
        boxEl.focus();
      } else if (!(active instanceof HTMLElement) || !boxEl.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? lastEl : firstEl).focus();
      } else if (event.shiftKey && (active === firstEl || active === boxEl)) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && active === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);

    return () => {
      document.removeEventListener("keydown", onKey, true);
      stack.splice(stack.indexOf(boxEl), 1);
      restoreInert();
      if (--scrollLocks === 0) document.documentElement.classList.remove("sp-scroll-locked");
      const back = resolveOpener(latest.current.opener, previouslyFocused);
      if (back && back.isConnected) back.focus();
    };
  }, []);

  const variant = props.variant;
  return (
    <div ref={layer} class={`sp-layer sp-layer--${variant}`}>
      <div class="sp-layer__scrim" onClick={() => latest.current.onClose()} />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={props.name}
        tabIndex={-1}
        class={`sp-${variant} sp-dark${props.class ? ` ${props.class}` : ""}`}
      >
        {props.children}
      </div>
    </div>
  );
}

export function Dialog(props: DialogProps) {
  if (!props.open) return null;
  return <Layer {...props} variant="dialog" />;
}

export function Sheet(props: SheetProps) {
  if (!props.open) return null;
  return <Layer {...props} variant="sheet" />;
}
