import { BAR_STATE_WORDS } from '../../shared/copy.js';
import type { Locale } from '../../shared/types.js';
import { PALETTE } from '../palette.js';

export type LabelKind = 'available' | 'held';

const WIDTH = 512;
const ROW_HEIGHT = 96;

const cache = new Map<Locale, HTMLCanvasElement>();

/** Two stacked rows of type, so a bar in the scene carries its state word, not just a colour. */
export function labelTexture(locale: Locale): HTMLCanvasElement {
  const cached = cache.get(locale);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = ROW_HEIGHT * 2;
  const context = canvas.getContext('2d');
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const rows: LabelKind[] = ['available', 'held'];
    rows.forEach((kind, index) => {
      const centre = index * ROW_HEIGHT + ROW_HEIGHT / 2;
      if (kind === 'held') {
        context.fillStyle = PALETTE.ground;
        context.fillRect(40, index * ROW_HEIGHT + 14, WIDTH - 80, ROW_HEIGHT - 28);
      }
      context.fillStyle = kind === 'held' ? PALETTE.ink : PALETTE.ground;
      context.font = '600 56px "Instrument Sans", system-ui, sans-serif';
      context.fillText(BAR_STATE_WORDS[kind][locale], WIDTH / 2, centre);
    });
  }
  cache.set(locale, canvas);
  return canvas;
}
