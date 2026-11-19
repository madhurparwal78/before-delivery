import type { Project } from '../shared/types.js';

const SIZE = 400;

function hslHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const sector = (((hue % 360) + 360) % 360) / 60;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  const base: [number, number, number] =
    sector < 1
      ? [chroma, second, 0]
      : sector < 2
        ? [second, chroma, 0]
        : sector < 3
          ? [0, chroma, second]
          : sector < 4
            ? [0, second, chroma]
            : sector < 5
              ? [second, 0, chroma]
              : [chroma, 0, second];
  const match = l - chroma / 2;
  return `#${base
    .map((channel) =>
      Math.round((channel + match) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`.toUpperCase();
}

const seedFrom = (text: string): number => {
  let seed = 0x811c9dc5;
  for (const character of text) {
    seed ^= character.codePointAt(0)!;
    seed = Math.imul(seed, 0x01000193) >>> 0;
  }
  return seed;
};

function randomFrom(text: string): () => number {
  let state = seedFrom(text);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

interface Tones {
  ground: string;
  light: string;
  mid: string;
  dark: string;
  ink: string;
}

const tonesFor = (hue: number): Tones => ({
  ground: hslHex(hue, 24, 93),
  light: hslHex(hue, 34, 82),
  mid: hslHex(hue, 46, 58),
  dark: hslHex(hue, 48, 30),
  ink: hslHex(hue, 40, 17),
});

const round = (value: number): string => (Math.round(value * 100) / 100).toString();

function arcsComposition(random: () => number, tones: Tones): string {
  const centreX = 120 + random() * 160;
  const centreY = 140 + random() * 140;
  const shapes: string[] = [];
  const count = 5 + Math.floor(random() * 3);
  for (let index = 0; index < count; index += 1) {
    const radius = 48 + index * (26 + random() * 16);
    const width = 6 + random() * 18;
    const rotation = random() * 360;
    const sweep = index % 2 === 0 ? 1 : 0;
    const colour = index % 3 === 0 ? tones.dark : index % 3 === 1 ? tones.mid : tones.light;
    shapes.push(
      `<path d="M ${round(centreX - radius)} ${round(centreY)} A ${round(radius)} ${round(
        radius,
      )} 0 0 ${sweep} ${round(centreX + radius)} ${round(centreY)}" fill="none" stroke="${colour}" stroke-width="${round(
        width,
      )}" stroke-linecap="butt" transform="rotate(${round(rotation)} ${round(centreX)} ${round(
        centreY,
      )})"/>`,
    );
  }
  shapes.push(
    `<circle cx="${round(centreX)}" cy="${round(centreY)}" r="${round(
      22 + random() * 16,
    )}" fill="${tones.ink}"/>`,
  );
  return shapes.join('');
}

function gridComposition(random: () => number, tones: Tones): string {
  const columns = 5 + Math.floor(random() * 3);
  const rows = columns;
  const step = SIZE / columns;
  const shapes: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const roll = random();
      if (roll < 0.22) {
        shapes.push(
          `<rect x="${round(column * step)}" y="${round(row * step)}" width="${round(
            step,
          )}" height="${round(step)}" fill="${tones.dark}"/>`,
        );
      } else if (roll < 0.36) {
        shapes.push(
          `<rect x="${round(column * step)}" y="${round(row * step)}" width="${round(
            step,
          )}" height="${round(step)}" fill="${tones.mid}"/>`,
        );
      } else if (roll < 0.46) {
        shapes.push(
          `<circle cx="${round(column * step + step / 2)}" cy="${round(
            row * step + step / 2,
          )}" r="${round(step * 0.28)}" fill="${tones.ink}"/>`,
        );
      }
    }
  }
  for (let line = 1; line < columns; line += 1) {
    shapes.push(
      `<line x1="${round(line * step)}" y1="0" x2="${round(
        line * step,
      )}" y2="${SIZE}" stroke="${tones.ink}" stroke-width="1" opacity="0.35"/>`,
      `<line x1="0" y1="${round(line * step)}" x2="${SIZE}" y2="${round(
        line * step,
      )}" stroke="${tones.ink}" stroke-width="1" opacity="0.35"/>`,
    );
  }
  return shapes.join('');
}

