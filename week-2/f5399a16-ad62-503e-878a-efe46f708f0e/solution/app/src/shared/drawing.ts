// Procedural pencil-line drawings: the only imagery that ships. One seed, one storyboard frame.

type Point = [number, number];
type Facing = 1 | -1;

interface Sketch {
  random(): number;
  lines: string[];
}

function sketchFor(seed: number): Sketch {
  let state = (seed * 2654435761 + 97) >>> 0 || 1;
  const random = (): number => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
  return { random, lines: [] };
}

function jitter(s: Sketch, amount: number): number {
  return (s.random() - 0.5) * 2 * amount;
}

function at(n: number): string {
  return n.toFixed(1);
}

/** A soft path through the points: each corner rounds on the way to the next midpoint. */
function softPath(points: Point[], wobble: () => number): string {
  const moved = points.map(([x, y]): Point => [x + wobble(), y + wobble()]);
  const first = moved[0] as Point;
  let path = `M${at(first[0])} ${at(first[1])}`;
  moved.slice(1, -1).forEach(([x, y], index) => {
    const next = moved[index + 2] as Point;
    path += `Q${at(x)} ${at(y)} ${at((x + next[0]) / 2)} ${at((y + next[1]) / 2)}`;
  });
  const last = moved[moved.length - 1] as Point;
  return `${path}L${at(last[0])} ${at(last[1])}`;
}

/** One curved stroke, traced twice as a pencil would. */
function curve(s: Sketch, points: Point[], width = 2.6): void {
  s.lines.push(`<path d="${softPath(points, () => jitter(s, 1.6))}" stroke-width="${width}" opacity=".92"/>`);
  s.lines.push(`<path d="${softPath(points, () => jitter(s, 2.8))}" stroke-width="${at(width * 0.55)}" opacity=".5"/>`);
}

/** Straight edges drawn one by one, each running a little past its corner. */
function edges(s: Sketch, points: Point[], width = 2.6): void {
  points.slice(1).forEach(([x, y], index) => {
    const [fromX, fromY] = points[index] as Point;
    const length = Math.hypot(x - fromX, y - fromY) || 1;
    const runX = ((x - fromX) / length) * 5;
    const runY = ((y - fromY) / length) * 5;
    curve(s, [[fromX - runX, fromY - runY], [x + runX, y + runY]], width);
  });
}

/** A white shape, so what stands in front hides what is behind it. */
function blank(s: Sketch, points: Point[]): void {
  s.lines.push(`<path d="${softPath(points, () => 0)}Z" fill="#fff" stroke="none"/>`);
}

/** Light shading between two edges: one quick stroke across for each step. */
function shade(s: Sketch, from: [Point, Point], to: [Point, Point], count: number): void {
  for (let n = 0; n <= count; n += 1) {
    const t = n / count;
    const across = Math.max(0, t - 0.12);
    s.lines.push(
      `<path d="M${at(from[0][0] + (from[1][0] - from[0][0]) * t + jitter(s, 2))} ${at(from[0][1] + (from[1][1] - from[0][1]) * t + jitter(s, 2))}L${at(to[0][0] + (to[1][0] - to[0][0]) * across + jitter(s, 2))} ${at(to[0][1] + (to[1][1] - to[0][1]) * across + jitter(s, 2))}" stroke-width="1.5" opacity=".62"/>`,
    );
  }
}

function ring(cx: number, cy: number, rx: number, ry: number): Point[] {
  const points: Point[] = [];
  for (let n = 0; n <= 16; n += 1) {
    const angle = (n / 16) * Math.PI * 2;
    points.push([cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]);
  }
  return points;
}

