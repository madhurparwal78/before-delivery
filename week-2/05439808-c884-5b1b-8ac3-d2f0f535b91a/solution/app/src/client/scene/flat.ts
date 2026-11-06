// The flat top-down plan for browsers without WebGL: the same island, colours and controls in 2D.
import { BUILD_AREA_MIN, BUILDINGS, GRID_SIZE } from '../../shared/catalog';
import { footprint } from '../../shared/grid';
import { saltCracks } from './salt';
import type { Camera, DrawState, Renderer } from './types';

const INK = '#f3efe4';
const GROUND = '#1a1838';
const SALT = '#e9e4d6';
const TEAL = '#5fbfb3';
const BRICK = '#e06a58';
const ACCENT = '#f2933f';
const SLATE = '#4a4670';

export class FlatRenderer implements Renderer {
  readonly kind = 'flat' as const;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly cracks = saltCracks();
  private width = 1;
  private height = 1;
  private ratio = 1;
  private hatch: CanvasPattern | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  }

  resize(width: number, height: number): void {
    this.ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * this.ratio);
    this.canvas.height = Math.round(height * this.ratio);
  }

  private scale(cam: Camera): number {
    return ((Math.min(this.width, this.height) * 0.9) / GRID_SIZE) * cam.zoom;
  }

  project(x: number, y: number, cam: Camera): { x: number; y: number } {
    const s = this.scale(cam);
    return { x: this.width / 2 + cam.offsetX + (x - cam.panX) * s, y: this.height / 2 + cam.offsetY + (y - cam.panY) * s };
  }

  pick(px: number, py: number, cam: Camera): { x: number; y: number } {
    const s = this.scale(cam);
    return { x: cam.panX + (px - this.width / 2 - cam.offsetX) / s, y: cam.panY + (py - this.height / 2 - cam.offsetY) / s };
  }

  private hatchPattern(): CanvasPattern | null {
    if (this.hatch) return this.hatch;
    const tile = document.createElement('canvas');
    tile.width = 8;
    tile.height = 8;
    const t = tile.getContext('2d') as CanvasRenderingContext2D;
    t.strokeStyle = BRICK;
    t.lineWidth = 2;
    t.beginPath();
    t.moveTo(0, 8);
    t.lineTo(8, 0);
    t.stroke();
    this.hatch = this.ctx.createPattern(tile, 'repeat');
    return this.hatch;
  }

  draw(state: DrawState): void {
    const { ctx } = this;
    const cam = state.camera;
    const s = this.scale(cam);
    const at = (x: number, y: number): { x: number; y: number } => this.project(x, y, cam);
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.fillStyle = GROUND;
    ctx.fillRect(0, 0, this.width, this.height);

    const origin = at(0, 0);
    ctx.fillStyle = TEAL;
    ctx.fillRect(origin.x, origin.y, GRID_SIZE * s, GRID_SIZE * s);
    const inner = at(BUILD_AREA_MIN, BUILD_AREA_MIN);
    const span = (GRID_SIZE - BUILD_AREA_MIN * 2) * s;
    ctx.fillStyle = SALT;
    ctx.fillRect(inner.x, inner.y, span, span);
    ctx.strokeStyle = 'rgba(96, 90, 132, 0.5)';
    ctx.lineWidth = 1;
    for (const line of this.cracks) {
      ctx.beginPath();
      line.forEach((p, i) => {
        const q = at(p.x + BUILD_AREA_MIN, p.y + BUILD_AREA_MIN);
        if (i === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      });
      ctx.stroke();
    }
    if (state.mode === 'raid') {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.strokeRect(origin.x, origin.y, GRID_SIZE * s, GRID_SIZE * s);
      ctx.strokeRect(inner.x, inner.y, span, span);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const b of state.buildings) {
      const f = footprint(b.type, b.x, b.y, b.rotation);
      const p = at(f.x, f.y);
      const w = f.width * s;
      const h = f.depth * s;
      const destroyed = (state.motion.get(b.id)?.collapse ?? (b.destroyed ? 1 : 0)) > 0.5;
      ctx.fillStyle = destroyed ? '#6d6782' : b.level === 0 ? '#8e88a6' : SLATE;
      ctx.fillRect(p.x + 2, p.y + 2, w - 4, h - 4);
      if (destroyed) {
        ctx.fillStyle = this.hatchPattern() ?? BRICK;
        ctx.fillRect(p.x + 2, p.y + 2, w - 4, h - 4);
      }
      ctx.strokeStyle = b.id === state.selected ? INK : 'rgba(243, 239, 228, 0.6)';
      ctx.lineWidth = b.id === state.selected ? 3 : 1;
      ctx.strokeRect(p.x + 2, p.y + 2, w - 4, h - 4);
      if (s >= 12) {
        ctx.fillStyle = INK;
        ctx.font = `600 ${Math.max(10, Math.min(14, s * 0.42))}px "Atkinson Hyperlegible", sans-serif`;
        ctx.fillText(BUILDINGS[b.type].name, p.x + w / 2, p.y + h / 2 - s * 0.32, w - 6);
        ctx.font = `500 ${Math.max(10, Math.min(14, s * 0.42))}px "JetBrains Mono", monospace`;
        ctx.fillText(`L${b.level}`, p.x + w / 2, p.y + h / 2 + s * 0.38);
      }
    }

    for (const u of state.units) {
      if (!u.alive) continue;
      const p = at(u.x / 1000, u.y / 1000);
      ctx.fillStyle = GROUND;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(3, s * 0.22), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    if (state.ghost) {
      const f = footprint(state.ghost.type, state.ghost.x, state.ghost.y, state.ghost.rotation);
      const p = at(f.x, f.y);
      const color = state.ghost.valid ? TEAL : BRICK;
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = color;
      ctx.fillRect(p.x, p.y, f.width * s, f.depth * s);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x, p.y, f.width * s, f.depth * s);
    }

    if (state.mode !== 'replay') {
      const c = at(state.cursor.x, state.cursor.y);
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2;
      ctx.strokeRect(c.x + 1, c.y + 1, s - 2, s - 2);
    }
  }

  dispose(): void {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}
