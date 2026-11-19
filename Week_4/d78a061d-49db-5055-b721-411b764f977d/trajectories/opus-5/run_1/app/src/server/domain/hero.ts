import { errors } from '../errors.js';
import {
  POSE_MAX_RAD,
  POSE_MIN_RAD,
  PROPORTION_MAX,
  PROPORTION_MIN,
  PROPORTION_STEP,
  NAME_MAX,
  NAME_MIN,
} from '../../shared/constants.js';
import { graphemeLength } from '../../shared/text.js';
import { roundHalfAway } from '../../shared/pose.js';
import {
  PROPORTION_KEYS,
  type Accessories,
  type Character,
  type MaterialName,
  type Parts,
  type Proportions,
} from '../../shared/types.js';

export const HEAD_PARTS = ['round', 'square', 'triangle'] as const;
export const TORSO_PARTS = ['stick', 'barrel', 'kite'] as const;
export const ARMS_PARTS = ['thin', 'thick'] as const;
export const LEGS_PARTS = ['thin', 'thick', 'spring'] as const;
export const MATERIALS = ['graphite', 'cobalt', 'marker', 'chalk', 'brick', 'moss'] as const;
export const HEAD_ACCESSORIES = ['none', 'paper_crown', 'beanie'] as const;
export const BACK_ACCESSORIES = ['none', 'scarf', 'satchel'] as const;
export const LEFT_HAND_ACCESSORIES = ['none', 'lantern', 'shield'] as const;

export const DEFAULT_PARTS: Parts = { head: 'round', torso: 'stick', arms: 'thin', legs: 'thin' };
export const DEFAULT_PROPORTIONS: Proportions = {
  head_size: 1,
  neck_length: 1,
  spine_length: 1,
  upper_arm_length: 1,
  forearm_length: 1,
  thigh_length: 1,
  shin_length: 1,
};
export const DEFAULT_ACCESSORIES: Accessories = { head: 'none', back: 'none', left_hand: 'none' };
export const DEFAULT_MATERIAL: MaterialName = 'graphite';

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

export interface HeroInput {
  revision: number | null;
  name: string;
  parts: Parts;
  proportions: Proportions;
  pose: { right_arm_raise: number };
  material: MaterialName;
  accessories: Accessories;
  model_id: string | null;
  weapon_id: string | null;
}

export function parseHeroInput(body: unknown): HeroInput {
  const root = record(body);
  if (!root) throw errors.invalidField('name', { key: 'fb.heroNameLimit' });

  const revisionRaw = root.revision ?? null;
  if (revisionRaw !== null && !Number.isInteger(revisionRaw)) {
    throw errors.invalidField('revision', { key: 'fb.generic' });
  }

  const nameRaw = typeof root.name === 'string' ? root.name.trim() : '';
  const nameLength = graphemeLength(nameRaw);
  if (nameLength < NAME_MIN || nameLength > NAME_MAX) {
    throw errors.invalidField('name', { key: 'fb.heroNameLimit' });
  }

  const partsRaw = record(root.parts);
  const head = pickEnum(partsRaw?.head, HEAD_PARTS);
  const torso = pickEnum(partsRaw?.torso, TORSO_PARTS);
  const arms = pickEnum(partsRaw?.arms, ARMS_PARTS);
  const legs = pickEnum(partsRaw?.legs, LEGS_PARTS);
  if (!head || !torso || !arms || !legs) {
    throw errors.invalidField('parts', { key: 'fb.generic' });
  }

  const proportionsRaw = record(root.proportions);
  const proportions = {} as Proportions;
  for (const key of PROPORTION_KEYS) {
    const value = proportionsRaw?.[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw errors.invalidField('proportions', { key: 'fb.heroPose' });
    }
    if (value < PROPORTION_MIN || value > PROPORTION_MAX) {
      throw errors.invalidField('proportions', { key: 'fb.heroPose' });
    }
    const steps = value / PROPORTION_STEP;
    if (Math.abs(steps - Math.round(steps)) > 1e-6) {
      throw errors.invalidField('proportions', { key: 'fb.heroPose' });
    }
    proportions[key] = roundHalfAway(value, 2);
  }

  const poseRaw = record(root.pose);
  const raiseRaw = poseRaw === null ? 0 : poseRaw.right_arm_raise;
  if (typeof raiseRaw !== 'number' || !Number.isFinite(raiseRaw)) {
    throw errors.invalidField('pose', { key: 'fb.heroPose' });
  }
  if (raiseRaw < POSE_MIN_RAD || raiseRaw > POSE_MAX_RAD) {
    throw errors.invalidField('pose', { key: 'fb.heroPose' });
  }

  const material = pickEnum(root.material, MATERIALS);
  if (!material) throw errors.invalidField('material', { key: 'fb.generic' });

  const accessoriesRaw = record(root.accessories);
  const headAccessory = pickEnum(accessoriesRaw?.head, HEAD_ACCESSORIES);
  const backAccessory = pickEnum(accessoriesRaw?.back, BACK_ACCESSORIES);
  const leftHandAccessory = pickEnum(accessoriesRaw?.left_hand, LEFT_HAND_ACCESSORIES);
  if (!headAccessory || !backAccessory || !leftHandAccessory) {
    throw errors.invalidField('accessories', { key: 'fb.generic' });
  }

  const modelId = root.model_id ?? null;
  const weaponId = root.weapon_id ?? null;
  if (modelId !== null && typeof modelId !== 'string') {
    throw errors.invalidField('model_id', { key: 'fb.generic' });
  }
  if (weaponId !== null && typeof weaponId !== 'string') {
    throw errors.invalidField('weapon_id', { key: 'fb.generic' });
  }

  return {
    revision: revisionRaw as number | null,
    name: nameRaw,
    parts: { head, torso, arms, legs },
    proportions,
    pose: { right_arm_raise: roundHalfAway(raiseRaw, 4) },
    material,
    accessories: { head: headAccessory, back: backAccessory, left_hand: leftHandAccessory },
    model_id: modelId,
    weapon_id: weaponId,
  };
}

export interface CharacterRow {
  id: string;
  slot: number;
  revision: number;
  name: string;
  parts: Parts;
  proportions: Proportions;
  pose: { right_arm_raise: number };
  material: MaterialName;
  accessories: Accessories;
  model_id: string | null;
  weapon_id: string | null;
}

export function rowToCharacter(row: CharacterRow, equippedId: string | null): Character {
  return {
    id: row.id,
    slot: row.slot,
    revision: row.revision,
    name: row.name,
    parts: row.parts,
    proportions: row.proportions,
    pose: { right_arm_raise: row.pose.right_arm_raise },
    material: row.material,
    accessories: row.accessories,
    model_id: row.model_id,
    weapon_id: row.weapon_id,
    equipped: equippedId === row.id,
  };
}
