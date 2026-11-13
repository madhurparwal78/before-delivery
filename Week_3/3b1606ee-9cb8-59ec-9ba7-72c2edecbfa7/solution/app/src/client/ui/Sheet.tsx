import { useEffect, useRef, type ReactNode } from 'react';
import { useReducedMotion } from '../lib/hooks';

const STRIPE_STEP_MS = 300;
const STRIPE_BAR_PX = 10;

/** A white aerogramme sheet edged with the airmail stripe, which steps one bar at a time while it loads. */
export function Sheet({ children, loading = false, className = '', ...rest }: { children: ReactNode; loading?: boolean; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  const edge = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!loading || reduced) return;
    let step = 0;
    const timer = setInterval(() => {
      step = (step + 1) % 4;
      edge.current?.style.setProperty('--stripe-shift', `${step * STRIPE_BAR_PX}px`);
    }, STRIPE_STEP_MS);
    return () => clearInterval(timer);
  }, [loading, reduced]);
  return (
    <div ref={edge} className={`sheet ${className}`} aria-busy={loading || undefined} {...rest}>
      <div className="sheet__page">{children}</div>
    </div>
  );
}

/** One folded blank sheet carrying an empty list's copy. */
export function EmptySheet({ children }: { children: ReactNode }) {
  return (
    <div className="empty" data-testid="empty-state">
      <p>{children}</p>
    </div>
  );
}
