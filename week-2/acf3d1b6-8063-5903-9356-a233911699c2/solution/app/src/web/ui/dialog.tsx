import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { Close } from './icons.js';
import { trapDialog } from './dialog-trap.js';
import { EASE_OUT, play } from './motion.js';

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  /** `drawer` slides in from the left edge; the default zooms in softly. */
  variant?: 'modal' | 'drawer';
  /** Shown as the heading; drawers name themselves with `title` but show the wordmark instead. */
  heading?: ComponentChildren;
}

/** A modal `<dialog>` that is open while it is rendered. Focus returns to whatever opened it. */
export function Dialog({ title, onClose, children, variant = 'modal', heading }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    const release = trapDialog(dialog, () => closeRef.current());
    const duration = variant === 'drawer' ? 250 : 200;
    play(
      dialog,
      variant === 'drawer'
        ? [{ transform: 'translateX(-100%)' }, { transform: 'none' }]
        : [{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }],
      { duration, easing: EASE_OUT },
    );
    play(dialog, [{ opacity: 0 }, { opacity: 1 }], { duration, easing: EASE_OUT, pseudoElement: '::backdrop' });
    return () => release(opener);
  }, []);

  const titleId = `dialog-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <dialog
      ref={ref}
      class={variant === 'drawer' ? 'drawer' : 'modal'}
      aria-labelledby={titleId}
      onClick={(event) => event.target === ref.current && onClose()}
    >
      <div class="dialog-panel">
        <div class="dialog-head">
          <h2 id={titleId} class={heading ? 'sr-only' : 'dialog-title'}>{title}</h2>
          {heading}
          <button type="button" class="icon-button" aria-label="Close" onClick={onClose}>
            <Close />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
