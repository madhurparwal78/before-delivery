import type { Placement, Wall } from './types.js';

/**
 * The flat drawing shown without WebGL: a top-down plan or a wall elevation,
 * drawn as line art with the accent hang line.
 */
export class FlatScene {
  private canvas: HTMLCanvasElement | null = null;

  constructor(private container: HTMLElement) {}

  mount(): void {
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    this.canvas = canvas;
    this.container.appendChild(canvas);
  }

  draw(params: {
    walls: Wall[];
    placements: Placement[];
    view: 'plan' | 'wall' | 'light';
    facingWallId: string | null;
    luxOverlay: boolean;
  }): void {
    const canvas = this.canvas;
    if (canvas === null) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    ctx.fillStyle = '#efe8dc';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#211d1a';
    ctx.lineWidth = 2;

    if (params.view === 'plan') {
      this.drawPlan(ctx, width, height, params.walls, params.placements);
    } else {
      const wallId = params.facingWallId ?? params.walls[0]?.id ?? null;
      const wall = params.walls.find((w) => w.id === wallId) ?? params.walls[0];
      if (wall !== undefined) {
        this.drawElevation(ctx, width, height, wall, params.placements, params.luxOverlay);
      }
    }
  }

  private drawPlan(
    ctx: CanvasRenderingContext2D, width: number, height: number,
    walls: Wall[], placements: Placement[]
  ): void {
    const roomW = 1200; // cm
    const roomD = 900;
    const scale = Math.min((width - 60) / roomW, (height - 60) / roomD);
    const x0 = (width - roomW * scale) / 2;
    const y0 = (height - roomD * scale) / 2;
    ctx.strokeRect(x0, y0, roomW * scale, roomD * scale);
    ctx.fillStyle = '#211d1a';
    ctx.font = '12px Hanken Grotesk, sans-serif';
    const names = ['North wall', 'East wall', 'South wall', 'West wall'];
    ctx.fillText(names[0]!, x0 + 4, y0 + 16);
    ctx.fillText(names[2]!, x0 + 4, y0 + roomD * scale - 6);
    ctx.fillText(names[1]!, x0 + roomW * scale - 70, y0 + 16);
    ctx.fillText(names[3]!, x0 + 4, y0 + roomD * scale - 22);

    for (const p of placements) {
      const wall = walls.find((w) => w.id === p.wallId);
      if (wall === undefined) continue;
      const w = (p.widthMm / 10) * scale;
      const along = ((p.offsetMm - wall.lengthMm / 2) / 10) * scale;
      ctx.fillStyle = '#f6f1e8';
      ctx.strokeStyle = '#211d1a';
      if (p.wallId === 'wall-north') {
        ctx.fillRect(x0 + (roomW * scale) / 2 + along - w / 2, y0, w, 8);
        ctx.strokeRect(x0 + (roomW * scale) / 2 + along - w / 2, y0, w, 8);
      } else if (p.wallId === 'wall-south') {
        ctx.fillRect(x0 + (roomW * scale) / 2 + along - w / 2, y0 + roomD * scale - 8, w, 8);
        ctx.strokeRect(x0 + (roomW * scale) / 2 + along - w / 2, y0 + roomD * scale - 8, w, 8);
      } else if (p.wallId === 'wall-east') {
        ctx.fillRect(x0 + roomW * scale - 8, y0 + (roomD * scale) / 2 + along - w / 2, 8, w);
        ctx.strokeRect(x0 + roomW * scale - 8, y0 + (roomD * scale) / 2 + along - w / 2, 8, w);
      } else {
        ctx.fillRect(x0, y0 + (roomD * scale) / 2 + along - w / 2, 8, w);
        ctx.strokeRect(x0, y0 + (roomD * scale) / 2 + along - w / 2, 8, w);
      }
    }
  }

  private drawElevation(
    ctx: CanvasRenderingContext2D, width: number, height: number,
    wall: Wall, placements: Placement[], luxOverlay: boolean
  ): void {
    const scale = Math.min((width - 60) / (wall.lengthMm / 10), (height - 60) / (wall.heightMm / 10));
    const x0 = (width - (wall.lengthMm / 10) * scale) / 2;
    const y0 = (height - (wall.heightMm / 10) * scale) / 2;
    ctx.fillStyle = luxOverlay ? luxFill(wall.plannedLux) : '#d8d1c5';
    ctx.fillRect(x0, y0, (wall.lengthMm / 10) * scale, (wall.heightMm / 10) * scale);
    ctx.strokeStyle = '#211d1a';
    ctx.strokeRect(x0, y0, (wall.lengthMm / 10) * scale, (wall.heightMm / 10) * scale);

    for (const p of placements.filter((q) => q.wallId === wall.id)) {
      const w = (p.widthMm / 10) * scale;
      const h = (p.heightMm / 10) * scale;
      const x = x0 + ((p.offsetMm - p.widthMm / 2) / 10) * scale;
      const y = y0 + (wall.heightMm / 10) * scale - ((p.centreHeightMm + p.heightMm / 2) / 10) * scale;
      ctx.fillStyle = '#f6f1e8';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = p.luxStatus === 'over' && luxOverlay ? '#8c2f22' : '#211d1a';
      ctx.strokeRect(x, y, w, h);
      if (p.luxStatus === 'over' && luxOverlay) {
        ctx.save();
        ctx.strokeStyle = 'rgba(140,47,34,0.45)';
        for (let i = -h; i < w; i += 10) {
          ctx.beginPath();
          ctx.moveTo(x + i, y + h);
          ctx.lineTo(x + i + h, y);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    // Accent hang line at 145 cm.
    const y = y0 + (wall.heightMm / 10) * scale - 145 * scale;
    ctx.strokeStyle = '#c25e1e';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + (wall.lengthMm / 10) * scale, y);
    ctx.stroke();
  }

  destroy(): void {
    this.canvas?.remove();
    this.canvas = null;
  }
}

function luxFill(lux: number): string {
  const t = Math.min(1, lux / 300);
  const r = Math.round(235 - 5 * (1 - t));
  const g = Math.round(228 - 40 * t);
  const b = Math.round(215 - 70 * t);
  return `rgb(${r}, ${g}, ${b})`;
}
