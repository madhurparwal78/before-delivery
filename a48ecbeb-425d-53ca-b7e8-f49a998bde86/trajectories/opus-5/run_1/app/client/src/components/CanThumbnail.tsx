import type { ReactElement } from 'react';
import type { FlavourSlug } from '../../../shared/catalogue.js';
import { canPalette } from './canArt.js';

/** A small can, drawn in code, used on flavour cards and crate slots. */
export function CanThumbnail({ flavour }: { flavour: FlavourSlug }): ReactElement {
  const palette = canPalette(flavour);
  return (
    <svg viewBox="0 0 48 110" className="can-thumb" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`body-${flavour}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="rgba(0,0,0,0.42)" />
          <stop offset="0.36" stopColor="rgba(255,255,255,0.1)" />
          <stop offset="0.56" stopColor="rgba(255,255,255,0.26)" />
          <stop offset="1" stopColor="rgba(0,0,0,0.36)" />
        </linearGradient>
        <clipPath id={`clip-${flavour}`}>
          <path d="M4 14 Q4 6 24 6 Q44 6 44 14 L44 96 Q44 104 24 104 Q4 104 4 96 Z" />
        </clipPath>
      </defs>
      <g clipPath={`url(#clip-${flavour})`}>
        <rect x="0" y="0" width="48" height="110" fill={palette.base} />
        {palette.band === null ? null : (
          <rect x="0" y="76" width="48" height="12" fill={palette.band} />
        )}
        <text
          x="24"
          y="46"
          textAnchor="middle"
          fontFamily="Fraunces, Georgia, serif"
          fontSize="13"
          fontWeight="600"
          fill={palette.ink}
        >
          Ceibo
        </text>
        <circle cx="24" cy="62" r="3.4" fill="#f2566b" />
        <rect x="0" y="0" width="48" height="110" fill={`url(#body-${flavour})`} />
      </g>
      <ellipse cx="24" cy="12" rx="20" ry="6.6" fill="#e8e4dc" />
      <ellipse cx="24" cy="12" rx="13" ry="3.8" fill="#bdb8ae" />
    </svg>
  );
}
