/** Procedural service portraits: a 2:3 mosaic of simple glyph shapes generated from the name. */

const PALETTES: Array<{ ground: string; glyphs: string[] }> = [
  { ground: "#0A1030", glyphs: ["#FF6A13", "#FFFFFF", "#FF8A3D"] },
  { ground: "#7A2B08", glyphs: ["#FF8A3D", "#FFFFFF", "#0A1030"] },
  { ground: "#FF8A3D", glyphs: ["#0A1030", "#7A2B08", "#FFFFFF"] },
  { ground: "#FFFFFF", glyphs: ["#0A1030", "#FF6A13", "#7A2B08"] },
  { ground: "#FF6A13", glyphs: ["#0A1030", "#FFFFFF", "#7A2B08"] },
];

function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function generator(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COLUMNS = 4;
const ROWS = 6;
const CELL = 30;

function glyph(kind: number, x: number, y: number, fill: string, key: string): JSX.Element {
  const c = CELL;
  const cx = x + c / 2;
  const cy = y + c / 2;
  switch (kind) {
    case 0:
      return <circle key={key} cx={cx} cy={cy} r={c * 0.38} fill={fill} />;
    case 1:
      return <rect key={key} x={x + 4} y={y + 4} width={c - 8} height={c - 8} fill={fill} />;
    case 2:
      return <polygon key={key} points={`${x + 3},${y + c - 3} ${cx},${y + 3} ${x + c - 3},${y + c - 3}`} fill={fill} />;
    case 3:
      return <path key={key} d={`M${x + 3} ${cy} A${c * 0.42} ${c * 0.42} 0 0 1 ${x + c - 3} ${cy} Z`} fill={fill} />;
    case 4:
      return <path key={key} d={`M${cx - 3} ${y + 3}h6v${c / 2 - 6}h${c / 2 - 6}v6h-${c / 2 - 6}v${c / 2 - 6}h-6v-${c / 2 - 6}h-${c / 2 - 6}v-6h${c / 2 - 6}z`} fill={fill} />;
    default:
      return <rect key={key} x={x + 3} y={cy - 3} width={c - 6} height={6} fill={fill} />;
  }
}

export function Portrait({ name, label, palette }: { name: string; label?: string; palette?: number }): JSX.Element {
  const seed = seedOf(name);
  const random = generator(seed);
  const scheme = PALETTES[palette ?? seed % PALETTES.length]!;
  const cells: JSX.Element[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let column = 0; column < COLUMNS; column++) {
      if (random() < 0.18) continue;
      const kind = Math.floor(random() * 6);
      const fill = scheme.glyphs[Math.floor(random() * scheme.glyphs.length)]!;
      cells.push(glyph(kind, column * CELL, row * CELL, fill, `${row}-${column}`));
    }
  }
  return (
    <svg className="portrait" viewBox={`0 0 ${COLUMNS * CELL} ${ROWS * CELL}`} role="img" aria-label={label ?? `${name} portrait`} preserveAspectRatio="xMidYMid slice">
      <rect width={COLUMNS * CELL} height={ROWS * CELL} fill={scheme.ground} />
      {cells}
    </svg>
  );
}
