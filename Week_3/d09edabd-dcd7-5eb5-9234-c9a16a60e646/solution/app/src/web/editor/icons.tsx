export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="28" height="28" rx="6" fill="none" stroke="var(--accent)" strokeWidth="2" />
      <rect x="13" y="7" width="6" height="18" rx="1.5" fill="var(--ink)" />
      <rect x="9" y="12" width="14" height="3" rx="1.5" fill="var(--ink)" />
    </svg>
  );
}

export function PlayGlyph({ playing, size = 20 }: { playing: boolean; size?: number }) {
  return playing ? (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <rect x="4" y="4" width="12" height="12" rx="2" fill="currentColor" />
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M6 3.5v13l10.5-6.5z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
