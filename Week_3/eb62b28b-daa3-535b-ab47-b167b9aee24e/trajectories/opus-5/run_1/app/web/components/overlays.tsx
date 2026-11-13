import { ReactNode, RefObject, useEffect, useRef, useState } from 'react';
import { Link, reducedMotion, useAnnounce } from '../app/shell';

const FOCUSABLE =
  'input:not([type="hidden"]), select, textarea, button, a[href], [tabindex]:not([tabindex="-1"])';

function focusFirst(panel: HTMLElement): void {
  const fields = panel.querySelectorAll<HTMLElement>(
    'input:not([type="hidden"]), select, textarea',
  );
  const first = fields[0] ?? panel.querySelector<HTMLElement>('button, a[href]');
  first?.focus();
}

export interface OverlayProps {
  name: string;
  open: boolean;
  onClose: () => void;
  opener: RefObject<HTMLElement>;
  children: ReactNode;
  kind?: 'dialog' | 'sheet';
}

/** One dialog and sheet behaviour: focus trap, Escape, closing animation, focus return. */
export function Overlay({
  name,
  open,
  onClose,
  opener,
  children,
  kind = 'dialog',
}: OverlayProps): JSX.Element | null {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const wasOpen = useRef(open);
  const { sessionEnded } = useAnnounce();

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
    } else if (wasOpen.current) {
      if (reducedMotion()) {
        setMounted(false);
        setClosing(false);
      } else {
        setClosing(true);
      }
      const control = opener.current;
      if (control && document.body.contains(control)) control.focus();
      else document.querySelector<HTMLElement>('h1')?.focus();
    }
    wasOpen.current = open;
  }, [open, opener]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (panel) focusFirst(panel);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (item) => !item.hasAttribute('disabled'),
      );
      if (items.length === 0) return;
      const first = items[0] as HTMLElement;
      const last = items[items.length - 1] as HTMLElement;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!mounted) return null;
  const panelClass = `${kind === 'sheet' ? 'sheet' : 'dialog'}${closing ? ' closing' : ''}`;
  return (
    <div
      className={`scrim${kind === 'sheet' ? ' sheet-scrim' : ''}`}
      {...(closing ? { 'aria-hidden': true, inert: '' } : {})}
      onMouseDown={(event) => {
        if (kind === 'sheet' && event.target === event.currentTarget) onClose();
      }}
      onTouchStart={(event) => {
        if (kind === 'sheet' && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={panelClass}
        role="dialog"
        aria-modal="true"
        aria-label={name}
        ref={panelRef}
        onAnimationEnd={() => {
          if (closing) {
            setMounted(false);
            setClosing(false);
          }
        }}
      >
        {sessionEnded ? (
          <p>
            <Link to="/signin">Sign in again</Link>
          </p>
        ) : null}
        {children}
      </div>
    </div>
  );
}

export interface PopoverProps {
  name: string;
  open: boolean;
  onClose: () => void;
  opener: RefObject<HTMLElement>;
  children: ReactNode;
}

/** The draw detail popover: fades in, stays inside the viewport, returns focus on close. */
export function Popover({ name, open, onClose, opener, children }: PopoverProps): JSX.Element | null {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const wasOpen = useRef(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
    } else if (wasOpen.current) {
      if (reducedMotion()) {
        setMounted(false);
        setClosing(false);
      } else {
        setClosing(true);
      }
      const control = opener.current;
      if (control && document.body.contains(control)) control.focus();
    }
    wasOpen.current = open;
  }, [open, opener]);

  useEffect(() => {
    if (!open || !mounted) return;
    const panel = panelRef.current;
    const control = opener.current;
    if (!panel || !control) return;
    const box = control.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const left = Math.min(
      Math.max(8, box.left + box.width / 2 - width / 2),
      Math.max(8, window.innerWidth - width - 8),
    );
    const below = box.bottom + 8;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, box.top - height - 8) : below;
    panel.style.left = `${left + window.scrollX}px`;
    panel.style.top = `${top + window.scrollY}px`;
    panel.querySelector<HTMLElement>('button, a[href]')?.focus();
  }, [open, mounted, opener, children]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!mounted) return null;
  return (
    <div
      className={`popover${closing ? ' closing' : ''}`}
      role="dialog"
      aria-label={name}
      ref={panelRef}
      {...(closing ? { 'aria-hidden': true, inert: '' } : {})}
      onAnimationEnd={() => {
        if (closing) {
          setMounted(false);
          setClosing(false);
        }
      }}
    >
      {children}
    </div>
  );
}
