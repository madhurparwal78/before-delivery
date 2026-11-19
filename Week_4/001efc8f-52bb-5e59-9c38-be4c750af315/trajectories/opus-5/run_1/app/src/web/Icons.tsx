import type { ReactElement, ReactNode } from 'react';

/** Lucide glyphs, drawn inline so nothing loads from another origin. */
function Glyph({ children, className }: { children: ReactNode; className?: string }): ReactElement {
  return (
    <svg
      className={className === undefined ? 'glyph' : `glyph ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function HourglassGlyph(): ReactElement {
  return (
    <Glyph>
      <path d="M5 22h14" />
      <path d="M5 2h14" />
      <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
      <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
    </Glyph>
  );
}

export function CheckGlyph(): ReactElement {
  return (
    <Glyph>
      <path d="M20 6 9 17l-5-5" />
    </Glyph>
  );
}

export function DoubleCheckGlyph(): ReactElement {
  return (
    <Glyph>
      <path d="M18 6 7 17l-5-5" />
      <path d="m22 10-7.5 7.5L13 16" />
    </Glyph>
  );
}

export function EyeGlyph(): ReactElement {
  return (
    <Glyph>
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </Glyph>
  );
}

export function WarningGlyph(): ReactElement {
  return (
    <Glyph className="glyph-alert">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </Glyph>
  );
}

export function PinGlyph(): ReactElement {
  return (
    <Glyph>
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </Glyph>
  );
}

export function PencilGlyph(): ReactElement {
  return (
    <Glyph>
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </Glyph>
  );
}

export function LockGlyph(): ReactElement {
  return (
    <Glyph>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </Glyph>
  );
}

export function SearchGlyph(): ReactElement {
  return (
    <Glyph>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </Glyph>
  );
}

export function MoreGlyph(): ReactElement {
  return (
    <Glyph>
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </Glyph>
  );
}

export function MenuGlyph(): ReactElement {
  return (
    <Glyph>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </Glyph>
  );
}
