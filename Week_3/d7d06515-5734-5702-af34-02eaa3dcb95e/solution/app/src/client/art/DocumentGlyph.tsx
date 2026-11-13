// The callout card's document glyph: deep blue over signal yellow, thin white crosshair lines, a folded corner.
export function DocumentGlyph() {
  return (
    <svg className="document-glyph" viewBox="0 0 75 92" width="75" height="92" aria-hidden="true" focusable="false">
      <path d="M0 0H54L75 21V92H0Z" fill="var(--glyph-blue)" />
      <path d="M0 56L75 36V92H0Z" fill="var(--glyph-yellow)" />
      <path d="M54 0V21H75Z" fill="#9db9dc" />
      <path d="M27 0V38M0 21H54" stroke="#fff" strokeWidth="1.5" fill="none" />
      <rect x="21" y="15" width="12" height="12" stroke="#fff" strokeWidth="1.5" fill="none" />
    </svg>
  );
}
