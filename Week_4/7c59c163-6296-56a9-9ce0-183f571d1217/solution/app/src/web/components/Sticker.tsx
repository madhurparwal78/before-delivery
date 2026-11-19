// The four die-cut stickers, drawn procedurally as SVG: a YES/NO coin, a margin dial, a spot cube
// and a statement envelope. Flat fills, a thick stone die-cut edge and ink line work.

export type StickerKind = "coin" | "dial" | "cube" | "envelope";

const INK = "var(--ink)";
const EDGE = "var(--stone)";

function Coin() {
  return (
    <g>
      <circle cx="100" cy="100" r="88" fill="var(--sage)" stroke={EDGE} strokeWidth="14" />
      <circle cx="100" cy="100" r="88" fill="none" stroke={INK} strokeWidth="5" />
      <circle cx="100" cy="100" r="66" fill="none" stroke={INK} strokeWidth="4" strokeDasharray="6 10" />
      <path d="M38 100h124" stroke={INK} strokeWidth="5" strokeLinecap="round" />
      <text x="100" y="86" textAnchor="middle" fontFamily="Parkinsans, sans-serif" fontWeight="700" fontSize="34" fill={INK}>YES</text>
      <text x="100" y="136" textAnchor="middle" fontFamily="Parkinsans, sans-serif" fontWeight="700" fontSize="34" fill={INK}>NO</text>
    </g>
  );
}

function Dial() {
  const ticks = Array.from({ length: 9 }, (_, i) => {
    const angle = Math.PI + (i * Math.PI) / 8;
    const inner = 58;
    const outer = i % 2 === 0 ? 78 : 70;
    return `M${100 + inner * Math.cos(angle)} ${118 + inner * Math.sin(angle)}L${100 + outer * Math.cos(angle)} ${118 + outer * Math.sin(angle)}`;
  });
  return (
    <g>
      <path d="M14 130a86 86 0 0 1 172 0v18a14 14 0 0 1-14 14H28a14 14 0 0 1-14-14z" fill="var(--blush)" stroke={EDGE} strokeWidth="14" strokeLinejoin="round" />
      <path d="M14 130a86 86 0 0 1 172 0v18a14 14 0 0 1-14 14H28a14 14 0 0 1-14-14z" fill="none" stroke={INK} strokeWidth="5" strokeLinejoin="round" />
      <path d={ticks.join("")} stroke={INK} strokeWidth="5" strokeLinecap="round" />
      <path d="M100 118 146 72" stroke={INK} strokeWidth="8" strokeLinecap="round" />
      <circle cx="100" cy="118" r="11" fill={INK} />
      <text x="100" y="152" textAnchor="middle" fontFamily="Parkinsans, sans-serif" fontWeight="700" fontSize="20" fill={INK}>2×</text>
    </g>
  );
}

function Cube() {
  return (
    <g strokeLinejoin="round">
      <path d="M100 18 176 60v86l-76 42-76-42V60z" fill="var(--surface)" stroke={EDGE} strokeWidth="14" />
      <path d="M100 18 176 60 100 102 24 60z" fill="color-mix(in srgb, var(--surface) 70%, white)" stroke={INK} strokeWidth="5" />
      <path d="M24 60l76 42v86l-76-42z" fill="color-mix(in srgb, var(--surface) 82%, var(--slate))" stroke={INK} strokeWidth="5" />
      <path d="M176 60l-76 42v86l76-42z" fill="color-mix(in srgb, var(--surface) 55%, var(--slate))" stroke={INK} strokeWidth="5" />
      <path d="M62 81v46M138 81v46" stroke={INK} strokeWidth="4" strokeLinecap="round" opacity="0.55" />
    </g>
  );
}

function Envelope() {
  return (
    <g strokeLinejoin="round">
      <rect x="14" y="40" width="172" height="120" rx="16" fill="var(--olive)" stroke={EDGE} strokeWidth="14" />
      <rect x="14" y="40" width="172" height="120" rx="16" fill="none" stroke={INK} strokeWidth="5" />
      <path d="M20 50 100 112 180 50" fill="none" stroke="var(--stone)" strokeWidth="7" strokeLinecap="round" />
      <path d="M40 132h52M40 146h34" stroke="var(--stone)" strokeWidth="6" strokeLinecap="round" />
      <circle cx="150" cy="134" r="14" fill="var(--blush)" stroke={INK} strokeWidth="4" />
    </g>
  );
}

const SHAPES = { coin: Coin, dial: Dial, cube: Cube, envelope: Envelope };

/** A sticker tilted by `tilt` degrees; `className` places and crops it at a viewport edge. */
export function Sticker({ kind, tilt, className = "" }: { kind: StickerKind; tilt: number; className?: string }) {
  const Shape = SHAPES[kind];
  return (
    <div className={`sticker sticker-${kind} ${className}`} style={{ ["--tilt" as string]: `${tilt}deg` }} aria-hidden="true">
      <svg viewBox="0 0 200 200" width="100%" height="100%" focusable="false">
        <Shape />
      </svg>
    </div>
  );
}
