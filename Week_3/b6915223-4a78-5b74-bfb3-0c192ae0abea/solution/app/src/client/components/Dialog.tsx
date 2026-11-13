import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";

// A modal dialog: Tab and Shift+Tab stay inside, Escape closes, focus returns to the opener
// (brief: Interactions / Dialogs and sheets).
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal(props: {
  title: string;
  onClose: () => void;
  children: (close: () => void) => ComponentChildren;
  initialFocus?: string;
  sheet?: boolean;
  returnTo?: () => HTMLElement | null;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useRef(`dialog-${Math.random().toString(36).slice(2)}`);
  const closeRef = useRef(props.onClose);
  closeRef.current = props.onClose;
  const returnRef = useRef(props.returnTo);
  returnRef.current = props.returnTo;
  // Leaves a little faster than it arrived; at once under reduced motion.
  const close = () => {
    const dialog = ref.current;
    if (!dialog || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      closeRef.current();
      return;
    }
    const exit = dialog.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(8px)" }], {
      duration: 140,
      easing: "cubic-bezier(0.4, 0, 1, 1)",
      fill: "forwards",
    });
    void exit.finished.then(() => closeRef.current(), () => closeRef.current());
  };
  const closeLatest = useRef(close);
  closeLatest.current = close;

  useLayoutEffect(() => {
    const dialog = ref.current!;
    opener.current = document.activeElement as HTMLElement | null;
    dialog.showModal();
    const first = (props.initialFocus ? dialog.querySelector<HTMLElement>(props.initialFocus) : null) ?? dialog.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => {
      dialog.close();
      const target = returnRef.current?.() ?? opener.current;
      target?.focus();
    };
  }, []);

  useEffect(() => {
    const dialog = ref.current!;
    const onCancel = (event: Event) => {
      event.preventDefault();
      closeLatest.current();
    };
    dialog.addEventListener("cancel", onCancel);
    return () => dialog.removeEventListener("cancel", onCancel);
  }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const items = [...ref.current!.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => item.offsetParent !== null || item === document.activeElement);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey && (active === first || !ref.current!.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !ref.current!.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog ref={ref} class={`modal${props.sheet ? " sheet" : ""}`} aria-labelledby={titleId.current} onKeyDown={onKeyDown}>
      <div class="dialog-body">
        <h3 id={titleId.current}>{props.title}</h3>
        {props.children(close)}
      </div>
    </dialog>
  );
}
