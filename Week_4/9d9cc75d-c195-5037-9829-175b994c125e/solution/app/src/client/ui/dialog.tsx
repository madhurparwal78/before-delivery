import { useId, useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './button.tsx';

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function tabbables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter((element) => element.getClientRects().length > 0);
}

function focusFirst(root: HTMLElement): void {
  const preferred = root.querySelector<HTMLElement>('[data-autofocus]');
  const controls = tabbables(root);
  (preferred ?? controls.find((element) => !element.closest('.dialog-close')) ?? controls[0] ?? root).focus();
}

interface ModalProps {
  /** the accessible name, shown as the heading */
  name: string;
  /** called for Escape, the Close button and a click outside */
  onClose: () => void;
  /** where focus goes when the dialog closes, when that is not the control that opened it */
  returnFocus?: () => HTMLElement | SVGElement | null;
  children: ReactNode;
}

interface InternalProps extends ModalProps {
  sheet: boolean;
  dataSheet?: 'bottom';
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function Modal({ name, onClose, returnFocus, children, sheet, dataSheet }: InternalProps) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | SVGElement | null>(null);
  const latest = useRef(returnFocus);
  latest.current = returnFocus;

  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    opener.current = document.activeElement instanceof HTMLElement || document.activeElement instanceof SVGElement ? document.activeElement : null;
    focusFirst(element);
    if (sheet && !prefersReducedMotion()) {
      element.animate(
        [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }],
        { id: 'sheet-open', duration: 240, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      );
    }
    const keepInside = (event: FocusEvent) => {
      if (event.target instanceof Node && !element.contains(event.target)) focusFirst(element);
    };
    document.addEventListener('focusin', keepInside);
    return () => {
      document.removeEventListener('focusin', keepInside);
      const target = latest.current?.() ?? opener.current;
      queueMicrotask(() => {
        if (target?.isConnected) target.focus();
      });
    };
  }, [sheet]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !box.current) return;
    const controls = tabbables(box.current);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && (document.activeElement === first || document.activeElement === box.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className={sheet ? 'overlay overlay-sheet' : 'overlay'}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={sheet ? 'dialog dialog-sheet' : 'dialog'}
        data-sheet={dataSheet}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className="dialog-title">
          {name}
        </h2>
        <div className="dialog-body">{children}</div>
        <div className="dialog-close">
          <Button variant="quiet" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * A modal dialog. Mount it while it is open and unmount it to close. Focus lands on the first control, Tab wraps,
 * Escape calls `onClose`, and focus returns to the opener (or `returnFocus()`) when the dialog unmounts.
 * A control inside that uses Escape itself must stop the event's propagation.
 */
export function Dialog(props: ModalProps) {
  return <Modal {...props} sheet={false} />;
}

/** A phone dialog that slides up with one `sheet-open` animation, and none under reduced motion. */
export function BottomSheet({ dataSheet, ...props }: ModalProps & { dataSheet?: 'bottom' }) {
  return <Modal {...props} sheet dataSheet={dataSheet} />;
}