/** A standing person in a coat: legs, shoulders, sleeve, collar, face turned the way they look. */
function person(s: Sketch, x: number, ground: number, height: number, facing: Facing, pose: 'rest' | 'reach' | 'hold' = 'rest'): void {
  const u = height / 100;
  const px = (dx: number): number => x + dx * u * facing;
  const py = (fromTop: number): number => ground - height + fromTop * u;
  const stride = 3 + s.random() * 4;
  blank(s, [[px(-7), py(58)], [px(-8 - stride), py(97)], [px(-1), py(97)], [px(1), py(62)], [px(4), py(97)], [px(11 + stride), py(97)], [px(8), py(58)]]);
  curve(s, [[px(-8), py(60)], [px(-8 - stride), py(96)]], 2.6);
  curve(s, [[px(-1), py(66)], [px(-2 - stride * 0.3), py(96)]], 2.2);
  curve(s, [[px(1), py(66)], [px(4 + stride * 0.3), py(96)]], 2.2);
  curve(s, [[px(8), py(60)], [px(10 + stride), py(96)]], 2.6);
  edges(s, [[px(-13 - stride), py(99)], [px(-3 - stride * 0.3), py(99)]], 3.2);
  edges(s, [[px(4 + stride * 0.3), py(99)], [px(15 + stride), py(99)]], 3.2);
  const coat: Point[] = [[px(-4), py(19)], [px(-15), py(25)], [px(-13), py(45)], [px(-15), py(68)], [px(0), py(70)], [px(14), py(68)], [px(12), py(45)], [px(15), py(25)], [px(4), py(19)]];
  blank(s, coat);
  curve(s, coat, 3);
  curve(s, [[px(3), py(22)], [px(1), py(46)], [px(2), py(68)]], 1.8);
  shade(s, [[px(-13), py(30)], [px(-14), py(66)]], [[px(-3), py(30)], [px(-3), py(66)]], 9);
  if (pose === 'reach') {
    curve(s, [[px(11), py(25)], [px(26), py(33)], [px(38), py(28)]], 3);
    curve(s, [[px(12), py(31)], [px(25), py(39)], [px(39), py(33)]], 3);
    curve(s, ring(px(41), py(30), 2.6 * u, 2.8 * u), 2);
  } else if (pose === 'hold') {
    curve(s, [[px(12), py(25)], [px(17), py(39)], [px(27), py(38)]], 3);
    curve(s, [[px(8), py(32)], [px(13), py(44)], [px(27), py(43)]], 3);
    blank(s, [[px(27), py(26)], [px(41), py(24)], [px(42), py(46)], [px(28), py(48)]]);
    edges(s, [[px(27), py(26)], [px(41), py(24)], [px(42), py(46)], [px(28), py(48)], [px(27), py(26)]], 2.2);
    curve(s, ring(px(26), py(41), 2.4 * u, 2.8 * u), 2);
  } else {
    curve(s, [[px(-14), py(26)], [px(-18), py(45)], [px(-15), py(58)]], 3);
    curve(s, [[px(14), py(26)], [px(18), py(45)], [px(15), py(58)]], 3);
    curve(s, ring(px(-15), py(61), 2.4 * u, 2.8 * u), 2);
    curve(s, ring(px(15), py(61), 2.4 * u, 2.8 * u), 2);
  }
  edges(s, [[px(-4), py(15)], [px(-4), py(20)]], 2.2);
  edges(s, [[px(4), py(15)], [px(4), py(20)]], 2.2);
  curve(s, [[px(-6), py(20)], [px(0), py(25)], [px(6), py(19)]], 2.4);
  const head = ring(px(1), py(8), 7.5 * u, 8.5 * u);
  blank(s, head);
  curve(s, head, 2.8);
  curve(s, [[px(7), py(7)], [px(10.5), py(10)], [px(7.5), py(11.5)]], 2);
  curve(s, [[px(-7), py(10)], [px(-8), py(1)], [px(1), py(-2)], [px(8), py(3)], [px(2), py(4)], [px(-3), py(9)], [px(-4), py(14)]], 2.6);
  shade(s, [[px(-7), py(1)], [px(-5), py(12)]], [[px(1), py(0)], [px(-2), py(7)]], 6);
}

