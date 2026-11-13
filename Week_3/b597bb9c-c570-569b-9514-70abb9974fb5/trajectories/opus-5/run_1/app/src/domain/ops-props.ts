/**
 * Property ops: keyframes, shaping a layer, changing the frame and brand kits.
 */
import { baseValue, isKeyframeProperty, PROPERTY_RANGES, round2 } from './layers.js';
import { roundRational } from './rate.js';
import { findClip, requireUnlockedRow, type EngineContext } from './timeline-state.js';
import { invalid, readChoice, readNumber, readString, readWhole } from './validate.js';
import { FRAME_SIZES, isAspectRatio, type Curve, type Keyframe, type KeyframeProperty } from '../shared/types.js';
import type { ApplyOutcome } from './ops-clips.js';

function diamonds(clip: { keyframes: Record<string, Keyframe[] | undefined> }, property: KeyframeProperty): Keyframe[] {
  return clip.keyframes[property] ?? [];
}

function writeDiamonds(
  clip: { keyframes: Record<string, Keyframe[] | undefined> },
  property: KeyframeProperty,
  list: Keyframe[],
): void {
  if (list.length === 0) delete clip.keyframes[property];
  else clip.keyframes[property] = [...list].sort((a, b) => a.frame - b.frame);
}

function readProperty(op: Record<string, unknown>): KeyframeProperty {
  const property = op.property;
  if (!isKeyframeProperty(property)) throw invalid('property');
  return property;
}

export function setKeyframe(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const clip = findClip(ctx.state, op.clip_id);
  requireUnlockedRow(ctx.state, clip.row_id);
  const property = readProperty(op);
  const range = PROPERTY_RANGES[property];
  const frame = readWhole(op, 'frame', { min: 0, max: clip.end_frame - clip.start_frame });
  const value = round2(readNumber(op, 'value', range));
  const curve = readChoice(op, 'curve', ['linear', 'eased'] as const);
  const list = diamonds(clip, property);
  const existing = list.find((diamond) => diamond.frame === frame) ?? null;
  const previous = existing === null ? null : { ...existing };
  writeDiamonds(clip, property, [...list.filter((diamond) => diamond.frame !== frame), { frame, value, curve }]);
  return {
    stopped: null,
    inverse: { type: 'restore_keyframe', clip_id: clip.id, property, frame, previous },
  };
}

export function removeKeyframe(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const clip = findClip(ctx.state, op.clip_id);
  requireUnlockedRow(ctx.state, clip.row_id);
  const property = readProperty(op);
  const frame = readWhole(op, 'frame', { min: 0 });
  const list = diamonds(clip, property);
  const existing = list.find((diamond) => diamond.frame === frame) ?? null;
  if (existing === null) throw invalid('frame');
  writeDiamonds(clip, property, list.filter((diamond) => diamond.frame !== frame));
  return {
    stopped: null,
    inverse: { type: 'restore_keyframe', clip_id: clip.id, property, frame, previous: { ...existing } },
  };
}

export function restoreKeyframe(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const clip = findClip(ctx.state, op.clip_id);
  const property = readProperty(op);
  const frame = readWhole(op, 'frame', { min: 0 });
  const previous = op.previous === null ? null : (op.previous as Keyframe);
  const list = diamonds(clip, property);
  const current = list.find((diamond) => diamond.frame === frame) ?? null;
  const kept = list.filter((diamond) => diamond.frame !== frame);
  writeDiamonds(clip, property, previous === null ? kept : [...kept, previous]);
  return {
    stopped: null,
    inverse: { type: 'restore_keyframe', clip_id: clip.id, property, frame, previous: current },
  };
}

const LAYER_PROPERTIES: readonly KeyframeProperty[] = ['x', 'y', 'scale'];

interface LayerPrevious {
  property: KeyframeProperty;
  had_diamonds: boolean;
  base: number | null;
  diamond: Keyframe | null;
}

/**
 * set_layer sets the base value when a property has no diamond, and otherwise
 * takes a diamond at that frame with the linear curve.
 */
export function setLayer(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const clip = findClip(ctx.state, op.clip_id);
  requireUnlockedRow(ctx.state, clip.row_id);
  const length = clip.end_frame - clip.start_frame;
  const frame = readWhole(op, 'frame', { min: 0, max: length - 1 });
  const given = LAYER_PROPERTIES.filter((property) => op[property] !== undefined);
  if (given.length === 0) throw invalid('value');
  const previous: LayerPrevious[] = [];
  for (const property of given) {
    const range = PROPERTY_RANGES[property];
    const raw = readNumber(op, property, range);
    const value = property === 'scale' ? round2(raw) : roundRational(BigInt(Math.round(raw * 1000000)), 1000000n);
    const list = diamonds(clip, property);
    if (list.length === 0) {
      previous.push({ property, had_diamonds: false, base: clip.base[property], diamond: null });
      clip.base[property] = value;
    } else {
      const existing = list.find((diamond) => diamond.frame === frame) ?? null;
      previous.push({ property, had_diamonds: true, base: clip.base[property], diamond: existing === null ? null : { ...existing } });
      const curve: Curve = existing?.curve ?? 'linear';
      writeDiamonds(clip, property, [...list.filter((diamond) => diamond.frame !== frame), { frame, value, curve }]);
    }
  }
  return { stopped: null, inverse: { type: 'restore_layer', clip_id: clip.id, frame, previous } };
}

