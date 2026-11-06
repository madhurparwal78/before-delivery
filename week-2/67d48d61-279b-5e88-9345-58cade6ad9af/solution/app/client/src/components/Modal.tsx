// A modal <dialog>: keeps Tab and Shift+Tab inside, closes on Escape with its exit motion, and
// returns focus to whatever opened it (a row is found again by its task id if it re-rendered).

import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DURATION, LEAVE, SETTLE, play } from "../motion";

export interface ModalHandle {
  close: () => void;
}

type Variant = "dialog" | "sheet" | "drawer" | "palette";

interface ModalProps {
  label: string;
  variant: Variant;
  onClosed: () => void;
  opener?: Element | null;
  children: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const focusables = (root: Element): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest("[inert]") && el.getClientRects().length > 0);

export const refocus = (opener: Element | null): void => {
  if (opener instanceof HTMLElement && opener.isConnected) {
    opener.focus({ preventScroll: true });
    return;
  }
  const id = opener instanceof HTMLElement ? opener.dataset.taskId : undefined;
  const row = id ? document.querySelector<HTMLElement>(`[role="row"][data-task-id="${id}"]`) : null;
  const fallback =
    row ??
    document.querySelector<HTMLElement>('[role="row"][aria-current="true"]') ??
    document.querySelector<HTMLElement>("main .empty h2, main h1, main h2");
  fallback?.focus({ preventScroll: true });
};

const MOTION: Record<Variant, { from: Keyframe; inMs: number }> = {
  dialog: { from: { opacity: 0, transform: "translateY(6px)" }, inMs: DURATION.dialog },
  palette: { from: { opacity: 0, transform: "translateY(6px)" }, inMs: DURATION.dialog },
  sheet: { from: { opacity: 0, transform: "translateY(40px)" }, inMs: DURATION.paneIn },
  drawer: { from: { opacity: 0, transform: "translateX(-40px)" }, inMs: DURATION.paneIn },
};

export const Modal = forwardRef<ModalHandle, ModalProps>(function Modal({ label, variant, onClosed, opener, children }, ref) {
  const dialog = useRef<HTMLDialogElement>(null);
  const openedBy = useRef<Element | null>(opener ?? null);
  const closing = useRef(false);
  const [leaving, setLeaving] = useState(false);
  const modal = variant === "dialog" || variant === "palette";

  // Dialogs and the palette are modal and close in one frame. The sheet and drawer cover the
  // page themselves (non-modal <dialog>, own focus trap) so they can slide away: focus returns at
  // once, and the element unmounts on the tick after its exit, already off-screen.
  const close = (): void => {
    const el = dialog.current;
    if (!el || closing.current) return;
    closing.current = true;
    setLeaving(true);
    for (const running of el.getAnimations()) running.finish();
    refocus(openedBy.current);
    const exit = modal ? null : play(el, [{ opacity: 1, transform: "none" }, MOTION[variant].from], { duration: DURATION.paneOut, easing: LEAVE, fill: "forwards" });
    const finish = (): void => {
      el.close();
      onClosed();
    };
    const gone = (): void => {
      el.dataset.gone = "true";
      setTimeout(finish, 0);
    };
    if (exit) void exit.finished.then(gone, gone);
    else finish();
  };

  useImperativeHandle(ref, () => ({ close }));

  useLayoutEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (!openedBy.current) openedBy.current = document.activeElement;
    if (modal) el.showModal();
    else el.show();
    play(el, [MOTION[variant].from, { opacity: 1, transform: "none" }], { duration: MOTION[variant].inMs, easing: SETTLE });
    const first = el.querySelector<HTMLElement>("[data-autofocus]") ?? focusables(el)[0];
    first?.focus();
    // The dialog opens once, when it mounts.
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>): void => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== "Tab" || !dialog.current) return;
    const list = focusables(dialog.current);
    const active = document.activeElement as HTMLElement | null;
    const at = active ? list.indexOf(active) : -1;
    if (!list.length) {
      e.preventDefault();
      return;
    }
    if (at === -1 || (e.shiftKey && at === 0) || (!e.shiftKey && at === list.length - 1)) {
      e.preventDefault();
      (e.shiftKey ? list[list.length - 1] : list[0]).focus();
    }
  };

  return createPortal(
    <>
      {variant === "drawer" && !leaving ? <div className="scrim" aria-hidden="true" onClick={close} /> : null}
      <dialog
        ref={dialog}
        className={`modal modal-${variant}`}
        aria-label={label}
        aria-modal="true"
        data-leaving={leaving ? "true" : undefined}
        onKeyDown={onKeyDown}
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
      >
        {children}
      </dialog>
    </>,
    document.body,
  );
});
