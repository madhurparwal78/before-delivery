import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 20, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const UserIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
  </Icon>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);

export const ChevronLeftIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m15 18-6-6 6-6" />
  </Icon>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m9 18 6-6-6-6" />
  </Icon>
);

export const MenuIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Icon>
);

export const PictureIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m21 16-5-5-8 8" />
  </Icon>
);

/** A padel ball: a disc with the two seam curves. */
export function BallIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="10" fill="#D4FF1A" />
      <path d="M4.5 6.5c4 2.4 4 8.6 0 11M19.5 6.5c-4 2.4-4 8.6 0 11" fill="none" stroke="#0E2433" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Top-down court pictogram for the empty top of a match card. */
export function CourtPictogram() {
  return (
    <svg viewBox="0 0 160 100" width="120" height="75" aria-hidden="true" focusable="false">
      <rect x="6" y="6" width="148" height="88" rx="6" fill="none" stroke="#566370" strokeWidth="3" />
      <path d="M80 6v88M6 50h148M42 6v88M118 6v88" stroke="#566370" strokeWidth="2" opacity="0.7" />
      <path d="M80 6v88" stroke="#566370" strokeWidth="4" strokeDasharray="3 5" />
    </svg>
  );
}
