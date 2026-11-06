// The context panel frame: slides in from the right (up from the bottom on phones), slides back
// out the same way, closes on Escape and hands focus back to the Island view.
import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { Icon } from './icons';
import { openPanel, reducedMotion, state } from './store';

const PANEL_MS = 250;
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
let exit: Animation | null = null;
let animatingListener: (on: boolean) => void = () => undefined;

/** The Island view reports panel slides through `data-animating`. */
export function onPanelAnimating(fn: (on: boolean) => void): void {
  animatingListener = fn;
}

const sheet = (): boolean => window.matchMedia('(max-width: 700px)').matches;
// A short travel from the edge: the panel is already where it lands, so a press during the slide hits its control.
const offscreen = (): string => (sheet() ? 'translateY(24px)' : 'translateX(24px)');

function track(animation: Animation): void {
  animatingListener(true);
  void animation.finished
    .catch(() => undefined)
    .then(() => {
      if (!document.querySelector('.panel')?.getAnimations().some((a) => a.playState === 'running')) animatingListener(false);
    });
}

function focusIsland(): void {
  document.querySelector<HTMLElement>('[role="application"]')?.focus({ preventScroll: true });
}

/** Slides the open panel out, then removes it. */
function closePanel(returnFocus = false): void {
  const el = document.querySelector<HTMLElement>('.panel');
  if (returnFocus) focusIsland();
  if (!el || reducedMotion()) {
    openPanel(null);
    return;
  }
  const closing = state.panel;
  exit = el.animate([{ transform: 'none', opacity: 1 }, { transform: offscreen(), opacity: 0 }], { duration: PANEL_MS, easing: EASE, fill: 'forwards' });
  const mine = exit;
  track(mine);
  void mine.finished
    .then(() => {
      if (state.panel === closing) openPanel(null);
      mine.cancel();
    })
    .catch(() => undefined);
}

interface PanelProps {
  label: string;
  title: ComponentChildren;
  focus?: boolean;
  onShown?: (rect: DOMRect) => void;
  children: ComponentChildren;
}

export function Panel({ label, title, focus = false, onShown, children }: PanelProps) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = ref.current as HTMLElement;
    exit?.cancel();
    exit = null;
    onShown?.(el.getBoundingClientRect());
    if (focus) el.focus({ preventScroll: true });
    if (reducedMotion()) return;
    track(el.animate([{ transform: offscreen(), opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: PANEL_MS, easing: EASE }));
  }, []);
  return (
    <aside
      ref={ref}
      class="panel"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        closePanel(true);
      }}
    >
      <header class="panel-head">
        <h2>{title}</h2>
        <button type="button" class="btn quiet" aria-label="Close panel" onClick={() => closePanel(true)}>
          <Icon name="close" />
        </button>
      </header>
      <div class="panel-body">{children}</div>
    </aside>
  );
}
