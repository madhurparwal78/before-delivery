// The Holdfast pixel wordmark: an original grid of square pixels spelling
// "Holdfast" in a light grey, with a few loose pixels breaking off its left edge
// like debris.

const glyphs: Record<string, string[]> = {
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  o: ['.....', '.....', '.###.', '#...#', '#...#', '#...#', '.###.'],
  l: ['.##..', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  d: ['....#', '....#', '.####', '#...#', '#...#', '#...#', '.####'],
  f: ['..##', '.#..', '####', '.#..', '.#..', '.#..', '.#..'],
  a: ['.....', '.....', '.###.', '....#', '.####', '#...#', '.####'],
  s: ['.....', '.....', '.####', '#....', '.###.', '....#', '####.'],
  t: ['.#...', '.#...', '####.', '.#...', '.#...', '.#...', '.###.'],
};

const word = 'Holdfast';
const letterGap = 1;
const rows = 7;

/** Loose pixels off the left edge, as column and row offsets outside the grid. */
const debris: [number, number][] = [
  [-2, 1],
  [-3, 3],
  [-2, 4],
  [-5, 2],
  [-4, 6],
];

const ink = '#cfd8d4';

/** wordmarkSVG builds the wordmark as a standalone SVG document. */
export function wordmarkSVG(): string {
  let columns = 0;
  for (const letter of word) columns += glyphs[letter][0].length + letterGap;
  columns -= letterGap;

  const leftmost = Math.min(...debris.map(([x]) => x));
  const originX = -leftmost;
  const width = columns + originX;

  const pixels: string[] = [];
  let cursor = originX;
  for (const letter of word) {
    const glyph = glyphs[letter];
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] !== '#') continue;
        pixels.push(`<rect x="${cursor + column}" y="${row}" width="1" height="1"/>`);
      }
    }
    cursor += glyph[0].length + letterGap;
  }
  for (const [x, y] of debris) {
    pixels.push(`<rect x="${originX + x}" y="${y}" width="1" height="1" opacity="0.72"/>`);
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${rows}"`,
    ` width="${width * 8}" height="${rows * 8}" shape-rendering="crispEdges" fill="${ink}">`,
    pixels.join(''),
    '</svg>',
  ].join('');
}

/** wordmarkDataURL renders the wordmark for an img element. */
export function wordmarkDataURL(): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(wordmarkSVG())}`;
}
