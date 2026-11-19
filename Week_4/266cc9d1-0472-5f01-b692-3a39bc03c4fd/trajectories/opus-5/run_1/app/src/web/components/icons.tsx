/** Lucide glyphs, inlined so nothing is fetched at runtime. */

import type { ReactNode } from "react";

function Glyph({ children, label }: { children: ReactNode; label?: string }): ReactNode {
  return (
    <svg
      className="glyph"
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** lucide: triangle-alert */
export function WarningTriangle(): ReactNode {
  return (
    <Glyph>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </Glyph>
  );
}

/** lucide: check */
export function Check(): ReactNode {
  return (
    <Glyph>
      <path d="M20 6 9 17l-5-5" />
    </Glyph>
  );
}

/** lucide: chevron-left */
export function ChevronLeft(): ReactNode {
  return (
    <Glyph>
      <path d="m15 18-6-6 6-6" />
    </Glyph>
  );
}

/** lucide: chevron-right */
export function ChevronRight(): ReactNode {
  return (
    <Glyph>
      <path d="m9 18 6-6-6-6" />
    </Glyph>
  );
}

/** lucide: chevron-down */
export function ChevronDown(): ReactNode {
  return (
    <Glyph>
      <path d="m6 9 6 6 6-6" />
    </Glyph>
  );
}

/** lucide: upload */
export function Upload(): ReactNode {
  return (
    <Glyph>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" x2="12" y1="3" y2="15" />
    </Glyph>
  );
}
