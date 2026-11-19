import { useId } from "react";

/** Prints drawn in code: bone lines on green-black. Nothing here is a picture file. */

const WINDOW_FRAME = "M40 40H360V460H40Z M54 54H346V446H54Z M200 54V446 M54 215H346 M54 335H346";

/** A moth on a lit window sash, upright 4:5. */
export function MothPrint({ className = "" }: { className?: string }) {
  const glow = useId();
  const wing = "M194 232C150 190 96 196 70 238C62 262 90 290 134 292C168 292 190 272 194 262Z";
  const hind = "M194 262C160 272 128 300 130 330C140 350 172 336 192 300Z";
  const veins = "M194 240L96 240M194 250L90 262M194 258L110 282M194 244L120 210";
  const half = (
    <>
      <path d={wing} />
      <path d={hind} />
      <path d={veins} />
      <circle cx="118" cy="254" r="11" />
      <circle cx="118" cy="254" r="4" />
      <path d="M196 200C180 170 160 166 150 150" />
    </>
  );
  return (
    <svg className={`print ${className}`} viewBox="31 39 338 422" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={glow} cx="50%" cy="46%" r="52%">
          <stop offset="0" stopColor="var(--ink)" stopOpacity="0.2" />
          <stop offset="0.6" stopColor="var(--ink)" stopOpacity="0.05" />
          <stop offset="1" stopColor="var(--ink)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="54" y="54" width="292" height="392" fill={`url(#${glow})`} stroke="none" />
      <path d={WINDOW_FRAME} fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" />
      <g fill="none" stroke="var(--ink)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {half}
        <g transform="translate(400 0) scale(-1 1)">{half}</g>
        <ellipse cx="200" cy="255" rx="9" ry="46" fill="var(--ink)" fillOpacity="0.12" />
        <circle cx="200" cy="204" r="7" />
      </g>
      <path d="M40 460H360" stroke="var(--ink)" strokeWidth="2" />
    </svg>
  );
}

/** A fern frond, square. */
export function FernPrint({ className = "" }: { className?: string }) {
  const stem = (t: number): { x: number; y: number; tx: number; ty: number } => {
    const p0 = { x: 26, y: 192 };
    const p1 = { x: 58, y: 96 };
    const p2 = { x: 166, y: 22 };
    const u = 1 - t;
    return {
      x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
      y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
      tx: 2 * u * (p1.x - p0.x) + 2 * t * (p2.x - p1.x),
      ty: 2 * u * (p1.y - p0.y) + 2 * t * (p2.y - p1.y),
    };
  };
  const leaves: string[] = [];
  for (let t = 0.1; t < 0.97; t += 0.055) {
    const { x, y, tx, ty } = stem(t);
    const length = Math.hypot(tx, ty);
    const ux = tx / length;
    const uy = ty / length;
    const reach = 6 + 32 * (1 - t) ** 0.8;
    for (const side of [-1, 1]) {
      const angle = (side * 62 * Math.PI) / 180;
      const dx = ux * Math.cos(angle) - uy * Math.sin(angle);
      const dy = ux * Math.sin(angle) + uy * Math.cos(angle);
      const ex = x + dx * reach;
      const ey = y + dy * reach;
      leaves.push(`M${x.toFixed(1)} ${y.toFixed(1)}Q${(x + dx * reach * 0.6 + ux * 6).toFixed(1)} ${(y + dy * reach * 0.6 + uy * 6).toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`);
    }
  }
  let spine = "M26 192";
  for (let t = 0.05; t <= 1.001; t += 0.05) {
    const { x, y } = stem(t);
    spine += `L${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return (
    <svg className={`print ${className}`} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <g fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d={spine} strokeWidth="2" />
        <path d={leaves.join("")} />
      </g>
    </svg>
  );
}

function seeded(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/** One lit print for empty and not-found states: a lamp-lit pane with a small moth, varied by the seed. */
export function EmptyPrint({ seed, className = "" }: { seed: string; className?: string }) {
  const random = seeded(seed);
  const glow = useId();
  const mx = 70 + random() * 60;
  const my = 70 + random() * 70;
  const scale = 0.7 + random() * 0.5;
  const tilt = (random() - 0.5) * 40;
  return (
    <svg className={`print print--empty ${className}`} viewBox="0 0 200 250" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={glow} cx={`${(mx / 200) * 100}%`} cy={`${(my / 250) * 100}%`} r="60%">
          <stop offset="0" stopColor="var(--ink)" stopOpacity="0.26" />
          <stop offset="1" stopColor="var(--ink)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="20" y="20" width="160" height="210" fill={`url(#${glow})`} />
      <path d="M20 20H180V230H20Z M30 30H170V220H30Z M100 30V220 M30 120H170" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinejoin="round" />
      <g transform={`translate(${mx} ${my}) rotate(${tilt}) scale(${scale})`} fill="none" stroke="var(--ink)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M-2 -4C-20 -22 -42 -20 -50 -2C-52 14 -34 22 -18 18C-8 15 -3 8 -2 4Z" />
        <path d="M2 -4C20 -22 42 -20 50 -2C52 14 34 22 18 18C8 15 3 8 2 4Z" />
        <path d="M0 -10V22" />
        <path d="M-1 -10C-8 -22 -16 -24 -20 -30M1 -10C8 -22 16 -24 20 -30" />
      </g>
    </svg>
  );
}
