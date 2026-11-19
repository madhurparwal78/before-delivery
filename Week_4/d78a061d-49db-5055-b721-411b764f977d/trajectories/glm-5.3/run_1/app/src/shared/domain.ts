/**
 * Shared domain rules used by both server and client.
 * Each rule lives in exactly one function here.
 */

export type Locale = 'en' | 'ja' | 'es';

export const locales: Locale[] = ['en', 'ja', 'es'];
export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'ja' || value === 'es';
}

export const localeNames: Record<Locale, string> = { en: 'English', ja: '日本語', es: 'Español' };

/** Grapheme-cluster counting used by every text limit and counter (DP-73). */
export function countChars(text: string): number {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
  let count = 0;
  for (const _ of segmenter.segment(trimmed)) count++;
  return count;
}

export function emailLooksValid(email: string): boolean {
  const at = email.indexOf('@');
  if (at <= 0) return false;
  const domain = email.slice(at + 1);
  const dot = domain.indexOf('.');
  return dot > 0 && dot < domain.length - 1;
}

/** Degree-to-radian pose rounding: half up, away from zero, 4 decimals (DP-67). */
export function degreesToRoundedRadians(degrees: number): number {
  const raw = (degrees * Math.PI) / 180;
  return roundHalfUpSigned(raw, 4);
}

export function radiansToDegrees(radians: number): number {
  return Math.round((radians * 180) / Math.PI);
}

export function roundHalfUpSigned(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  const scaled = value * factor;
  const rounded = scaled >= 0 ? Math.floor(scaled + 0.5) : -Math.floor(-scaled + 0.5);
  return rounded / factor;
}

/** The drawing-plane coordinate mapping (DP-68): CSS px from top-left -> metres from centre, y up. */
export function planePxToMetres(px: number, py: number, size: number): { x: number; y: number } {
  const half = size / 2;
  return { x: (px - half) / half, y: (half - py) / half };
}

export function metresToPlanePx(x: number, y: number, size: number): { px: number; py: number } {
  const half = size / 2;
  return { px: x * half + half, py: half - y * half };
}

export const PLANE_CSS_PX = 320;
export const PLANE_METRES = 2;
export const VERTEX_LIMIT = 12000;
export const STROKE_LIMIT = 24;
export const STROKE_MIN_POINTS = 2;
export const STROKE_MAX_POINTS = 200;
export const THICKNESS_MIN = 0.01;
export const THICKNESS_MAX = 0.08;
export const POINT_MIN = -1;
export const POINT_MAX = 1;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const MODEL_QUOTA_BYTES = 60 * 1024 * 1024;
export const CHAT_LIMIT = 280;
export const NAME_MIN = 3;
export const NAME_MAX = 20;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;
export const TICKS_PER_SECOND = 20;
export const MOVE_PER_TICK = 0.2;
export const PUDDLE_DAMAGE_PER_TICK = 0.5;
export const READY_CHECK_SECONDS = 20;
export const PARTY_MAX_MEMBERS = 4;
export const CHAT_WINDOW_SECONDS = 10;
export const CHAT_WINDOW_MESSAGES = 5;

export type Stroke = { thickness: number; points: [number, number][] };
export type Stats = { reach_m: number; weight_kg: number; swing_per_s: number };

/** The weapon stat formulas (DP-19), decided in this one function. */
export function deriveWeaponStats(strokes: Stroke[]): Stats {
  const grip = strokes[0]?.points[0];
  if (!grip) return { reach_m: 0, weight_kg: 0, swing_per_s: 0 };
  let reach = 0;
  let weight = 0;
  for (const stroke of strokes) {
    const r = stroke.thickness / 2;
    const points = stroke.points;
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      if (!point) continue;
      const d = Math.hypot(point[0] - grip[0], point[1] - grip[1]);
      if (d > reach) reach = d;
      if (i > 0) {
        const prev = points[i - 1];
        if (prev) {
          const len = Math.hypot(point[0] - prev[0], point[1] - prev[1]);
          weight += Math.PI * r * r * len * 2000;
        }
      }
    }
  }
  const swing = 3 / (1 + (weight * reach) / 2);
  return {
    reach_m: roundHalfUpSigned(reach, 2),
    weight_kg: roundHalfUpSigned(weight, 2),
    swing_per_s: roundHalfUpSigned(swing, 2),
  };
}

export function vertexCount(strokes: Stroke[]): number {
  return strokes.reduce((sum, s) => sum + s.points.length * 8, 0);
}

export interface LimitCheck {
  strokes: number;
  vertices: number;
  within_limits: boolean;
  over: ('strokes' | 'vertices')[];
}

