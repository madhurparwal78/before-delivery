export function LogoMark() {
  return (
    <svg className="logo-mark" viewBox="0 0 28 28" width="28" height="28" aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="15" y="2" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.6" />
      <rect x="2" y="15" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.6" />
      <path d="M15 22c3-6 5-6 11-9" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.8" />
    </svg>
  );
}

export function HamburgerIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
      <path d="M4 9h16M4 15h16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function ArrowIcon() {
  return (
    <svg className="arrow" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path d="M3 8h9M8.5 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function EmptyDrawing() {
  return (
    <svg className="empty-drawing" viewBox="0 0 160 60" width="160" height="60" aria-hidden="true" focusable="false">
      <path d="M0 40C30 10 60 10 90 30S130 50 160 20M0 46C34 18 62 18 92 36S132 54 160 28M0 34C28 4 58 4 88 24S128 44 160 12"
        fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
    </svg>
  );
}
