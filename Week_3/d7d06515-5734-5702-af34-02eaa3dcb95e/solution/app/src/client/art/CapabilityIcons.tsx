// The three 80px grey line icons of the capability band.
const common = { viewBox: '0 0 80 80', width: 80, height: 80, 'aria-hidden': true, focusable: false, className: 'capability-icon' } as const;

/** Command line first: a terminal window with a prompt and cursor. */
export function CommandIcon() {
  return (
    <svg {...common}>
      <rect x="8" y="14" width="64" height="52" />
      <path d="M8 26h64" />
      <path d="M18 38l9 7-9 7" />
      <path d="M34 53h16" />
      <rect x="52" y="48" width="6" height="9" />
      <path d="M14 20h4M22 20h4" />
    </svg>
  );
}

/** Markup that can't move a wall: a revision cloud above a hatched wall. */
export function MarkupIcon() {
  return (
    <svg {...common}>
      <path d="M14 66h52M14 58h52" />
      <path d="M20 66l6-8M32 66l6-8M44 66l6-8M56 66l6-8" />
      <path d="M18 46c-6-1-8-9-2-12 0-7 8-10 13-6 3-6 12-6 15-1 5-3 12 0 12 6 6 1 8 9 2 12 0 5-6 8-11 5-3 4-9 4-12 1-5 3-11 1-12-3-3 1-5 0-5-2z" />
      <path d="M36 38v6M36 48v1" />
    </svg>
  );
}

/** The same sheet everywhere: a laptop and a phone showing one plan. */
export function SheetIcon() {
  return (
    <svg {...common}>
      <rect x="10" y="16" width="44" height="30" />
      <path d="M6 52h52l-4 6H10z" />
      <path d="M18 24h18v12H18zM36 30h10M26 36v6" />
      <rect x="56" y="30" width="16" height="28" rx="3" />
      <path d="M60 38h8v8h-8zM64 52h0" />
      <path d="M54 34h2M54 40h2" />
    </svg>
  );
}
