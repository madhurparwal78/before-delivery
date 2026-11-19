import { compositeHash } from '../../shared/composite.js';
import type { TagDirection } from '../../shared/types.js';
import { api } from '../api.js';
import { button, el, reducedMotion } from '../dom.js';
import { onLeave } from '../router.js';
import { fitZoom, paintPixels, rowsToBytes, stepZoom } from '../stagepaint.js';

interface ShareView {
  sprite: {
    name: string;
    width: number;
    height: number;
    seq: number;
    frames: { number: number; duration_ms: number }[];
    tags: { name: string; from: number; to: number; direction: TagDirection; repeat: number }[];
  };
  state: string;
}

function endedPage(): HTMLElement {
  return el('main', { class: 'column' }, [
    el('div', { class: 'card' }, [el('h1', { text: 'This link has ended' })]),
  ]);
}

export async function sharePage(params: string[]): Promise<HTMLElement> {
  const token = params[0];
  const result = await api.get<ShareView>(`/api/share/${token}`);
  if (!result.ok) return endedPage();
  const sprite = result.body.sprite;

  const host = el('main', { class: 'share' });
  const stage = el('canvas', {
    role: 'application',
    'aria-label': 'Sprite stage',
    class: 'stage-canvas',
    'data-frame': '1',
    'data-zoom': '8',
    'data-seq': String(sprite.seq),
  });
  const previewCanvas = el('canvas', {
    class: 'preview-canvas',
    'data-preview-frame': '1',
    'data-preview-mode': reducedMotion() ? 'step' : 'autoplay',
  });
  let zoom = fitZoom(sprite.width, sprite.height, { w: 640, h: 640 });
  const frameBytes = new Map<number, Uint8Array>();

  const loadFrame = async (number: number): Promise<Uint8Array> => {
    const held = frameBytes.get(number);
    if (held !== undefined) return held;
    const pixels = await api.get<{ rows: string[][]; seq: number }>(
      `/api/share/${token}/frames/${number}/pixels`,
    );
    if (!pixels.ok) return new Uint8Array(sprite.width * sprite.height * 4);
    const bytes = rowsToBytes(pixels.body.rows);
    frameBytes.set(number, bytes);
    return bytes;
  };

  let shownFrame = 1;
  const drawStage = async (): Promise<void> => {
    const bytes = await loadFrame(shownFrame);
    paintPixels(stage, bytes, sprite.width, sprite.height, zoom);
    stage.setAttribute('data-zoom', String(zoom));
    stage.setAttribute('data-frame', String(shownFrame));
    stage.setAttribute('data-composite-hash', compositeHash(bytes));
  };

  const drawPreview = async (number: number): Promise<void> => {
    const bytes = await loadFrame(number);
    paintPixels(previewCanvas, bytes, sprite.width, sprite.height, 4);
    previewCanvas.setAttribute('data-preview-frame', String(number));
  };

  const sequence =
    sprite.frames.length === 0 ? [1] : sprite.frames.map((frame) => frame.number);
  let at = 0;
  let timer = 0;
  const play = (): void => {
    if (reducedMotion()) return;
    const number = sequence[at % sequence.length];
    void drawPreview(number);
    const duration = sprite.frames.find((frame) => frame.number === number)?.duration_ms ?? 100;
    timer = window.setTimeout(() => {
      at += 1;
      play();
    }, duration);
  };

  await drawStage();
  await drawPreview(1);
  play();

  const source = new EventSource(`/api/share/${token}/events`);
  source.onmessage = (event) => {
    const message = JSON.parse(event.data) as { type: string };
    if (message.type === 'ended') {
      source.close();
      window.clearTimeout(timer);
      host.replaceWith(endedPage());
      return;
    }
    frameBytes.clear();
    void drawStage();
  };
  source.onerror = () => undefined;
  onLeave(() => {
    source.close();
    window.clearTimeout(timer);
  });

  host.append(
    el('h1', { text: sprite.name }),
    el('div', { class: 'stage-viewport' }, [stage]),
    el('div', { class: 'row' }, [
      button('Zoom in', () => {
        zoom = stepZoom(zoom, 1);
        void drawStage();
      }),
      button('Zoom out', () => {
        zoom = stepZoom(zoom, -1);
        void drawStage();
      }),
    ]),
    el('div', { role: 'region', 'aria-label': 'Preview', class: 'panel preview' }, [previewCanvas]),
  );
  return host;
}
