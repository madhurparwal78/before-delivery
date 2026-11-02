import { useMemo } from "react";

// A border of mate leaves and ceibo blossoms, drawn in code. A seeded generator places every
// leaf and petal, so the same border draws the same way on every load.

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WIDTH = 1600;
const HEIGHT = 120;
const LEAF = "M0 0 C 9 -11 29 -12 40 0 C 29 12 9 11 0 0 Z";
const PETAL = "M0 0 C 5 -6 14 -20 9 -34 C 4 -24 -2 -12 0 0 Z";
const KEEL = "M0 0 C 10 -4 24 -18 22 -40 C 12 -30 2 -16 0 0 Z";
const LEAF_TONES = ["#8cc47a", "#6fa65c", "#4f8a41", "#a9d38f"];
const BLOSSOM_TONES = ["#ec5a6e", "#d8344c", "#f07b8b"];

interface Placed {
  kind: "leaf" | "blossom";
  x: number;
  y: number;
  angle: number;
  scale: number;
  tone: string;
}

function layout(seed: number): { stem: string; items: Placed[] } {
  const rand = mulberry32(seed);
  const points: [number, number][] = [];
  for (let x = -40; x <= WIDTH + 40; x += 80) points.push([x, HEIGHT / 2 + (rand() - 0.5) * 34]);
  const stem = points.map(([x, y], i) => `${i === 0 ? "M" : "S"} ${x} ${y}${i === 0 ? "" : ` ${x + 40} ${y}`}`).join(" ");
  const items: Placed[] = [];
  for (let x = 0; x < WIDTH; x += 26 + rand() * 18) {
    const side = rand() < 0.5 ? -1 : 1;
    const near = points[Math.min(points.length - 1, Math.round((x + 40) / 80))][1];
    items.push({
      kind: "leaf",
      x,
      y: near + side * (4 + rand() * 10),
      angle: side * (25 + rand() * 50) + (rand() - 0.5) * 20,
      scale: 0.7 + rand() * 0.6,
      tone: LEAF_TONES[Math.floor(rand() * LEAF_TONES.length)],
    });
    if (rand() < 0.16) {
      items.push({
        kind: "blossom",
        x: x + 10,
        y: near + (rand() - 0.5) * 20,
        angle: (rand() - 0.5) * 60,
        scale: 0.75 + rand() * 0.45,
        tone: BLOSSOM_TONES[Math.floor(rand() * BLOSSOM_TONES.length)],
      });
    }
  }
  return { stem, items };
}

function Blossom({ tone }: { tone: string }) {
  return (
    <g>
      <path d={KEEL} fill={tone} />
      <path d={PETAL} fill={tone} transform="rotate(-38) scale(0.8)" opacity="0.92" />
      <path d={PETAL} fill={tone} transform="rotate(34) scale(0.7)" opacity="0.85" />
      <path d="M2 -2 C 8 -14 6 -26 14 -34" stroke="#ffd666" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      <circle cx="14" cy="-34" r="2.2" fill="#ffd666" />
      <path d="M0 0 C -2 6 -1 10 1 14" stroke="#4f8a41" strokeWidth="2.4" fill="none" strokeLinecap="round" />
    </g>
  );
}

export function Border({ seed, className = "" }: { seed: number; className?: string }) {
  const { stem, items } = useMemo(() => layout(seed), [seed]);
  return (
    <svg
      className={`botanical-border ${className}`}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
      data-seed={seed}
    >
      <path d={stem} stroke="#3f6b33" strokeWidth="3" fill="none" strokeLinecap="round" />
      {items.map((item, i) => (
        <g key={i} transform={`translate(${item.x.toFixed(1)} ${item.y.toFixed(1)}) rotate(${item.angle.toFixed(1)}) scale(${item.scale.toFixed(3)})`}>
          {item.kind === "leaf" ? (
            <>
              <path d={LEAF} fill={item.tone} />
              <path d="M1 0 L 36 0" stroke="#24451f" strokeWidth="1.1" opacity="0.6" />
            </>
          ) : (
            <Blossom tone={item.tone} />
          )}
        </g>
      ))}
    </svg>
  );
}
