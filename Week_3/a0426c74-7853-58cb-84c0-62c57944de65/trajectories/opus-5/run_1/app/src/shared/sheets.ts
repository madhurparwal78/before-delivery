import { round6 } from './numbers.js';
import type { SheetSnapshot, ViewportSnapshot } from './snapshot.js';

export type SheetSize = 'A3' | 'A4';

export const SHEET_SIZES: Record<SheetSize, { width: number; height: number }> = {
  A3: { width: 420, height: 297 },
  A4: { width: 297, height: 210 },
};

export const TITLE_BLOCK_TAGS = ['Sheet no', 'Title', 'Drawn by', 'Scale', 'Project', 'Checked by'] as const;
export const TITLE_BLOCK_NAMES: Record<SheetSize, string> = { A3: 'Title A3', A4: 'Title A4' };
export const AUTO_TITLE_TAGS = ['Sheet no', 'Title', 'Drawn by', 'Scale'] as const;

export function scaleDenominator(scale: string): number {
  const parts = scale.split(':');
  return Number(parts[1]);
}

/** The published paper mapping for a viewport. */
export function worldToPaper(viewport: ViewportSnapshot, worldX: number, worldY: number): { x: number; y: number } {
  const n = scaleDenominator(viewport.scale);
  return {
    x: round6(viewport.x + (worldX - viewport.view_x) / n + viewport.width / 2),
    y: round6(viewport.y + viewport.height / 2 - (worldY - viewport.view_y) / n),
  };
}

/** Annotation scale: world text height = paper height x n. */
export function worldTextHeight(textHeightMm: number, scale: string): number {
  return round6(textHeightMm * scaleDenominator(scale));
}

export function titleBlockAttributes(sheet: SheetSnapshot): Record<string, string> {
  const scales = sheet.viewports.map((viewport) => viewport.scale);
  const unique = [...new Set(scales)];
  const scale = unique.length === 0 ? 'Varies' : unique.length === 1 ? unique[0] : 'Varies';
  return {
    ...sheet.attributes,
    'Sheet no': String(sheet.number),
    Title: sheet.name,
    'Drawn by': sheet.creator,
    Scale: scale,
  };
}

export function isAutoTag(tag: string): boolean {
  return (AUTO_TITLE_TAGS as readonly string[]).includes(tag);
}
