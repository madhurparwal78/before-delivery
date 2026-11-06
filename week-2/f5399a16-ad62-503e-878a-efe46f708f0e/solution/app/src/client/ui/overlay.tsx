// Dialogs and sheets (SR2, SR3, SR8, SR9, SR21, SR24), and the dialog state a screen holds.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BASE, EASE, isRtl, reducedMotion } from '../motion';
import { readResume, useSessionEnded } from '../session';
import { countOverlay, focusHeading, SignInAgain } from './kit';

export interface DialogState {
  open: boolean;
  show(): void;
  /** Closes; focus goes back to the opener, to the heading, or stays where the caller puts it. */
  hide(focus?: 'opener' | 'heading' | 'none'): void;
  focusAfter: React.RefObject<'opener' | 'heading' | 'none'>;
}

export function useDialog(key: string): DialogState {
  const [open, setOpen] = useState(() => readResume(key) !== null);
  const focusAfter = useRef<'opener' | 'heading' | 'none'>('opener');
  const show = useCallback(() => {
    focusAfter.current = 'opener';
    setOpen(true);
  }, []);
  const hide = useCallback((focus: 'opener' | 'heading' | 'none' = 'opener') => {
    focusAfter.current = focus;
    setOpen(false);
  }, []);
  return { open, show, hide, focusAfter };
}

const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';

function tabStops(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => {
    if (element.tabIndex < 0 || !element.getClientRects().length) return false;
    if (element instanceof HTMLInputElement && element.type === 'radio' && !element.checked) {
      return !panel.querySelector(`input[type=radio][name="${element.name}"]:checked`);
    }
    return true;
  });
}

function firstField(panel: HTMLElement): HTMLElement | null {
  const field = panel.querySelector<HTMLElement>('[data-first-field], .panel-body input:not([type=file]), .panel-body select, .panel-body textarea');
  if (field && field.getClientRects().length) return field;
  return tabStops(panel).find((element) => !element.classList.contains('panel-close')) ?? tabStops(panel)[0] ?? null;
}

function entranceFrames(sheet: boolean, origin: DOMRect | null, panel: HTMLElement): Keyframe[] {
  if (origin) {
    const box = panel.getBoundingClientRect();
    const scale = Math.max(origin.width / box.width, 0.05);
    const x = origin.left + origin.width / 2 - (box.left + box.width / 2);
    const y = origin.top + origin.height / 2 - (box.top + box.height / 2);
    return [{ transform: `translate(${x}px, ${y}px) scale(${scale})` }, { transform: 'none' }];
  }
  if (innerWidth < 768) return [{ transform: 'translateY(100%)' }, { transform: 'none' }];
  if (sheet) return [{ transform: `translateX(${isRtl() ? '-100%' : '100%'})` }, { transform: 'none' }];
  return [{ transform: 'scale(.9)' }, { transform: 'none' }];
}

interface OverlayProps {
  state: DialogState;
  title: string;
  /** A named sheet slides from the side from 768 px. */
  sheet?: boolean;
  fullHeight?: boolean;
  closeLabel?: string;
  /** The large view grows from this element's box. */
  origin?: () => Element | null;
  className?: string;
  children: ReactNode;
}

export function Overlay({ state, title, sheet = false, fullHeight = false, closeLabel = 'Close', origin, className, children }: OverlayProps) {
  const [mounted, setMounted] = useState(state.open);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const moving = useRef<Animation[]>([]);
  const counted = useRef(false);
  const ended = useSessionEnded();
  const { open } = state;

  if (open && !mounted) setMounted(true);

  const count = useCallback((on: boolean) => {
    if (counted.current === on) return;
    counted.current = on;
    countOverlay(on ? 1 : -1);
  }, []);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const scrim = scrimRef.current;
    if (!panel || !scrim) return;
    for (const animation of moving.current) animation.cancel();
    moving.current = [];
    if (open) {
      if (document.activeElement && document.activeElement !== document.body && !panel.contains(document.activeElement)) opener.current = document.activeElement;
      count(true);
      firstField(panel)?.focus({ preventScroll: true });
      if (!reducedMotion()) {
        const from = origin?.()?.getBoundingClientRect() ?? null;
        const frames = entranceFrames(sheet, from, panel);
        moving.current = [
          panel.animate(frames, { duration: BASE, easing: EASE }),
          scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: BASE, easing: EASE }),
        ];
      }
      return;
    }
    if (!mounted) return;
    count(false);
    const after = state.focusAfter.current;
    if (after === 'heading' || (after === 'opener' && !opener.current?.isConnected)) focusHeading();
    else if (after === 'opener') (opener.current as HTMLElement).focus({ preventScroll: true });
    if (reducedMotion()) {
      setMounted(false);
      return;
    }
    const from = origin?.()?.getBoundingClientRect() ?? null;
    const frames = entranceFrames(sheet, from, panel);
    const options: KeyframeAnimationOptions = { duration: BASE, easing: EASE, direction: 'reverse', fill: 'forwards' };
    const leaving = panel.animate(frames, options);
    moving.current = [leaving, scrim.animate([{ opacity: 0 }, { opacity: 1 }], options)];
    void leaving.finished.then(() => setMounted(false), () => undefined);
    // Runs on opening and closing only.
  }, [open]);

  useEffect(() => () => count(false), [count]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        state.hide();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, state]);

  if (!mounted) return null;
  return createPortal(
    <div className={`overlay ${sheet ? 'overlay-sheet' : 'overlay-dialog'} ${open ? '' : 'overlay-closing'}`}>
      <div ref={scrimRef} className="scrim" onPointerDown={() => state.hide()} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        inert={!open}
        className={`panel ${fullHeight ? 'panel-full' : ''} ${className ?? ''}`}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const panel = event.currentTarget;
          const stops = tabStops(panel);
          if (!stops.length) return;
          event.preventDefault();
          const at = stops.indexOf(document.activeElement as HTMLElement);
          const next = event.shiftKey ? (at <= 0 ? stops.length - 1 : at - 1) : at === stops.length - 1 ? 0 : at + 1;
          const stop = stops[next] as HTMLElement;
          stop.focus();
          stop.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
        }}
      >
        <header className="panel-head">
          <h2>{title}</h2>
          <button type="button" className="btn btn-plain panel-close" onClick={() => state.hide()}>{closeLabel}</button>
        </header>
        {ended ? <SignInAgain /> : null}
        <div className="panel-body">{open || mounted ? children : null}</div>
      </div>
    </div>,
    document.getElementById('overlays') as HTMLElement,
  );
}
