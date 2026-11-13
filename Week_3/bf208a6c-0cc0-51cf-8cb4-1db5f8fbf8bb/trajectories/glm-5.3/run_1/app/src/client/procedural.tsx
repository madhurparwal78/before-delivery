const SANDS = ['#e9e0cf', '#ded3ba', '#e3d8c4', '#d9cdb2'];
const GREENS = ['#8a9a6b', '#6a7d4f', '#97a878', '#7d8f5c'];

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function proceduralColors(seed: string): { a: string; b: string; c: string; angle: number } {
  const h = hashString(seed);
  return {
    a: SANDS[h % SANDS.length]!,
    b: GREENS[(h >> 3) % GREENS.length]!,
    c: SANDS[(h >> 6) % SANDS.length]!,
    angle: (h % 8) * 45,
  };
}

export function proceduralField(seed: string): React.CSSProperties {
  const { a, b, c, angle } = proceduralColors(seed);
  return {
    background: `linear-gradient(${angle}deg, ${a} 0%, ${b} 55%, ${c} 100%)`,
  };
}