export function restoreLayer(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const clip = findClip(ctx.state, op.clip_id);
  const frame = readWhole(op, 'frame', { min: 0 });
  const entries = op.previous as LayerPrevious[];
  const current: LayerPrevious[] = [];
  for (const entry of entries) {
    const list = diamonds(clip, entry.property);
    const existing = list.find((diamond) => diamond.frame === frame) ?? null;
    current.push({
      property: entry.property,
      had_diamonds: list.length > 0,
      base: clip.base[entry.property],
      diamond: existing === null ? null : { ...existing },
    });
    if (entry.had_diamonds) {
      const kept = list.filter((diamond) => diamond.frame !== frame);
      writeDiamonds(clip, entry.property, entry.diamond === null ? kept : [...kept, entry.diamond]);
    } else {
      clip.base[entry.property] = entry.base;
    }
  }
  return { stopped: null, inverse: { type: 'restore_layer', clip_id: clip.id, frame, previous: current } };
}

interface AspectPrevious {
  clip_id: string;
  base_x: number | null;
  base_y: number | null;
  keyframes_x: Keyframe[] | null;
  keyframes_y: Keyframe[] | null;
}

function convert(value: number, from: number, to: number): number {
  const scaled = Math.round(value * 1000000);
  return roundRational(BigInt(scaled) * BigInt(to), BigInt(from) * 1000000n);
}

/** Changing the frame converts every layer position and position keyframe by the fit rule. */
export function setAspect(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const aspect = op.aspect_ratio;
  if (!isAspectRatio(aspect)) throw invalid('aspect_ratio');
  const from = FRAME_SIZES[ctx.state.project.aspect_ratio];
  const to = FRAME_SIZES[aspect];
  const previousAspect = ctx.state.project.aspect_ratio;
  const previous: AspectPrevious[] = [];
  for (const clip of ctx.state.clips) {
    previous.push({
      clip_id: clip.id,
      base_x: clip.base.x,
      base_y: clip.base.y,
      keyframes_x: clip.keyframes.x ? structuredClone(clip.keyframes.x) : null,
      keyframes_y: clip.keyframes.y ? structuredClone(clip.keyframes.y) : null,
    });
    const baseX = baseValue({ ...clip, media_width: null, media_height: null }, 'x', previousAspect);
    const baseY = baseValue({ ...clip, media_width: null, media_height: null }, 'y', previousAspect);
    clip.base.x = convert(baseX, from.width, to.width);
    clip.base.y = convert(baseY, from.height, to.height);
    if (clip.keyframes.x) {
      clip.keyframes.x = clip.keyframes.x.map((diamond) => ({
        ...diamond,
        value: convert(diamond.value, from.width, to.width),
      }));
    }
    if (clip.keyframes.y) {
      clip.keyframes.y = clip.keyframes.y.map((diamond) => ({
        ...diamond,
        value: convert(diamond.value, from.height, to.height),
      }));
    }
  }
  ctx.state.project.aspect_ratio = aspect;
  return {
    stopped: null,
    inverse: { type: 'restore_aspect', aspect_ratio: previousAspect, layers: previous },
  };
}

export function restoreAspect(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const aspect = op.aspect_ratio;
  if (!isAspectRatio(aspect)) throw invalid('aspect_ratio');
  const current: AspectPrevious[] = [];
  const currentAspect = ctx.state.project.aspect_ratio;
  const entries = op.layers as AspectPrevious[];
  for (const entry of entries) {
    const clip = ctx.state.clips.find((candidate) => candidate.id === entry.clip_id);
    if (!clip) continue;
    current.push({
      clip_id: clip.id,
      base_x: clip.base.x,
      base_y: clip.base.y,
      keyframes_x: clip.keyframes.x ? structuredClone(clip.keyframes.x) : null,
      keyframes_y: clip.keyframes.y ? structuredClone(clip.keyframes.y) : null,
    });
    clip.base.x = entry.base_x;
    clip.base.y = entry.base_y;
    if (entry.keyframes_x === null) delete clip.keyframes.x;
    else clip.keyframes.x = entry.keyframes_x;
    if (entry.keyframes_y === null) delete clip.keyframes.y;
    else clip.keyframes.y = entry.keyframes_y;
  }
  ctx.state.project.aspect_ratio = aspect;
  return { stopped: null, inverse: { type: 'restore_aspect', aspect_ratio: currentAspect, layers: current } };
}

interface TextStyle {
  clip_id: string;
  text_colour: string | null;
  box_colour: string | null;
  font_weight: number | null;
}

/** Applying a brand kit copies its colours and weight into every text clip, in one op. */
export function applyKit(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const kitId = readString(op, 'kit_id');
  const kit = ctx.kits.get(kitId);
  if (!kit) throw invalid('kit_id');
  const previous: TextStyle[] = [];
  for (const clip of ctx.state.clips) {
    if (clip.kind !== 'text') continue;
    requireUnlockedRow(ctx.state, clip.row_id);
    previous.push({
      clip_id: clip.id,
      text_colour: clip.text_colour,
      box_colour: clip.box_colour,
      font_weight: clip.font_weight,
    });
    clip.text_colour = kit.text_colour;
    clip.box_colour = kit.box_colour;
    clip.font_weight = kit.font_weight;
  }
  return { stopped: null, inverse: { type: 'restore_text_styles', styles: previous } };
}

export function restoreTextStyles(ctx: EngineContext, op: Record<string, unknown>): ApplyOutcome {
  const entries = op.styles as TextStyle[];
  const current: TextStyle[] = [];
  for (const entry of entries) {
    const clip = ctx.state.clips.find((candidate) => candidate.id === entry.clip_id);
    if (!clip) continue;
    current.push({
      clip_id: clip.id,
      text_colour: clip.text_colour,
      box_colour: clip.box_colour,
      font_weight: clip.font_weight,
    });
    clip.text_colour = entry.text_colour;
    clip.box_colour = entry.box_colour;
    clip.font_weight = entry.font_weight;
  }
  return { stopped: null, inverse: { type: 'restore_text_styles', styles: current } };
}


