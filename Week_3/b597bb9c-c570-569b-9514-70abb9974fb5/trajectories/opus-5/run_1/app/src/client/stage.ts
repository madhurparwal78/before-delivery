/** The stage: one coloured box per drawn layer at its computed position. */
import { formatTwoDecimals } from '../domain/layers.js';
import { FRAME_SIZES } from '../shared/types.js';
import { el } from './dom.js';
import { boxColour, boxesAt, type MediaIndex, type ProjectDetail } from './sheet.js';

export interface StageOptions {
  mode: 'playhead' | 'skim';
  frame: number;
  interactive: boolean;
  lockedRows: Set<string>;
  guide: string | null;
}

export function renderStage(detail: ProjectDetail, media: MediaIndex, options: StageOptions): HTMLElement {
  const size = FRAME_SIZES[detail.project.aspect_ratio];
  const boxes = boxesAt(detail, media, options.frame);
  const inner = el('div', {
    class: 'stage-frame',
    'data-stage-box': '',
    style: `aspect-ratio: ${size.width} / ${size.height}`,
  });
  for (const box of boxes) {
    const clip = detail.clips.find((candidate) => candidate.id === box.clip_id);
    if (clip === undefined) continue;
    const style = [
      `left:${((box.x - box.width / 2) / size.width) * 100}%`,
      `top:${((box.y - box.height / 2) / size.height) * 100}%`,
      `width:${(box.width / size.width) * 100}%`,
      `height:${(box.height / size.height) * 100}%`,
      `background:${boxColour(clip, media)}`,
      `opacity:${box.opacity / 100}`,
      box.rotation === 0 ? '' : `transform: rotate(${box.rotation}deg)`,
    ]
      .filter((part) => part !== '')
      .join(';');
    const attributes = {
      class: 'stage-layer',
      'data-layer-box': clip.id,
      'data-x': formatTwoDecimals(box.x),
      'data-y': formatTwoDecimals(box.y),
      'data-width': formatTwoDecimals(box.width),
      'data-height': formatTwoDecimals(box.height),
      'data-scale': formatTwoDecimals(box.scale),
      'data-rotation': formatTwoDecimals(box.rotation),
      'data-opacity': formatTwoDecimals(box.opacity),
      style,
    };
    const shapeable = options.interactive && !clip.hidden && !options.lockedRows.has(clip.row_id);
    if (!shapeable) {
      inner.append(el('div', attributes, clip.kind === 'text' ? [el('span', { class: 'layer-text', text: clip.text ?? '' })] : []));
      continue;
    }
    const layer = el('button', { ...attributes, type: 'button', 'aria-label': `Layer ${clip.name}` }, [
      clip.kind === 'text' ? el('span', { class: 'layer-text', text: clip.text ?? '' }) : null,
    ]);
    for (const [handle, corner] of [
      ['nw', 'Top left'],
      ['ne', 'Top right'],
      ['se', 'Bottom right'],
      ['sw', 'Bottom left'],
    ] as const) {
      layer.append(
        el('button', {
          type: 'button',
          class: `handle handle-${handle}`,
          'data-handle': handle,
          'aria-label': `${corner} handle ${clip.name}`,
        }),
      );
    }
    inner.append(layer);
  }
  if (options.guide !== null) {
    inner.append(el('div', { class: `stage-guide guide-${options.guide}`, 'data-stage-guide': options.guide }));
  }
  return el(
    'section',
    {
      class: 'stage',
      role: 'region',
      'aria-label': 'Stage',
      'data-stage-mode': options.mode,
      'data-stage-frame': String(options.frame),
    },
    [inner],
  );
}
