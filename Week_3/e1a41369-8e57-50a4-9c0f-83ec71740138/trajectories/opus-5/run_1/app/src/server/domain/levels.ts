export const MAX_HEALTH_TENTHS = 500;

/** Reaching level L+1 needs 25 x L experience within level L. */
export function experienceToLevel(level: number): number {
  return 25 * level;
}

export interface LevelState {
  level: number;
  experience: number;
  healthTenths: number;
}

/** Adds experience, carrying over across as many levels as it reaches. Every level gained refills health. */
export function gainExperience(state: LevelState, gained: number): { next: LevelState; levelsGained: number } {
  let level = state.level;
  let experience = state.experience + gained;
  let healthTenths = state.healthTenths;
  let levelsGained = 0;
  while (experience >= experienceToLevel(level)) {
    experience -= experienceToLevel(level);
    level += 1;
    levelsGained += 1;
    healthTenths = MAX_HEALTH_TENTHS;
  }
  return { next: { level, experience, healthTenths }, levelsGained };
}

export interface FaintOutcome {
  level: number;
  experience: number;
  healthTenths: number;
  goldLostCents: number;
}

/** Health at or below zero: one level lost, experience in the level reset, a tenth of the gold gone. */
export function faint(state: LevelState, goldCents: number): FaintOutcome {
  return {
    level: Math.max(1, state.level - 1),
    experience: 0,
    healthTenths: MAX_HEALTH_TENTHS,
    goldLostCents: Math.floor(goldCents / 10),
  };
}
