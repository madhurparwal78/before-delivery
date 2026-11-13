// One inline SVG icon set, hand drawn on a 24 grid with a 1.75 stroke. Icons never stand alone: words sit beside them.
import type { ReactElement } from "react";

const PATHS: Record<string, ReactElement> = {
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.4v.1" />
    </>
  ),
  heart: <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z" />,
  download: (
    <>
      <path d="M12 4v11M7.5 10.8 12 15.3l4.5-4.5" />
      <path d="M5 19.5h14" />
    </>
  ),
  chevron: <path d="m7 9.5 5 5 5-5" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.6v.1" />
    </>
  ),
  mark: (
    <>
      <path d="M4 17V7l8-4 8 4v10l-8 4z" />
      <path d="M4 7l8 4 8-4M12 11v10" />
    </>
  ),
  dimension: (
    <>
      <path d="M4 5v14M20 5v14M4 12h16" />
      <path d="m7 9.5-3 2.5 3 2.5M17 9.5l3 2.5-3 2.5" />
    </>
  ),
};

type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, filled = false }: { name: IconName; size?: number; filled?: boolean }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

const SEVERITY: Record<"Blocking" | "Advisory" | "Pass", { shape: ReactElement; glyph: ReactElement }> = {
  Blocking: { shape: <path d="M8.2 3h7.6L21 8.2v7.6L15.8 21H8.2L3 15.8V8.2z" />, glyph: <path d="m9 9 6 6M15 9l-6 6" /> },
  Advisory: { shape: <path d="M12 3.5 21.5 20h-19z" />, glyph: <path d="M12 10v4.5M12 17.4v.1" /> },
  Pass: { shape: <circle cx="12" cy="12" r="9" />, glyph: <path d="m8 12.4 2.8 2.8L16.4 9" /> },
};

/** A severity icon: solid while the finding is current, hollow (outline only) once its report is stale. */
export function SeverityIcon({ severity, hollow = false, size = 20 }: { severity: "Blocking" | "Advisory" | "Pass"; hollow?: boolean; size?: number }) {
  const { shape, glyph } = SEVERITY[severity];
  return (
    <svg className="icon sev-svg" width={size} height={size} viewBox="0 0 24 24" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" data-hollow={hollow ? "true" : undefined}>
      <g fill={hollow ? "none" : "currentColor"} stroke="currentColor">{shape}</g>
      <g fill="none" stroke={hollow ? "currentColor" : "var(--surface)"}>{glyph}</g>
    </svg>
  );
}
