import { useEffect, useRef, useState } from 'react';

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function easeOut(progress: number): number {
  return 1 - (1 - progress) * (1 - progress) * (1 - progress);
}

/** Slower at both ends, so the first frames of a growth stay small. */
export function easeInOut(progress: number): number {
  return progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
}

/**
 * Runs a motion on the page's own clock. Advancing the clock finishes it;
 * under reduced motion the end state is set in the same frame.
 */
export function animate(
  durationMs: number,
  step: (progress: number) => void,
  easing: (progress: number) => number = easeOut,
): () => void {
  if (reducedMotion()) {
    step(1);
    return () => undefined;
  }
  let frame = 0;
  let start = -1;
  const tick = (now: number): void => {
    if (start < 0) start = now;
    const progress = Math.min(1, (now - start) / durationMs);
    step(easing(progress));
    if (progress < 1) frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}

/** A number that travels to its new target, settling on the exact value. */
export function useTravellingNumber(target: number, durationMs: number): number {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  const settled = useRef(target);

  useEffect(() => {
    if (settled.current === target) return;
    const start = from.current;
    settled.current = target;
    const stop = animate(durationMs, (progress) => {
      const value = start + (target - start) * progress;
      const rounded = Math.round(value * 10) / 10;
      from.current = progress === 1 ? target : rounded;
      setShown(progress === 1 ? target : rounded);
    });
    return stop;
  }, [target, durationMs]);

  return shown;
}

/** Grows an element from a quarter of its size to full size. */
export function useGrowIn(durationMs: number): (element: SVGElement | HTMLElement | null) => void {
  const started = useRef(false);
  return (element: SVGElement | HTMLElement | null): void => {
    if (!element || started.current) return;
    started.current = true;
    if (reducedMotion()) {
      element.style.transform = 'scale(1)';
      return;
    }
    element.style.transform = 'scale(0.1)';
    animate(
      durationMs,
      (progress) => {
        element.style.transform = `scale(${0.1 + 0.9 * progress})`;
      },
      easeInOut,
    );
  };
}

/** Slides a sheet in from the right edge. */
export function useSlideIn(): (element: HTMLElement | null) => void {
  const started = useRef(false);
  return (element: HTMLElement | null): void => {
    if (!element || started.current) return;
    started.current = true;
    if (reducedMotion()) {
      element.style.transform = 'translateX(0)';
      return;
    }
    element.style.transform = 'translateX(100%)';
    animate(420, (progress) => {
      element.style.transform = `translateX(${(1 - progress) * 100}%)`;
    });
  };
}

/** Slides a strike line into the bottom of the strike list. */
export function slideUpInto(element: HTMLElement | null): void {
  if (!element) return;
  if (reducedMotion()) return;
  animate(300, (progress) => {
    element.style.transform = `translateY(${(1 - progress) * 18}px)`;
    element.style.opacity = String(progress);
  });
}

/** Lifts the row's damage chip out of the row and carries it to the seam. */
export function flyDamageChip(from: DOMRect, to: DOMRect, text: string): void {
  if (reducedMotion()) return;
  const chip = document.createElement('div');
  chip.className = 'damage-chip-flight';
  chip.textContent = text;
  chip.setAttribute('aria-hidden', 'true');
  chip.style.left = `${from.left}px`;
  chip.style.top = `${from.top}px`;
  document.body.append(chip);
  animate(340, (progress) => {
    chip.style.left = `${from.left + (to.left - from.left) * progress}px`;
    chip.style.top = `${from.top + (to.top - from.top) * progress}px`;
    chip.style.opacity = String(1 - progress * 0.2);
    if (progress === 1) chip.remove();
  });
}
