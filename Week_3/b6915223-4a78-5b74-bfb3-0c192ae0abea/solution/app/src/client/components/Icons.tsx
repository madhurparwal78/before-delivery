import type { JSX } from "preact";

// Simple line icons drawn for this app (1.75 stroke, 24 grid).
function Icon({ children, size = 20 }: { children: JSX.Element | JSX.Element[]; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const BellIcon = () => (
  <Icon>
    <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
    <path d="M10 20.5a2 2 0 0 0 4 0" />
  </Icon>
);
export const LockIcon = () => (
  <Icon>
    <rect x="5" y="11" width="14" height="9" rx="1.5" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Icon>
);
export const CopyIcon = () => (
  <Icon>
    <rect x="9" y="9" width="11" height="11" rx="1.5" />
    <path d="M5 15V5a1 1 0 0 1 1-1h10" />
  </Icon>
);
export const RefreshIcon = () => (
  <Icon>
    <path d="M20 11a8 8 0 0 0-14.5-4.5L4 8" />
    <path d="M4 4v4h4" />
    <path d="M4 13a8 8 0 0 0 14.5 4.5L20 16" />
    <path d="M20 20v-4h-4" />
  </Icon>
);
export const SignOutIcon = () => (
  <Icon>
    <path d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5" />
    <path d="M10 8l-4 4 4 4M6 12h10" />
  </Icon>
);
export const DownloadIcon = () => (
  <Icon size={18}>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </Icon>
);
export const ArrowIcon = ({ up }: { up: boolean }) => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="currentColor">
    <path d={up ? "M5 1l4 7H1z" : "M5 9L1 2h8z"} />
  </svg>
);
export const BallMark = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7l4 3-1.5 4.5h-5L8 10z" />
    <path d="M12 3v4M21 10l-5 0M18 19l-3.5-4.5M6 19l3.5-4.5M3 10h5" />
  </svg>
);

// A club badge: a chalk shield outline carrying the club code.
export function ClubBadge({ code }: { code: string }) {
  return (
    <svg class="badge-svg" viewBox="0 0 28 30" aria-hidden="true">
      <path d="M14 1.5l11 3.5v9c0 7-5 11.5-11 14-6-2.5-11-7-11-14V5z" fill="none" stroke="var(--chalk-line)" stroke-width="1.25" />
      <text x="14" y="18" text-anchor="middle" fill="var(--chalk)" style="font: 700 8px var(--font-mono)">
        {code}
      </text>
    </svg>
  );
}
