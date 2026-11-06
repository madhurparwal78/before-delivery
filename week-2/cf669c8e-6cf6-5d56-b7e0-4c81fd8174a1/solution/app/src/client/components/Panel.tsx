import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useReducedMotion } from '../scene/index.js';

type PanelVariant = 'modal' | 'drawer' | 'sheet';
const PANEL_MS = 320;

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [role="slider"]';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute('disabled') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');
}

interface PanelProps {
  open: boolean;
  name: string;
  variant: PanelVariant;
  /** Escape or a click on the backdrop. Focus has already gone back to the opener when this runs. */
  onClose: () => void;
  opener?: () => HTMLElement | null;
  /** Close at once with no motion (a breakpoint crossing). */
  instant?: boolean;
  children: ReactNode;
}

/**
 * A dialog, drawer or sheet. It takes focus when opened, wraps Tab, closes on Escape, returns focus to its opener, and
 * from the first moment of closing nothing inside is focusable or clickable; the shell fades out over 320 ms.
 */
export function Panel({ open, name, variant, onClose, opener, instant = false, children }: PanelProps): ReactNode {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<'closed' | 'open' | 'closing'>(open ? 'open' : 'closed');
  const timer = useRef(0);
  const panel = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    window.clearTimeout(timer.current);
    if (open) {
      setPhase('open');
    } else if (phase === 'open') {
      if (reduced || instant) {
        setPhase('closed');
      } else {
        setPhase('closing');
        timer.current = window.setTimeout(() => setPhase('closed'), PANEL_MS);
      }
    }
  }, [open]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const entered = useRef(false);
  useLayoutEffect(() => {
    if (phase === 'open' && !entered.current) {
      entered.current = true;
      const node = panel.current;
      if (!node) return;
      node.focus();
      if (!reduced) {
        const from = variant === 'drawer' ? 'translateX(-24px)' : variant === 'sheet' ? 'translateY(24px)' : 'translateY(-12px)';
        node.animate([{ opacity: 0, transform: from }, { opacity: 1, transform: 'none' }], { duration: PANEL_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
        shell.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: PANEL_MS, easing: 'linear' });
      }
    }
    if (phase === 'closing' && !reduced) {
      const out = variant === 'drawer' ? 'translateX(-24px)' : variant === 'sheet' ? 'translateY(24px)' : 'translateY(-12px)';
      panel.current?.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: out }], { duration: PANEL_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' });
      shell.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: PANEL_MS, easing: 'linear', fill: 'forwards' });
    }
    if (phase === 'closed') entered.current = false;
    if (phase === 'closing') entered.current = false;
  }, [phase, reduced, variant]);

  if (phase === 'closed') return null;

  const requestClose = (): void => {
    opener?.()?.focus();
    onClose();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      requestClose();
      return;
    }
    if (event.key !== 'Tab' || !panel.current) return;
    const stops = focusables(panel.current);
    if (stops.length === 0) {
      event.preventDefault();
      panel.current.focus();
      return;
    }
    const first = stops[0];
    const last = stops[stops.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panel.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || active === panel.current)) {
      event.preventDefault();
      first.focus();
    } else if (!panel.current.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="panel-root" data-variant={variant} data-state={phase} inert={phase === 'closing'} aria-hidden={phase === 'closing' ? true : undefined}>
      <div className="panel-backdrop" ref={shell} onClick={requestClose} />
      <div className="panel" role="dialog" aria-modal="true" aria-label={name} tabIndex={-1} ref={panel} onKeyDown={onKeyDown}>
        {children}
      </div>
    </div>
  );
}
