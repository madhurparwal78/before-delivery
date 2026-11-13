/** Draws the table: the one lit surface. All cloth, rails, balls and the cue are drawn here, with no image assets. */
import { BALL_RADIUS, CUE_BALL, POCKET_ENTRIES, TABLE_LENGTH, TABLE_WIDTH, aimVector, type BallSpots, type Contact, type Point } from '../../shared/physics';

interface Scene {
  spots: BallSpots;
  cloth: string;
  aimDegrees: number | null;
  contact: Contact | null;
  guideline: boolean;
  guidelineBonus: number;
}

interface Layout {
  width: number;
  height: number;
  rail: number;
  portrait: boolean;
  scale: number;
}

const CLOTHS: Record<string, [string, string, string]> = {
  'cloth-hall-blue': ['#3a8fca', '#1b5079', '#0a2237'],
  'cloth-oxblood': ['#a53a3a', '#6b1f24', '#2c0c10'],
  'cloth-moss': ['#5f9352', '#34602f', '#142812'],
  'cloth-brass-felt': ['#c49a3e', '#7f6024', '#30240d'],
};
const BALL_COLOURS: Record<number, string> = {
  1: '#e3b62b', 2: '#2a55b5', 3: '#c8372d', 4: '#6a3596', 5: '#e0742a', 6: '#2c8452', 7: '#7d2a2a', 8: '#15161a',
};
const GUIDE_BASE_LENGTH = 42;

function layoutOf(width: number, height: number): Layout {
  const portrait = height > width;
  const rail = Math.round(Math.min(width, height) * 0.052);
  const scale = portrait ? (width - rail * 2) / TABLE_WIDTH : (height - rail * 2) / TABLE_WIDTH;
  return { width, height, rail, portrait, scale };
}

function toCanvas(layout: Layout, [x, y]: Point): Point {
  const { rail, portrait, scale, height } = layout;
  if (portrait) return [rail + x * scale, height - rail - (y / TABLE_LENGTH) * (height - rail * 2)];
  return [rail + (y / TABLE_LENGTH) * (layout.width - rail * 2), rail + x * scale];
}

export function toTable(width: number, height: number, canvasX: number, canvasY: number): Point {
  const layout = layoutOf(width, height);
  const { rail, portrait, scale } = layout;
  if (portrait) return [(canvasX - rail) / scale, ((height - rail - canvasY) / (height - rail * 2)) * TABLE_LENGTH];
  return [(canvasY - rail) / scale, ((canvasX - rail) / (width - rail * 2)) * TABLE_LENGTH];
}

function drawRails(ctx: CanvasRenderingContext2D, { width, height, rail }: Layout): void {
  const wood = ctx.createLinearGradient(0, 0, width, height);
  wood.addColorStop(0, '#4a2f16');
  wood.addColorStop(0.5, '#6e4722');
  wood.addColorStop(1, '#3d2611');
  ctx.fillStyle = wood;
  ctx.beginPath();
  ctx.roundRect(0, 0, width, height, rail * 0.45);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.16)';
  ctx.lineWidth = 1;
  for (let line = 3; line < rail; line += 5) {
    ctx.strokeRect(line, line, width - line * 2, height - line * 2);
  }
  ctx.strokeStyle = '#c9a24b';
  ctx.lineWidth = Math.max(1, rail * 0.09);
  ctx.strokeRect(rail * 0.5, rail * 0.5, width - rail, height - rail);
}

