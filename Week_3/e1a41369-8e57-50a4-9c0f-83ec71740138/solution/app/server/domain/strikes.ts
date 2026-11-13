import { one, rows, type Db } from "../db.js";
import type { Touch } from "../publish.js";
import type { EventRow, QuestRow, UserRow } from "../records.js";
import { addEntry } from "./ledger.js";
import { gainExperience } from "./progress.js";
import { fixtureOf, moveQuest } from "./quests.js";

export async function activeQuestOf(db: Db, partyId: string | null): Promise<QuestRow | undefined> {
  if (!partyId) return undefined;
  return one<QuestRow>(db, "SELECT * FROM quests WHERE party_id = $1 AND state = 'active'", [partyId]);
}

export async function appendEvent(
  db: Db,
  touch: Touch,
  quest: QuestRow,
  event: { kind: "strike" | "strikeback"; userId: string; amountTenths: number; missed: number | null; bossHealthAfterTenths: number },
): Promise<EventRow> {
  const created = await one<EventRow>(
    db,
    `INSERT INTO quest_events (quest_id, seq, kind, user_id, amount_tenths, missed, boss_health_after_tenths)
     VALUES ($1, COALESCE((SELECT MAX(seq) FROM quest_events WHERE quest_id = $1), 0) + 1, $2, $3, $4, $5, $6) RETURNING *`,
    [quest.id, event.kind, event.userId, event.amountTenths, event.missed, event.bossHealthAfterTenths],
  );
  touch.strike(quest.id, created!.id);
  touch.quest(quest.id);
  return created!;
}

interface Strike {
  event: EventRow;
  defeated: boolean;
}

/** One strike on the boss of the striker's active quest; the strike that reaches 0.0 defeats it and pays every member. */
export async function strikeBoss(db: Db, touch: Touch, striker: UserRow, damageTenths: number, now: Date): Promise<Strike | null> {
  const quest = await activeQuestOf(db, striker.party_id);
  if (!quest) return null;
  const dealt = Math.min(damageTenths, quest.boss_health_tenths);
  const remaining = quest.boss_health_tenths - dealt;
  await db.query("UPDATE quests SET boss_health_tenths = $2 WHERE id = $1", [quest.id, remaining]);
  const event = await appendEvent(db, touch, quest, {
    kind: "strike",
    userId: striker.id,
    amountTenths: dealt,
    missed: null,
    bossHealthAfterTenths: remaining,
  });
  if (remaining > 0) return { event, defeated: false };
  await moveQuest(db, touch, quest, "defeat", now, striker.id);
  const fixture = fixtureOf(quest);
  const members = await rows<{ id: string }>(db, "SELECT id FROM users WHERE party_id = $1 ORDER BY username", [quest.party_id]);
  for (const member of members) {
    await addEntry(db, member.id, "quest", fixture.rewardGoldCents);
    await gainExperience(db, touch, member.id, fixture.rewardExperience);
  }
  return { event, defeated: true };
}
