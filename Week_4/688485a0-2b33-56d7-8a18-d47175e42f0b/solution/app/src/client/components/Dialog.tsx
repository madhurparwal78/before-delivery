import { type ReactNode, createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { focusables, reducedMotion, trapTab } from "../focus.js";

/** Modal dialogs and drawers: focus moves in, Tab wraps, Escape closes, focus returns to the opener, closed means inert. */

let locks = 0;

function lockPage(on: boolean): void {
  locks += on ? 1 : -1;
  const root = document.getElementById("root");
  if (root) root.inert = locks > 0;
}

/**
 * Which dialog is open. A dialog that is still leaving never swallows a reopen: every opening gets a new id, so the old
 * dialog's late `onClose` leaves the new one alone.
 */
export function useOverlay<T = true>(): { slot: { id: number; value: T } | null; open: (value: T) => void; closeFor: (id: number) => () => void } {
  const [slot, setSlot] = useState<{ id: number; value: T } | null>(null);
  const counter = useRef(0);
  const open = useCallback((value: T) => setSlot({ id: ++counter.current, value }), []);
  const closeFor = useCallback((id: number) => () => setSlot((current) => (current?.id === id ? null : current)), []);
  return { slot, open, closeFor };
}

const CloseContext = createContext<() => void>(() => undefined);

/** Close the surrounding dialog with its leave transition (Cancel, Close). */
export const useDialogClose = (): (() => void) => useContext(CloseContext);

interface DialogProps {
  name: string;
  onClose: () => void;
  variant?: "center" | "drawer" | "full";
  children: ReactNode;
}

export function Dialog({ name, onClose, variant = "center", children }: DialogProps): ReactNode {
  const surface = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  if (opener.current === null && document.activeElement instanceof HTMLElement) opener.current = document.activeElement;
  const released = useRef(false);
  const [leaving, setLeaving] = useState(false);

  const release = useCallback((): void => {
    if (released.current) return;
    released.current = true;
    lockPage(false);
  }, []);

  useLayoutEffect(() => {
    lockPage(true);
    const node = surface.current;
    if (node) (node.querySelector<HTMLElement>("[data-autofocus]") ?? focusables(node)[0] ?? node).focus();
    return () => {
      if (released.current) return;
      release();
      if (opener.current?.isConnected) opener.current.focus();
    };
  }, [release]);

  const requestClose = useCallback((): void => {
    if (released.current) return;
    release();
    if (opener.current?.isConnected) opener.current.focus();
    if (reducedMotion()) onClose();
    else setLeaving(true);
  }, [onClose, release]);

  useEffect(() => {
    if (!leaving) return;
    const fallback = setTimeout(onClose, 400);
    return () => clearTimeout(fallback);
  }, [leaving, onClose]);

  return createPortal(
    <div className={`overlay overlay-${variant}`} data-leaving={leaving || undefined} inert={leaving} aria-hidden={leaving || undefined}>
      {variant === "full" ? null : <div className="scrim" onClick={requestClose} />}
      <div
        ref={surface}
        role="dialog"
        aria-modal="true"
        aria-label={name}
        tabIndex={-1}
        className={`dialog dialog-${variant}`}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            requestClose();
          } else if (surface.current) {
            trapTab(event, surface.current);
          }
        }}
        onAnimationEnd={(event) => {
          if (leaving && event.target === surface.current) onClose();
        }}
      >
        <CloseContext value={requestClose}>{children}</CloseContext>
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({ name, text, confirm = "Delete", onConfirm, onClose }: { name: string; text: string; confirm?: string; onConfirm: () => void; onClose: () => void }): ReactNode {
  return (
    <Dialog name={name} onClose={onClose}>
      <ConfirmBody text={text} confirm={confirm} onConfirm={onConfirm} />
    </Dialog>
  );
}

function ConfirmBody({ text, confirm, onConfirm }: { text: string; confirm: string; onConfirm: () => void }): ReactNode {
  const close = useDialogClose();
  return (
    <div className="dialog-body">
      <p>{text}</p>
      <div className="actions">
        <button type="button" className="btn" data-autofocus onClick={close}>
          Cancel
        </button>
        <button type="button" className="btn btn-ink" onClick={onConfirm}>
          {confirm}
        </button>
      </div>
    </div>
  );
}
