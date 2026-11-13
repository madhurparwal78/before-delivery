/**
 * The stage: a procedural pack drawn in WebGL, with an SVG panel fallback that
 * carries the same facts. All facts come from the server's price decision.
 */
import type { PackFacts } from './lib.js';

export interface StageGeometry {
  mrpRect: [number, number, number, number];
  stickerRect: [number, number, number, number];
  panelRect: [number, number, number, number];
  frontRect: [number, number, number, number];
}

const PANEL_GEOMETRY: Record<string, StageGeometry> = {
  carton: { mrpRect: [0.08, 0.30, 0.40, 0.16], stickerRect: [0.54, 0.28, 0.38, 0.22], panelRect: [0.06, 0.10, 0.88, 0.80], frontRect: [0.10, 0.18, 0.80, 0.44] },
  pet: { mrpRect: [0.10, 0.42, 0.36, 0.14], stickerRect: [0.52, 0.40, 0.38, 0.20], panelRect: [0.08, 0.08, 0.84, 0.84], frontRect: [0.10, 0.18, 0.80, 0.44] },
  glass: { mrpRect: [0.12, 0.48, 0.34, 0.14], stickerRect: [0.52, 0.46, 0.36, 0.20], panelRect: [0.10, 0.06, 0.80, 0.88], frontRect: [0.10, 0.18, 0.80, 0.44] },
  can: { mrpRect: [0.10, 0.36, 0.36, 0.14], stickerRect: [0.50, 0.34, 0.40, 0.20], panelRect: [0.08, 0.10, 0.84, 0.80], frontRect: [0.10, 0.18, 0.80, 0.44] },
};

export const STICKER_FLIGHT_START = 0.55;
export const STICKER_SEAT = 0.75;

export interface StageState {
  progress: number;
  yaw: number;
  cameraZ: number;
  renderer: 'webgl' | 'svg';
  sticker: boolean;
  format: string;
  sku: string;
  batch: string;
  swapProgress: number;
}

/** The published Sticker Turn rules, in exactly one place. */
export function stageFormulas(progress: number, stickerApplies: boolean): { yaw: number; cameraZ: number; stickerT: number; seated: boolean } {
  const p = Math.max(0, Math.min(1, progress));
  const yaw = p < 0.55 ? (p / 0.55) * 180 : 180;
  const cameraZ = p < 0.75 ? 6 : 6 + (3.2 - 6) * ((p - 0.75) / 0.25);
  let stickerT = 0;
  if (stickerApplies && p >= STICKER_FLIGHT_START) {
    stickerT = Math.min(1, (p - STICKER_FLIGHT_START) / (STICKER_SEAT - STICKER_FLIGHT_START));
  }
  const seated = stickerApplies && p >= STICKER_SEAT;
  return { yaw, cameraZ, stickerT, seated };
}

export interface PanelLines {
  printedMrp: string;
  packed: string;
  bestBefore: string;
  unit: string | null;
  revised: string | null;
  oldWrapper: boolean;
}

export function panelLines(facts: PackFacts): PanelLines {
  return {
    printedMrp: `MRP Rs ${rupeesPlain(facts.printedMrpPaise)}`,
    packed: `Packed ${displayDateIso(facts.packedDate)}`,
    bestBefore: `Best before ${displayDateIso(facts.bestBeforeDate)}`,
    unit: facts.unitSalePrice ? `Rs ${facts.unitSalePrice.rupees} per ${facts.unitSalePrice.per}` : null,
    revised: facts.revisedMrpPaise !== null && facts.stickerApplies ? `Revised MRP Rs ${rupeesPlain(facts.revisedMrpPaise)}` : null,
    oldWrapper: facts.oldWrapper,
  };
}

function rupeesPlain(paise: number): string {
  const a = Math.abs(paise);
  return `${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function displayDateIso(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export function geometryFor(format: string): StageGeometry {
  return PANEL_GEOMETRY[format] ?? PANEL_GEOMETRY.carton;
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