function drawCloth(ctx: CanvasRenderingContext2D, layout: Layout, cloth: string): void {
  const { width, height, rail } = layout;
  const [lit, base, edge] = CLOTHS[cloth] ?? CLOTHS['cloth-hall-blue'];
  const cx = width / 2;
  const cy = height / 2;
  const reach = Math.max(width, height) * 0.56;
  const lamp = ctx.createRadialGradient(cx, cy, reach * 0.04, cx, cy, reach);
  lamp.addColorStop(0, lit);
  lamp.addColorStop(0.46, base);
  lamp.addColorStop(1, edge);
  ctx.fillStyle = lamp;
  ctx.fillRect(rail, rail, width - rail * 2, height - rail * 2);

  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  for (let speck = 0; speck < (width * height) / 90; speck += 1) {
    const x = rail + ((speck * 7919) % 9973) / 9973 * (width - rail * 2);
    const y = rail + ((speck * 6271) % 9967) / 9967 * (height - rail * 2);
    ctx.fillRect(x, y, 1, 1);
  }

  const warm = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach * 0.74);
  warm.addColorStop(0, 'rgba(255,214,140,0.2)');
  warm.addColorStop(0.55, 'rgba(255,214,140,0.07)');
  warm.addColorStop(1, 'rgba(255,214,140,0)');
  ctx.fillStyle = warm;
  ctx.fillRect(rail, rail, width - rail * 2, height - rail * 2);

  ctx.strokeStyle = 'rgba(241,233,218,0.3)';
  ctx.lineWidth = 1;
  const [headX, headY] = toCanvas(layout, [0, TABLE_LENGTH / 4]);
  const [endX, endY] = toCanvas(layout, [TABLE_WIDTH, TABLE_LENGTH / 4]);
  ctx.beginPath();
  ctx.moveTo(headX, headY);
  ctx.lineTo(endX, endY);
  ctx.stroke();
  ctx.fillStyle = 'rgba(241,233,218,0.5)';
  for (const spot of [[50, 50], [50, 150]] as Point[]) {
    const [x, y] = toCanvas(layout, spot);
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPockets(ctx: CanvasRenderingContext2D, layout: Layout): void {
  const radius = layout.scale * 4.6;
  for (const [, spot] of POCKET_ENTRIES) {
    const clamped: Point = [Math.min(TABLE_WIDTH, Math.max(0, spot[0])), spot[1]];
    const [x, y] = toCanvas(layout, clamped);
    ctx.fillStyle = '#05070a';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#c9a24b';
    ctx.lineWidth = Math.max(1, layout.rail * 0.08);
    ctx.stroke();
  }
}

function drawDiamonds(ctx: CanvasRenderingContext2D, layout: Layout): void {
  const { width, height, rail } = layout;
  ctx.fillStyle = '#e7d6a6';
  const size = Math.max(1.5, rail * 0.1);
  const mark = (x: number, y: number): void => {
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x - size, y);
    ctx.fill();
  };
  for (let index = 1; index < 8; index += 1) {
    if (index === 4) continue;
    const long = rail + ((height > width ? height : width) - rail * 2) * (index / 8);
    if (height > width) {
      mark(rail / 2, long);
      mark(width - rail / 2, long);
    } else {
      mark(long, rail / 2);
      mark(long, height - rail / 2);
    }
  }
  for (let index = 1; index < 4; index += 1) {
    const short = rail + ((height > width ? width : height) - rail * 2) * (index / 4);
    if (height > width) {
      mark(short, rail / 2);
      mark(short, height - rail / 2);
    } else {
      mark(rail / 2, short);
      mark(width - rail / 2, short);
    }
  }
}

