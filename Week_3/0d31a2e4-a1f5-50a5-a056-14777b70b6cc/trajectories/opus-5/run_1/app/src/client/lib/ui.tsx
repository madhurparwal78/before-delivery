import { useEffect, useRef, useState } from 'react';
import { beanBellyColor, beanBodyColor } from '../../shared/hue.js';

interface BeanProps {
  hue: number;
  size?: number;
  className?: string;
  bob?: boolean;
}

/** The procedural bean: a rounded jelly-bean body with two simple eyes. */
export function Bean({ hue, size = 32, className, bob = false }: BeanProps) {
  return (
    <svg
      className={`bean${bob ? ' bean-bob' : ''}${className === undefined ? '' : ` ${className}`}`}
      data-hue={hue}
      width={size}
      height={size * 1.125}
      viewBox="0 0 32 36"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M16 2.5c6.2 0 10.6 4.8 10.6 12.6C26.6 24 22.2 33.2 16 33.2S5.4 24 5.4 15.1C5.4 7.3 9.8 2.5 16 2.5Z"
        fill={beanBodyColor(hue)}
        stroke="var(--ink)"
        strokeWidth="1.7"
      />
      <ellipse cx="16" cy="23.5" rx="6" ry="6.6" fill={beanBellyColor(hue)} />
      <circle cx="12.2" cy="14" r="2.6" fill="#fffdf7" stroke="var(--ink)" strokeWidth="1.1" />
      <circle cx="19.8" cy="14" r="2.6" fill="#fffdf7" stroke="var(--ink)" strokeWidth="1.1" />
      <circle cx="12.5" cy="14.4" r="1.1" fill="var(--ink)" />
      <circle cx="20.1" cy="14.4" r="1.1" fill="var(--ink)" />
    </svg>
  );
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (): void => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(() => window.matchMedia('(pointer: coarse)').matches);
  useEffect(() => {
    const query = window.matchMedia('(pointer: coarse)');
    const update = (): void => setCoarse(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return coarse;
}

/** True below the width where the on-screen controls take over. */
export function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(() => window.innerWidth < 1024);
  useEffect(() => {
    const update = (): void => setNarrow(window.innerWidth < 1024);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return narrow;
}

/** Keeps focus inside a panel and gives it back to the control that opened it. */
export function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    first?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || node === null) return;
      const focusable = [
        ...node.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const start = focusable[0];
      const end = focusable[focusable.length - 1];
      if (!event.shiftKey && document.activeElement === end) {
        event.preventDefault();
        start.focus();
      } else if (event.shiftKey && document.activeElement === start) {
        event.preventDefault();
        end.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const previous = opener.current;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [open, onClose]);

  return ref;
}

export function formatClock(secondsLeft: number): string {
  const clamped = Math.max(0, Math.ceil(secondsLeft));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatPosition(value: number): string {
  return value.toFixed(3);
}
