// The race canvas: a top-down ribbon with kerbs, built in code from the layout.
import type { RaceCar } from '../../shared/raceModel';
import type { LayoutSpec, LaneId } from '../../shared/domain';

const INK = '#231c14';
const PAPER = '#f6efe2';
const ACCENT = '#d9600f';
const RULE = '#c9bda5';
const KERB = '#b04a17';

const LANE_X: Record<LaneId, number> = { left: -16, middle: 0, right: 16 };

/** Draws the track behind the player, the AI cars and the ghost outline. */
export function drawRace(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, layout: LayoutSpec,
                         player: RaceCar, ai: RaceCar[], ghost: RaceCar | null, units: 'kmh' | 'mph'): void {
  void units;
  const w = canvas.width;
  const h = canvas.height;
  ctx.save();
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, w, h);

  // A camera follows behind the player: the track scrolls under it.
  const scale = 8; // pixels per metre
  const baseX = w / 2;
  const carY = h * 0.62;
  const cam = player.position;

  // Track ribbon: three lanes wide with ruled kerbs.
  const drawSegment = (from: number, to: number, y: number): void => {
    ctx.fillStyle = '#e8dfc9';
    ctx.fillRect(baseX - (cam - from) * scale - (to - from) * scale, y - 30, (to - from) * scale, 60);
  };

  // Draw the ribbon across the visible window.
  const visibleFrom = Math.max(0, cam - w / 2 / scale);
  const visibleTo = cam + w / 2 / scale + 60;
  for (let m = Math.floor(visibleFrom / 60) * 60; m < visibleTo + 120; m += 60) {
    const segEnd = Math.min(m + 60, layout.length);
    if (segEnd <= m) break;
    const corner = layout.corners.find(c => m >= c.start && m < c.end);
    if (corner) {
      // A corner: a kerb block
      ctx.fillStyle = KERB;
      const x = baseX - (cam - m) * scale;
      const width = (segEnd - m) * scale;
      ctx.fillRect(x, carY - 34, width, 6);
      ctx.fillRect(x, carY + 28, width, 6);
      ctx.fillStyle = '#e8dfc9';
      ctx.fillRect(x, carY - 28, width, 56);
    } else {
      ctx.fillStyle = '#e8dfc9';
      const x = baseX - (cam - m) * scale;
      const width = (segEnd - m) * scale;
      ctx.fillRect(x, carY - 28, width, 56);
      ctx.strokeStyle = RULE;
      ctx.beginPath();
      ctx.moveTo(x, carY - 28); ctx.lineTo(x + width, carY - 28);
      ctx.moveTo(x, carY + 28); ctx.lineTo(x + width, carY + 28);
      ctx.stroke();
    }
    // Distance ruler marks
    ctx.fillStyle = RULE;
    ctx.fillRect(baseX - (cam - m) * scale, carY + 40, 2, 10);
  }

  // Coins on this lap
  for (const coin of layout.coins) {
    const x = baseX - (cam - coin.at) * scale;
    if (x > -20 && x < w + 20) {
      ctx.beginPath();
      ctx.arc(x, carY + LANE_X[coin.lane], 7, 0, Math.PI * 2);
      ctx.fillStyle = ACCENT;
      ctx.fill();
    }
  }

  // Cars: simple shapes built in code
  const drawCar = (car: RaceCar, x: number, colour: string, outline: boolean): void => {
    void car;
    if (outline) {
      ctx.strokeStyle = 'rgba(35, 28, 20, 0.55)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 16, carY + LANE_X[car.lane] - 8, 32, 16);
      return;
    }
    ctx.fillStyle = colour;
    ctx.fillRect(x - 16, carY + LANE_X[car.lane] - 8, 32, 16);
    ctx.fillStyle = INK;
    ctx.fillRect(x - 4, carY + LANE_X[car.lane] - 6, 10, 12);
  };

  if (ghost) drawCar(ghost, baseX - (cam - ghost.position) * scale, '', true);
  for (const a of ai) {
    const x = baseX - (cam - a.position) * scale;
    if (x > -30 && x < w + 30) drawCar(a, x, INK, false);
  }
  drawCar(player, baseX, ACCENT, false);

  ctx.restore();
}
