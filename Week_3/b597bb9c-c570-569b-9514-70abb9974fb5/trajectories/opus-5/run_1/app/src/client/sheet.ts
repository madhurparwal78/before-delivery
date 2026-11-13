/** Procedural frames: a marker frame's layer boxes drawn at their computed positions. */
import { checksumColour, layersAtFrame, type LayerClip } from '../domain/layers.js';
import { exactRate, timecode, type FrameRateName } from '../domain/rate.js';
import { FRAME_SIZES, type CaptionRecord, type ClipRecord, type LayerBox, type MediaRecord, type ProjectRecord, type RowRecord } from '../shared/types.js';
import type { LayerBase } from '../domain/layers.js';
import { el } from './dom.js';

export interface ProjectDetail {
  project: ProjectRecord;
  rows: RowRecord[];
  clips: (ClipRecord & { base: LayerBase })[];
  captions: CaptionRecord[];
  members?: { person: { id: string; name: string; handle: string }; role: string }[];
}

export type MediaIndex = Map<string, MediaRecord>;

export function layerClips(detail: ProjectDetail, media: MediaIndex): LayerClip[] {
  return detail.clips.map((clip) => {
    const info = clip.media_id === null ? undefined : media.get(clip.media_id);
    return { ...clip, media_width: info?.width ?? null, media_height: info?.height ?? null };
  });
}

export function boxesAt(detail: ProjectDetail, media: MediaIndex, frame: number): LayerBox[] {
  return layersAtFrame(layerClips(detail, media), detail.rows, frame, detail.project.aspect_ratio);
}

/** A box's colour is the first six hexadecimal digits of its media checksum. */
export function boxColour(clip: ClipRecord, media: MediaIndex): string {
  if (clip.kind === 'text') return `#${clip.box_colour ?? '000000'}`;
  const info = clip.media_id === null ? undefined : media.get(clip.media_id);
  return info === undefined ? 'var(--surface)' : checksumColour(info.sha256);
}

export function frameTimecode(project: ProjectRecord, frame: number): string {
  return timecode(frame, exactRate(project.frame_rate as FrameRateName));
}

export interface FrameOptions {
  width?: string;
  label?: string;
}

export function procedualFrame(
  detail: ProjectDetail,
  media: MediaIndex,
  frame: number,
  options: FrameOptions = {},
): HTMLElement {
  const size = FRAME_SIZES[detail.project.aspect_ratio];
  const boxes = boxesAt(detail, media, frame);
  const frameNode = el('div', {
    class: 'sheet-frame',
    role: 'img',
    'aria-label': options.label ?? `${detail.project.title} at ${frameTimecode(detail.project, frame)}`,
    'data-sheet-frame': frame,
    'data-project-id': detail.project.id,
    style: `aspect-ratio: ${size.width} / ${size.height}; ${options.width === undefined ? '' : `width:${options.width};`}`,
  });
  for (const box of boxes) {
    const clip = detail.clips.find((candidate) => candidate.id === box.clip_id);
    if (clip === undefined) continue;
    frameNode.append(
      el('span', {
        class: 'sheet-box',
        'data-box-clip': clip.id,
        style: [
          `left:${((box.x - box.width / 2) / size.width) * 100}%`,
          `top:${((box.y - box.height / 2) / size.height) * 100}%`,
          `width:${(box.width / size.width) * 100}%`,
          `height:${(box.height / size.height) * 100}%`,
          `background:${boxColour(clip, media)}`,
          `opacity:${box.opacity / 100}`,
          box.rotation === 0 ? '' : `transform: rotate(${box.rotation}deg)`,
        ]
          .filter((part) => part !== '')
          .join(';'),
      }),
    );
  }
  return frameNode;
}

export async function loadMediaIndex(allowed: boolean): Promise<MediaIndex> {
  if (!allowed) return new Map();
  const { get } = await import('./api.js');
  try {
    const page = await get<{ items: MediaRecord[] }>('/api/media?limit=100');
    return new Map(page.items.map((item) => [item.id, item]));
  } catch {
    return new Map();
  }
}
