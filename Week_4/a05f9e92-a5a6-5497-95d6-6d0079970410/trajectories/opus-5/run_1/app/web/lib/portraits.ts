/**
 * Procedural service portraits: a 2:3 upright mosaic of simple glyph shapes
 * generated from the name, each with its own flat background made from its own
 * glyph colours. Drawn as an inline SVG, so nothing is fetched.
 */

const palette = ['#0b1020', '#ff6a13', '#ff8a3d', '#4a2408', '#ffffff'];

function hashOf(name: string): number {
  let hash = 2166136261;
  for (let i = 0; i < name.length; i += 1) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function* numbers(seed: number): Generator<number> {
  let state = seed || 1;
  for (;;) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    yield state / 4294967296;
  }
}

/** A data URL for the portrait of one service name. */
export function portraitFor(name: string): string {
  const random = numbers(hashOf(name));
  const next = (): number => random.next().value as number;
  const columns = 4;
  const rows = 6;
  const cell = 40;
  const width = columns * cell;
  const height = rows * cell;

  const glyphColours = [
    palette[Math.floor(next() * palette.length)],
    palette[Math.floor(next() * palette.length)],
    palette[Math.floor(next() * palette.length)],
  ];
  const background = glyphColours[Math.floor(next() * glyphColours.length)];

  const shapes: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const roll = next();
      if (roll < 0.28) continue;
      const colour = glyphColours[Math.floor(next() * glyphColours.length)];
      if (colour === background) continue;
      const x = column * cell;
      const y = row * cell;
      const kind = Math.floor(next() * 4);
      if (kind === 0) {
        shapes.push(`<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${colour}"/>`);
      } else if (kind === 1) {
        shapes.push(
          `<circle cx="${x + cell / 2}" cy="${y + cell / 2}" r="${cell / 2}" fill="${colour}"/>`,
        );
      } else if (kind === 2) {
        shapes.push(
          `<polygon points="${x},${y + cell} ${x + cell / 2},${y} ${x + cell},${y + cell}" fill="${colour}"/>`,
        );
      } else {
        shapes.push(
          `<rect x="${x}" y="${y + cell / 3}" width="${cell}" height="${cell / 3}" fill="${colour}"/>`,
        );
      }
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${background}"/>${shapes.join('')}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** The six hero portraits, in their published order. */
export const heroPortraits: readonly { name: string; alt: string }[] = [
  { name: 'Mail', alt: 'Mail portrait' },
  { name: 'Project files', alt: 'Project files portrait' },
  { name: 'Payroll', alt: 'Payroll portrait' },
  { name: 'Remote access', alt: 'Remote access portrait' },
  { name: 'Printing', alt: 'Printing portrait' },
  { name: 'Sign-in', alt: 'Sign-in portrait' },
];

/** A simple bar chart for a widget, drawn the same procedural way. */
export function chartFor(data: readonly { label: string; count: number }[]): string {
  const width = 320;
  const height = 160;
  const max = Math.max(1, ...data.map((d) => d.count));
  const slot = data.length === 0 ? width : width / data.length;
  const bars = data
    .map((d, index) => {
      const barHeight = Math.round((d.count / max) * (height - 20));
      return `<rect x="${Math.round(index * slot + 4)}" y="${height - barHeight}" width="${Math.max(2, Math.round(slot - 8))}" height="${barHeight}" fill="#0b1020"/>`;
    })
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#ff8a3d"/>${bars}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