/** Head and shoulders close up, three quarters on, with a shaded far side. */
function bust(s: Sketch, cx: number, cy: number, r: number, facing: Facing, scarf: boolean): void {
  const px = (dx: number): number => cx + dx * r * facing;
  const py = (dy: number): number => cy + dy * r;
  const shoulders: Point[] = [[px(-2.5), 720], [px(-2.2), py(2.1)], [px(-1), py(1.35)], [px(-0.42), py(0.95)], [px(0.5), py(0.95)], [px(1.1), py(1.35)], [px(2.2), py(2.1)], [px(2.5), 720]];
  blank(s, shoulders);
  curve(s, shoulders, 3.4);
  curve(s, [[px(-1.5), 720], [px(-1.3), py(2.2)]], 2.4);
  curve(s, [[px(1.5), 720], [px(1.3), py(2.2)]], 2.4);
  shade(s, [[px(-1.5), py(1.9)], [px(-1.6), 712]], [[px(-0.6), py(1.5)], [px(-0.6), 712]], 12);
  if (scarf) {
    curve(s, [[px(-0.75), py(1)], [px(0), py(1.45)], [px(0.85), py(1)]], 3.4);
    curve(s, [[px(-0.85), py(1.25)], [px(0), py(1.75)], [px(0.95), py(1.25)]], 3.4);
    curve(s, [[px(0.2), py(1.6)], [px(0.3), py(2.6)], [px(0.75), py(2.65)], [px(0.65), py(1.5)]], 2.8);
    shade(s, [[px(-0.75), py(1.1)], [px(0.8), py(1.1)]], [[px(-0.7), py(1.45)], [px(0.85), py(1.45)]], 8);
  } else {
    edges(s, [[px(-0.45), py(1.05)], [px(0.1), py(1.7)], [px(0.55), py(1.05)]], 2.6);
  }
  const head: Point[] = [[px(-0.1), py(-1)], [px(0.68), py(-0.82)], [px(0.86), py(-0.1)], [px(0.74), py(0.56)], [px(0.28), py(1.08)], [px(-0.28), py(0.98)], [px(-0.7), py(0.48)], [px(-0.9), py(-0.1)], [px(-0.7), py(-0.8)], [px(-0.1), py(-1)]];
  blank(s, head);
  curve(s, head, 3.2);
  curve(s, [[px(-0.92), py(0.15)], [px(-1.06), py(-0.5)], [px(-0.62), py(-1.12)], [px(0.25), py(-1.2)], [px(0.92), py(-0.72)], [px(0.5), py(-0.55)], [px(-0.1), py(-0.62)], [px(-0.55), py(-0.3)], [px(-0.68), py(0.28)]], 3);
  shade(s, [[px(-0.92), py(-0.8)], [px(-0.75), py(0.2)]], [[px(-0.2), py(-1.05)], [px(-0.58), py(-0.3)]], 10);
  curve(s, ring(px(-0.72), py(0.08), 0.1 * r, 0.2 * r), 2);
  curve(s, [[px(-0.1), py(-0.28)], [px(0.14), py(-0.36)], [px(0.34), py(-0.26)]], 3);
  curve(s, [[px(0.52), py(-0.28)], [px(0.66), py(-0.34)], [px(0.78), py(-0.24)]], 3);
  curve(s, [[px(0.03), py(-0.1)], [px(0.2), py(-0.17)], [px(0.34), py(-0.08)], [px(0.17), py(-0.03)], [px(0.03), py(-0.1)]], 2);
  curve(s, [[px(0.56), py(-0.09)], [px(0.66), py(-0.15)], [px(0.76), py(-0.08)], [px(0.66), py(-0.03)], [px(0.56), py(-0.09)]], 2);
  curve(s, [[px(0.5), py(-0.05)], [px(0.6), py(0.28)], [px(0.42), py(0.35)]], 2.4);
  curve(s, [[px(0.14), py(0.6)], [px(0.4), py(0.65)], [px(0.62), py(0.56)]], 2.6);
  shade(s, [[px(-0.6), py(0.25)], [px(-0.3), py(0.92)]], [[px(-0.28), py(0.1)], [px(-0.02), py(0.8)]], 7);
}

function waves(s: Sketch, top: number, rows: number, gap: number, from = 40, to = 1240): void {
  for (let row = 0; row < rows; row += 1) {
    const y = top + row * gap;
    const inset = (rows - row) * 18 + s.random() * 60;
    const left = from + inset;
    const right = to - inset * (0.5 + s.random());
    const third = (right - left) / 3;
    curve(s, [[left, y], [left + third, y - 6 + jitter(s, 3)], [left + 2 * third, y + 6 + jitter(s, 3)], [right, y + jitter(s, 3)]], 1.8);
  }
}

function gull(s: Sketch, x: number, y: number, span: number): void {
  curve(s, [[x - span, y - span * 0.2], [x - span * 0.45, y - span * 0.5], [x, y], [x + span * 0.45, y - span * 0.5], [x + span, y - span * 0.2]], 2.2);
}

