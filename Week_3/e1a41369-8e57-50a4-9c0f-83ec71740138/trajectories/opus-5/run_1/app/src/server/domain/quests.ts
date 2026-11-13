import type { QuestFixture, QuestState } from '../../shared/types.js';

export interface QuestFixtureRow extends QuestFixture {
  maxHealthTenths: number;
  powerTenths: number;
  rewardGoldCents: number;
}

/** The only quests. */
export const QUEST_FIXTURES: QuestFixtureRow[] = [
  {
    name: 'Wake the Drowsewyrm',
    boss: 'Drowsewyrm',
    maxHealth: 400,
    maxHealthTenths: 4000,
    power: 1.5,
    powerTenths: 15,
    rewardGold: 25,
    rewardGoldCents: 2500,
    rewardExperience: 100,
  },
  {
    name: 'Hush the Clutterhound',
    boss: 'Clutterhound',
    maxHealth: 250,
    maxHealthTenths: 2500,
    power: 1,
    powerTenths: 10,
    rewardGold: 15,
    rewardGoldCents: 1500,
    rewardExperience: 60,
  },
  {
    name: 'Dim the Gloamtide Moth',
    boss: 'Gloamtide Moth',
    maxHealth: 600,
    maxHealthTenths: 6000,
    power: 2,
    powerTenths: 20,
    rewardGold: 40,
    rewardGoldCents: 4000,
    rewardExperience: 150,
  },
];

export function questFixture(name: string): QuestFixtureRow | undefined {
  return QUEST_FIXTURES.find((fixture) => fixture.name === name);
}

/** The published state edges. Every other move is refused as quest not active. */
const EDGES: Record<QuestState, QuestState[]> = {
  invited: ['active', 'abandoned'],
  active: ['defeated', 'abandoned'],
  defeated: [],
  abandoned: [],
};

export function canMove(from: QuestState, to: QuestState): boolean {
  return (EDGES[from] ?? []).includes(to);
}

export const MIN_ACCEPTED_TO_BEGIN = 2;
