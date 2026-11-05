import type { JSX } from "react";
import type { Section } from "./Stage";

// Still drawings of the four pinned objects, shown when WebGL is unavailable. Drawn for this app.

const INK = "#1A1D26";
const COBALT = "#1E44C2";
const SEAM = "#E0522B";
const PAPER = "#FAF6EE";
const STONE = "#8C7F6E";
const SHADE = "#2A2F3D";

function Monolith() {
  return (
    <svg viewBox="0 0 400 520">
      <ellipse cx="200" cy="470" rx="150" ry="22" fill={INK} opacity="0.12" />
      <polygon points="130,60 200,40 270,60 285,460 200,478 115,460" fill={INK} />
      <polygon points="200,40 270,60 285,460 200,478" fill={SHADE} />
      <line x1="200" y1="70" x2="200" y2="440" stroke={COBALT} strokeWidth="5" />
      <line x1="118" y1="466" x2="282" y2="466" stroke={SEAM} strokeWidth="3" />
    </svg>
  );
}

function Deck() {
  return (
    <svg viewBox="0 0 400 520">
      <ellipse cx="200" cy="440" rx="170" ry="20" fill={INK} opacity="0.1" />
      {[-2, -1, 0, 1].map((i) => (
        <g key={i} transform={`translate(${200 + i * 44} ${250 - i * 6}) rotate(${i * 7})`}>
          <rect x="-110" y="-72" width="220" height="144" rx="6" fill={PAPER} stroke={STONE} strokeWidth="2" />
          <rect x="-110" y="-72" width="220" height="20" rx="6" fill={COBALT} />
          <rect x="-90" y="-30" width="120" height="10" rx="3" fill={INK} opacity="0.8" />
          <rect x="-90" y="-8" width="170" height="6" rx="3" fill={STONE} opacity="0.6" />
          <rect x="-90" y="6" width="150" height="6" rx="3" fill={STONE} opacity="0.6" />
        </g>
      ))}
    </svg>
  );
}

function Rail() {
  const beads: [number, number][] = [[78, 330], [158, 220], [250, 280], [330, 170]];
  return (
    <svg viewBox="0 0 400 520">
      <ellipse cx="200" cy="430" rx="170" ry="18" fill={INK} opacity="0.1" />
      <path d="M40 360 C 110 260, 140 200, 200 250 S 300 300, 360 140" fill="none" stroke={STONE} strokeWidth="7" strokeLinecap="round" />
      {beads.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="22" fill={COBALT} />
          <circle cx={x - 7} cy={y - 7} r="6" fill={PAPER} opacity="0.45" />
        </g>
      ))}
    </svg>
  );
}

function Sheet() {
  return (
    <svg viewBox="0 0 400 520">
      <ellipse cx="200" cy="430" rx="160" ry="18" fill={INK} opacity="0.1" />
      <polygon points="200,110 60,140 70,400 200,380" fill={PAPER} stroke={STONE} strokeWidth="2" />
      <polygon points="200,110 340,140 330,400 200,380" fill="#F1EADC" stroke={STONE} strokeWidth="2" />
      <line x1="200" y1="110" x2="200" y2="380" stroke={SEAM} strokeWidth="4" />
      <text x="80" y="250" fontFamily="IBM Plex Mono, monospace" fontSize="26" fill={INK}>40%</text>
      <text x="236" y="250" fontFamily="IBM Plex Mono, monospace" fontSize="26" fill={INK}>60%</text>
    </svg>
  );
}

function Shelf() {
  return (
    <svg viewBox="0 0 400 520">
      <line x1="30" y1="380" x2="370" y2="380" stroke={STONE} strokeWidth="2" />
      <polygon points="70,250 86,244 102,250 105,378 86,382 67,378" fill={INK} />
      <rect x="130" y="320" width="70" height="46" rx="3" fill={PAPER} stroke={STONE} strokeWidth="2" transform="rotate(-6 165 343)" />
      <path d="M220 360 C 240 330, 255 320, 270 340 S 300 345, 315 315" fill="none" stroke={STONE} strokeWidth="3" />
      {[[228, 352], [252, 330], [282, 342], [308, 322]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="6" fill={COBALT} />
      ))}
      <polygon points="330,300 350,306 350,372 330,366" fill={PAPER} stroke={STONE} strokeWidth="1.5" />
      <line x1="330" y1="300" x2="330" y2="366" stroke={SEAM} strokeWidth="2" />
    </svg>
  );
}

const DRAWINGS: Record<Section, () => JSX.Element> = { hero: Monolith, work: Deck, process: Rail, pricing: Sheet, contact: Shelf };

export function StillDrawing({ section }: { section: Section }) {
  const Drawing = DRAWINGS[section];
  return (
    <div className={`still still--${section}`}>
      <Drawing />
    </div>
  );
}
