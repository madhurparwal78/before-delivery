// Selected rule self-checks run as a plain node script during build.
import { createHash } from 'node:crypto';
import {
  linePoints, brushOffsets, ellipseCells, composite, rampColor,
  parsePaletteFile, formatNumber, formatDate, tagSequence, rankCommands,
  pixelPerfectKeep, applyStrokeToCel, newCel, edgeMask
} from './rules.js';

let failures = 0;
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { console.error(`FAIL ${label}: got ${a} want ${e}`); failures++; }
}
function hex(buf: Uint8Array): string {
  return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// DP-02 the published example: cells ff0044ff and 00000000
eq(createHash('sha256').update(Buffer.from([0xff, 0x00, 0x44, 0xff, 0, 0, 0, 0])).digest('hex'),
  'ac0b31f44df1d49682a57b5bcdca73870c19d91315a0681b26e05fa939923b9d', 'composite hash example');

// DP-07 lines
eq(linePoints(0, 0, 5, 2), [[0, 0], [1, 0], [2, 1], [3, 1], [4, 2], [5, 2]], 'line (0,0)-(5,2)');
eq(linePoints(0, 0, 4, 2), [[0, 0], [1, 1], [2, 1], [3, 2], [4, 2]], 'line (0,0)-(4,2)');
eq(linePoints(1, 1, 3, 6), [[1, 1], [1, 2], [2, 3], [2, 4], [3, 5], [3, 6]], 'line (1,1)-(3,6)');

// DP-08 brush
eq(brushOffsets(2), [0, 1], 'brush 2');
eq(brushOffsets(3), [-1, 0, 1], 'brush 3');
eq(brushOffsets(4), [-1, 0, 1, 2], 'brush 4');

// DP-09 ellipse
{
  const rows = ellipseCells({ x: 0, y: 0, w: 5, h: 5 }, false).map(([x, y]) => y * 5 + x);
  const grid = Array.from({ length: 5 }, () => Array(5).fill('.'));
  for (const i of rows) grid[Math.floor(i / 5)][i % 5] = '#';
  eq(grid.map((r) => r.join('')), ['.###.', '#...#', '#...#', '#...#', '.###.'], 'ellipse 5x5 outline');
}
{
  const cells = ellipseCells({ x: 0, y: 0, w: 6, h: 4 }, false);
  const grid = Array.from({ length: 4 }, () => Array(6).fill('.'));
  for (const [x, y] of cells) grid[y][x] = '#';
  eq(grid.map((r) => r.join('')), ['.####.', '#....#', '#....#', '.####.'], 'ellipse 6x4 outline');
}

// DP-16 compositing
{
  const one = (color: string, opacity: number, blend: 'normal' | 'multiply') =>
    composite(1, 1, [{ rows: [[1]], colorOf: () => color, opacity, blend, visible: true }]) as unknown as Uint8Array;
  const over = (baseAlpha: number, overColor: string, op: number, blend: 'normal' | 'multiply') =>
    composite(1, 1, [
      { rows: [[1]], colorOf: () => '204080ff', opacity: baseAlpha, blend: 'normal', visible: true },
      { rows: [[1]], colorOf: () => overColor, opacity: op, blend, visible: true }
    ]) as unknown as Uint8Array;
  const half = (baseColor: string, op: number, blend: 'normal' | 'multiply') =>
    composite(1, 1, [
      { rows: [[1]], colorOf: () => baseColor, opacity: 100, blend: 'normal', visible: true },
      { rows: [[1]], colorOf: () => 'ff8040ff', opacity: op, blend, visible: true }
    ]) as unknown as Uint8Array;
  eq(hex(one('ff0044ff', 33, 'normal')), 'ff004454', 'alone at 33');
  eq(hex(over(100, 'ff8040ff', 50, 'normal')), '906060ff', 'normal 50 over base');
  eq(hex(over(100, 'ff8040ff', 100, 'multiply')), '202020ff', 'multiply 100 over base');
  eq(hex(over(100, 'ff8040ff', 50, 'multiply')), '203050ff', 'multiply 50 over base');
}
// Half-alpha base needs a base swatch with alpha 128.
{
  const buf = composite(1, 1, [
    { rows: [[1]], colorOf: () => '20408080', opacity: 100, blend: 'normal', visible: true },
    { rows: [[1]], colorOf: () => 'ff8040ff', opacity: 40, blend: 'multiply', visible: true }
  ]) as unknown as Uint8Array;
  eq(hex(buf), '5f4952b3', 'multiply 40 over 20408080 base');
}

// DP-22 ramp
{
  const got = [0, 1, 2, 3, 4].map((i) => rampColor('000000ff', 'ff8001ff', i, 5));
  eq(got, ['000000ff', '402000ff', '804001ff', 'bf6001ff', 'ff8001ff'], 'ramp 5');
}

// DP-23 palette files
eq(parsePaletteFile('p.hex', 'ff0044\n\n00ff00').colors, ['ff0044ff', '00ff00ff'], 'hex ok');
eq(parsePaletteFile('p.hex', 'ff0044\nzzzzzz').error?.text, 'Line 2: expected six hex digits', 'hex bad');
eq(parsePaletteFile('p.gpl', 'GIMP Palette\nName: x\n# c\n255 0 68 red').colors, ['ff0044ff'], 'gpl ok');
eq(parsePaletteFile('p.gpl', 'GIMP Palette\n1 2 3\nnope').error?.text, 'Line 3: expected three numbers from 0 to 255', 'gpl bad');
eq(parsePaletteFile('p.txt', 'x').error?.text, 'Use a .hex or .gpl file', 'wrong type');

// DP-35 numbers and dates
eq(formatNumber(123456.5, 'en-US'), '123,456.5', 'en-US grouping');
eq(formatNumber(123456.5, 'en-IN'), '1,23,456.5', 'en-IN grouping');
eq(formatNumber(1000, 'en-IN'), '1,000', 'en-IN 1000');
eq(formatDate('2027-03-08T16:00:00.000Z', 'en-US', 'UTC'), 'Mar 8, 2027 16:00 UTC', 'en-US date');
eq(formatDate('2027-03-08T16:00:00.000Z', 'en-IN', 'Asia/Kolkata'), '8 Mar 2027 21:30 IST', 'en-IN IST date');

// DP-31 tags
eq(tagSequence(2, 5, 'forward'), [2, 3, 4, 5], 'forward');
eq(tagSequence(2, 5, 'reverse'), [5, 4, 3, 2], 'reverse');
eq(tagSequence(2, 5, 'pingpong'), [2, 3, 4, 5, 4, 3], 'pingpong');
eq(tagSequence(2, 3, 'pingpong'), [2, 3], 'pingpong 2-3');
eq(tagSequence(3, 3, 'forward'), [3], 'single');

// DP-14 ranking
eq(rankCommands('pen', ['Tool: Pencil', 'Layer: Pen shadow'])[0], 'Tool: Pencil', 'pen ranking');

// DP-99 pixel perfect
eq(pixelPerfectKeep([[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]]), [[0, 0], [1, 1], [2, 2]], 'pp diag');
eq(pixelPerfectKeep([[0, 0], [1, 0], [2, 0], [2, 1]]), [[0, 0], [1, 0], [2, 1]], 'pp corner');
eq(pixelPerfectKeep([[0, 0], [1, 0], [2, 0]]), [[0, 0], [1, 0], [2, 0]], 'pp straight');

// DP-10 fill
{
  const cel = newCel(3, 1);
  cel.rows[0] = [0, 1, 1];
  const res = applyStrokeToCel(cel, { tool: 'fill', points: [[0, 0]], swatch: 2, size: 1, mirror: 'none', options: { contiguous: false } });
  eq(res.changed, 1, 'fill changed 1');
  eq(cel.rows[0], [2, 1, 1], 'fill non-contiguous');
}

// DP-12 dither worked examples
{
  const cel = newCel(8, 8);
  const res = applyStrokeToCel(cel, {
    tool: 'dither', points: [[0, 0]], swatch: 1, size: 1, mirror: 'none',
    options: { level: 6, secondary: 2, contiguous: false }
  });
  const at = (x: number, y: number) => cel.rows[y][x];
  eq(at(7, 7), 1, 'dither (7,7) primary');
  eq(at(5, 2), 2, 'dither (5,2) secondary');
  eq(at(4, 4), 1, 'dither (4,4) primary');
}

// DP-39 edge mask
{
  const cells = new Set(['1,1', '2,1']);
  eq(edgeMask(cells, 1, 1), 2, 'mask at 1,1');
  eq(edgeMask(cells, 2, 1), 8, 'mask at 2,1');
}

if (failures) { console.error(`${failures} failures`); process.exit(1); }
console.log('rules checks ok');
