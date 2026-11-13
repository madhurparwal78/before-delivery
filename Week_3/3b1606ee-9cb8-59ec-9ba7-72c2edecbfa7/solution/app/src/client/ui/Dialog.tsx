import { createContext, useCallback, useContext, useLayoutEffect, useRef, type ReactNode } from 'react';
import { focusables, trapTab } from '../lib/dialog';
import { EASE } from '../lib/motion';
import { prefersReducedMotion } from '../lib/hooks';

const CloseContext = createContext<() => void>(() => undefined);

/** Closes the surrounding dialog the same way Escape does. */
export const useDialogClose = (): (() => void) => useContext(CloseContext);

const EXIT_MS = 150;

export function Dialog({ label, onClose, children, className = '', returnTo }: { label: string; onClose: () => void; children: ReactNode; className?: string; returnTo?: HTMLElement | null }) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(returnTo ?? (document.activeElement as HTMLElement | null));
  const closing = useRef(false);
  const pressedBackdrop = useRef(false);
  const armed = useRef(false);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    const dialog = ref.current;
    if (dialog) {
      // The page behind a modal dialog is inert, so the dialog stops being modal first; a copy fades out in its place.
      const rect = dialog.getBoundingClientRect();
      const ghost = document.createElement('div');
      ghost.className = `${dialog.className} dialog--ghost`;
      ghost.setAttribute('aria-hidden', 'true');
      ghost.setAttribute('inert', '');
      ghost.innerHTML = dialog.innerHTML;
      Object.assign(ghost.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
      document.body.append(ghost);
      dialog.close();
      const reduced = prefersReducedMotion();
      void ghost
        .animate(reduced ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(8px)' }], {
          duration: reduced ? 100 : EXIT_MS,
          easing: EASE,
          fill: 'forwards',
        })
        .finished.then(() => ghost.remove());
    }
    if (opener.current?.isConnected) opener.current.focus();
    onClose();
  }, [onClose]);

  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    focusables(dialog)[0]?.focus();
    return () => {
      if (!closing.current && opener.current?.isConnected) opener.current.focus();
    };
  }, []);

  return (
    <CloseContext.Provider value={close}>
      <dialog
        ref={ref}
        aria-label={label}
        className={`dialog ${className}`}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            close();
          } else if (event.key === 'Tab') trapTab(ref.current!, event.nativeEvent);
        }}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onPointerDown={(event) => {
          armed.current = true;
          pressedBackdrop.current = event.target === ref.current;
        }}
        onClickCapture={(event) => {
          // A finger lifted over the dialog after a long press must not press what is beneath it.
          if (event.detail > 0 && !armed.current) {
            event.stopPropagation();
            event.preventDefault();
          }
        }}
        onClick={(event) => {
          if (event.target === ref.current && pressedBackdrop.current) close();
          pressedBackdrop.current = false;
        }}
      >
        <div className="dialog__page">{children}</div>
      </dialog>
    </CloseContext.Provider>
  );
}
