const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

const LONG_TABLE_BLOCKS = [
  '###...####...##',
  '##.....##.....#',
  '##.....##.....#',
  '...###....##...',
  '...###...##....',
  '...##....#.....',
  '#.....##......#',
  '###...###...###',
  '#......##.....#',
  '.....#....##...',
  '....##...###...',
  '...##....###...',
  '#.....##.....##',
  '#.....##.....##',
  '##...####...###',
];

const LETTERS = 'SCONESTEAMOVENSENTERMISEREJECTSTARLINGPOSTSHOTELGULLS';

/**
 * A still, procedural one-bit ordered-dither drawing of the Long Table grid,
 * cropped at an angle so the tiles read as one photograph.
 */
export function ditherCanvas(width: number, height: number, offset: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.setAttribute('role', 'presentation');
  const context = canvas.getContext('2d');
  if (!context) return canvas;

  context.save();
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.translate(width / 2, height / 2);
  context.rotate(-0.14);
  context.translate(-width / 2 - offset * 0.6, -height / 2 - offset * 0.35);

  const cell = Math.max(width, height) / 7.5;
  const start = offset / cell;
  context.font = `500 ${cell * 0.62}px "Albert Sans", sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  let letter = Math.floor(start) % LETTERS.length;
  for (let r = 0; r < 15; r += 1) {
    for (let c = 0; c < 15; c += 1) {
      const x = c * cell;
      const y = r * cell;
      const black = LONG_TABLE_BLOCKS[r][c] === '#';
      context.fillStyle = black ? '#1b1a17' : '#f2f0ea';
      context.fillRect(x, y, cell - 2, cell - 2);
      if (!black) {
        context.fillStyle = '#2a2824';
        context.fillText(LETTERS[letter % LETTERS.length], x + cell / 2 - 1, y + cell / 2 - 1);
        letter += 1;
      }
    }
  }
  context.restore();

  const image = context.getImageData(0, 0, width, height);
  const data = image.data;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const grey = (data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114) / 255;
      const threshold = (BAYER[y % 4][x % 4] + 0.5) / 16;
      const value = grey > threshold ? 255 : 0;
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}
