const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'square', strokeLinejoin: 'miter' } as const;

export const CloseIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" {...stroke}>
    <path d="M3 3l10 10M13 3L3 13" />
  </svg>
);

export const GripIcon = ({ vertical }: { vertical: boolean }) => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" {...stroke}>
    {vertical ? <path d="M3 6h10M3 10h10" /> : <path d="M6 3v10M10 3v10" />}
  </svg>
);

/** A small blueprint sheet: the library's empty state. */
export const BlueprintDrawing = () => (
  <svg viewBox="0 0 160 112" width="160" height="112" aria-hidden="true" className="drawing">
    <rect x="4" y="4" width="152" height="104" fill="none" stroke="currentColor" strokeWidth="1" />
    <path d="M4 32h152M52 32v76M108 32v76M52 70h56" fill="none" stroke="currentColor" strokeWidth="1" />
    <rect x="56" y="36" width="48" height="30" className="drawing-wash" />
    <path d="M4 20h152M20 14v12M140 14v12" fill="none" stroke="currentColor" strokeWidth="1" />
  </svg>
);