export function drawingLimits(strokes: Stroke[]): LimitCheck {
  const vertices = vertexCount(strokes);
  const over: ('strokes' | 'vertices')[] = [];
  if (strokes.length > STROKE_LIMIT) over.push('strokes');
  if (vertices > VERTEX_LIMIT) over.push('vertices');
  return { strokes: strokes.length, vertices, within_limits: over.length === 0, over };
}

export type HeadPart = 'round' | 'square' | 'triangle';
export type TorsoPart = 'stick' | 'barrel' | 'kite';
export type ArmsPart = 'thin' | 'thick';
export type LegsPart = 'thin' | 'thick' | 'spring';
export type Material = 'graphite' | 'cobalt' | 'marker' | 'chalk' | 'brick' | 'moss';
export type HeadAccessory = 'none' | 'paper_crown' | 'beanie';
export type BackAccessory = 'none' | 'scarf' | 'satchel';
export type LeftHandAccessory = 'none' | 'lantern' | 'shield';

export type Proportions = {
  head_size: number; neck_length: number; spine_length: number;
  upper_arm_length: number; forearm_length: number; thigh_length: number; shin_length: number;
};

export type Pose = { right_arm_raise: number };

export const PROPORTION_KEYS: (keyof Proportions)[] = [
  'head_size', 'neck_length', 'spine_length', 'upper_arm_length',
  'forearm_length', 'thigh_length', 'shin_length',
];

export type CharacterBody = {
  name: string;
  parts: { head: HeadPart; torso: TorsoPart; arms: ArmsPart; legs: LegsPart };
  proportions: Proportions;
  pose: Pose;
  material: Material;
  accessories: { head: HeadAccessory; back: BackAccessory; left_hand: LeftHandAccessory };
};

export function proportionInRange(value: number): boolean {
  if (!Number.isFinite(value)) return false;
  return value >= 0.5 && value <= 1.5;
}

export function poseInRange(value: number): boolean {
  if (!Number.isFinite(value)) return false;
  return value >= -3.1416 && value <= 3.1416;
}

export const stories = [
  { id: 'lantern-road', mode: 'solo' as const, chapters: 3, title: { en: 'The Lantern Road', ja: '灯籠の道', es: 'El camino de los farolillos' } },
  { id: 'smudged-keep', mode: 'coop' as const, chapters: 2, title: { en: 'The Smudged Keep', ja: 'にじんだ砦', es: 'La fortaleza emborronada' } },
  { id: 'eraser-ferry', mode: 'coop' as const, chapters: 2, title: { en: 'The Eraser Ferry', ja: '消しゴムの渡し舟', es: 'El ferry de goma' } },
];

export function storyById(id: string) {
  return stories.find((s) => s.id === id);
}

/** The story layout every chapter uses, in one place. */
export const layout = {
  spawn: { x: 0, z: 0 },
  motes: [
    { id: 'm1', x: 4, z: 0 },
    { id: 'm2', x: 4, z: 4 },
    { id: 'm3', x: 0, z: 4 },
  ],
  checkpoint: { x: -4, z: 0 },
  gate: { x: 0, z: -8 },
  puddle: { x: -8, z: -8, radius: 2 },
  bounds: { min: -20, max: 20 },
  checkpointRadius: 1.5,
  pickupRadius: 1,
  gateRadius: 1,
};

export type SystemCode =
  | 'joined' | 'left' | 'leader' | 'ready_started' | 'ready_passed'
  | 'ready_failed' | 'dropped' | 'rejoined' | 'removed';

export const emotes = ['wave', 'cheer', 'bow', 'laugh', 'point', 'shrug'] as const;
export type Emote = (typeof emotes)[number];

export function isEmote(value: unknown): value is Emote {
  return typeof value === 'string' && (emotes as readonly string[]).includes(value);
}

export const rulebookVersion = '2026.11-r1';
export const validatorVersion = '2.0.0-dev.3.10';

export const humanoidBones = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
];

export const allowedExtensions = ['KHR_materials_unlit', 'KHR_texture_transform', 'KHR_materials_emissive_strength'];

export function sanitizeFilename(raw: string): string {
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {
    name = raw;
  }
  const lastSlash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  if (lastSlash !== -1) name = name.slice(lastSlash + 1);
  name = name.replace(/[^A-Za-z0-9.\-_]/g, '_');
  name = name.replace(/^\.+/, '');
  name = name.slice(0, 64);
  if (name === '') name = 'model.glb';
  else if (!/\.glb$/i.test(name)) name = `${name}.glb`;
  return name;
}

export function formatNumber(value: number, locale: Locale, decimals = 0): string {
  const tag = locale === 'ja' ? 'ja-JP' : locale === 'es' ? 'es-ES' : 'en-US';
  return new Intl.NumberFormat(tag, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