function cloud(s: Sketch, x: number, y: number, size: number): void {
  curve(s, [[x, y], [x + size * 0.2, y - size * 0.3], [x + size * 0.45, y - size * 0.34], [x + size * 0.62, y - size * 0.12], [x + size * 0.86, y - size * 0.2], [x + size, y]], 2);
  curve(s, [[x + size * 0.14, y + 2], [x + size * 0.92, y + 3]], 1.4);
}

function boat(s: Sketch, x: number, water: number, size: number, facing: Facing): void {
  const px = (dx: number): number => x + dx * size * facing;
  const py = (dy: number): number => water + dy * size;
  const hull: Point[] = [[px(-1), py(-0.26)], [px(-0.8), py(0.1)], [px(0.72), py(0.1)], [px(1.14), py(-0.34)], [px(-1), py(-0.26)]];
  blank(s, hull);
  curve(s, hull, 3.6);
  curve(s, [[px(-0.9), py(-0.11)], [px(0.98), py(-0.17)]], 2);
  shade(s, [[px(-0.84), py(-0.08)], [px(0.8), py(-0.12)]], [[px(-0.78), py(0.1)], [px(0.68), py(0.1)]], 16);
  edges(s, [[px(-0.08), py(-0.28)], [px(-0.08), py(-1.72)]], 3.4);
  curve(s, [[px(-0.02), py(-1.66)], [px(0.5), py(-1)], [px(0.86), py(-0.46)], [px(-0.02), py(-0.44)], [px(-0.02), py(-1.66)]], 2.8);
  curve(s, [[px(-0.16), py(-1.5)], [px(-0.52), py(-0.9)], [px(-0.72), py(-0.46)], [px(-0.16), py(-0.44)], [px(-0.16), py(-1.5)]], 2.6);
  shade(s, [[px(0.12), py(-1.2)], [px(0.1), py(-0.5)]], [[px(0.5), py(-0.9)], [px(0.74), py(-0.5)]], 9);
  curve(s, [[px(-0.84), py(0.2)], [px(-0.1), py(0.16)], [px(0.74), py(0.21)]], 2);
  curve(s, [[px(-0.5), py(0.32)], [px(0.42), py(0.33)]], 1.6);
}

function tree(s: Sketch, x: number, ground: number, size: number): void {
  edges(s, [[x - size * 0.06, ground], [x - size * 0.03, ground - size]], 2.8);
  edges(s, [[x + size * 0.06, ground], [x + size * 0.03, ground - size]], 2.8);
  curve(s, [[x - size * 0.5, ground - size * 0.9], [x - size * 0.62, ground - size * 1.3], [x - size * 0.25, ground - size * 1.8], [x + size * 0.3, ground - size * 1.72], [x + size * 0.6, ground - size * 1.28], [x + size * 0.46, ground - size * 0.9], [x, ground - size * 0.82], [x - size * 0.5, ground - size * 0.9]], 2.6);
  shade(s, [[x + size * 0.1, ground - size * 1.6], [x + size * 0.1, ground - size * 0.95]], [[x + size * 0.5, ground - size * 1.3], [x + size * 0.42, ground - size * 0.95]], 8);
}

function harbourDawn(s: Sketch): void {
  const horizon = 360 + jitter(s, 24);
  const low = 300 + s.random() * 120;
  curve(s, [[0, horizon], [420, horizon - 8], [860, horizon + 4], [1280, horizon - 6]], 2.2);
  curve(s, [[820, horizon - 2], [940, horizon - 62], [1060, horizon - 34], [1160, horizon - 90], [1280, horizon - 48]], 2.2);
  cloud(s, 90, 120, 280);
  cloud(s, 760, 170, 220);
  curve(s, ring(1040, 110, 44, 44), 2);
  gull(s, 560, 140, 34);
  gull(s, 640, 96, 22);
  waves(s, horizon + 120, 6, 40);
  boat(s, low, horizon + 80, 170, 1);
}

