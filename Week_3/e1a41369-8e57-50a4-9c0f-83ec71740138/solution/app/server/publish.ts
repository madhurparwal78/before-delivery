import type { LiveEvent, Notice } from "../shared/api.js";
import { one, pool, rows } from "./db.js";
import { loadUser } from "./domain/progress.js";
import { send } from "./live.js";
import type { EventRow, PartyRow, QuestRow, UserRow } from "./records.js";
import { eventView, invitesOf, messageView, partyView, playerView, questView, taskLists } from "./views.js";


/** What one committed transaction changed; flushed to open live streams after the commit. */
export class Touch {
  readonly players = new Set<string>();
  readonly tasks = new Set<string>();
  readonly parties = new Set<string>();
  readonly partiesOfUsers = new Set<string>();
  readonly quests = new Set<string>();
  readonly strikes: { questId: string; eventId: string }[] = [];
  readonly chats: { partyId: string; messageId: string }[] = [];
  readonly banners = new Set<string>();
  readonly invites = new Set<string>();
  readonly notices: { userId: string; noticeId: string }[] = [];

  player(userId: string): void {
    this.players.add(userId);
  }
  taskList(userId: string): void {
    this.tasks.add(userId);
  }
  party(partyId: string): void {
    this.parties.add(partyId);
  }
  partyOf(userId: string): void {
    this.partiesOfUsers.add(userId);
  }
  quest(questId: string): void {
    this.quests.add(questId);
  }
  strike(questId: string, eventId: string): void {
    this.strikes.push({ questId, eventId });
  }
  chat(partyId: string, messageId: string): void {
    this.chats.push({ partyId, messageId });
  }
  banner(partyId: string): void {
    this.banners.add(partyId);
  }
  invitesOf(userId: string): void {
    this.invites.add(userId);
  }
  notice(userId: string, noticeId: string): void {
    this.notices.push({ userId, noticeId });
  }
}


const LIVE_BATCH_MS = 120;
let flushing: Promise<void> = Promise.resolve();

/** Send what a committed transaction changed after a short batching window, in commit order. */
export function scheduleFlush(touch: Touch): void {
  setTimeout(() => {
    flushing = flushing.then(() => flush(touch)).catch((error: unknown) => console.error("live flush failed", error));
  }, LIVE_BATCH_MS);
}

async function flush(touch: Touch): Promise<void> {
  const parties = new Set(touch.parties);
  const withParty = await rows<UserRow>(pool, "SELECT * FROM users WHERE id = ANY($1)", [[...touch.players, ...touch.tasks, ...touch.partiesOfUsers, ...touch.invites]]);
  const byId = new Map(withParty.map((user) => [user.id, user]));
  for (const userId of touch.players) {
    const user = byId.get(userId)!;
    send([userId], { name: "player", data: await playerView(pool, user) });
    if (user.party_id) parties.add(user.party_id);
  }
  for (const userId of touch.tasks) send([userId], { name: "tasks", data: await taskLists(pool, byId.get(userId)!) });
  for (const userId of touch.invites) send([userId], { name: "invite", data: { invites: await invitesOf(pool, userId) } });
  for (const userId of touch.partiesOfUsers) await sendPartyOf(byId.get(userId)!);
  for (const partyId of parties) await sendParty(partyId);
  for (const questId of touch.quests) await sendQuest(questId);
  for (const { questId, eventId } of touch.strikes) await sendStrike(questId, eventId);
  for (const { partyId, messageId } of touch.chats) {
    const message = await messageView(pool, messageId);
    send(await memberIds(partyId), { name: "chat", data: { ...message, partyId } });
  }
  for (const partyId of touch.banners) {
    const party = await partyById(partyId);
    send(await memberIds(partyId), { name: "banner", data: { partyId, bannerUrl: (await partyView(pool, party)).bannerUrl } });
  }
  for (const { userId, noticeId } of touch.notices) await sendNotice(userId, noticeId);
}

async function memberIds(partyId: string): Promise<string[]> {
  return (await rows<{ id: string }>(pool, "SELECT id FROM users WHERE party_id = $1", [partyId])).map((member) => member.id);
}

async function partyById(partyId: string): Promise<PartyRow> {
  return (await one<PartyRow>(pool, "SELECT * FROM parties WHERE id = $1", [partyId]))!;
}

async function sendParty(partyId: string): Promise<void> {
  const party = await partyById(partyId);
  if (party.deleted) return;
  send(await memberIds(partyId), { name: "party", data: await partyView(pool, party) });
}

export async function partyEvent(user: UserRow): Promise<LiveEvent> {
  if (!user.party_id) return { name: "party", data: { party: null } };
  return { name: "party", data: await partyView(pool, await partyById(user.party_id)) };
}

async function sendPartyOf(user: UserRow): Promise<void> {
  send([user.id], await partyEvent(await loadUser(pool, user.id)));
}

async function sendQuest(questId: string): Promise<void> {
  const quest = (await one<QuestRow>(pool, "SELECT * FROM quests WHERE id = $1", [questId]))!;
  send(await memberIds(quest.party_id), { name: "quest", data: await questView(pool, quest) });
}

async function sendStrike(questId: string, eventId: string): Promise<void> {
  const quest = (await one<QuestRow>(pool, "SELECT * FROM quests WHERE id = $1", [questId]))!;
  const event = await one<EventRow>(pool, "SELECT * FROM quest_events WHERE id = $1", [eventId]);
  if (!event) return;
  send(await memberIds(quest.party_id), { name: "strike", data: { ...(await eventView(pool, event)), questId } });
}

async function sendNotice(userId: string, noticeId: string): Promise<void> {
  const notice = await one<{ id: string; kind: Notice["kind"]; level: number; gold_lost_cents: number }>(
    pool,
    "SELECT id, kind, level, gold_lost_cents FROM notices WHERE id = $1 AND NOT acknowledged",
    [noticeId],
  );
  if (notice) send([userId], { name: "notice", data: { id: notice.id, kind: notice.kind, level: notice.level, goldLost: notice.gold_lost_cents / 100 } });
}
