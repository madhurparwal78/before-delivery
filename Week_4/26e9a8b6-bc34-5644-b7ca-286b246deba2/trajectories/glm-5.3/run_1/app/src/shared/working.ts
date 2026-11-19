// Field paths of the working copy, with their value shapes and ranges.
// One place decides what a commit may contain; the editor builds paths with these helpers.

import { isPhase, type Phase } from './phase';
import { isCurrency, type CurrencyCode } from './cost';

export type Axis = 'x' | 'y' | 'z';
export const AXES: Axis[] = ['x', 'y', 'z'];

export interface Camera {
  yaw: number;
  pitch: number;
  zoom: number;
}

export interface Callout {
  part_id: string;
  text: string;
}

export type FieldPath =
  | 'title'
  | 'currency'
  | 'tags'
  | 'visibility'
  | 'model_scale'
  | 'model_scale_confirmed'
  | `step/${string}/title`
  | `step/${string}/text`
  | `step/${string}/phase`
  | `step/${string}/explode`
  | `step/${string}/focus_parts`
  | `step/${string}/camera`
  | `step/${string}/callouts`
  | `part/${string}/name`
  | `part/${string}/axis`
  | `part/${string}/apart_mm`
  | `part/${string}/quantity`
  | `part/${string}/unit_price`
  | `part/${string}/fitted_at`
  | `part/${string}/node_path`;

export function parseFieldPath(path: string): { kind: 'guide' | 'step' | 'part'; field: string; id?: string } {
  if (path.startsWith('step/')) {
    const rest = path.slice('step/'.length);
    const slash = rest.indexOf('/');
    return slash === -1 ? { kind: 'guide', field: path } : { kind: 'step', id: rest.slice(0, slash), field: rest.slice(slash + 1) };
  }
  if (path.startsWith('part/')) {
    const rest = path.slice('part/'.length);
    const slash = rest.indexOf('/');
    return slash === -1 ? { kind: 'guide', field: path } : { kind: 'part', id: rest.slice(0, slash), field: rest.slice(slash + 1) };
  }
  return { kind: 'guide', field: path };
}

export interface FieldValueCheck {
  valid: boolean;
  range?: 'too_long' | 'too_many' | 'invalid';
}

/** Shape and range of a committed value, independent of text limits checked in the editor. */
export function checkFieldValue(path: FieldPath, value: unknown): FieldValueCheck {
  const parsed = parseFieldPath(path);
  const field = parsed.field;
  const isText = field === 'title' || field === 'text' || field === 'name';
  if (isText) return { valid: typeof value === 'string' };
  if (field === 'currency') return { valid: isCurrency(value) };
  if (field === 'tags') {
    if (!Array.isArray(value)) return { valid: false, range: 'invalid' };
    return { valid: value.every((tag) => typeof tag === 'string') };
  }
  if (field === 'visibility') return { valid: value === 'public' || value === 'private' };
  if (field === 'model_scale') return { valid: typeof value === 'number' && Number.isFinite(value) && value > 0 };
  if (field === 'model_scale_confirmed') return { valid: typeof value === 'boolean' };
  if (field === 'phase') return { valid: isPhase(value) };
  if (field === 'explode') return { valid: typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 };
  if (field === 'focus_parts') {
    if (!Array.isArray(value)) return { valid: false, range: 'invalid' };
    return { valid: value.every((id) => typeof id === 'string') };
  }
  if (field === 'camera') {
    if (typeof value !== 'object' || value === null) return { valid: false, range: 'invalid' };
    const c = value as Record<string, unknown>;
    const yawOk = typeof c.yaw === 'number' && Number.isFinite(c.yaw) && c.yaw >= -180 && c.yaw <= 180;
    const pitchOk = typeof c.pitch === 'number' && Number.isFinite(c.pitch) && c.pitch >= -60 && c.pitch <= 60;
    const zoomOk = typeof c.zoom === 'number' && Number.isFinite(c.zoom) && c.zoom >= 0.5 && c.zoom <= 3;
    return { valid: yawOk && pitchOk && zoomOk };
  }
  if (field === 'callouts') {
    if (!Array.isArray(value)) return { valid: false, range: 'invalid' };
    return {
      valid: value.every(
        (item) =>
          typeof item === 'object' && item !== null &&
          typeof (item as Record<string, unknown>).part_id === 'string' &&
          typeof (item as Record<string, unknown>).text === 'string',
      ),
    };
  }
  if (field === 'axis') return { valid: value === 'x' || value === 'y' || value === 'z' };
  if (field === 'apart_mm') return { valid: typeof value === 'number' && Number.isFinite(value) };
  if (field === 'quantity') return { valid: typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 999 };
  if (field === 'unit_price') return { valid: typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 99999999 };
  if (field === 'fitted_at') return { valid: value === null || typeof value === 'string' };
  if (field === 'node_path') return { valid: typeof value === 'string' };
  return { valid: false, range: 'invalid' };
}

export type Visibility = 'public' | 'private';

export interface WorkingStep {
  id: string;
  number: number;
  title: string;
  text: string;
  phase: Phase;
  explode: number;
  focus_parts: string[];
  camera: Camera;
  callouts: Callout[];
}

export interface WorkingPart {
  id: string;
  name: string;
  node_path: string;
  unbound: boolean;
  axis: Axis;
  apart_mm: number;
  quantity: number;
  unit_price: number;
  fitted_at: string | null;
}

export interface WorkingModel {
  id: string;
  state: 'stored';
  bytes: number;
  sha256: string;
  bbox_mm: [number, number, number];
  scale: number;
  scale_confirmed: boolean;
}

export interface ForkSource {
  guide_id: string;
  title: string;
  author_name: string;
  version: number;
}

export interface WorkingJson {
  id: string;
  slug: string;
  title: string;
  state: 'draft' | 'published' | 'withdrawn';
  visibility: Visibility;
  currency: CurrencyCode;
  tags: string[];
  revision: number;
  latest_version: number | null;
  guide_total: number;
  guide_total_text: string;
  field_revisions: Record<string, number>;
  model: WorkingModel | null;
  parts: WorkingPart[];
  steps: WorkingStep[];
  forked_from: ForkSource | null;
}

/** The running cost at a step: parts fitted at or before it, counted once. */
export function runningCostAt(steps: WorkingStep[], parts: WorkingPart[], stepId: string | null): number {
  const fitIndex = new Map<string, number>();
  steps.forEach((step, index) => fitIndex.set(step.id, index));
  const limit = stepId === null ? steps.length : (fitIndex.get(stepId) ?? -1);
  let total = 0;
  for (const part of parts) {
    if (part.fitted_at === null) continue;
    const at = fitIndex.get(part.fitted_at);
    if (at === undefined || at > limit) continue;
    total += part.quantity * part.unit_price;
  }
  return total;
}

export function guideTotal(steps: WorkingStep[], parts: WorkingPart[]): number {
  return runningCostAt(steps, parts, steps.length > 0 ? steps[steps.length - 1].id : null);
}