function deckRail(s: Sketch): void {
  const side: Facing = s.random() > 0.5 ? 1 : -1;
  const horizon = 300;
  curve(s, [[0, horizon], [640, horizon + 4], [1280, horizon]], 2);
  cloud(s, 700, 150, 300);
  gull(s, 320, 150, 30);
  waves(s, horizon + 60, 3, 40);
  edges(s, [[0, 500], [1280, 460]], 3.6);
  edges(s, [[0, 540], [1280, 500]], 2.4);
  for (let x = 90; x < 1280; x += 170) edges(s, [[x, 500 - x / 32], [x, 720]], 2.6);
  shade(s, [[0, 620], [1280, 590]], [[0, 720], [1280, 720]], 26);
  person(s, side === 1 ? 420 : 860, 690, 480, side);
}

function closeFacing(s: Sketch): void {
  const cx = 500 + s.random() * 120;
  edges(s, [[0, 430], [1280, 430]], 1.8);
  edges(s, [[900, 80], [1180, 80], [1180, 390], [900, 390], [900, 80]], 2.4);
  edges(s, [[1040, 80], [1040, 390]], 1.6);
  edges(s, [[900, 235], [1180, 235]], 1.6);
  shade(s, [[60, 40], [60, 360]], [[260, 40], [260, 360]], 14);
  bust(s, cx, 300, 175, 1, false);
}

function streetWalk(s: Sketch): void {
  const vanish: Point = [640 + jitter(s, 110), 290];
  for (const edge of [[0, 90], [0, 720], [1280, 60], [1280, 720]] as Point[]) edges(s, [edge, vanish], 2.6);
  for (let n = 0; n < 4; n += 1) {
    const x = 80 + n * 118;
    const near = 1 - n * 0.2;
    edges(s, [[x, 290 - 170 * near], [x, 290 + 240 * near]], 2);
    edges(s, [[1200 - n * 118, 290 - 190 * near], [1200 - n * 118, 290 + 240 * near]], 2);
  }
  edges(s, [[110, 170], [168, 186], [168, 330], [110, 330], [110, 170]], 2);
  shade(s, [[112, 180], [112, 326]], [[166, 192], [166, 326]], 9);
  edges(s, [[1040, 150], [1100, 138], [1100, 330], [1040, 330], [1040, 150]], 2);
  edges(s, [[920, 610], [920, 180]], 3.2);
  curve(s, [[920, 180], [950, 150], [992, 168]], 2.8);
  curve(s, ring(992, 182, 16, 14), 2.2);
  person(s, 500 + s.random() * 150, 680, 400, 1);
}

function cafeTable(s: Sketch): void {
  edges(s, [[0, 500], [1280, 500]], 2);
  edges(s, [[110, 70], [620, 70], [620, 400], [110, 400], [110, 70]], 3);
  edges(s, [[365, 70], [365, 400]], 2);
  cloud(s, 150, 190, 170);
  curve(s, [[110, 320], [270, 280], [420, 330], [620, 290]], 1.8);
  edges(s, [[760, 160], [1180, 160]], 2.4);
  for (let n = 0; n < 4; n += 1) edges(s, [[790 + n * 100, 160], [790 + n * 100, 110 - (n % 2) * 16]], 2.2);
  person(s, 860, 720, 500, -1, 'hold');
  edges(s, [[150, 560], [790, 560]], 3.6);
  edges(s, [[230, 560], [190, 720]], 3);
  edges(s, [[710, 560], [750, 720]], 3);
  curve(s, [[420, 515], [426, 554], [492, 554], [498, 515]], 2.6);
  curve(s, ring(459, 515, 39, 8), 2.2);
  curve(s, [[496, 524], [522, 526], [515, 546], [490, 546]], 2);
}

function pierTalk(s: Sketch): void {
  const horizon = 330;
  curve(s, [[0, horizon], [1280, horizon - 10]], 2);
  cloud(s, 140, 150, 240);
  waves(s, horizon + 40, 3, 34);
  edges(s, [[0, 620], [1280, 590]], 3);
  for (let x = 40; x < 1280; x += 150) edges(s, [[x, 622 - x / 42], [x - 30, 720]], 1.8);
  boat(s, 1040, horizon + 28, 60, -1);
  person(s, 390, 660, 430, 1, 'reach');
  person(s, 800, 650, 410, -1, 'hold');
}

