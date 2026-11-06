// Modal dialogs on native <dialog>: focus moves in, Tab and Shift+Tab cycle inside, Escape closes,
// and focus returns to the opener (adapted from kit/modules/a11y_dialog).

import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useContext, useLayoutEffect, useRef } from "preact/hooks";
import { reducedMotion } from "./store.js";

const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const FADE_MS = 180;
const SELECTOR = "button, input:not([type=hidden]), select, textarea, a[href], [tabindex]:not([tabindex='-1'])";

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(SELECTOR)].filter((el) => !el.hasAttribute("disabled") && el.getClientRects().length > 0);
}

type Scroll = Array<[Element | Window, number, number]>;

/** The page's and every scrolling frame's positions, so a dialog leaves them exactly as it found them. */
function savedScroll(): Scroll {
  const frames: Scroll = [...document.querySelectorAll(".board-frame, .rail")].map((el) => [el, el.scrollLeft, el.scrollTop]);
  return [[window, window.scrollX, window.scrollY], ...frames];
}

function restoreScroll(saved: Scroll): void {
  for (const [el, left, top] of saved) el.scrollTo({ left, top, behavior: "instant" });
}

/** A moved, put-back or created item that is not already in view is jumped into view inside its board frame. */
function bringIntoFrame(target: HTMLElement): void {
  const frame = target.closest(".board-frame, .rail");
  if (!frame) return;
  const box = target.getBoundingClientRect();
  const view = frame.getBoundingClientRect();
  if (box.left < view.left || box.right > view.right || box.top < view.top || box.bottom > view.bottom) {
    target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  }
}

const CloseContext = createContext<() => void>(() => undefined);

/** Closes the surrounding dialog with its exit motion. */
export const useDialogClose = (): (() => void) => useContext(CloseContext);

interface Props {
  title: string;
  onClose: () => void;
  /** Where focus lands when the dialog closes; defaults to the element that opened it. */
  returnTo?: () => HTMLElement | null;
  wide?: boolean;
  children: ComponentChildren;
}

let headingIds = 0;

export function Dialog({ title, onClose, returnTo, wide, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const closing = useRef(false);
  const headingId = useRef(`dialog-title-${++headingIds}`);
  const returnRef = useRef(returnTo);
  returnRef.current = returnTo;

  const close = (): void => {
    const dialog = ref.current;
    if (!dialog || closing.current) return;
    closing.current = true;
    if (reducedMotion()) {
      onClose();
      return;
    }
    dialog.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(8px)" }], { duration: FADE_MS, easing: EASE, fill: "forwards" })
      .finished.then(onClose, onClose);
  };

  useLayoutEffect(() => {
    const dialog = ref.current!;
    const scrolled = savedScroll();
    dialog.showModal();
    focusables(dialog)[0]?.focus();
    if (!reducedMotion()) {
      dialog.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: FADE_MS, easing: EASE });
    }
    return () => {
      if (dialog.open) dialog.close();
      const target = returnRef.current?.() ?? opener.current;
      restoreScroll(scrolled);
      if (target?.isConnected) {
        target.focus({ preventScroll: true });
        if (target !== opener.current) bringIntoFrame(target);
      }
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent): void => {
    e.stopPropagation();
    if (e.key !== "Tab") return;
    const items = focusables(ref.current!);
    if (!items.length) {
      e.preventDefault();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !ref.current!.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !ref.current!.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog
      ref={ref}
      class={wide ? "dialog dialog-wide" : "dialog"}
      aria-labelledby={headingId.current}
      onKeyDown={onKeyDown}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <CloseContext.Provider value={close}>
        <h2 id={headingId.current} class="dialog-title">{title}</h2>
        {children}
      </CloseContext.Provider>
    </dialog>
  );
}