function drawBall(ctx: CanvasRenderingContext2D, layout: Layout, ball: number, spot: Point): void {
  const [x, y] = toCanvas(layout, spot);
  const radius = BALL_RADIUS * layout.scale;
  ctx.fillStyle = 'rgba(0,0,0,0.34)';
  ctx.beginPath();
  ctx.ellipse(x + radius * 0.16, y + radius * 0.24, radius, radius * 0.92, 0, 0, Math.PI * 2);
  ctx.fill();

  const striped = ball >= 9;
  const colour = ball === CUE_BALL ? '#f4efe3' : BALL_COLOURS[striped ? ball - 8 : ball];
  ctx.fillStyle = striped ? '#f4efe3' : colour;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  if (striped) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = colour;
    ctx.fillRect(x - radius, y - radius * 0.56, radius * 2, radius * 1.12);
    ctx.restore();
  }
  if (ball !== CUE_BALL) {
    ctx.fillStyle = '#f4efe3';
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.48, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#14100a';
    ctx.font = `700 ${Math.max(7, radius * 0.72)}px 'IBM Plex Sans', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(ball), x, y + 0.5);
  }
  const shine = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.4, 0, x, y, radius);
  shine.addColorStop(0, 'rgba(255,255,255,0.62)');
  shine.addColorStop(0.35, 'rgba(255,255,255,0.08)');
  shine.addColorStop(1, 'rgba(0,0,0,0.3)');
  ctx.fillStyle = shine;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawAim(ctx: CanvasRenderingContext2D, layout: Layout, scene: Scene): void {
  const { aimDegrees, contact, spots } = scene;
  const cue = spots[CUE_BALL];
  if (aimDegrees === null || cue === undefined) return;
  const [dx, dy] = aimVector(aimDegrees);
  const start = toCanvas(layout, cue);

  const stickBack = toCanvas(layout, [cue[0] - dx * 66, cue[1] - dy * 66]);
  const stickTip = toCanvas(layout, [cue[0] - dx * 3, cue[1] - dy * 3]);
  const stick = ctx.createLinearGradient(stickTip[0], stickTip[1], stickBack[0], stickBack[1]);
  stick.addColorStop(0, '#f1e9da');
  stick.addColorStop(0.06, '#d8b67a');
  stick.addColorStop(1, '#5c3a1c');
  ctx.strokeStyle = stick;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(2, BALL_RADIUS * layout.scale * 0.55);
  ctx.beginPath();
  ctx.moveTo(stickTip[0], stickTip[1]);
  ctx.lineTo(stickBack[0], stickBack[1]);
  ctx.stroke();

  if (!scene.guideline || contact === null) return;
  const reach = GUIDE_BASE_LENGTH * (1 + scene.guidelineBonus / 25);
  const full = Math.hypot(contact.ghost[0] - cue[0], contact.ghost[1] - cue[1]);
  const shown = Math.min(full, reach);
  const end = toCanvas(layout, [cue[0] + dx * shown, cue[1] + dy * shown]);
  ctx.strokeStyle = 'rgba(241,233,218,0.72)';
  ctx.lineWidth = 1.25;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(start[0], start[1]);
  ctx.lineTo(end[0], end[1]);
  ctx.stroke();
  ctx.setLineDash([]);
  if (shown === full) {
    ctx.strokeStyle = 'rgba(241,233,218,0.9)';
    ctx.beginPath();
    ctx.arc(end[0], end[1], BALL_RADIUS * layout.scale, 0, Math.PI * 2);
    ctx.stroke();
  }
}

let layerKey = '';
let layer: HTMLCanvasElement | null = null;

/** The still table is painted once per size and cloth; a replay frame only redraws the balls over it. */
function tableLayer(layout: Layout, cloth: string, ratio: number, pixelWidth: number, pixelHeight: number): HTMLCanvasElement {
  const key = `${pixelWidth}x${pixelHeight}:${cloth}`;
  if (layer !== null && key === layerKey) return layer;
  const painted = document.createElement('canvas');
  painted.width = pixelWidth;
  painted.height = pixelHeight;
  const ctx = painted.getContext('2d') as CanvasRenderingContext2D;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  drawRails(ctx, layout);
  drawCloth(ctx, layout, cloth);
  drawPockets(ctx, layout);
  drawDiamonds(ctx, layout);
  layer = painted;
  layerKey = key;
  return painted;
}

export function drawScene(canvas: HTMLCanvasElement, scene: Scene): void {
  const box = canvas.getBoundingClientRect();
  if (box.width === 0) return;
  const ratio = Math.min(2, devicePixelRatio);
  const pixelWidth = Math.round(box.width * ratio);
  const pixelHeight = Math.round(box.height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const layout = layoutOf(box.width, box.height);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, pixelWidth, pixelHeight);
  ctx.drawImage(tableLayer(layout, scene.cloth, ratio, pixelWidth, pixelHeight), 0, 0);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  for (const [key, spot] of Object.entries(scene.spots)) {
    const ball = Number(key);
    if (ball !== CUE_BALL) drawBall(ctx, layout, ball, spot);
  }
  if (scene.spots[CUE_BALL] !== undefined) drawBall(ctx, layout, CUE_BALL, scene.spots[CUE_BALL]);
  drawAim(ctx, layout, scene);
}
