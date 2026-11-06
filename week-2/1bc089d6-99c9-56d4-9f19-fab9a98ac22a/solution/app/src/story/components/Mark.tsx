const CRESCENT = "M30.34 18.50 A14.5 14.5 0 1 0 43.93 37.04 A11.5 11.5 0 0 1 30.34 18.50 Z";

/** The Stillhour mark: a crescent moon inside a thin circle. With `traced`, the circle draws its own outline. */
export function Mark({ className, traced = false }: { className?: string; traced?: boolean }) {
  return (
    <svg className={className} viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false">
      <circle
        className={traced ? "sh-mark__trace" : undefined}
        cx="32"
        cy="32"
        r="29"
        stroke="currentColor"
        strokeWidth="2"
        pathLength={1}
        transform="rotate(-90 32 32)"
      />
      <path d={CRESCENT} fill="currentColor" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className}>
      <Mark className="sh-wordmark__mark" />
      <span className="sh-wordmark__text">Stillhour</span>
    </span>
  );
}
