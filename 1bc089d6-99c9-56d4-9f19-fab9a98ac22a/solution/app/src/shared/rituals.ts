export type RitualId = "dim-lamps" | "warm-shower" | "paper-not-pixels" | "tomorrow-list" | "slow-stretch" | "breathe";

export interface Ritual {
  id: RitualId;
  title: string;
  minutes: number;
  summary: string;
  clip: string;
}

export const HOUR_MINUTES = 60;
export const MINUTE_STEP = 5;
export const MIN_RITUAL_MINUTES = 5;
export const MAX_RITUAL_MINUTES = 30;

export const RITUALS: readonly Ritual[] = [
  {
    id: "dim-lamps",
    title: "Dim the lamps",
    minutes: 10,
    summary: "Swap the ceiling light for one low lamp. The room turns amber and your eyes take the hint.",
    clip: "lamps",
  },
  {
    id: "warm-shower",
    title: "Warm shower",
    minutes: 15,
    summary: "Warm water first, then the cool air of the bedroom. The change in temperature feels like permission.",
    clip: "shower",
  },
  {
    id: "paper-not-pixels",
    title: "Paper, not pixels",
    minutes: 15,
    summary: "Read something printed: a chapter, a magazine, a recipe you will never cook.",
    clip: "paper",
  },
  {
    id: "tomorrow-list",
    title: "Tomorrow list",
    minutes: 5,
    summary: "Write down the three things tomorrow needs, so your head does not have to hold them overnight.",
    clip: "list",
  },
  {
    id: "slow-stretch",
    title: "Slow stretch",
    minutes: 10,
    summary: "Neck, shoulders, back. Ten easy minutes on the floor, with nothing to achieve.",
    clip: "stretch",
  },
  {
    id: "breathe",
    title: "Breathe",
    minutes: 5,
    summary: "Three rounds of in for four, hold for seven, out for eight, with the lights already low.",
    clip: "breathe",
  },
];

/** The catalogue by id; every RitualId has its entry. */
const BY_ID = Object.fromEntries(RITUALS.map((ritual) => [ritual.id, ritual])) as Record<RitualId, Ritual>;

export function isRitualId(value: string): value is RitualId {
  return Object.hasOwn(BY_ID, value);
}

export const ritualById = (id: RitualId): Ritual => BY_ID[id];