function stackComposition(random: () => number, tones: Tones): string {
  const bands = 5 + Math.floor(random() * 3);
  const shapes: string[] = [];
  let y = 24 + random() * 24;
  for (let index = 0; index < bands && y < SIZE - 20; index += 1) {
    const height = 18 + random() * 48;
    const inset = random() * 90;
    const fromLeft = index % 2 === 0;
    const colour = index % 3 === 0 ? tones.dark : index % 3 === 1 ? tones.mid : tones.light;
    shapes.push(
      `<rect x="${round(fromLeft ? 0 : inset)}" y="${round(y)}" width="${round(
        SIZE - inset,
      )}" height="${round(height)}" fill="${colour}"/>`,
    );
    y += height + 10 + random() * 22;
  }
  shapes.push(
    `<rect x="${round(40 + random() * 120)}" y="0" width="${round(
      14 + random() * 14,
    )}" height="${SIZE}" fill="${tones.ink}" opacity="0.8"/>`,
  );
  return shapes.join('');
}

function composition(project: Project, salt: string): string {
  const random = randomFrom(`${project.slug}:${project.motif}:${project.hue}:${salt}`);
  const tones = tonesFor(project.hue);
  const body =
    project.motif === 'arcs'
      ? arcsComposition(random, tones)
      : project.motif === 'grid'
        ? gridComposition(random, tones)
        : stackComposition(random, tones);
  return `<rect width="${SIZE}" height="${SIZE}" fill="${tones.ground}"/>${body}`;
}

const svg = (body: string, extra: string): string =>
  `<svg class="plate" viewBox="0 0 ${SIZE} ${SIZE}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"${extra}>${body}</svg>`;

export const coverPlate = (project: Project): string =>
  svg(composition(project, 'cover'), ` data-plate="${project.slug}"`);

export const screenPlate = (project: Project, index: number): string =>
  svg(composition(project, `screen-${index}`), ` data-plate="${project.slug}-${index}"`);

export function portraitPlate(): string {
  const tones = tonesFor(168);
  const body = [
    `<rect width="${SIZE}" height="${SIZE}" fill="${tones.ground}"/>`,
    `<path d="M 60 400 C 60 300 130 268 200 268 C 270 268 340 300 340 400 Z" fill="${tones.dark}"/>`,
    `<ellipse cx="200" cy="176" rx="86" ry="100" fill="${tones.light}"/>`,
    `<path d="M 114 170 C 114 86 160 54 200 54 C 250 54 288 92 288 162 C 288 128 254 110 206 110 C 160 110 128 130 114 170 Z" fill="${tones.ink}"/>`,
    `<circle cx="172" cy="182" r="7" fill="${tones.ink}"/>`,
    `<circle cx="230" cy="182" r="7" fill="${tones.ink}"/>`,
    `<path d="M 180 228 C 194 238 212 238 224 228" fill="none" stroke="${tones.ink}" stroke-width="5" stroke-linecap="round"/>`,
    `<path d="M 200 196 L 200 214" fill="none" stroke="${tones.mid}" stroke-width="5" stroke-linecap="round"/>`,
    `<line x1="0" y1="330" x2="400" y2="330" stroke="${tones.mid}" stroke-width="1" opacity="0.5"/>`,
  ].join('');
  return svg(body, '');
}

export function introPlate(): string {
  const tones = tonesFor(168);
  const warm = tonesFor(28);
  const body = [
    `<rect width="${SIZE}" height="${SIZE}" fill="${tones.ground}"/>`,
    `<circle cx="196" cy="188" r="150" fill="none" stroke="${tones.dark}" stroke-width="18"/>`,
    `<path d="M 46 188 A 150 150 0 0 1 346 188" fill="none" stroke="${warm.mid}" stroke-width="18"/>`,
    `<circle cx="196" cy="188" r="96" fill="${tones.light}"/>`,
    `<path d="M 100 188 A 96 96 0 0 0 292 188 Z" fill="${tones.dark}"/>`,
    `<rect x="40" y="306" width="316" height="10" fill="${tones.mid}"/>`,
    `<rect x="40" y="336" width="196" height="10" fill="${warm.mid}"/>`,
    `<circle cx="196" cy="188" r="26" fill="${tones.ink}"/>`,
  ].join('');
  return svg(body, '');
}
