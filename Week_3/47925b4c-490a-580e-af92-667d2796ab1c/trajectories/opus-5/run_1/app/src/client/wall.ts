import { el } from './dom.js';

export const GROUND = '#f7e8e5';
export const INK = '#2b1430';

export interface CellLight {
  readonly cell: string;
  readonly ambientLux: string | null;
  readonly projectedLux: number | null;
  readonly totalLux: number | null;
  readonly luminanceCdM2: number | null;
  readonly contrast: number | null;
  readonly contrastText: string | null;
  readonly band: string;
  readonly pixelsPerMetre: number;
  readonly blended: boolean;
  readonly stale: boolean;
  readonly litLevel: number | null;
  readonly hatched: boolean;
  readonly reflectance: string;
  readonly recessMetres: string;
  readonly contributions: readonly { placementId: string; share: number; lux: number }[];
}

function hatch(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): void {
  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  context.strokeStyle = GROUND;
  context.globalAlpha = 0.5;
  context.lineWidth = 1;
  for (let offset = -height; offset < width; offset += 6) {
    context.beginPath();
    context.moveTo(x + offset, y + height);
    context.lineTo(x + offset + height, y);
    context.stroke();
  }
  context.restore();
}

export interface WallPaint {
  readonly columns: number;
  readonly rows: number;
  readonly cells: readonly CellLight[];
  readonly litCell?: string | null;
  readonly showLevel?: boolean;
}

/** Two colours only: blush light on an aubergine wall, with numerals and hatching. */
export function drawWall(canvas: HTMLCanvasElement, paint: WallPaint): void {
  const context = canvas.getContext('2d');
  if (context === null) return;
  const cellWidth = canvas.width / paint.columns;
  const cellHeight = canvas.height / paint.rows;
  context.fillStyle = INK;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = `${Math.max(7, Math.min(12, cellHeight * 0.4))}px 'Albert Sans', sans-serif`;
  for (const [index, cell] of paint.cells.entries()) {
    const column = index % paint.columns;
    const row = Math.floor(index / paint.columns);
    const x = column * cellWidth;
    const y = row * cellHeight;
    const show = paint.showLevel === true || paint.litCell === cell.cell;
    const level = cell.litLevel ?? 0;
    context.globalAlpha = show ? Math.max(0.06, level) : Math.max(0.04, level * 0.35);
    context.fillStyle = GROUND;
    context.fillRect(x + 0.5, y + 0.5, cellWidth - 1, cellHeight - 1);
    context.globalAlpha = 1;
    if (cell.hatched || cell.band === 'No reading') hatch(context, x, y, cellWidth, cellHeight);
    if (cellWidth > 22 && cellHeight > 14) {
      context.fillStyle = level > 0.45 ? INK : GROUND;
      context.globalAlpha = 0.9;
      context.fillText(
        cell.contrast === null ? '—' : cell.contrast.toFixed(1),
        x + cellWidth / 2,
        y + cellHeight / 2,
        cellWidth - 2,
      );
      context.globalAlpha = 1;
    }
  }
}

export function drawCellZoom(canvas: HTMLCanvasElement, cell: CellLight | null): void {
  const context = canvas.getContext('2d');
  if (context === null) return;
  context.fillStyle = INK;
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (cell === null) return;
  const level = cell.litLevel ?? 0;
  context.globalAlpha = Math.max(0.1, level);
  context.fillStyle = GROUND;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalAlpha = 1;
  if (cell.hatched || cell.band === 'No reading') hatch(context, 0, 0, canvas.width, canvas.height);
  context.fillStyle = level > 0.45 ? INK : GROUND;
  context.font = `600 ${Math.round(canvas.height * 0.5)}px 'Albert Sans', sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(cell.contrastText ?? 'No reading', canvas.width / 2, canvas.height / 2, canvas.width - 6);
}

function slotCanvas(label: string, paint: (canvas: HTMLCanvasElement) => void): HTMLElement {
  const canvas = el('canvas', { width: 320, height: 100 });
  const slot = el('span', { class: 'slot', role: 'img', 'aria-label': label }, [canvas]);
  paint(canvas);
  return slot;
}

/** The waiting frame of an empty state: the slot, unlit. */
export function emptySlot(label: string): HTMLElement {
  return el('span', { class: 'slot unlit', role: 'img', 'aria-label': label });
}

export function wallFragment(): HTMLElement {
  return slotCanvas('Wall fragment', (canvas) => {
    const context = canvas.getContext('2d');
    if (context === null) return;
    context.fillStyle = INK;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = GROUND;
    for (let bay = 0; bay < 8; bay += 1) {
      context.globalAlpha = 0.18 + (bay % 3) * 0.14;
      context.fillRect(bay * 40 + 6, 18 + (bay % 2) * 14, 28, canvas.height - 30);
    }
    context.globalAlpha = 1;
  });
}

export function bodyCrop(): HTMLElement {
  return slotCanvas('Body crop', (canvas) => {
    const context = canvas.getContext('2d');
    if (context === null) return;
    context.fillStyle = INK;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = GROUND;
    context.globalAlpha = 0.85;
    context.fillRect(40, 30, 180, 44);
    context.globalAlpha = 0.5;
    context.beginPath();
    context.moveTo(220, 30);
    context.lineTo(300, 10);
    context.lineTo(300, 94);
    context.lineTo(220, 74);
    context.closePath();
    context.fill();
    context.globalAlpha = 1;
  });
}
