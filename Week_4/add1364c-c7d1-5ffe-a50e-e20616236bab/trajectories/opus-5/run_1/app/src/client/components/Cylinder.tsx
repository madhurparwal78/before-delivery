import { useEffect, useRef, useState } from 'react';

/** The drawn lockset cylinder on a vault tab: upright while a rule is pending, across once it is in force. */
export function Cylinder(props: { vaultName: string; state: 'pending' | 'in_force' }): React.ReactElement {
  const label = props.state === 'pending' ? 'rule pending' : 'rule in force';
  return (
    <svg
      className="cylinder"
      data-state={props.state}
      viewBox="0 0 24 24"
      role="img"
      aria-label={`${props.vaultName} lock: ${label}`}
    >
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
      <g className="cylinder-turn">
        <rect x="11" y="4" width="2" height="16" fill="currentColor" />
        <circle cx="12" cy="12" r="3" fill="currentColor" />
      </g>
    </svg>
  );
}

/** The out-of-policy count counts up or down to the server's figure, in one step under reduced motion. */
export function useCountTo(target: number): number {
  const [shown, setShown] = useState(target);
  const from = useRef(target);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = from.current;
    if (reduced || start === target) {
      from.current = target;
      setShown(target);
      return;
    }
    const began = performance.now();
    let frame = 0;
    const step = (at: number): void => {
      const share = Math.min(1, (at - began) / 900);
      setShown(Math.round(start + (target - start) * share));
      if (share < 1) frame = requestAnimationFrame(step);
      else from.current = target;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return shown;
}
