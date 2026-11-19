/**
 * Every drawing in the app comes from one dot primitive: chairs, leather
 * grains, hides and condition fragments. There is no leather colour anywhere,
 * so a swatch is told apart by its grain, its name and its code.
 */

const INK = '#17181a';
const MUTED = '#5c6066';
const SURFACE = '#eceef0';

/** A small deterministic generator, so a drawing is the same every time. */
function generator(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let state = h >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The one dot primitive. Density is dots per 100 square units. */
function dots(
  random: () => number,
  box: Box,
  density: number,
  radius: number,
  colour: string,
): string {
  const count = Math.max(1, Math.round((box.w * box.h * density) / 100));
  let out = '';
  for (let i = 0; i < count; i += 1) {
    const cx = (box.x + random() * box.w).toFixed(1);
    const cy = (box.y + random() * box.h).toFixed(1);
    const r = (radius * (0.6 + random() * 0.8)).toFixed(2);
    out += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${colour}"/>`;
  }
  return out;
}

function svg(viewBox: string, inner: string, attributes = ''): string {
  return `<svg viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" focusable="false" aria-hidden="true" ${attributes}>${inner}</svg>`;
}

/**
 * A chair drawn from dots. Each family of chair reads differently because the
 * seed moves its frame, its back and its grain.
 */
export function chairDrawing(seed: string): string {
  const random = generator(`chair|${seed}`);
  const lean = Math.round(random() * 14) - 7;
  const backHeight = 58 + Math.round(random() * 26);
  const seatDepth = 26 + Math.round(random() * 10);
  const legSpread = 6 + Math.round(random() * 10);
  const grain = 14 + random() * 22;

  const seat: Box = { x: 34, y: 112, w: 92, h: seatDepth };
  const back: Box = { x: 44, y: 112 - backHeight, w: 76, h: backHeight };

  const frame = (x: number, y: number, w: number, h: number): string =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="none" stroke="${INK}" stroke-width="2"/>`;

  return svg(
    '0 0 160 200',
    [
      `<rect x="0" y="0" width="160" height="200" fill="${SURFACE}"/>`,
      `<g transform="rotate(${lean} 80 120)">`,
      `<rect x="${back.x}" y="${back.y}" width="${back.w}" height="${back.h}" rx="3" fill="#fff"/>`,
      dots(random, back, grain, 1.1, MUTED),
      frame(back.x, back.y, back.w, back.h),
      `</g>`,
      `<rect x="${seat.x}" y="${seat.y}" width="${seat.w}" height="${seat.h}" rx="3" fill="#fff"/>`,
      dots(random, seat, grain * 1.2, 1.2, MUTED),
      frame(seat.x, seat.y, seat.w, seat.h),
      frame(seat.x + legSpread, seat.y + seatDepth, 5, 56),
      frame(seat.x + seat.w - legSpread - 5, seat.y + seatDepth, 5, 56),
      `<line x1="${seat.x + legSpread}" y1="${seat.y + seatDepth + 40}" x2="${
        seat.x + seat.w - legSpread
      }" y2="${seat.y + seatDepth + 40}" stroke="${INK}" stroke-width="2"/>`,
    ].join(''),
  );
}

/** A leather or fabric grain: density and dot size carry the material, not hue. */
export function grainSwatch(code: string, unit: 'sqFt' | 'metre'): string {
  const random = generator(`grain|${code}`);
  const density = unit === 'metre' ? 55 + random() * 40 : 20 + random() * 60;
  const radius = unit === 'metre' ? 0.7 : 1.1 + random() * 0.8;
  const box: Box = { x: 0, y: 0, w: 80, h: 80 };
  const weave =
    unit === 'metre'
      ? Array.from({ length: 9 }, (_, i) =>
          `<line x1="0" y1="${i * 10}" x2="80" y2="${i * 10}" stroke="${SURFACE}" stroke-width="3"/>`,
        ).join('')
      : '';
  return svg(
    '0 0 80 80',
    `<rect width="80" height="80" fill="#fff"/>${weave}${dots(random, box, density, radius, MUTED)}`,
  );
}

/** The fragment of a condition map the home page shows. */
export function pinFragment(seed: string): string {
  const random = generator(`pins|${seed}`);
  const box: Box = { x: 0, y: 0, w: 120, h: 120 };
  const pins = [
    { x: 24, y: 36 },
    { x: 60, y: 72 },
    { x: 96, y: 36 },
  ];
  return svg(
    '0 0 120 120',
    [
      `<rect width="120" height="120" fill="#fff"/>`,
      dots(random, box, 10, 0.9, SURFACE),
      ...pins.map(
        (pin, i) =>
          `<g><circle cx="${pin.x}" cy="${pin.y}" r="9" fill="none" stroke="${INK}" stroke-width="2"/>` +
          `<line x1="${pin.x - 13}" y1="${pin.y}" x2="${pin.x + 13}" y2="${pin.y}" stroke="${INK}" stroke-width="1"/>` +
          `<line x1="${pin.x}" y1="${pin.y - 13}" x2="${pin.x}" y2="${pin.y + 13}" stroke="${INK}" stroke-width="1"/>` +
          `<text x="${pin.x}" y="${pin.y + 3.5}" font-size="8" text-anchor="middle" fill="${INK}">${i + 1}</text></g>`,
      ),
    ].join(''),
  );
}

/** The ground a tile sits on, used where a picture's box must be reserved. */
export function groundTexture(seed: string): string {
  const random = generator(`ground|${seed}`);
  return svg(
    '0 0 200 120',
    `<rect width="200" height="120" fill="${SURFACE}"/>${dots(
      random,
      { x: 0, y: 0, w: 200, h: 120 },
      6,
      1,
      '#d9dcdf',
    )}`,
  );
}

/** The hide's own grain, drawn once behind the pattern pieces. */
export function hideGrain(seed: string, widthCm: number, heightCm: number): string {
  const random = generator(`hide|${seed}`);
  return `<rect width="${widthCm}" height="${heightCm}" fill="#fff"/>${dots(
    random,
    { x: 0, y: 0, w: widthCm, h: heightCm },
    1.4,
    1.6,
    '#d2d5d9',
  )}`;
}