function tableObjects(s: Sketch): void {
  edges(s, [[0, 250], [1280, 220]], 2.2);
  shade(s, [[0, 100], [1280, 80]], [[0, 240], [1280, 214]], 30);
  const lean = jitter(s, 30);
  const sheet: Point[] = [[140 + lean, 320], [620 + lean, 290], [690 + lean, 640], [170 + lean, 670], [140 + lean, 320]];
  blank(s, sheet);
  edges(s, sheet, 2.6);
  for (let n = 0; n < 5; n += 1) edges(s, [[190 + lean + n * 4, 370 + n * 54], [620 + lean + n * 12, 348 + n * 54]], 1.6);
  curve(s, [[820, 350], [830, 560], [1050, 560], [1062, 350]], 3.4);
  curve(s, ring(941, 350, 122, 28), 3);
  curve(s, ring(941, 354, 96, 18), 1.8);
  curve(s, [[1058, 400], [1140, 400], [1130, 500], [1044, 510]], 3);
  shade(s, [[850, 390], [860, 550]], [[930, 400], [935, 560]], 9);
  curve(s, ring(941, 572, 190, 34), 2.4);
  edges(s, [[640 + lean, 240], [740 + lean, 660]], 3.6);
  edges(s, [[654 + lean, 238], [752 + lean, 656]], 2);
}

function hillRoad(s: Sketch): void {
  const crest = 300 + jitter(s, 26);
  curve(s, [[0, crest + 90], [220, crest - 40], [430, crest + 40], [660, crest - 90], [900, crest + 30], [1120, crest - 50], [1280, crest]], 3);
  curve(s, [[0, crest + 200], [360, crest + 150], [800, crest + 210], [1280, crest + 140]], 2);
  curve(s, [[420, 720], [620, 560], [700, crest + 190]], 2.4);
  curve(s, [[900, 720], [740, 560], [720, crest + 190]], 2.4);
  tree(s, 170, crest + 280, 120);
  tree(s, 1110, crest + 260, 100);
  tree(s, 1000, crest + 170, 46);
  curve(s, ring(250, 110, 40, 40), 2);
  cloud(s, 620, 150, 230);
  person(s, 660, 700, 230, 1);
}

function tramStop(s: Sketch): void {
  edges(s, [[0, 600], [1280, 600]], 2.6);
  edges(s, [[0, 650], [1280, 650]], 1.8);
  edges(s, [[0, 700], [1280, 700]], 1.8);
  edges(s, [[0, 120], [1280, 120]], 1.6);
  const tram: Point[] = [[420, 190], [1190, 190], [1230, 300], [1230, 590], [420, 590], [420, 190]];
  blank(s, tram);
  edges(s, tram, 3.2);
  for (let n = 0; n < 4; n += 1) edges(s, [[460 + n * 180, 240], [610 + n * 180, 240], [610 + n * 180, 390], [460 + n * 180, 390], [460 + n * 180, 240]], 2.4);
  edges(s, [[420, 440], [1230, 440]], 2);
  shade(s, [[420, 450], [1230, 450]], [[420, 580], [1230, 580]], 30);
  edges(s, [[800, 190], [840, 120]], 2.4);
  edges(s, [[880, 190], [840, 120]], 2.4);
  curve(s, ring(1120, 590, 34, 34), 2.6);
  curve(s, ring(540, 590, 34, 34), 2.6);
  edges(s, [[240, 600], [240, 210]], 3.2);
  edges(s, [[180, 210], [300, 210], [300, 280], [180, 280], [180, 210]], 2.4);
  person(s, 150 + s.random() * 50, 640, 340, 1);
}

function closeWindow(s: Sketch): void {
  edges(s, [[60, 50], [1220, 50], [1220, 640], [60, 640], [60, 50]], 2.8);
  for (let n = 0; n < 26; n += 1) {
    const x = 90 + n * 44 + jitter(s, 12);
    const y = 80 + s.random() * 400;
    curve(s, [[x, y], [x - 16, y + 70]], 1.5);
  }
  bust(s, 640 + jitter(s, 90), 310, 170, -1, true);
}

