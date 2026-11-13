import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { OVERLAY_MS, OVERSHOOT, SETTLE, useReducedMotion } from '../lib/motion.js';
import { focusFirst, trapTab, type OverlayState } from '../lib/overlay.js';

export type OverlayKind = 'dialog' | 'sheet-bottom' | 'sheet-side' | 'menu';

interface OverlayProps {
  state: OverlayState;
  name: string;
  kind?: OverlayKind;
  /** A modal overlay dims the page, keeps Tab inside it and closes on a tap outside. */
  modal?: boolean;
  /** A menu panel carries the role of what it holds, not a dialog role. */
  role?: 'dialog' | 'none';
  className?: string;
  children: ComponentChildren;
}

const ENTER: Record<OverlayKind, Keyframe[]> = {
  dialog: [
    { opacity: 0, transform: 'translateY(12px) scale(0.985)' },
    { opacity: 1, transform: 'translateY(0) scale(1)' },
  ],
  'sheet-bottom': [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }],
  'sheet-side': [{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }],
  menu: [
    { opacity: 0, transform: 'translateY(-8px)' },
    { opacity: 1, transform: 'translateY(0)' },
  ],
};

const LEAVE: Record<OverlayKind, Keyframe[]> = {
  dialog: [
    { opacity: 1, transform: 'translateY(0) scale(1)' },
    { opacity: 0, transform: 'translateY(8px) scale(0.99)' },
  ],
  'sheet-bottom': [{ transform: 'translateY(0)' }, { transform: 'translateY(100%)' }],
  'sheet-side': [{ transform: 'translateX(0)' }, { transform: 'translateX(100%)' }],
  menu: [
    { opacity: 1, transform: 'translateY(0)' },
    { opacity: 0, transform: 'translateY(-6px)' },
  ],
};

export function Overlay({
  state,
  name,
  kind = 'dialog',
  modal = true,
  role = 'dialog',
  className = '',
  children,
}: OverlayProps) {
  const panel = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { phase, isOpen } = state;

  useEffect(() => {
    if (!isOpen) return;
    const node = panel.current;
    if (node === null) return;
    focusFirst(node);
  }, [isOpen]);

  // A menu has no scrim, so the page behind it stays usable; a press outside closes it.
  useEffect(() => {
    if (!isOpen || modal) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (target === null) return;
      if (panel.current?.contains(target) === true) return;
      if (state.opener()?.contains(target) === true) return;
      state.close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [isOpen, modal, state]);

  useEffect(() => {
    const node = panel.current;
    if (node === null) return;
    if (reduced) {
      if (phase === 'leaving') state.settle();
      return;
    }
    if (phase === 'open') {
      const animation = node.animate(ENTER[kind], {
        duration: OVERLAY_MS,
        easing: OVERSHOOT,
      });
      return () => animation.cancel();
    }
    const animation = node.animate(LEAVE[kind], {
      duration: OVERLAY_MS,
      easing: SETTLE,
      fill: 'forwards',
    });
    let live = true;
    animation.finished
      .then(() => {
        if (live) state.settle();
      })
      .catch(() => undefined);
    return () => {
      live = false;
      animation.cancel();
    };
  }, [phase, kind, reduced, state]);

  const leaving = phase === 'leaving';

  return (
    <div
      class={`overlay overlay--${kind} ${modal ? '' : 'overlay--bare'} ${leaving ? 'is-leaving' : 'is-open'}`}
      // A leaving overlay is already inert and out of the accessibility tree.
      {...(leaving ? { inert: true, 'aria-hidden': 'true' } : {})}
    >
      {modal ? (
        <div
          class="overlay__scrim"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) state.close();
          }}
        />
      ) : null}
      <div
        ref={panel}
        class={`overlay__panel ${className}`}
        {...(role === 'dialog'
          ? { role: 'dialog', 'aria-label': name, ...(modal ? { 'aria-modal': 'true' } : {}) }
          : {})}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            state.close();
            return;
          }
          if (modal) trapTab(event, panel.current as HTMLElement);
        }}
      >
        {children}
      </div>
    </div>
  );
}
