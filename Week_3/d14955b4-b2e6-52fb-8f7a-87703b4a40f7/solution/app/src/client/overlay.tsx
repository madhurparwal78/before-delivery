import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode, RefObject } from 'react';

const SLIDE_MS = 250;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface OverlayControl {
  mounted: boolean;
  open: boolean;
  show: () => void;
  hide: () => void;
}

export function useOverlay(opener: RefObject<HTMLElement | null>): OverlayControl {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const wasOpen = useRef(false);
  const show = useCallback(() => {
    window.clearTimeout(timer.current);
    setMounted(true);
    setOpen(true);
  }, []);
  const hide = useCallback(() => {
    setOpen(false);
    window.clearTimeout(timer.current);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setMounted(false);
    else timer.current = window.setTimeout(() => setMounted(false), SLIDE_MS);
  }, []);
  useEffect(() => {
    if (wasOpen.current && !open) opener.current?.focus();
    wasOpen.current = open;
  }, [open, opener]);
  return { mounted, open, show, hide };
}

export function Overlay({ label, side, control, children }: { label: string; side: 'left' | 'bottom'; control: OverlayControl; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = panel.current;
    if (!element) return;
    const focusFirst = (): void => (element.querySelector<HTMLElement>(FOCUSABLE) ?? element).focus();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return focusFirst();
    let settled = false;
    const settle = (): void => {
      if (settled) return;
      settled = true;
      focusFirst();
    };
    const onEnd = (event: TransitionEvent): void => {
      if (event.target === element && event.propertyName === 'transform') settle();
    };
    element.addEventListener('transitionend', onEnd);
    const fallback = window.setTimeout(settle, SLIDE_MS + 50);
    return () => {
      element.removeEventListener('transitionend', onEnd);
      window.clearTimeout(fallback);
    };
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!control.open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      control.hide();
    } else if (event.key === 'Tab') {
      const items = [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return event.preventDefault();
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };
  return (
    <div className="overlay" data-state={control.open ? 'open' : 'closing'} inert={!control.open}>
      <div className="scrim" aria-hidden="true" onClick={control.hide} />
      <div
        className={`panel panel-${side}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-hidden={control.open ? undefined : true}
        tabIndex={-1}
        ref={panel}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>
  );
}
