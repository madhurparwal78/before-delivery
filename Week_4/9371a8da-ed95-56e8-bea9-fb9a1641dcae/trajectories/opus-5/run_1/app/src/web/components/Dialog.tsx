import { ReactNode, useEffect, useRef } from 'react';
import { focusablesIn, LAYER_CONFIRMATION, LAYER_DIALOG, useEscapeLayer } from '../layers.js';

interface Props {
  name: string;
  kind?: 'dialog' | 'alertdialog';
  onClose: () => void;
  /** Which control takes focus when the dialog opens. */
  firstFocus?: 'first' | 'last' | 'self' | string;
  returnFocusTo?: () => HTMLElement | null;
  className?: string;
  children: ReactNode;
}

export function Dialog(props: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEscapeLayer(props.onClose, props.kind === 'alertdialog' ? LAYER_CONFIRMATION : LAYER_DIALOG);

  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const host = hostRef.current;
    if (host === null) return () => undefined;
    const target = props.firstFocus ?? 'first';
    const choose = (): HTMLElement | null => {
      if (target === 'self') return host;
      if (typeof target === 'string' && target !== 'first' && target !== 'last') {
        const named = host.querySelector<HTMLElement>(target);
        if (named !== null) return named;
      }
      const focusables = focusablesIn(host);
      if (focusables.length === 0) return host;
      return target === 'last' ? focusables[focusables.length - 1] : focusables[0];
    };
    const element = choose();
    element?.focus();
    return () => {
      const back = props.returnFocusTo?.() ?? opener.current;
      if (back !== null && back.isConnected) back.focus();
    };
  }, []);

  return (
    <div className="dialog-scrim">
      <div
        ref={hostRef}
        className={`dialog ${props.className ?? ''}`}
        role={props.kind ?? 'dialog'}
        aria-modal="true"
        aria-label={props.name}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const host = hostRef.current;
          if (host === null) return;
          const focusables = focusablesIn(host);
          if (focusables.length === 0) {
            event.preventDefault();
            return;
          }
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          const active = document.activeElement;
          if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
          } else if (event.shiftKey && (active === first || active === host)) {
            event.preventDefault();
            last.focus();
          }
        }}
      >
        {props.children}
      </div>
    </div>
  );
}
