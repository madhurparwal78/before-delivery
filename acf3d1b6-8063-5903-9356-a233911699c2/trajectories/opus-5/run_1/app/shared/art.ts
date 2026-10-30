export type Aspect = '16:9' | '9:16' | '1:1';

const SIZES: Record<Aspect, { w: number; h: number }> = {
  '16:9': { w: 1600, h: 900 },
  '9:16': { w: 900, h: 1600 },
  '1:1': { w: 1200, h: 1200 }
};

function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function makeRandom(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function hsl(h: number, s: number, l: number, a = 1): string {
  return `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%${a < 1 ? ` / ${a}` : ''})`;
}

export interface ArtOptions {
  seed: string;
  aspect?: Aspect;
  animated?: boolean;
  loopSeconds?: number;
  title: string;
}

/**
 * Draws the one picture of a generation (and every decorative frame on the public
 * site) purely from a seed phrase, so the same phrase always yields the same art.
 */
export function drawArt({ seed, aspect = '16:9', animated = false, loopSeconds = 10, title }: ArtOptions): string {
  const { w, h } = SIZES[aspect];
  const seedNumber = hash32(seed);
  const random = makeRandom(seedNumber);
  const uid = seedNumber.toString(36);
  const baseHue = seedNumber % 360;
  const spread = 40 + (seedNumber % 70);
  const hues = [baseHue, (baseHue + spread) % 360, (baseHue + 2 * spread) % 360, (baseHue + 200) % 360];

  const bands: string[] = [];
  const bandCount = 4 + Math.floor(random() * 3);
  for (let i = 0; i < bandCount; i++) {
    const hue = hues[i % hues.length];
    const cx = Math.round(w * (0.1 + random() * 0.8));
    const cy = Math.round(h * (0.1 + random() * 0.8));
    const rx = Math.round(w * (0.3 + random() * 0.45));
    const ry = Math.round(h * (0.18 + random() * 0.35));
    const rotation = Math.round(random() * 180);
    const delay = (random() * loopSeconds).toFixed(2);
    bands.push(
      `<ellipse class="band b${i % 3}" cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${hsl(
        hue,
        62 + random() * 22,
        58 + random() * 18,
        0.5
      )}" transform="rotate(${rotation} ${cx} ${cy})" style="animation-delay:-${delay}s" />`
    );
  }

  const shapes: string[] = [];
  const shapeCount = 2 + Math.floor(random() * 3);
  for (let i = 0; i < shapeCount; i++) {
    const hue = hues[(i + 1) % hues.length];
    const kind = Math.floor(random() * 3);
    const cx = Math.round(w * (0.15 + random() * 0.7));
    const cy = Math.round(h * (0.15 + random() * 0.7));
    const size = Math.round(Math.min(w, h) * (0.07 + random() * 0.2));
    const stroke = hsl(hue, 70, 92, 0.75);
    const delay = (random() * loopSeconds).toFixed(2);
    const style = ` style="animation-delay:-${delay}s"`;
    if (kind === 0) {
      shapes.push(
        `<circle class="mark" cx="${cx}" cy="${cy}" r="${size}" fill="none" stroke="${stroke}" stroke-width="${Math.max(
          2,
          Math.round(size * 0.05)
        )}"${style} />`
      );
    } else if (kind === 1) {
      shapes.push(
        `<rect class="mark" x="${cx - size}" y="${cy - size}" width="${size * 2}" height="${size * 2}" rx="${Math.round(
          size * 0.4
        )}" fill="${hsl(hue, 60, 80, 0.3)}" stroke="${stroke}" stroke-width="2"${style} />`
      );
    } else {
      shapes.push(
        `<path class="mark" d="M${cx - size} ${cy} A ${size} ${size} 0 0 1 ${cx + size} ${cy}" fill="none" stroke="${stroke}" stroke-width="${Math.max(
          2,
          Math.round(size * 0.07)
        )}" stroke-linecap="round"${style} />`
      );
    }
  }

  const horizon = Math.round(h * (0.55 + random() * 0.2));
  const motion = animated
    ? `
    .band { animation: drift-${uid} ${loopSeconds}s ease-in-out infinite alternate; transform-box: fill-box; transform-origin: center; }
    .b1 { animation-duration: ${(loopSeconds * 1.3).toFixed(2)}s; }
    .b2 { animation-duration: ${(loopSeconds * 0.8).toFixed(2)}s; }
    .mark { animation: glow-${uid} ${loopSeconds}s ease-in-out infinite alternate; transform-box: fill-box; transform-origin: center; }
    .sheen { animation: sweep-${uid} ${loopSeconds}s linear infinite; }
    @keyframes drift-${uid} { from { transform: translate(-2.5%, 1.5%) scale(1); } to { transform: translate(3%, -2%) scale(1.08); } }
    @keyframes glow-${uid} { from { opacity: .45; transform: scale(.94); } to { opacity: .95; transform: scale(1.06); } }
    @keyframes sweep-${uid} { from { transform: translateX(-${w}px); } to { transform: translateX(${w}px); } }
    @media (prefers-reduced-motion: reduce) { .band, .mark, .sheen { animation: none; } }`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${escapeXml(
    title
  )}" preserveAspectRatio="xMidYMid slice"><title>${escapeXml(title)}</title><defs><linearGradient id="g-${uid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${hsl(
    hues[0],
    48,
    22
  )}"/><stop offset="55%" stop-color="${hsl(hues[1], 52, 34)}"/><stop offset="100%" stop-color="${hsl(
    hues[2],
    44,
    16
  )}"/></linearGradient><linearGradient id="s-${uid}" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#ffffff" stop-opacity="0"/><stop offset="50%" stop-color="#ffffff" stop-opacity=".18"/><stop offset="100%" stop-color="#ffffff" stop-opacity="0"/></linearGradient><radialGradient id="v-${uid}" cx="50%" cy="45%" r="75%"><stop offset="55%" stop-color="#000000" stop-opacity="0"/><stop offset="100%" stop-color="#000000" stop-opacity=".45"/></radialGradient><filter id="f-${uid}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${Math.round(
    Math.min(w, h) * 0.06
  )}"/></filter></defs><style>${motion}</style><rect width="${w}" height="${h}" fill="url(#g-${uid})"/><g filter="url(#f-${uid})">${bands.join(
    ''
  )}</g><g opacity=".9">${shapes.join(
    ''
  )}</g><rect class="sheen" width="${w}" height="${h}" fill="url(#s-${uid})"/><path d="M0 ${horizon} Q ${w / 2} ${
    horizon - Math.round(h * 0.08)
  } ${w} ${horizon} L ${w} ${h} L 0 ${h} Z" fill="${hsl(hues[3], 40, 12, 0.45)}"/><rect width="${w}" height="${h}" fill="url(#v-${uid})"/></svg>`;
}

export function artDataUri(options: ArtOptions): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(drawArt(options))}`;
}
