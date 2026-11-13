import { BALL_RADIUS, POCKET_MOUTHS, WIDTH, toVec } from '../shared/table-geometry.js';
import { POCKETS, type Point } from '../shared/types.js';

export interface Scene {
  positions: { ball: number; across: number; along: number }[];
  aimDegrees: number;
  guideline: boolean;
  guidelineLength: number;
  contact: { x: number; y: number } | null;
  tangent: { x: number; y: number } | null;
  tangentProgress: number;
  cloth: string;
  locked: boolean;
}

export type Orientation = 'vertical' | 'horizontal';

const BALL_COLOURS: Record<number, string> = {
  1: '#e8c04a',
  2: '#2f5bd0',
  3: '#c6483c',
  4: '#6b4a9e',
  5: '#d87a32',
  6: '#2f8f5b',
  7: '#8c3b2e',
  8: '#13161c',
  9: '#e8c04a',
  10: '#2f5bd0',
  11: '#c6483c',
  12: '#6b4a9e',
  13: '#d87a32',
  14: '#2f8f5b',
  15: '#8c3b2e',
};

export function pointToCanvas(point: Point, width: number, height: number, orientation: Orientation): { x: number; y: number } {
  if (orientation === 'vertical') {
    return { x: (point.across / WIDTH) * width, y: ((100 - point.along) / 100) * height };
  }
  return { x: ((100 - point.along) / 100) * width, y: (point.across / WIDTH) * height };
}

export function canvasToPoint(x: number, y: number, width: number, height: number, orientation: Orientation): Point {
  if (orientation === 'vertical') {
    return { across: (x / width) * WIDTH, along: 100 - (y / height) * 100 };
  }
  return { across: (y / height) * WIDTH, along: 100 - (x / width) * 100 };
}

function radiusFor(width: number, height: number, orientation: Orientation): number {
  const shortSide = orientation === 'vertical' ? width : height;
  return (BALL_RADIUS / WIDTH) * shortSide;
}

export function drawTable(
  context: CanvasRenderingContext2D,
  scene: Scene,
  width: number,
  height: number,
  orientation: Orientation,
): void {
  context.clearRect(0, 0, width, height);
  const radius = radiusFor(width, height, orientation);

  context.fillStyle = '#1b1208';
  context.fillRect(0, 0, width, height);
  const inset = radius * 1.2;
  context.fillStyle = scene.cloth;
  context.fillRect(inset, inset, width - inset * 2, height - inset * 2);
  context.strokeStyle = '#b98a3c';
  context.lineWidth = Math.max(2, radius * 0.35);
  context.strokeRect(inset, inset, width - inset * 2, height - inset * 2);

  const lamp = context.createRadialGradient(width / 2, height / 2, radius, width / 2, height / 2, Math.max(width, height) * 0.7);
  lamp.addColorStop(0, 'rgba(255, 236, 190, 0.26)');
  lamp.addColorStop(0.55, 'rgba(255, 236, 190, 0.05)');
  lamp.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
  context.fillStyle = lamp;
  context.fillRect(inset, inset, width - inset * 2, height - inset * 2);

  for (const pocket of POCKETS) {
    const mouth = POCKET_MOUTHS[pocket];
    const spot = pointToCanvas({ across: mouth.x, along: mouth.y / 2 }, width, height, orientation);
    context.beginPath();
    context.fillStyle = '#07090c';
    context.arc(spot.x, spot.y, radius * 1.35, 0, Math.PI * 2);
    context.fill();
  }

  const headStringStart = pointToCanvas({ across: 0, along: 25 }, width, height, orientation);
  const headStringEnd = pointToCanvas({ across: 100, along: 25 }, width, height, orientation);
  context.strokeStyle = 'rgba(243, 236, 222, 0.18)';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(headStringStart.x, headStringStart.y);
  context.lineTo(headStringEnd.x, headStringEnd.y);
  context.stroke();

  const cue = scene.positions.find((entry) => entry.ball === 0);
  if (cue && scene.guideline) {
    const from = pointToCanvas(cue, width, height, orientation);
    const radians = (scene.aimDegrees * Math.PI) / 180;
    const direction = orientation === 'vertical' ? { x: Math.sin(radians), y: -Math.cos(radians) } : { x: -Math.cos(radians), y: Math.sin(radians) };
    const length = scene.guidelineLength * Math.max(width, height);
    context.strokeStyle = 'rgba(243, 236, 222, 0.55)';
    context.lineWidth = 1.5;
    context.setLineDash([radius * 0.6, radius * 0.6]);
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(from.x + direction.x * length, from.y + direction.y * length);
    context.stroke();
    context.setLineDash([]);
  }

  if (scene.contact) {
    const ghost = pointToCanvas({ across: scene.contact.x, along: scene.contact.y / 2 }, width, height, orientation);
    context.strokeStyle = 'rgba(243, 236, 222, 0.8)';
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(ghost.x, ghost.y, radius, 0, Math.PI * 2);
    context.stroke();
    if (scene.tangent && scene.tangentProgress > 0) {
      const tangentVector = toVec({ across: scene.tangent.x, along: scene.tangent.y / 2 });
      const scaled = {
        across: scene.contact.x + tangentVector.x * 24 * scene.tangentProgress,
        along: (scene.contact.y + tangentVector.y * 24 * scene.tangentProgress) / 2,
      };
      const tip = pointToCanvas(scaled, width, height, orientation);
      context.strokeStyle = '#d7a345';
      context.lineWidth = Math.max(2, radius * 0.3);
      context.beginPath();
      context.moveTo(ghost.x, ghost.y);
      context.lineTo(tip.x, tip.y);
      context.stroke();
    }
  }

  for (const entry of scene.positions) {
    const spot = pointToCanvas(entry, width, height, orientation);
    context.beginPath();
    context.fillStyle = entry.ball === 0 ? '#f3ecde' : BALL_COLOURS[entry.ball] ?? '#f3ecde';
    context.arc(spot.x, spot.y, radius, 0, Math.PI * 2);
    context.fill();
    if (entry.ball >= 9) {
      context.fillStyle = '#f3ecde';
      context.fillRect(spot.x - radius, spot.y - radius * 0.35, radius * 2, radius * 0.7);
    }
    if (entry.ball > 0) {
      context.fillStyle = '#13161c';
      context.beginPath();
      context.arc(spot.x, spot.y, radius * 0.45, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#f3ecde';
      context.font = `${Math.max(7, radius * 0.8)}px "IBM Plex Sans", sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(String(entry.ball), spot.x, spot.y + radius * 0.05);
    }
  }
}

export function drawLoupe(
  context: CanvasRenderingContext2D,
  scene: Scene,
  size: number,
  orientation: Orientation,
): void {
  const magnification = 3;
  const centre = scene.contact ?? { x: 50, y: 100 };
  context.save();
  context.clearRect(0, 0, size, size);
  context.beginPath();
  context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  context.clip();
  const virtualWidth = orientation === 'vertical' ? size * magnification : size * magnification * 2;
  const virtualHeight = orientation === 'vertical' ? size * magnification * 2 : size * magnification;
  const focus = pointToCanvas({ across: centre.x, along: centre.y / 2 }, virtualWidth, virtualHeight, orientation);
  context.translate(size / 2 - focus.x, size / 2 - focus.y);
  drawTable(context, scene, virtualWidth, virtualHeight, orientation);
  context.restore();
}
