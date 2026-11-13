// The app's own line glyphs and cloud fields, drawn as SVG.

import type { ReactNode } from "react";

function Glyph({ children, size = 32 }: { children: ReactNode; size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const BandGlyph = ({ size }: { size?: number }) => (
  <Glyph {...(size ? { size } : {})}><rect x="3" y="13" width="26" height="6" rx="3" /><circle cx="19" cy="16" r="5" fill="#fff" /><path d="M9 13v6M13 13v6" /></Glyph>
);

export const TubeGlyph = ({ size }: { size?: number }) => (
  <Glyph {...(size ? { size } : {})}><path d="M12 4h8M13.5 4v21a2.5 2.5 0 0 0 5 0V4" /><path d="M13.5 16h5" /><path d="M6 10h3M6 16h3M6 22h3" /></Glyph>
);

export const PacketGlyph = ({ size }: { size?: number }) => (
  <Glyph {...(size ? { size } : {})}><path d="M7 5h18v6l-2 1.5 2 1.5v12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1z" /><path d="M7 9.5h12" /><rect x="11" y="15" width="10" height="4.5" rx="2.25" /><path d="M16 15v4.5" /><circle cx="13" cy="23.5" r="1" /><circle cx="19" cy="23.5" r="1" /></Glyph>
);

export const CapsuleGlyph = ({ size }: { size?: number }) => (
  <Glyph {...(size ? { size } : {})}><rect x="4" y="11" width="24" height="10" rx="5" transform="rotate(-35 16 16)" /><path d="M12.8 11.4l6.4 9.2" /></Glyph>
);

export const PlansGlyph = ({ size }: { size?: number }) => (
  <Glyph {...(size ? { size } : {})}><rect x="5" y="6" width="22" height="20" rx="4" /><path d="M10 12h12M10 17h8M10 22h5" /></Glyph>
);

export const MarkerGlyph = ({ size }: { size?: number }) => (
  <Glyph {...(size ? { size } : {})}><path d="M16 4c5 6.5 8 10.6 8 14.5a8 8 0 0 1-16 0C8 14.6 11 10.5 16 4z" /><path d="M12.5 19a3.5 3.5 0 0 0 3.5 3.5" /></Glyph>
);

export const MembershipGlyph = ({ size }: { size?: number }) => (
  <Glyph {...(size ? { size } : {})}><rect x="4" y="7" width="24" height="18" rx="4" /><circle cx="11" cy="14" r="2.5" /><path d="M7.5 21a3.5 3.5 0 0 1 7 0" /><path d="M18 13h6M18 18h6" /></Glyph>
);

export const ChevronGlyph = ({ size }: { size?: number }) => (
  <Glyph {...(size ? { size } : {})}><path d="M8 12l8 8 8-8" /></Glyph>
);

export const MessageGlyph = ({ size }: { size?: number }) => (
  <Glyph {...(size ? { size } : {})}><path d="M5 8a3 3 0 0 1 3-3h16a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H13l-6 5v-5a3 3 0 0 1-2-3z" /><path d="M11 12h10M11 17h6" /></Glyph>
);

// The marker band drawn large in its zone colours, to give the Results card its weight. Purely decorative.
export const BandIllustration = () => (
  <svg className="band-illustration" viewBox="0 0 480 40" aria-hidden="true">
    <defs>
      <clipPath id="band-track"><rect y="8" width="480" height="24" rx="12" /></clipPath>
    </defs>
    <g clipPath="url(#band-track)">
      <rect y="8" width="96" height="24" className="band-illustration-outside" />
      <rect x="96" y="8" width="288" height="24" className="band-illustration-in-range" />
      <rect x="168" y="8" width="136" height="24" className="band-illustration-optimal" />
      <rect x="384" y="8" width="96" height="24" className="band-illustration-outside" />
    </g>
    <circle cx="240" cy="20" r="13" className="band-illustration-dot" />
  </svg>
);

// A soft sky behind every hero: blurred clouds over a gradient. Purely decorative.
export function CloudField() {
  return (
    <svg className="cloud-field" viewBox="0 0 1440 520" preserveAspectRatio="xMidYMin slice" aria-hidden="true">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#CFE5F7" />
          <stop offset="1" stopColor="#EAF4FC" />
        </linearGradient>
        <filter id="soft" x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation="28" />
        </filter>
      </defs>
      <rect width="1440" height="520" fill="url(#sky)" />
      <g filter="url(#soft)" fill="#FFFFFF">
        <ellipse cx="220" cy="150" rx="260" ry="70" opacity="0.85" />
        <ellipse cx="420" cy="210" rx="210" ry="60" opacity="0.7" />
        <ellipse cx="1040" cy="110" rx="300" ry="80" opacity="0.8" />
        <ellipse cx="1290" cy="230" rx="240" ry="70" opacity="0.65" />
        <ellipse cx="740" cy="330" rx="340" ry="60" opacity="0.5" />
      </g>
    </svg>
  );
}
