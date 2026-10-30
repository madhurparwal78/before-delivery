// Hand-built modal dialog. Adapted from the kit's a11y_dialog module contract (kit/modules/a11y_dialog):
// focus the first field or button on open, keep Tab and Shift+Tab inside, close on Escape, and return
// focus to the opener. It is a role="dialog" element rather than <dialog>.showModal() so the page's
// live regions stay in the accessibility tree while it is open.
import { createContext, type ComponentChildren } from "preact";
import { useContext, useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { prefersReducedMotion } from "../store";

const FOCUSABLE = "a[href], button, input, select, textarea, [tabindex]";

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.hasAttribute("disabled") && el.tabIndex >= 0 && !(el instanceof HTMLInputElement && el.type === "hidden"),
  );
}

let titleCount = 0;

const DialogClose = createContext<() => void>(() => undefined);

interface DialogProps {
  title: string;
  /** The control that opened the dialog; focus returns to it on close. */
  opener: HTMLElement | null;
  onClose: () => void;
  children: ComponentChildren;
  wide?: boolean;
}

export function Dialog({ title, opener, onClose, children, wide }: DialogProps) {
  const box = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const titleId = useRef(`dialog-title-${++titleCount}`);
  const closing = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    const root = box.current;
    if (!root) return;
    const field = root.querySelector<HTMLElement>("input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])");
    (field ?? focusables(root)[0] ?? root).focus();
    if (!prefersReducedMotion()) {
      root.animate(
        [
          { opacity: 0, transform: "translateY(6px)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 200, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
      );
    }
  }, []);

  // Focus goes back to the opener when the dialog starts to leave, and again on unmount only if it is
  // still inside the dialog or nowhere, so a fade never pulls focus from a control the user moved to.
  const returnFocus = (): void => {
    const active = document.activeElement;
    const stranded = !active || active === document.body || box.current?.contains(active);
    if (stranded && opener?.isConnected) opener.focus();
  };
  const returnFocusRef = useRef(returnFocus);
  returnFocusRef.current = returnFocus;
  useEffect(() => () => returnFocusRef.current(), []);

  const close = (): void => {
    const root = box.current;
    if (closing.current) return;
    closing.current = true;
    // The leaving layer stops taking pointer and keyboard input at once, so nothing waits on the fade.
    layer.current?.classList.add("dialog-layer-leaving");
    layer.current?.setAttribute("inert", "");
    returnFocus();
    if (!root || prefersReducedMotion()) {
      onCloseRef.current();
      return;
    }
    const leave = root.animate([{ opacity: 1 }, { opacity: 0, transform: "translateY(4px)" }], {
      duration: 120,
      easing: "ease-in",
      fill: "forwards",
    });
    leave.onfinish = () => onCloseRef.current();
  };

  // Keys are handled for the whole document while the dialog is open, so Escape and Tab still work
  // when focus has dropped to the page (for example after a button was disabled while pending).
  const onKeyDown = (event: KeyboardEvent): void => {
    const root = box.current;
    if (!root || closing.current) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusables(root);
    if (!items.length) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !root.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !root.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  const keys = useRef(onKeyDown);
  keys.current = onKeyDown;
  useLayoutEffect(() => {
    const listener = (event: KeyboardEvent): void => keys.current(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  return (
    <div ref={layer} class="dialog-layer">
      <div class="dialog-wash" />
      <div
        ref={box}
        class={wide ? "dialog dialog-wide" : "dialog"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId.current}
        tabIndex={-1}
      >
        <h2 id={titleId.current} class="dialog-title">
          {title}
        </h2>
        <DialogClose.Provider value={close}>{children}</DialogClose.Provider>
      </div>
    </div>
  );
}

/** Closes the surrounding dialog with its leave motion and focus return. */
export function useCloseDialog(): () => void {
  return useContext(DialogClose);
}
