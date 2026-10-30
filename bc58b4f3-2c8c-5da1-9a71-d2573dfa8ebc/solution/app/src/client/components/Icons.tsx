// Inline SVG glyphs drawn for Teamseat on a 24px grid (1.75 stroke), so no icon font or remote file is loaded.

interface IconProps {
  size?: number;
}

function Glyph({ size = 20, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function ChevronLeft(props: IconProps) {
  return <Glyph {...props}><path d="M15 6l-6 6 6 6" /></Glyph>;
}

export function ChevronRight(props: IconProps) {
  return <Glyph {...props}><path d="M9 6l6 6-6 6" /></Glyph>;
}

export function CloseIcon(props: IconProps) {
  return <Glyph {...props}><path d="M6 6l12 12M18 6L6 18" /></Glyph>;
}

export function SignOutIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      <path d="M10 16l-4-4 4-4M6 12h10" />
    </Glyph>
  );
}

/** The full-coverage check glyph on a capsule. */
export function CoveredCheck() {
  return (
    <svg className="check-glyph" role="img" aria-label="All seats covered" width="18" height="18" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="11" fill="currentColor" />
      <path d="M6.5 12.5l3.5 3.5 7.5-8" fill="none" stroke="var(--paper)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The verified mark on a served seat: a stamped seal with a check. */
export function VerifiedMark() {
  return (
    <svg className="verified-mark" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M12 2l2.4 1.8 3-.2.9 2.9 2.5 1.7-1 2.8 1 2.8-2.5 1.7-.9 2.9-3-.2L12 22l-2.4-1.8-3 .2-.9-2.9-2.5-1.7 1-2.8-1-2.8 2.5-1.7.9-2.9 3 .2z"
        fill="currentColor"
      />
      <path d="M8 12.3l2.7 2.7L16.2 9" fill="none" stroke="var(--paper)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Empty-state drawing: a blank dispatch slip with ruled lines and an open seat stub. */
export function BlankSlip() {
  return (
    <svg className="blank-slip" width="64" height="64" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect x="10" y="6" width="44" height="52" rx="2" fill="var(--paper-raised)" stroke="currentColor" strokeWidth="1.5" />
      <path d="M17 18h30M17 26h30M17 34h20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="17" y="42" width="30" height="8" rx="4" fill="none" stroke="var(--gap)" strokeWidth="1.5" strokeDasharray="3 3" />
    </svg>
  );
}
