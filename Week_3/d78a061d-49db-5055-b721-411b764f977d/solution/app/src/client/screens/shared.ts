import { el } from '../dom.js';
import { fmtFixed, type Locale, type MessageKey } from '../../shared/i18n/index.js';
import type { Character, MaterialName, Stats } from '../../shared/types.js';
import type { HeroLook } from '../scene/hero.js';

export type { AppContext, Screen } from '../state.js';
import type { AppContext } from '../state.js';

export const DEFAULT_LOOK: HeroLook = {
  parts: { head: 'round', torso: 'stick', arms: 'thin', legs: 'thin' },
  proportions: {
    head_size: 1,
    neck_length: 1,
    spine_length: 1,
    upper_arm_length: 1,
    forearm_length: 1,
    thigh_length: 1,
    shin_length: 1,
  },
  material: 'graphite',
  accessories: { head: 'none', back: 'none', left_hand: 'none' },
  armRaiseRadians: 0,
};

export function lookFrom(character: Character): HeroLook {
  return {
    parts: character.parts,
    proportions: character.proportions,
    material: character.material as MaterialName,
    accessories: character.accessories,
    armRaiseRadians: character.pose.right_arm_raise,
  };
}

/**
 * Pending, then the control goes back to its own copy. The control is disabled through
 * aria-disabled so it keeps keyboard focus, and presses are ignored until the answer.
 */
export async function withPending<T>(
  ctx: AppContext,
  button: HTMLButtonElement,
  run: () => Promise<T>,
): Promise<T | null> {
  if (button.getAttribute('aria-disabled') === 'true') return null;
  const original = button.textContent ?? '';
  button.setAttribute('aria-disabled', 'true');
  button.textContent = ctx.t('fb.pending');
  try {
    return await run();
  } finally {
    button.removeAttribute('aria-disabled');
    button.textContent = original;
  }
}

export function statsBlock(ctx: AppContext, locale: Locale, stats: Stats): HTMLElement {
  const rows: [MessageKey, MessageKey, number][] = [
    ['stat.reach', 'stat.reachValue', stats.reach_m],
    ['stat.weight', 'stat.weightValue', stats.weight_kg],
    ['stat.swing', 'stat.swingValue', stats.swing_per_s],
  ];
  return el(
    'dl',
    { class: 'stats' },
    rows.flatMap(([labelKey, valueKey, value]) => [
      el('dt', { text: ctx.t(labelKey) }),
      el('dd', { text: ctx.t(valueKey, { v: fmtFixed(locale, value, 2) }) }),
    ]),
  );
}

export function weaponName(ctx: AppContext, numberValue: number): string {
  return ctx.t('weapon.name', { n: numberValue });
}
