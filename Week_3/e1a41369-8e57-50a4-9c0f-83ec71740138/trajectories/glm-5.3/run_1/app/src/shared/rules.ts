export type TaskType = 'habit' | 'daily' | 'todo' | 'reward';
export type Difficulty = 'trivial' | 'easy' | 'medium' | 'hard';
export type Band = 'Crimson' | 'Amber' | 'Sand' | 'Teal' | 'Blue';
export type LedgerKind = 'task' | 'reward' | 'quest' | 'faint' | 'undo';
export type QuestState = 'invited' | 'active' | 'defeated' | 'abandoned';
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Difficulty multiplier d (Business rules). */
export function difficultyMultiplier(d: Difficulty): number {
  switch (d) {
    case 'trivial':
      return 0.5;
    case 'easy':
      return 1;
    case 'medium':
      return 1.5;
    case 'hard':
      return 2;
  }
}

/** Band and factor f, taken from the value v before an action changes it. */
export function bandOf(v: number): { band: Band; factor: number } {
  if (v <= -10) return { band: 'Crimson', factor: 2 };
  if (v <= -1) return { band: 'Amber', factor: 1.5 };
  if (v <= 4) return { band: 'Sand', factor: 1 };
  if (v <= 9) return { band: 'Teal', factor: 0.75 };
  return { band: 'Blue', factor: 0.5 };
}

/** Half-up rounding to a precision: 10 = whole, 1 = one decimal, 100 = two decimals. */
export function roundHalfUp(x: number, unit: 10 | 1 | 100 = 10): number {
  return Math.round(x * unit + Number.EPSILON) / unit;
}

export interface RewardParts {
  difficulty: Difficulty;
  value: number;
  checked: number;
  total: number;
}

/** Experience for completing or scoring up. */
export function experienceFor({ difficulty, value, checked = 0, total = 0 }: RewardParts): number {
  const { factor } = bandOf(value);
  const d = difficultyMultiplier(difficulty);
  const checklist = total > 0 ? 1 + 0.5 * (checked / total) : 1;
  return Math.round(10 * d * factor * checklist);
}

/** Gold in cents from experience. */
export function goldCentsFor(experience: number): number {
  return Math.round((experience / 10) * 100 + Number.EPSILON);
}

/** Boss damage in tenths from experience. */
export function damageTenthsFor(experience: number): number {
  return Math.round((experience / 2) * 10 + Number.EPSILON);
}

/** Health lost scoring a habit down, in tenths. */
export function habitDownHealthTenths(difficulty: Difficulty, value: number): number {
  const { factor } = bandOf(value);
  return Math.round(2 * difficultyMultiplier(difficulty) * factor * 10 + Number.EPSILON);
}

/** Health lost for a missed daily at close, in tenths. */
export function missedDailyHealthTenths(difficulty: Difficulty, value: number): number {
  const { factor } = bandOf(value);
  return Math.round(2 * difficultyMultiplier(difficulty) * factor * 10 + Number.EPSILON);
}

/** Strike-back amount per member, in tenths. */
export function strikeBackTenths(power: number, missed: number): number {
  return Math.round(power * missed * 10 + Number.EPSILON);
}

/** Experience needed within level L to reach L+1. */
export function experienceToLevel(level: number): number {
  return 25 * level;
}

export const MAX_HEALTH_TENTHS = 500;

/** Apply experience, levelling up with carry-over and refilling health each level. */
export interface LevelResult {
  level: number;
  experience: number;
  levelsGained: number;
}

export function applyExperience(level: number, experience: number, gained: number): LevelResult {
  let l = level;
  let e = experience + gained;
  let levelsGained = 0;
  while (e >= experienceToLevel(l)) {
    e -= experienceToLevel(l);
    l += 1;
    levelsGained += 1;
  }
  return { level: l, experience: e, levelsGained };
}

/** Faint: one level down (never below 1), experience reset, 10% of gold lost (rounded down to the cent). */
export function faintPenalty(level: number, goldCents: number): { level: number; goldLostCents: number } {
  const newLevel = Math.max(1, level - 1);
  const goldLostCents = Math.floor(goldCents * 0.1);
  return { level: newLevel, goldLostCents };
}

export const QUEST_FIXTURES = [
  {
    name: 'Wake the Drowsewyrm',
    boss: 'Drowsewyrm',
    maxHealth: 400.0,
    power: 1.5,
    rewardGold: 25.0,
    rewardExperience: 100,
  },
  {
    name: 'Hush the Clutterhound',
    boss: 'Clutterhound',
    maxHealth: 250.0,
    power: 1.0,
    rewardGold: 15.0,
    rewardExperience: 60,
  },
  {
    name: 'Dim the Gloamtide Moth',
    boss: 'Gloamtide Moth',
    maxHealth: 600.0,
    power: 2.0,
    rewardGold: 40.0,
    rewardExperience: 150,
  },
] as const;

export type QuestFixtureName = (typeof QUEST_FIXTURES)[number]['name'];

export function fixtureByName(name: string) {
  return QUEST_FIXTURES.find((q) => q.name === name);
}
