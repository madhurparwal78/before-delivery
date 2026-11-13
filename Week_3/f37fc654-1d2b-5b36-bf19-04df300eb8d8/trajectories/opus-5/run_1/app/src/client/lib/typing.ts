import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * The cue-line typing schedule. Letter i appears 0.4 + 0.04 x i seconds after
 * the line opens; each letter reads violet for its first 0.2 seconds, cyan from
 * 0.2 to 0.4 seconds and white from 0.4 seconds on.
 */

export const TYPING_START_DELAY_S = 0.4;
export const TYPING_LETTER_STEP_S = 0.04;
export const VIOLET_UNTIL_S = 0.2;
export const CYAN_UNTIL_S = 0.4;

export type LetterState = 'hidden' | 'violet' | 'cyan' | 'white';

export interface TypedLine {
  /** Characters shown so far, from 0 up to the line's length. */
  typed: number;
  letters: LetterState[];
  settled: boolean;
}

export function letterStateAt(elapsedS: number, index: number): LetterState {
  const appearsAt = TYPING_START_DELAY_S + TYPING_LETTER_STEP_S * index;
  const age = elapsedS - appearsAt;
  if (age < 0) return 'hidden';
  if (age < VIOLET_UNTIL_S) return 'violet';
  if (age < CYAN_UNTIL_S) return 'cyan';
  return 'white';
}

function wholeLine(length: number): TypedLine {
  return {
    typed: length,
    letters: Array.from({ length }, () => 'white' as LetterState),
    settled: true,
  };
}

/**
 * Type one line. Under reduced motion the line is whole and white from the
 * moment it opens.
 */
export function useTypedLine(text: string, reducedMotion: boolean): TypedLine {
  const length = text.length;
  const [elapsed, setElapsed] = useState(reducedMotion ? Number.POSITIVE_INFINITY : 0);
  const openedAt = useRef(0);
  const frame = useRef(0);

  useEffect(() => {
    if (reducedMotion) {
      setElapsed(Number.POSITIVE_INFINITY);
      return undefined;
    }
    // A line opens the moment its text changes.
    setElapsed(0);
    openedAt.current = performance.now();
    const finishAt = TYPING_START_DELAY_S + TYPING_LETTER_STEP_S * length + CYAN_UNTIL_S + 0.3;
    const step = (now: number): void => {
      const seconds = (now - openedAt.current) / 1000;
      setElapsed(seconds);
      if (seconds < finishAt) {
        frame.current = requestAnimationFrame(step);
      } else {
        frame.current = 0;
        setElapsed(Number.POSITIVE_INFINITY);
      }
    };
    frame.current = requestAnimationFrame(step);
    return () => {
      if (frame.current !== 0) cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [text, length, reducedMotion]);

  return useMemo(() => {
    if (!Number.isFinite(elapsed)) return wholeLine(length);
    const letters: LetterState[] = [];
    let typed = 0;
    for (let i = 0; i < length; i += 1) {
      const state = letterStateAt(elapsed, i);
      letters.push(state);
      if (state !== 'hidden') typed += 1;
    }
    const lineSettled =
      elapsed >= TYPING_START_DELAY_S + TYPING_LETTER_STEP_S * Math.max(0, length - 1);
    return { typed, letters, settled: lineSettled };
  }, [elapsed, length]);
}

/** Does the visitor ask for reduced motion? */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (): void => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return reduced;
}
