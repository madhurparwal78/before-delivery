import { useLayoutEffect, useRef } from 'preact/hooks';
import { play } from './motion.js';

/** The turning ring on a saving button: one full turn after another at an even speed. */
export function Spinner() {
  const ring = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const turn = play(ring.current, [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], {
      duration: 800,
      iterations: Infinity,
    });
    return () => turn?.cancel();
  }, []);
  return <span ref={ring} class="spinner" aria-hidden="true" />;
}
