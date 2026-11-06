import { useId } from "react";
import { FLAVOUR_COPY } from "./flavours";

// A layered drawing of the can, made in code: lid, rim, body, label band with the wordmark and
// a ring of leaves, and a fixed highlight. `--label-shift` slides the label artwork sideways.

const LEAVES = Array.from({ length: 9 }, (_, i) => i);

export function CanArt({ flavour, className = "" }: { flavour: string; className?: string }) {
  const id = useId().replace(/:/g, "");
  const look = FLAVOUR_COPY[flavour] ?? FLAVOUR_COPY["guava-lime"];
  const artwork = (dx: number) => (
    <g transform={`translate(${dx} 0)`}>
      <rect x="0" y="62" width="160" height="148" fill={look.label} />
      <rect x="0" y="176" width="160" height="16" fill={look.band} />
      <rect x="0" y="70" width="160" height="5" fill={look.band} opacity="0.85" />
      {LEAVES.map((i) => (
        <path
          key={i}
          d="M0 0 C 5 -6 15 -6 20 0 C 15 6 5 6 0 0 Z"
          fill={look.band}
          opacity="0.9"
          transform={`translate(${8 + i * 17.5} ${i % 2 ? 160 : 156}) rotate(${i % 2 ? 24 : -24}) scale(0.62)`}
        />
      ))}
      <circle cx="60" cy="96" r="10" fill={look.band} />
      <path d="M60 88 c4 3 6 6 6 9a6 6 0 0 1-12 0c0-3 2-6 6-9z" fill={look.label} />
      <text x="60" y="130" textAnchor="middle" fontFamily="Fraunces, Georgia, serif" fontWeight="700" fontSize="21" letterSpacing="2" fill={look.ink}>
        CEIBO
      </text>
      <text x="60" y="144" textAnchor="middle" fontFamily="'Atkinson Hyperlegible', sans-serif" fontWeight="700" fontSize="6.4" letterSpacing="1" fill={look.ink}>
        SPARKLING YERBA MATE
      </text>
      <text x="140" y="126" textAnchor="middle" fontFamily="'Atkinson Hyperlegible', sans-serif" fontWeight="700" fontSize="6" letterSpacing="0.8" fill={look.ink} opacity="0.8">
        ORGANIC
      </text>
    </g>
  );
  return (
    <svg className={`can-art ${className}`} viewBox="0 0 120 250" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-metal`} x1="0" x2="1">
          <stop offset="0" stopColor="#7d8580" />
          <stop offset="0.35" stopColor="#eef1ee" />
          <stop offset="0.6" stopColor="#b9c0bb" />
          <stop offset="1" stopColor="#6c736e" />
        </linearGradient>
        <linearGradient id={`${id}-shade`} x1="0" x2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0.45" />
          <stop offset="0.25" stopColor="#000" stopOpacity="0" />
          <stop offset="0.7" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.5" />
        </linearGradient>
        <clipPath id={`${id}-body`}>
          <path d="M14 48 C 14 40 20 36 26 34 L 94 34 C 100 36 106 40 106 48 L 106 214 C 106 226 98 232 86 234 L 34 234 C 22 232 14 226 14 214 Z" />
        </clipPath>
      </defs>
      <ellipse cx="60" cy="240" rx="44" ry="6" fill="#000" opacity="0.35" />
      <path d="M14 48 C 14 40 20 36 26 34 L 94 34 C 100 36 106 40 106 48 L 106 214 C 106 226 98 232 86 234 L 34 234 C 22 232 14 226 14 214 Z" fill={`url(#${id}-metal)`} />
      <g clipPath={`url(#${id}-body)`}>
        <g className="can-label" style={{ transform: "translateX(var(--label-shift, 0px))" }}>
          {artwork(-160)}
          {artwork(0)}
          {artwork(160)}
        </g>
        <rect x="0" y="0" width="120" height="250" fill={`url(#${id}-shade)`} />
        <rect x="30" y="40" width="9" height="190" fill="#fff" opacity="0.28" rx="4" />
        <rect x="44" y="40" width="3" height="190" fill="#fff" opacity="0.18" />
      </g>
      <path d="M22 34 C 24 22 34 18 60 18 C 86 18 96 22 98 34 Z" fill={`url(#${id}-metal)`} />
      <ellipse cx="60" cy="20" rx="36" ry="7" fill="#d9ded9" stroke="#8a918c" strokeWidth="2" />
      <ellipse cx="60" cy="20" rx="27" ry="4.5" fill="#bfc6c0" />
      <path d="M52 18 q8 -6 16 0 q-8 4 -16 0z" fill="#9aa29c" />
    </svg>
  );
}
