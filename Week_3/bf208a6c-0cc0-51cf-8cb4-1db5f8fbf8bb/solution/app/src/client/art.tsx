import { File, FileText } from "lucide-react";

function seeded(text: string): () => number {
  let h = 2166136261;
  for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SKIES: [string, string][] = [
  ["#F2E9CF", "#D6C59A"],
  ["#E9DDBB", "#B9C48F"],
  ["#EFE2C2", "#C9A97A"],
  ["#DCE0C2", "#A2B382"],
  ["#F0E6D0", "#BFB08A"],
];
const HILLS = ["#8AA05E", "#64803C", "#47662A", "#34501F", "#6F8B45", "#A3B27A"];
const W = 136;
const H = 72;

function ridge(random: () => number, base: number, amplitude: number): string {
  const points = Array.from({ length: 5 }, (_, i) => [(i * W) / 4, base - random() * amplitude] as const);
  let path = `M0 ${H} L0 ${points[0]?.[1] ?? base}`;
  for (let i = 1; i < points.length; i++) {
    const [px, py] = points[i - 1] ?? [0, base];
    const [x, y] = points[i] ?? [W, base];
    path += ` C${px + (x - px) / 2} ${py} ${px + (x - px) / 2} ${y} ${x} ${y}`;
  }
  return `${path} L${W} ${H} Z`;
}

/** A photo-like field built from the palette's sands and greens: sky, sun, hills, sometimes water. Seeded by the post id. */
export function Field({ seed }: { seed: string }) {
  const random = seeded(seed);
  const [top, bottom] = SKIES[Math.floor(random() * SKIES.length)] ?? SKIES[0] ?? ["#F2E9CF", "#D6C59A"];
  const sun = { x: 16 + random() * (W - 32), y: 10 + random() * 22, r: 5 + random() * 8 };
  const layers = [0, 1, 2].map((i) => ({
    fill: HILLS[Math.floor(random() * HILLS.length)] ?? "#47662A",
    d: ridge(random, 40 + i * 12 + random() * 6, 14 + random() * 12),
    opacity: 0.72 + i * 0.14,
  }));
  const water = random() > 0.55;
  const id = `f${seed.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <svg className="photo" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={top} />
          <stop offset="1" stopColor={bottom} />
        </linearGradient>
        <linearGradient id={`${id}w`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#C9D2A8" />
          <stop offset="1" stopColor="#8FA06A" />
        </linearGradient>
        <filter id={`${id}b`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
      </defs>
      <rect width={W} height={H} fill={`url(#${id}s)`} />
      <circle cx={sun.x} cy={sun.y} r={sun.r * 1.8} fill="#FBF4DC" opacity="0.45" filter={`url(#${id}b)`} />
      <circle cx={sun.x} cy={sun.y} r={sun.r} fill="#FBF4DC" opacity="0.9" />
      {layers.map((layer, index) => (
        <path key={index} d={layer.d} fill={layer.fill} opacity={layer.opacity} />
      ))}
      {water && <rect y={H - 14} width={W} height="14" fill={`url(#${id}w)`} opacity="0.85" />}
    </svg>
  );
}

/** A file card: the file-type icon and the label, on the surface sand. */
export function FileCard({ label, type }: { label: string; type?: string }) {
  const Icon = type === "application/pdf" || type === "text/plain" || type === undefined ? FileText : File;
  return (
    <div className="file-card">
      <Icon size={24} strokeWidth={1.75} aria-hidden="true" />
      <span className="file-label">{label}</span>
    </div>
  );
}
