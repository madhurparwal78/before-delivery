export function Cylinder({ name, turned, delay = 0 }: { name: string; turned: boolean; delay?: number }) {
  return (
    <svg className="cylinder" role="img" aria-label={name} viewBox="0 0 32 32" width="28" height="28" data-turned={turned ? "true" : "false"}>
      <circle cx="16" cy="16" r="14" className="cyl-shell" />
      <circle cx="16" cy="16" r="10" className="cyl-face" />
      <g className="cyl-key" style={{ transitionDelay: `${delay}ms` }}>
        <rect x="14" y="7" width="4" height="18" rx="2" className="cyl-slot" />
        <circle cx="16" cy="16" r="2.4" className="cyl-pin" />
      </g>
    </svg>
  );
}

export function KeyMark() {
  return (
    <svg className="key-mark" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <circle cx="8" cy="12" r="5" fill="currentColor" />
      <circle cx="8" cy="12" r="2" fill="var(--mark-hole, var(--ground))" />
      <rect x="12" y="10.5" width="11" height="3" fill="currentColor" />
      <rect x="18" y="13" width="2.4" height="4" fill="currentColor" />
      <rect x="21" y="13" width="2" height="3" fill="currentColor" />
    </svg>
  );
}

export function EmptyFolder() {
  return (
    <svg className="empty-folder" viewBox="0 0 160 100" width="160" height="100" aria-hidden="true" focusable="false">
      <path d="M8 22 L20 8 H62 L74 22 Z" fill="var(--muted)" />
      <rect x="8" y="22" width="144" height="70" fill="var(--ink)" />
      <rect x="8" y="30" width="144" height="62" fill="var(--paper)" />
      <path d="M52 62 H108" stroke="var(--muted)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Glyph({ kind }: { kind: "ok" | "warn" | "lock" | "dash" }) {
  const paths: Record<string, string> = {
    ok: "M2 7 L5.5 10.5 L12 3.5",
    warn: "M7 2 L7 8 M7 11 L7 12",
    lock: "M3 7 H11 V12 H3 Z M5 7 V4.5 A2 2 0 0 1 9 4.5 V7",
    dash: "M3 7 H11",
  };
  return (
    <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true" focusable="false" className="glyph">
      <path d={paths[kind]} fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
