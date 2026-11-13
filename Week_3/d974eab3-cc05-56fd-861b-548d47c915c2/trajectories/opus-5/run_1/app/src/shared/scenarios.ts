import type { Mode } from './types';

/**
 * The fixed scenario order. It decides the order of the `Moments` radios, each
 * mode's first scenario, the swipe neighbours and the scenario order in
 * `GET /api/content`.
 */
export const SCENARIO_ORDER = [
  'on-work',
  'on-sports',
  'on-hobby',
  'on-housework',
  'off-break',
  'off-holiday',
  'off-relax',
  'off-rest',
] as const;

export type ScenarioId = (typeof SCENARIO_ORDER)[number];

export const START_SCENARIO_ID: ScenarioId = 'on-work';

export function isScenarioId(value: string): value is ScenarioId {
  return (SCENARIO_ORDER as readonly string[]).includes(value);
}

export function modeOfScenarioId(id: ScenarioId): Mode {
  return id.startsWith('on-') ? 'on' : 'off';
}

export function scenarioIdsOfMode(mode: Mode): ScenarioId[] {
  return SCENARIO_ORDER.filter((id) => modeOfScenarioId(id) === mode);
}

export function firstScenarioIdOfMode(mode: Mode): ScenarioId {
  const [first] = scenarioIdsOfMode(mode);
  if (first === undefined) {
    throw new RangeError(`No scenario for mode ${mode}.`);
  }
  return first;
}

/**
 * The swipe neighbour inside the scenario's own mode, or null past the first or
 * last scenario of that mode.
 */
export function neighbourScenarioId(
  id: ScenarioId,
  step: 1 | -1,
): ScenarioId | null {
  const ids = scenarioIdsOfMode(modeOfScenarioId(id));
  const next = ids[ids.indexOf(id) + step];
  return next ?? null;
}
