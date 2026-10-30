// Ink drawings made for this app (brief: Controls and imagery): empty states and the public roadmap ornament.

/** A tidy stack of paper with one marked line: an empty inbox or an empty reading column. */
export function EmptyInbox() {
  return (
    <svg className="art" width="72" height="56" viewBox="0 0 72 56" aria-hidden="true" focusable="false">
      <rect x="14" y="10" width="44" height="36" rx="3" fill="var(--sheet)" stroke="var(--ink)" strokeWidth="1.25" />
      <rect x="10" y="14" width="44" height="36" rx="3" fill="var(--sheet)" stroke="var(--ink)" strokeWidth="1.25" />
      <rect x="17" y="24" width="22" height="5" rx="1" fill="var(--marker)" />
      <path d="M17 26.5h26M17 34h30M17 41h18" stroke="var(--ink)" strokeWidth="1.25" strokeLinecap="round" />
      <path d="M44 26.5c8 0 10 -14 20 -14" fill="none" stroke="var(--cobalt)" strokeWidth="1.25" strokeLinecap="round" />
      <circle cx="64" cy="12.5" r="2" fill="var(--cobalt)" />
    </svg>
  );
}

/** An open slot waiting for cards: an empty release. */
export function EmptyRelease() {
  return (
    <svg className="art" width="56" height="32" viewBox="0 0 56 32" aria-hidden="true" focusable="false">
      <rect x="4" y="4" width="48" height="24" rx="4" fill="none" stroke="var(--stone-strong)" strokeWidth="1.25" strokeDasharray="4 3" />
      <path d="M22 16h12M28 10v12" stroke="var(--ink-muted)" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

/** The public roadmap header ornament: a folded route map with one cobalt thread running across it. */
export function RoadmapOrnament() {
  return (
    <svg className="art ornament" width="144" height="56" viewBox="0 0 144 56" aria-hidden="true" focusable="false">
      <path d="M8 10l40-6 48 6 40-6v42l-40 6-48-6-40 6z" fill="var(--sheet)" stroke="var(--ink)" strokeWidth="1.25" strokeLinejoin="round" />
      <path d="M48 4v42M96 10v42" stroke="var(--stone-strong)" strokeWidth="1.25" />
      <path d="M18 38c14 0 18-22 34-22s18 18 32 18 20-20 42-22" fill="none" stroke="var(--cobalt)" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="62" y="20" width="18" height="6" rx="1" fill="var(--marker)" opacity="0.9" />
      <circle cx="18" cy="38" r="3" fill="var(--sheet)" stroke="var(--cobalt)" strokeWidth="1.5" />
      <path d="M121 9l3 3 6-7" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
