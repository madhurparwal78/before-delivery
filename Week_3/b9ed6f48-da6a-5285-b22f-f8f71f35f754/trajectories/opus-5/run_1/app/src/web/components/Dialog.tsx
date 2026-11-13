import { useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** The element that takes focus when the dialog opens, if not its first control. */
  initialFocus?: 'heading' | 'first';
  variant?: 'centre' | 'bottom-sheet';
  headingLevel?: 2 | 3;
  /** Overrides where focus goes when the dialog closes. */
  restoreFocus?: () => void;
  /** A dialog that shows its own heading instead of its title hides the title. */
  showTitle?: boolean;
}

/**
 * A dialog that keeps Tab inside itself, closes on Escape and returns focus to whatever
 * opened it. While closed it is not rendered at all, so nothing inside it can be reached.
 */
export function Dialog({
  title,
  onClose,
  children,
  initialFocus = 'first',
  variant = 'centre',
  headingLevel = 2,
  restoreFocus,
  showTitle = true,
}: DialogProps): JSX.Element {
  const panel = useRef<HTMLDivElement | null>(null);
  const body = useRef<HTMLDivElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = panel.current;
    if (!element) return undefined;
    if (initialFocus === 'heading') heading.current?.focus();
    else {
      const first =
        body.current?.querySelector<HTMLElement>(FOCUSABLE) ?? element.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? heading.current)?.focus();
    }
    return () => {
      if (restoreFocus) restoreFocus();
      else opener.current?.focus();
    };
    /* The opener is captured once, when the dialog opens. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFocus]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const element = panel.current;
      if (!element) return;
      const focusable = [...element.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (candidate) => candidate.offsetParent !== null || candidate === document.activeElement,
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) {
        event.preventDefault();
        last.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  const Heading = headingLevel === 2 ? 'h2' : 'h3';

  return (
    <div className={`scrim${variant === 'bottom-sheet' ? ' sheet-bottom' : ''}`}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} ref={panel}>
        <div className="dialog-head">
          {showTitle ? (
            <Heading tabIndex={-1} ref={heading}>
              {title}
            </Heading>
          ) : (
            <span />
          )}
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div ref={body}>{children}</div>
      </div>
    </div>
  );
}

/** A success heading that takes focus as soon as it appears. */
export function ConfirmationHeading({ children }: { children: ReactNode }): JSX.Element {
  const heading = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <h2 tabIndex={-1} ref={heading}>
      {children}
    </h2>
  );
}

export interface ErrorSummaryProps {
  message: string | null;
  fields?: Record<string, string>;
  fieldIds?: Record<string, string>;
}

/** The error summary at the top of a form: each field entry moves focus to its field. */
export function ErrorSummary({ message, fields = {}, fieldIds = {} }: ErrorSummaryProps): JSX.Element | null {
  const entries = Object.entries(fields);
  if (!message && entries.length === 0) return null;
  return (
    <div role="alert" className="alert">
      {message ? <p>{message}</p> : null}
      {entries.length > 0 ? (
        <ul>
          {entries.map(([field, text]) => (
            <li key={field}>
              <a
                href={`#${fieldIds[field] ?? field}`}
                onClick={(event) => {
                  event.preventDefault();
                  document.getElementById(fieldIds[field] ?? field)?.focus();
                }}
              >
                {text}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
