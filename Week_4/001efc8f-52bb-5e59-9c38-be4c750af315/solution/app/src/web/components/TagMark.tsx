// A punched equipment service tag, drawn for this app (decorative).
export function TagMark({ size = 72 }: { size?: number }) {
  return (
    <svg className="tag-mark" width={size} height={size} viewBox="0 0 72 72" aria-hidden="true" focusable="false">
      <path d="M36 4 L64 20 V66 H8 V20 Z" fill="var(--amber)" stroke="var(--ink)" strokeWidth="3" strokeLinejoin="miter" />
      <circle cx="36" cy="22" r="6" fill="var(--page)" stroke="var(--ink)" strokeWidth="3" />
      <path d="M36 16 C30 6 22 2 14 2" fill="none" stroke="var(--ink)" strokeWidth="2" />
      <rect x="16" y="36" width="40" height="4" fill="var(--ink)" />
      <rect x="16" y="46" width="28" height="4" fill="var(--ink)" />
      <rect x="16" y="56" width="34" height="4" fill="var(--ink)" />
    </svg>
  );
}
