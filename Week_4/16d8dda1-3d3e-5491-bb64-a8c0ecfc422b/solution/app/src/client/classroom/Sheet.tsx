import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useModal } from '../ui/Dialog';
import { Icon } from '../ui/icons';
import { useClassroom } from './context';
import { tween } from './motion';

const SLIDE_MS = 250;
const easeOut = (progress: number): number => 1 - (1 - progress) ** 3;

/**
 * The tablet bottom sheet: a modal that slides up and down on the page clock. Only the parts of the page marked
 * `data-modal-inert` go inert, so the Class announcements strip stays readable while the sheet is open.
 */
export function Sheet({ onClosed, children }: { onClosed: () => void; children: ReactNode }) {
  const { reduced } = useClassroom();
  const ref = useRef<HTMLDivElement>(null);
  const leaving = useRef(false);
  const cancel = useRef<(() => void) | null>(null);
  const inertParts = useRef<Element[]>([]);

  const slideTo = (from: number, to: number, done: () => void) => {
    const element = ref.current;
    if (!element) return;
    cancel.current?.();
    cancel.current = tween(
      SLIDE_MS,
      (progress) => {
        element.style.transform = `translateY(${(from + (to - from) * easeOut(progress)) * 100}%)`;
      },
      () => {
        element.style.transform = '';
        done();
      },
    );
  };

  const requestClose = () => {
    if (leaving.current) return;
    leaving.current = true;
    if (reduced) onClosed();
    else slideTo(0, 1, onClosed);
  };

  // Cleanups run in declaration order: the parts must be live again before useModal returns focus to the opener.
  useLayoutEffect(
    () => () => {
      cancel.current?.();
      inertParts.current.forEach((part) => part.removeAttribute('inert'));
    },
    [],
  );

  useModal(ref, requestClose);

  useLayoutEffect(() => {
    inertParts.current = [...document.querySelectorAll('[data-modal-inert]')];
    document.getElementById('root')?.removeAttribute('inert');
    inertParts.current.forEach((part) => part.setAttribute('inert', ''));
    if (ref.current && !reduced) {
      ref.current.style.transform = 'translateY(100%)';
      slideTo(1, 0, () => undefined);
    }
  }, []);

  return createPortal(
    <>
      <div className="sheet-backdrop" onClick={requestClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Class panel" data-sheet="" ref={ref} tabIndex={-1}>
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-head">
          <button type="button" data-native-enter="" onClick={requestClose}>
            <Icon name="close" size={18} />
            Close panel
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </>,
    document.body,
  );
}
