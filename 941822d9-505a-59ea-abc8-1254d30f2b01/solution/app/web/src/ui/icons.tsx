// One stroke icon set drawn for Credwell on a 24 grid (1.5 stroke), always beside a text label.

const paths = {
  menu: "M4 7h16M4 12h16M4 17h16",
  signOut: "M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10",
  check: "M5 12.5l4.5 4.5L19 7.5",
  warning: "M12 4l9 16H3L12 4zM12 10v4M12 17.2v.1",
  download: "M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19h14",
  copy: "M9 9h10v10H9zM5 15V5h10",
  link: "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1",
  plus: "M12 5v14M5 12h14",
  chevron: "M9 6l6 6-6 6",
  empty: "M4 7h16v12H4zM4 7l2-3h12l2 3M9 12h6",
} as const;

type IconName = keyof typeof paths;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={paths[name]} />
    </svg>
  );
}

/** Verified: a filled disc with a check; not yet verified: an open dashed circle. Always with its word. */
export function StatusGlyph({ verified, justVerified = false }: { verified: boolean; justVerified?: boolean }) {
  return (
    <span className="glyph">
      <span className={`chip ${verified ? "on" : "off"}${justVerified ? " just" : ""}`} data-chip={verified ? "verified" : "unverified"}>
        {verified && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={paths.check} />
          </svg>
        )}
      </span>
      {verified ? "Verified" : "Not yet verified"}
    </span>
  );
}

export function Empty({ children }: { children: string }) {
  return (
    <p className="empty">
      <Icon name="empty" size={28} />
      {children}
    </p>
  );
}
