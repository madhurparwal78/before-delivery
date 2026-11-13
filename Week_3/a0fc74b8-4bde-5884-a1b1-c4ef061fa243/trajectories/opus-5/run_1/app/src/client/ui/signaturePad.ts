import { h } from '../dom.ts';
import type { Stroke } from '../../shared/types.ts';

export interface Pad {
  element: HTMLElement;
  clear: () => void;
  strokes: () => Stroke[];
  onChange: (listener: () => void) => void;
}

const WIDTH = 600;
const HEIGHT = 200;

/** Drawing on the pad never scrolls or zooms the page behind it. */
export const signaturePad = (label: string): Pad => {
  const canvas = h('canvas', { width: String(WIDTH), height: String(HEIGHT), class: 'pad-canvas' });
  const element = h('div', { role: 'img', 'aria-label': label, class: 'signature-pad' }, canvas);
  element.style.touchAction = 'none';
  canvas.style.touchAction = 'none';
  const context = canvas.getContext('2d');
  const strokes: Stroke[] = [];
  let active: Stroke | null = null;
  let listener: () => void = () => undefined;

  const paint = (): void => {
    if (context === null) return;
    context.clearRect(0, 0, WIDTH, HEIGHT);
    context.lineWidth = 2.5;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#16213a';
    for (const stroke of strokes) {
      const first = stroke[0];
      if (!first) continue;
      context.beginPath();
      context.moveTo(first[0] * WIDTH, first[1] * HEIGHT);
      for (const [x, y] of stroke.slice(1)) context.lineTo(x * WIDTH, y * HEIGHT);
      if (stroke.length === 1) context.lineTo(first[0] * WIDTH + 0.5, first[1] * HEIGHT);
      context.stroke();
    }
  };

  const pointAt = (event: PointerEvent): [number, number] => {
    const rect = canvas.getBoundingClientRect();
    return [
      Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    ];
  };

  canvas.addEventListener('pointerdown', (event: PointerEvent) => {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    active = [pointAt(event)];
    strokes.push(active);
    paint();
    listener();
  });
  canvas.addEventListener('pointermove', (event: PointerEvent) => {
    if (active === null) return;
    event.preventDefault();
    active.push(pointAt(event));
    paint();
  });
  const end = (event: PointerEvent): void => {
    if (active === null) return;
    event.preventDefault();
    active = null;
    canvas.releasePointerCapture?.(event.pointerId);
    listener();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('touchstart', (event: TouchEvent) => event.preventDefault(), {
    passive: false,
  });
  canvas.addEventListener('touchmove', (event: TouchEvent) => event.preventDefault(), {
    passive: false,
  });

  return {
    element,
    clear: () => {
      strokes.length = 0;
      active = null;
      paint();
      listener();
    },
    strokes: () => strokes.map((stroke) => stroke.map(([x, y]): [number, number] => [x, y])),
    onChange: (next: () => void) => {
      listener = next;
    },
  };
};
