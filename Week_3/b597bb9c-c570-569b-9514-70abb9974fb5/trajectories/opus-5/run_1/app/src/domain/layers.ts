/**
 * Keyframe interpolation and the layer box rule. The frame endpoint, the stage,
 * the Inspector and the Frame Loupe all read values from here.
 */
import type { AspectRatio, ClipRecord, Keyframe, KeyframeProperty, LayerBox, RowRecord } from '../shared/types.js';
import { FRAME_SIZES, KEYFRAME_PROPERTIES } from '../shared/types.js';

export interface LayerBase {
  x: number | null;
  y: number | null;
  scale: number | null;
  rotation: number | null;
  opacity: number | null;
}

export interface LayerClip extends ClipRecord {
  base: LayerBase;
  media_width?: number | null;
  media_height?: number | null;
}

export const PROPERTY_RANGES: Record<KeyframeProperty, { min: number; max: number }> = {
  x: { min: -10000, max: 10000 },
  y: { min: -10000, max: 10000 },
  scale: { min: 1, max: 1000 },
  rotation: { min: -3600, max: 3600 },
  opacity: { min: 0, max: 100 },
};

export function isKeyframeProperty(value: unknown): value is KeyframeProperty {
  return typeof value === 'string' && (KEYFRAME_PROPERTIES as readonly string[]).includes(value);
}

/** Two decimals, halves away from zero. A value within one millionth of a half counts as a half. */
export function round2(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const scaled = Math.abs(value) * 100;
  const floor = Math.floor(scaled);
  const fraction = scaled - floor;
  const whole = Math.abs(fraction - 0.5) <= 1e-6 ? floor + 1 : Math.round(scaled);
  return (sign * whole) / 100;
}

export function formatTwoDecimals(value: number): string {
  return round2(value).toFixed(2);
}

function easing(t: number, curve: Keyframe['curve']): number {
  return curve === 'eased' ? t * t * (3 - 2 * t) : t;
}

export function defaultBaseValue(property: KeyframeProperty, aspect: AspectRatio): number {
  const size = FRAME_SIZES[aspect];
  switch (property) {
    case 'x':
      return size.width / 2;
    case 'y':
      return size.height / 2;
    case 'scale':
      return 100;
    case 'rotation':
      return 0;
    case 'opacity':
      return 100;
  }
}

export function baseValue(clip: LayerClip, property: KeyframeProperty, aspect: AspectRatio): number {
  const stored = clip.base[property];
  return stored === null || stored === undefined ? defaultBaseValue(property, aspect) : stored;
}

export function sortedKeyframes(clip: LayerClip, property: KeyframeProperty): Keyframe[] {
  const list = clip.keyframes[property] ?? [];
  return [...list].sort((a, b) => a.frame - b.frame);
}

/**
 * The value of one property at a frame counted from the clip's own start.
 * Rounded to two decimals by the shared rule.
 */
export function valueAt(clip: LayerClip, property: KeyframeProperty, clipFrame: number, aspect: AspectRatio): number {
  const diamonds = sortedKeyframes(clip, property);
  if (diamonds.length === 0) return round2(baseValue(clip, property, aspect));
  if (clipFrame <= diamonds[0].frame) return round2(diamonds[0].value);
  const last = diamonds[diamonds.length - 1];
  if (clipFrame >= last.frame) return round2(last.value);
  let left = diamonds[0];
  let right = last;
  for (let i = 0; i < diamonds.length - 1; i += 1) {
    if (clipFrame >= diamonds[i].frame && clipFrame <= diamonds[i + 1].frame) {
      left = diamonds[i];
      right = diamonds[i + 1];
      break;
    }
  }
  const span = right.frame - left.frame;
  const t = span === 0 ? 0 : (clipFrame - left.frame) / span;
  return round2(left.value + (right.value - left.value) * easing(t, left.curve));
}

/** The media's natural size fitted inside the project frame without cropping. */
export function fittedBox(
  clip: LayerClip,
  aspect: AspectRatio,
): { width: number; height: number } {
  const frame = FRAME_SIZES[aspect];
  if (clip.kind === 'text') {
    return { width: frame.width * 0.6, height: frame.height * 0.12 };
  }
  const naturalWidth = clip.media_width ?? frame.width;
  const naturalHeight = clip.media_height ?? frame.height;
  const factor = Math.min(frame.width / naturalWidth, frame.height / naturalHeight);
  return { width: naturalWidth * factor, height: naturalHeight * factor };
}

export function layerAtFrame(clip: LayerClip, timelineFrame: number, aspect: AspectRatio): LayerBox {
  const clipFrame = timelineFrame - clip.start_frame;
  const scale = valueAt(clip, 'scale', clipFrame, aspect);
  const fitted = fittedBox(clip, aspect);
  return {
    clip_id: clip.id,
    row_id: clip.row_id,
    x: valueAt(clip, 'x', clipFrame, aspect),
    y: valueAt(clip, 'y', clipFrame, aspect),
    width: round2((fitted.width * scale) / 100),
    height: round2((fitted.height * scale) / 100),
    scale,
    rotation: valueAt(clip, 'rotation', clipFrame, aspect),
    opacity: valueAt(clip, 'opacity', clipFrame, aspect),
  };
}

/** Drawn layers at a frame, back to front. Position 1 is the top of the stack and is drawn frontmost. */
export function layersAtFrame(
  clips: LayerClip[],
  rows: RowRecord[],
  timelineFrame: number,
  aspect: AspectRatio,
): LayerBox[] {
  const position = new Map(rows.map((row) => [row.id, row]));
  const drawn = clips.filter((clip) => {
    const row = position.get(clip.row_id);
    if (!row || row.kind !== 'video') return false;
    if (clip.hidden) return false;
    return timelineFrame >= clip.start_frame && timelineFrame < clip.end_frame;
  });
  drawn.sort((a, b) => {
    const pa = position.get(a.row_id)?.position ?? 0;
    const pb = position.get(b.row_id)?.position ?? 0;
    if (pa !== pb) return pb - pa;
    return a.start_frame - b.start_frame || a.id.localeCompare(b.id);
  });
  return drawn.map((clip) => layerAtFrame(clip, timelineFrame, aspect));
}

/** The checksum colour: the first six hexadecimal digits of a media checksum. */
export function checksumColour(sha256: string | null | undefined): string {
  return `#${(sha256 ?? '000000000000').slice(0, 6)}`;
}

