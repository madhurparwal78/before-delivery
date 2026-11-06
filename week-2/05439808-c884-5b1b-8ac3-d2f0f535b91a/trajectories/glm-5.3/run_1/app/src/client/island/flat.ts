// The flat top-down plan, shown when WebGL is unavailable: the same colours, the same data
// attributes, the same controls. Buildings are labelled rectangles; destroyed ones are hatched.
import type { IslandScene } from './scene.ts';
import { BUILDINGS } from '../../domain/catalog.ts';
import { footprintSize } from './scene.ts';

const GROUND = '#eae6da';
const CRACK = '#dcd7c9';
const WATER = '#4e9a8f';
const INK = '#232642';
const ACCENT = '#e8763a';
const DANGER = '#c65b4a';

const BUILDING_COLORS: Record<string, string> = {
  brine_pan: '#b2c7b8',
  peat_cutter: '#9e8064',
  copper_sluice: '#b87f52',
  brine_cistern: '#809e9a',
  peat_rick: '#a8905c',
  copper_vault: '#c7734d',
  tide_barracks: '#9a9dab',
  driftwood_camp: '#b89f75',
  kiln_tower: '#d1733f',
};

export class FlatRenderer {
  kind = 'flat' as const;
  private ctx: CanvasRenderingContext2D;
  readonly scene: IslandScene;
  private scale = 14;

  constructor(scene: IslandScene) {
    this.scene = scene;
    const canvas = scene.expose().canvas;
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('no 2d context');
    this.ctx = ctx;
  }

  resize(_widthPx: number, _heightPx: number): void {
    // redraw happens each frame
  }

  render(timeMs: number): void {
    const ctx = this.ctx;
    const canvas = this.scene.expose().canvas;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const ex = this.scene.expose();
    this.scale = Math.min(width, height) / 46 * ex.camera.zoom;
    const originX = width / 2 - (ex.camera.panX - 20) * this.scale;
    const originY = height / 2 - (ex.camera.panY - 20) * this.scale;

    // ground
    for (let x = 0; x < 40; x++) {
      for (let y = 0; y < 40; y++) {
        const isRing = x <= 1 || x >= 38 || y <= 1 || y >= 38;
        ctx.fillStyle = isRing ? WATER : (x + y) % 2 === 0 ? GROUND : CRACK;
        ctx.fillRect(originX + x * this.scale, originY + y * this.scale, this.scale, this.scale);
      }
    }

    // grid lines
    ctx.strokeStyle = 'rgba(35, 38, 66, 0.08)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 40; i++) {
      ctx.beginPath();
      ctx.moveTo(originX + i * this.scale, originY);
      ctx.lineTo(originX + i * this.scale, originY + 40 * this.scale);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(originX, originY + i * this.scale);
      ctx.lineTo(originX + 40 * this.scale, originY + i * this.scale);
      ctx.stroke();
    }

    // raid ring highlight
    if (ex.view === 'raid') {
      ctx.fillStyle = 'rgba(232, 118, 58, 0.35)';
      for (let x = 0; x < 40; x++) {
        for (const y of [0, 1, 38, 39]) ctx.fillRect(originX + x * this.scale, originY + y * this.scale, this.scale, this.scale);
      }
      for (let y = 0; y < 40; y++) {
        for (const x of [0, 1, 38, 39]) ctx.fillRect(originX + x * this.scale, originY + y * this.scale, this.scale, this.scale);
      }
    }

    // buildings
    for (const building of ex.buildings) {
      const { width, depth } = footprintSize(building.type, building.rotation);
      const px = originX + building.x * this.scale;
      const py = originY + building.y * this.scale;
      const w = width * this.scale;
      const h = depth * this.scale;
      ctx.fillStyle = building.destroyed ? '#585049' : BUILDING_COLORS[building.type] ?? GROUND;
      ctx.fillRect(px, py, w, h);
      if (building.destroyed) {
        ctx.save();
        ctx.strokeStyle = DANGER;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = -h; i < w; i += 8) {
          ctx.moveTo(px + Math.max(0, i), py + Math.max(0, -i));
          ctx.lineTo(px + Math.min(w, i + h), py + Math.min(h, -i + h));
        }
        ctx.stroke();
        ctx.restore();
      }
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(px, py, w, h);
      if (building.working && !ex.reduced) {
        const angle = (timeMs / 5000) * Math.PI * 2;
        ctx.strokeStyle = '#f2b874';
        ctx.beginPath();
        ctx.arc(px + w / 2, py + h / 2, Math.max(w, h) / 2 + 3, angle, angle + 1.2);
        ctx.stroke();
      }
      if (this.scale > 9) {
        ctx.fillStyle = INK;
        ctx.font = `${Math.max(8, this.scale * 0.34)}px 'Atkinson Hyperlegible', sans-serif`;
        ctx.fillText(BUILDINGS[building.type].name.slice(0, 9), px + 3, py + Math.min(h - 3, this.scale * 0.7));
      }
    }

    // units
    for (const unit of ex.units) {
      const ux = originX + (unit.x / 1000) * this.scale;
      const uy = originY + (unit.y / 1000) * this.scale;
      ctx.fillStyle = unit.alive ? (unit.unit === 'saltjack' ? '#f2efe4' : '#d9b873') : '#6a625c';
      ctx.fillRect(ux - this.scale * 0.15, uy - this.scale * 0.15, this.scale * 0.3, this.scale * 0.3);
    }

    // ghost
    if (ex.ghost !== null) {
      const { width, depth } = footprintSize(ex.ghost.type, ex.ghost.rotation);
      ctx.strokeStyle = ex.ghost.valid ? WATER : DANGER;
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(originX + ex.ghost.x * this.scale, originY + ex.ghost.y * this.scale, width * this.scale, depth * this.scale);
      ctx.setLineDash([]);
      ctx.fillStyle = ex.ghost.valid ? 'rgba(78, 154, 143, 0.25)' : 'rgba(198, 91, 74, 0.25)';
      ctx.fillRect(originX + ex.ghost.x * this.scale, originY + ex.ghost.y * this.scale, width * this.scale, depth * this.scale);
    }

    // cursor
    if (ex.view !== 'replay') {
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2;
      ctx.strokeRect(originX + ex.cursor.x * this.scale + 1, originY + ex.cursor.y * this.scale + 1, this.scale - 2, this.scale - 2);
    }
  }
}

export function flatPick(renderer: FlatRenderer, px: number, py: number): { x: number; y: number } | null {
  const ex = renderer.scene.expose();
  const canvas = ex.canvas;
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  const scale = Math.min(width, height) / 46 * ex.camera.zoom;
  const originX = width / 2 - (ex.camera.panX - 20) * scale;
  const originY = height / 2 - (ex.camera.panY - 20) * scale;
  const cellX = Math.floor((px - originX) / scale);
  const cellY = Math.floor((py - originY) / scale);
  if (cellX < 0 || cellX > 39 || cellY < 0 || cellY > 39) return null;
  return { x: cellX, y: cellY };
}

export function flatBadge(renderer: FlatRenderer, cx: number, cy: number): { x: number; y: number } {
  const ex = renderer.scene.expose();
  const canvas = ex.canvas;
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  const scale = Math.min(width, height) / 46 * ex.camera.zoom;
  const originX = width / 2 - (ex.camera.panX - 20) * scale;
  const originY = height / 2 - (ex.camera.panY - 20) * scale;
  return { x: originX + cx * scale, y: originY + cy * scale };
}