function lighthouse(s: Sketch): void {
  const x = 840 + jitter(s, 90);
  curve(s, [[x - 330, 590], [x - 220, 500], [x - 100, 480], [x + 80, 490], [x + 240, 530], [x + 370, 610]], 3.2);
  shade(s, [[x + 40, 500], [x + 340, 600]], [[x + 40, 610], [x + 340, 620]], 16);
  edges(s, [[x - 62, 490], [x - 40, 170]], 3.2);
  edges(s, [[x + 62, 490], [x + 40, 170]], 3.2);
  edges(s, [[x - 58, 400], [x + 58, 400]], 2);
  edges(s, [[x - 49, 290], [x + 49, 290]], 2);
  shade(s, [[x - 58, 300], [x - 58, 396]], [[x + 56, 300], [x + 56, 396]], 12);
  edges(s, [[x - 56, 170], [x + 56, 170]], 3);
  edges(s, [[x - 34, 170], [x - 34, 100], [x + 34, 100], [x + 34, 170]], 2.6);
  edges(s, [[x - 44, 100], [x, 58], [x + 44, 100]], 3);
  edges(s, [[x - 34, 130], [x - 460, 80]], 1.6);
  edges(s, [[x - 34, 142], [x - 460, 190]], 1.6);
  gull(s, 260, 240, 34);
  gull(s, 190, 170, 22);
  cloud(s, 60, 110, 240);
  waves(s, 620, 3, 36);
}

function overShoulder(s: Sketch): void {
  const horizon = 300 + jitter(s, 20);
  curve(s, [[0, horizon], [1280, horizon - 12]], 2);
  cloud(s, 130, 120, 260);
  gull(s, 880, 130, 28);
  boat(s, 880 + jitter(s, 60), horizon + 50, 90, -1);
  waves(s, horizon + 130, 4, 40, 520, 1260);
  const shoulder: Point[] = [[-20, 720], [40, 590], [170, 520], [250, 460], [420, 460], [510, 530], [620, 600], [670, 720]];
  blank(s, shoulder);
  curve(s, shoulder, 3.6);
  shade(s, [[60, 580], [80, 710]], [[320, 520], [340, 710]], 16);
  curve(s, [[280, 462], [340, 510], [400, 462]], 3);
  const head = ring(335, 300, 125, 170);
  blank(s, head);
  curve(s, head, 3.4);
  shade(s, [[225, 210], [245, 390]], [[440, 210], [420, 390]], 20);
  curve(s, ring(462, 310, 15, 34), 2.4);
}

const SCENES = [harbourDawn, deckRail, closeFacing, streetWalk, cafeTable, pierTalk, tableObjects, hillRoad, tramStop, closeWindow, lighthouse, overShoulder];

/** The pencil strokes of a frame's drawing, on a 1280 by 720 field. Past twelve frames a scene returns mirrored. */
export function drawingStrokes(seed: number): string {
  const s = sketchFor(seed);
  const round = Math.floor((seed - 1) / SCENES.length);
  (SCENES[(seed - 1 + SCENES.length) % SCENES.length] as (sketch: Sketch) => void)(s);
  return round % 2 ? `<g transform="matrix(-1 0 0 1 1280 0)">${s.lines.join('')}</g>` : s.lines.join('');
}

/** The whole drawing as an SVG file. */
/** Vector, so the declared size is only a default: every screen and the PDF size it by CSS, down to a 24px clip. */
export function drawingSvg(seed: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="48" height="27"><rect width="1280" height="720" fill="#fff"/><g fill="none" stroke="#1a1a1c" stroke-linecap="round" stroke-linejoin="round">${drawingStrokes(seed)}</g></svg>`;
}

/** The home page's frame on a tall 640 by 960 field: the subject keeps left, clear of the red bar. */
export function heroStrokes(): string {
  const s = sketchFor(5);
  const horizon = 500;
  curve(s, [[0, horizon], [320, horizon - 6], [640, horizon + 4]], 2.4);
  curve(s, [[300, horizon - 4], [410, horizon - 58], [520, horizon - 30], [640, horizon - 76]], 2.2);
  cloud(s, 40, 190, 220);
  cloud(s, 330, 130, 240);
  curve(s, ring(96, 300, 30, 30), 2);
  gull(s, 340, 280, 24);
  gull(s, 290, 230, 16);
  waves(s, horizon + 100, 7, 42, 0, 640);
  boat(s, 200, horizon + 58, 150, 1);
  person(s, 90, 950, 300, 1, 'reach');
  return s.lines.join('');
}
