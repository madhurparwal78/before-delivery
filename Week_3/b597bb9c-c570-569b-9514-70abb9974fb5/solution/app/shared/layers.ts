import { interpolate, round2, type Property } from "./keyframes";
import { ASPECTS, type AspectRatio, type Clip, type MediaDims, type Row } from "./types";

export interface LayerBox {
  clip_id: string;
  row_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  rotation: number;
  opacity: number;
}

interface FrameSize {
  width: number;
  height: number;
}

export function frameSize(aspect: AspectRatio): FrameSize {
  return ASPECTS[aspect];
}

function defaultValue(property: Property, size: FrameSize): number {
  switch (property) {
    case "x":
      return size.width / 2;
    case "y":
      return size.height / 2;
    case "scale":
      return 100;
    case "rotation":
      return 0;
    case "opacity":
      return 100;
  }
}

/** Unrounded value of a property at a project frame: diamonds, else the base value, else the default. */
function propertyValue(clip: Clip, property: Property, frame: number, size: FrameSize): number {
  return interpolate(clip.keyframes[property], frame - clip.start_frame) ?? clip.base[property] ?? defaultValue(property, size);
}

/** The one published value rule, rounded to two decimals. */
export function shownValue(clip: Clip, property: Property, frame: number, size: FrameSize): number {
  return round2(propertyValue(clip, property, frame, size));
}

function baseBox(clip: Clip, media: Record<string, MediaDims>, size: FrameSize): { width: number; height: number } | null {
  if (clip.kind === "text") return { width: size.width * 0.6, height: size.height * 0.12 };
  if (clip.kind === "wav" || !clip.media_id) return null;
  const dims = media[clip.media_id];
  if (!dims?.width || !dims.height) return null;
  const fit = Math.min(size.width / dims.width, size.height / dims.height);
  return { width: dims.width * fit, height: dims.height * fit };
}

function layerOf(clip: Clip, frame: number, media: Record<string, MediaDims>, size: FrameSize): LayerBox | null {
  const box = baseBox(clip, media, size);
  if (!box) return null;
  const scale = propertyValue(clip, "scale", frame, size);
  return {
    clip_id: clip.id,
    row_id: clip.row_id,
    x: shownValue(clip, "x", frame, size),
    y: shownValue(clip, "y", frame, size),
    width: round2((box.width * scale) / 100),
    height: round2((box.height * scale) / 100),
    scale: round2(scale),
    rotation: shownValue(clip, "rotation", frame, size),
    opacity: shownValue(clip, "opacity", frame, size),
  };
}

/** Drawn layers at a project frame, back to front (row position 1 is frontmost). */
export function layersAt(
  frame: number,
  clips: readonly Clip[],
  rows: readonly Row[],
  media: Record<string, MediaDims>,
  size: FrameSize,
): LayerBox[] {
  const position = new Map(rows.map((row) => [row.id, row.position]));
  return clips
    .filter((clip) => !clip.hidden && clip.start_frame <= frame && frame < clip.end_frame)
    .sort((a, b) => (position.get(b.row_id) ?? 0) - (position.get(a.row_id) ?? 0))
    .flatMap((clip) => layerOf(clip, frame, media, size) ?? []);
}
