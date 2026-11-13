import type { QuestFixture, QuestState } from "../../shared/api.js";
import { config } from "../config.js";
import { one, type Db } from "../db.js";
import { Refusal } from "../errors.js";
import type { Touch } from "../publish.js";
import type { QuestRow } from "../records.js";

interface Fixture {
  name: string;
  boss: string;
  maxHealthTenths: number;
  powerTenths: number;
  rewardGoldCents: number;
  rewardExperience: number;
}

export const FIXTURES: readonly Fixture[] = [
  { name: "Wake the Drowsewyrm", boss: "Drowsewyrm", maxHealthTenths: 4000, powerTenths: 15, rewardGoldCents: 2500, rewardExperience: 100 },
  { name: "Hush the Clutterhound", boss: "Clutterhound", maxHealthTenths: 2500, powerTenths: 10, rewardGoldCents: 1500, rewardExperience: 60 },
  { name: "Dim the Gloamtide Moth", boss: "Gloamtide Moth", maxHealthTenths: 6000, powerTenths: 20, rewardGoldCents: 4000, rewardExperience: 150 },
];

export function fixtureNamed(name: string): Fixture | undefined {
  return FIXTURES.find((fixture) => fixture.name === name);
}

export function fixtureOf(quest: QuestRow): Fixture {
  return fixtureNamed(quest.name)!;
}

export function fixtureView(fixture: Fixture): QuestFixture {
  return {
    name: fixture.name,
    boss: fixture.boss,
    maxHealth: fixture.maxHealthTenths / 10,
    power: fixture.powerTenths / 10,
    rewardGold: fixture.rewardGoldCents / 100,
    rewardExperience: fixture.rewardExperience,
  };
}

/** Quest states: invited, then active, then defeated; invited or active may be abandoned. The only edges. */
export const LIVE_STATES = ["invited", "active"] as const satisfies readonly QuestState[];
export const FINISHED_STATES = ["defeated", "abandoned"] as const satisfies readonly QuestState[];

const EDGES = {
  accept: { from: ["invited"] },
  decline: { from: ["invited"] },
  begin: { from: ["invited"], to: "active" },
  abandon: { from: LIVE_STATES, to: "abandoned" },
  defeat: { from: ["active"], to: "defeated" },
} as const satisfies Record<string, { from: readonly QuestState[]; to?: QuestState }>;

type QuestMove = keyof typeof EDGES;

export function requireMove(quest: QuestRow, move: QuestMove): void {
  if (!(EDGES[move].from as readonly QuestState[]).includes(quest.state)) throw Refusal.questNotActive();
}

/** Move a quest along one edge. A finished quest keeps the members who took part, so it stays in their history. */
export async function moveQuest(
  db: Db,
  touch: Touch,
  quest: QuestRow,
  move: "begin" | "abandon" | "defeat",
  now: Date,
  defeatedBy: string | null = null,
): Promise<QuestRow> {
  requireMove(quest, move);
  const finished = move !== "begin";
  const moved = (await one<QuestRow>(
    db,
    `UPDATE quests SET state = $2, started_at = CASE WHEN $3 THEN started_at ELSE $4 END,
       ended_at = CASE WHEN $3 THEN $4 ELSE ended_at END, defeated_by = $5 WHERE id = $1 RETURNING *`,
    [quest.id, EDGES[move].to, finished, now, defeatedBy],
  ))!;
  if (finished) await db.query("INSERT INTO quest_participants (quest_id, user_id) SELECT $1, id FROM users WHERE party_id = $2", [quest.id, quest.party_id]);
  touch.quest(quest.id);
  touch.party(quest.party_id);
  return moved;
}

export async function latestQuestOf(db: Db, partyId: string): Promise<QuestRow | undefined> {
  return one<QuestRow>(db, "SELECT * FROM quests WHERE party_id = $1 ORDER BY seq DESC LIMIT 1", [partyId]);
}

export function expiresAt(quest: QuestRow): Date {
  return new Date(quest.invited_at.getTime() + config.questInviteSeconds * 1000);
}

export function requireLiveInvite(quest: QuestRow, now: Date): void {
  if (now >= expiresAt(quest)) throw Refusal.inviteExpired();
}
