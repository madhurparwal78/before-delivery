// Corbel Works mark: an L-shaped corbel bracket under a quarter-arc, with a selection grip at its foot.
function Mark({ size = 40 }: { size?: number }) {
  return (
    <svg className="mark" viewBox="0 0 40 40" width={size} height={size} aria-hidden="true" focusable="false">
      <path d="M8 6v26h26" fill="none" stroke="var(--ink)" strokeWidth="2" />
      <path d="M8 20c8 0 14-6 14-14" fill="none" stroke="var(--line)" strokeWidth="1.5" />
      <rect x="29" y="28" width="8" height="8" fill="var(--vertex)" />
    </svg>
  );
}

function Wordmark() {
  return (
    <span className="wordmark">
      <span className="wordmark-strong">CORBEL</span> <span className="wordmark-light">Works</span>
    </span>
  );
}

/** The named logo of the headers: mark plus word mark (the word mark hides on phones in CSS). */
export function Logo() {
  return (
    <span role="img" aria-label="Corbel Works" className="logo">
      <Mark />
      <Wordmark />
    </span>
  );
}

/** The larger lockup above the hero headline; the header's img carries the accessible name. */
export function Lockup() {
  return (
    <div className="lockup" aria-hidden="true">
      <Mark size={48} />
      <Wordmark />
    </div>
  );
}
