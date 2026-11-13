import { one, type Db } from "./db.js";
import { Refusal } from "./errors.js";
import { isUuid } from "./http.js";
import type { PartyRow, QuestRow, UserRow } from "./records.js";

/** Another party, or one that does not exist, answers exactly like a missing resource. */
export async function memberParty(db: Db, user: UserRow, partyId: string): Promise<PartyRow> {
  const party =
    isUuid(partyId) && user.party_id === partyId ? await one<PartyRow>(db, "SELECT * FROM parties WHERE id = $1 AND NOT deleted", [partyId]) : undefined;
  if (!party) throw Refusal.notFound();
  return party;
}

/** A quest is visible to the members of its party, and once finished to everyone who took part. */
export async function visibleQuest(db: Db, user: UserRow, questId: string): Promise<QuestRow> {
  const quest = isUuid(questId)
    ? await one<QuestRow>(
        db,
        `SELECT q.* FROM quests q WHERE q.id = $1 AND (
           q.party_id = $2 OR EXISTS (SELECT 1 FROM quest_participants p WHERE p.quest_id = q.id AND p.user_id = $3))`,
        [questId, user.party_id, user.id],
      )
    : undefined;
  if (!quest) throw Refusal.notFound();
  return quest;
}

/** A quest the user may act on: it belongs to the party they are in now. */
export async function memberQuest(db: Db, user: UserRow, questId: string): Promise<QuestRow> {
  const quest = isUuid(questId) && user.party_id ? await one<QuestRow>(db, "SELECT * FROM quests WHERE id = $1 AND party_id = $2", [questId, user.party_id]) : undefined;
  if (!quest) throw Refusal.notFound();
  return quest;
}

export function requireLeader(party: PartyRow, user: UserRow): void {
  if (party.leader_id !== user.id) throw Refusal.leaderOnly();
}
