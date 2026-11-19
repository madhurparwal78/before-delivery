import type { ReactNode } from "react";

// Inline Lucide icons (ISC licence), always beside words that carry the meaning.

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const MoonIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  </Icon>
);
export const OfflineIcon = () => (
  <Icon>
    <path d="m2 2 20 20" />
    <path d="M5.782 5.782A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.307-.193" />
    <path d="M21.532 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7.008 7.008 0 0 0 10 5.07" />
  </Icon>
);
export const CheckIcon = () => (
  <Icon size={16}>
    <path d="M20 6 9 17l-5-5" />
  </Icon>
);
export const AlertIcon = () => (
  <Icon size={16}>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" x2="12" y1="8" y2="12" />
    <line x1="12" x2="12.01" y1="16" y2="16" />
  </Icon>
);
export const MicIcon = () => (
  <Icon>
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" x2="12" y1="19" y2="22" />
  </Icon>
);
export const StopIcon = () => (
  <Icon>
    <rect width="14" height="14" x="5" y="5" rx="2" />
  </Icon>
);
export const CloseIcon = () => (
  <Icon>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </Icon>
);
export const ExpandIcon = () => (
  <Icon>
    <polyline points="15 3 21 3 21 9" />
    <polyline points="9 21 3 21 3 15" />
    <line x1="21" x2="14" y1="3" y2="10" />
    <line x1="3" x2="10" y1="21" y2="14" />
  </Icon>
);
export const TagIcon = () => (
  <Icon size={16}>
    <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
    <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
  </Icon>
);

/** The empty-night drawing: a thin crescent with three faint dots of recall. */
export function EmptyNightDrawing() {
  return (
    <svg className="empty-drawing" width="56" height="56" viewBox="0 0 56 56" aria-hidden="true" focusable="false">
      <path d="M33 10a18 18 0 1 0 13 30A15 15 0 0 1 33 10Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="44" cy="14" r="1.4" fill="currentColor" opacity="0.7" />
      <circle cx="49" cy="22" r="1" fill="currentColor" opacity="0.5" />
      <circle cx="40" cy="7" r="0.8" fill="currentColor" opacity="0.4" />
    </svg>
  );
}
