import { useEffect, useRef, type ReactNode } from 'react';
import { useLayout } from '../lib/layout.ts';

/**
 * A review dialog. On phones it is a full-width bottom sheet; elsewhere it is
 * a centred dialog over the sheet. A closed review is not rendered at all, so
 * it is invisible, unfocusable, untappable and absent from the accessibility
 * tree at every viewport.
 *
 * Opening moves focus to G10. Tab and Shift+Tab wrap inside. Escape works the
 * same as G10, and closing returns focus to the control that opened it.
 */

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

export interface ReviewProps {
  open: boolean;
  title: string;
  /** A summary of the proposed change and the specimens it affects. */
  children: ReactNode;
  confirmDisabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  /** Extra controls, such as N06 inside "Accept offer version". */
  extra?: ReactNode;
  /** Where focus returns when the dialog closes. */
  opener: React.RefObject<HTMLElement>;
}

export function Review({
  open,
  title,
  children,
  confirmDisabled,
  onCancel,
  onConfirm,
  extra,
  opener,
}: ReviewProps): JSX.Element | null {
  const layout = useLayout();
  const panel = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancel.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        opener.current?.focus();
        return;
      }
      if (event.key !== 'Tab') return;
      const within = panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!within || within.length === 0) return;
      const first = within[0] as HTMLElement;
      const last = within[within.length - 1] as HTMLElement;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, onCancel, opener]);

  if (!open) return null;

  return (
    <div className="review-scrim" data-layout={layout}>
      <div
        className={layout === 'phone' ? 'review review-sheet' : 'review review-centred'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panel}
      >
        <h2 className="review-title">{title}</h2>
        <div className="review-body">{children}</div>
        {extra}
        <div className="review-actions">
          <button
            type="button"
            className="target"
            ref={cancel}
            onClick={() => {
              onCancel();
              opener.current?.focus();
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="target primary"
            disabled={confirmDisabled === true}
            onClick={onConfirm}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

/** A summary line naming a specimen the change affects. */
export function ReviewLine({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <p className="review-line">
      <span className="review-label">{label}:</span> <span>{value}</span>
    </p>
  );
}
