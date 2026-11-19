import type { ReactNode } from "react";

/** The jar drawing for empty states: glass body, lid ring, a { } label, brace rows inside and a mesh sieve across the neck. */
export function Jar({ size = 160, tipped = false }: { size?: number; tipped?: boolean }): ReactNode {
  return (
    <svg className="jar" width={size} height={size * 1.18} viewBox="0 0 160 190" aria-hidden="true" focusable="false" style={tipped ? { transform: "rotate(-14deg)" } : undefined}>
      <rect x="42" y="6" width="76" height="20" fill="var(--ink)" />
      <rect x="38" y="26" width="84" height="12" fill="var(--plum)" />
      <path d="M44 38 H116 V52 C140 66 146 86 146 112 V160 C146 180 134 186 118 186 H42 C26 186 14 180 14 160 V112 C14 86 20 66 44 52 Z" fill="var(--panel)" stroke="var(--ink)" strokeWidth="5" strokeLinejoin="round" />
      <path d="M48 46 H112" stroke="var(--ink)" strokeWidth="3" />
      <path d="M52 40 V52 M64 40 V52 M76 40 V52 M88 40 V52 M100 40 V52 M112 40 V52" stroke="var(--ink)" strokeWidth="2" />
      <rect x="40" y="98" width="80" height="50" fill="var(--ground)" stroke="var(--ink)" strokeWidth="4" />
      <text x="80" y="132" textAnchor="middle" fontFamily="var(--font-code)" fontSize="28" fontWeight="700" fill="var(--ink)">
        {"{ }"}
      </text>
      <rect x="34" y="158" width="38" height="6" fill="var(--plum)" />
      <rect x="78" y="158" width="26" height="6" fill="var(--plum)" />
      <rect x="34" y="168" width="52" height="6" fill="var(--plum)" />
      <path d="M26 104 V150" stroke="var(--white)" strokeWidth="5" strokeLinecap="round" opacity="0.8" />
    </svg>
  );
}
