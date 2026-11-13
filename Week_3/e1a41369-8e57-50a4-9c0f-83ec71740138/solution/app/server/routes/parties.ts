import type { Db } from "../db.js";
import { one, pool, rows } from "../db.js";
import { config } from "../config.js";
import { memberParty, requireLeader } from "../access.js";
import { LIVE_STATES, moveQuest } from "../domain/quests.js";
import { Message, Refusal, invalid } from "../errors.js";
import { isUuid, reply, route } from "../http.js";
import { mutate } from "../mutate.js";
import type { PartyRow, QuestRow, UserRow } from "../records.js";
import { getObject, putObject } from "../storage.js";
import { invitesOf, messageView, partyView } from "../views.js";
import { loadUser } from "../domain/progress.js";
import { asObject } from "./auth.js";

const PARTY_NAME_MAX = 40;
const CHAT_MAX_CHARS = 500;
const CHAT_WINDOW_SECONDS = 60;
const BANNER_LIMIT = 2_000_000;

const nameOf = (value: unknown): string | undefined => {
  const name = typeof value === "string" ? value.trim() : "";
  const length = Array.from(name).length;
  return length >= 1 && length <= PARTY_NAME_MAX ? name : undefined;
};

route("POST", "/api/parties", async (context) => {
  const account = await context.user();
  return mutate(async (db, touch) => {
    const user = await loadUser(db, account.id);
    if (user.party_id) throw Refusal.alreadyInParty();
    const name = context.json((body) => nameOf(asObject(body).name));
    if (name === undefined) throw invalid({ name: Message.name });
    const party = (await one<PartyRow>(db, "INSERT INTO parties (name, leader_id) VALUES ($1, $2) RETURNING *", [name, user.id]))!;
    await db.query("UPDATE users SET party_id = $1, joined_party_at = now() WHERE id = $2", [party.id, user.id]);
    touch.player(user.id);
    touch.partyOf(user.id);
    return reply(201, await partyView(db, party));
  });
});

route("GET", "/api/party", async (context) => {
  const user = await context.user();
  const party = user.party_id ? await one<PartyRow>(pool, "SELECT * FROM parties WHERE id = $1 AND NOT deleted", [user.party_id]) : undefined;
  return reply(200, { party: party ? await partyView(pool, party) : null });
});

route("GET", "/api/parties/:id", async (context) => {
  const user = await context.user();
  return reply(200, await partyView(pool, await memberParty(pool, user, context.params.id!)));
});

/** Seats a party holds: its members, plus its pending invites when a new invite is being weighed. */
async function seatsTaken(db: Db, partyId: string, countInvites: boolean): Promise<number> {
  const row = await one<{ taken: number }>(
    db,
    "SELECT (SELECT COUNT(*) FROM users WHERE party_id = $1) + CASE WHEN $2 THEN (SELECT COUNT(*) FROM party_invites WHERE party_id = $1) ELSE 0 END AS taken",
    [partyId, countInvites],
  );
  return row!.taken;
}

route("POST", "/api/parties/:id/invites", async (context) => {
  const account = await context.user();
  return mutate(async (db, touch) => {
    const user = await loadUser(db, account.id);
    const party = await memberParty(db, user, context.params.id!);
    requireLeader(party, user);
    const username = context.json((body) => asObject(body).username);
    const target = typeof username === "string" ? await one<UserRow>(db, "SELECT * FROM users WHERE username = $1", [username]) : undefined;
    if (!target) throw invalid({ username: Message.inviteTarget });
    if (target.party_id) throw Refusal.alreadyInParty();
    if (await one(db, "SELECT 1 FROM party_invites WHERE party_id = $1 AND invitee_id = $2", [party.id, target.id])) throw Refusal.alreadyInvited();
    if ((await seatsTaken(db, party.id, true)) >= config.partyMaxMembers) throw Refusal.partyFull();
    const invite = (await one<{ id: string }>(db, "INSERT INTO party_invites (party_id, invitee_id, inviter_id) VALUES ($1, $2, $3) RETURNING id", [party.id, target.id, user.id]))!;
    touch.invitesOf(target.id);
    touch.party(party.id);
    return reply(201, { id: invite.id, party: await partyView(db, party), username: target.username });
  });
});

route("GET", "/api/invites", async (context) => reply(200, { invites: await invitesOf(pool, (await context.user()).id) }));

interface InviteRow {
  id: string;
  party_id: string;
}

async function ownInvite(db: Db, user: UserRow, id: string): Promise<InviteRow> {
  const invite = isUuid(id) ? await one<InviteRow>(db, "SELECT id, party_id FROM party_invites WHERE id = $1 AND invitee_id = $2", [id, user.id]) : undefined;
  if (!invite) throw Refusal.notFound();
  return invite;
}

route("POST", "/api/invites/:id/accept", async (context) => {
  const account = await context.user();
  return mutate(async (db, touch) => {
    const user = await loadUser(db, account.id);
    const invite = await ownInvite(db, user, context.params.id!);
    if (user.party_id) throw Refusal.alreadyInParty();
    if ((await seatsTaken(db, invite.party_id, false)) >= config.partyMaxMembers) throw Refusal.partyFull();
    const dropped = await rows<{ party_id: string }>(db, "DELETE FROM party_invites WHERE invitee_id = $1 RETURNING party_id", [user.id]);
    await db.query("UPDATE users SET party_id = $1, joined_party_at = now() WHERE id = $2", [invite.party_id, user.id]);
    for (const { party_id } of dropped) touch.party(party_id);
    touch.player(user.id);
    touch.partyOf(user.id);
    touch.invitesOf(user.id);
    return reply(200, await partyView(db, (await one<PartyRow>(db, "SELECT * FROM parties WHERE id = $1", [invite.party_id]))!));
  });
});

route("POST", "/api/invites/:id/decline", async (context) => {
  const account = await context.user();
  return mutate(async (db, touch) => {
    const invite = await ownInvite(db, account, context.params.id!);
    await db.query("DELETE FROM party_invites WHERE id = $1", [invite.id]);
    touch.invitesOf(account.id);
    touch.party(invite.party_id);
    return reply(204);
  });
});

route("POST", "/api/parties/:id/leave", async (context) => {
  const account = await context.user();
  return mutate(async (db, touch) => {
    const user = await loadUser(db, account.id);
    const party = await memberParty(db, user, context.params.id!);
    const heir = await one<{ id: string }>(db, "SELECT id FROM users WHERE party_id = $1 AND id <> $2 ORDER BY joined_party_at, username LIMIT 1", [party.id, user.id]);
    if (!heir) {
      await db.query("UPDATE parties SET deleted = true WHERE id = $1", [party.id]);
      for (const quest of await rows<QuestRow>(db, "SELECT * FROM quests WHERE party_id = $1 AND state = ANY($2)", [party.id, LIVE_STATES])) {
        await moveQuest(db, touch, quest, "abandon", new Date());
      }
      for (const dropped of await rows<{ invitee_id: string }>(db, "DELETE FROM party_invites WHERE party_id = $1 RETURNING invitee_id", [party.id])) {
        touch.invitesOf(dropped.invitee_id);
      }
    } else if (party.leader_id === user.id) {
      await db.query("UPDATE parties SET leader_id = $2 WHERE id = $1", [party.id, heir.id]);
    }
    await db.query("UPDATE users SET party_id = NULL, joined_party_at = NULL WHERE id = $1", [user.id]);
    touch.player(user.id);
    touch.partyOf(user.id);
    touch.party(party.id);
    return reply(204);
  });
});

route("GET", "/api/parties/:id/chat", async (context) => {
  const user = await context.user();
  const party = await memberParty(pool, user, context.params.id!);
  const latest = await rows<{ id: string }>(pool, "SELECT id FROM (SELECT id, seq FROM chat_messages WHERE party_id = $1 ORDER BY seq DESC LIMIT 100) m ORDER BY seq", [party.id]);
  return reply(200, { messages: await Promise.all(latest.map((message) => messageView(pool, message.id))) });
});

route("POST", "/api/parties/:id/chat", async (context) => {
  const account = await context.user();
  return mutate(async (db, touch) => {
    const user = await loadUser(db, account.id);
    const party = await memberParty(db, user, context.params.id!);
    const raw = context.json((body) => asObject(body).text);
    const text = typeof raw === "string" ? raw.trim() : "";
    const length = Array.from(text).length;
    if (length < 1 || length > CHAT_MAX_CHARS) throw invalid({ text: Message.text });
    const recent = await one<{ count: number }>(
      db,
      `SELECT COUNT(*) AS count FROM chat_messages WHERE user_id = $1 AND created_at > now() - make_interval(secs => $2)`,
      [user.id, CHAT_WINDOW_SECONDS],
    );
    if (recent!.count >= config.chatMaxPerMinute) throw Refusal.chatRateLimited();
    const message = (await one<{ id: string }>(db, "INSERT INTO chat_messages (party_id, user_id, text) VALUES ($1, $2, $3) RETURNING id", [party.id, user.id, text]))!;
    touch.chat(party.id, message.id);
    return reply(201, await messageView(db, message.id));
  });
});

const IMAGE_TYPES = { png: "image/png", jpg: "image/jpeg" } as const;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);

route(
  "PUT",
  "/api/parties/:id/banner",
  async (context) => {
    const account = await context.user();
    const party = await memberParty(pool, account, context.params.id!);
    requireLeader(party, account);
    const file = context.multipartFile(BANNER_LIMIT);
    const extension = file.bytes.subarray(0, PNG.length).equals(PNG) ? "png" : file.bytes.subarray(0, JPEG.length).equals(JPEG) ? "jpg" : undefined;
    if (!extension) throw Refusal.unsupportedFileType();
    const uploadId = crypto.randomUUID();
    await putObject(`banners/${party.id}/${uploadId}.${extension}`, file.bytes, IMAGE_TYPES[extension]);
    return mutate(async (db, touch) => {
      await db.query("INSERT INTO party_banners (upload_id, party_id, extension) VALUES ($1, $2, $3)", [uploadId, party.id, extension]);
      touch.banner(party.id);
      touch.party(party.id);
      return reply(201, { bannerUrl: (await partyView(db, party)).bannerUrl });
    });
  },
  BANNER_LIMIT + 8192,
);

route("GET", "/api/parties/:id/banner", async (context) => {
  const user = await context.user();
  const party = await memberParty(pool, user, context.params.id!);
  const asked = context.url.searchParams.get("v");
  const banner = await one<{ upload_id: string; extension: keyof typeof IMAGE_TYPES }>(
    pool,
    `SELECT upload_id, extension FROM party_banners WHERE party_id = $1 AND ($2::text IS NULL OR upload_id::text = $2) ORDER BY created_at DESC LIMIT 1`,
    [party.id, asked],
  );
  if (!banner) throw Refusal.notFound();
  const bytes = await getObject(`banners/${party.id}/${banner.upload_id}.${banner.extension}`);
  return { status: 200, raw: bytes, contentType: IMAGE_TYPES[banner.extension], headers: { "Cache-Control": "private, max-age=3600" } };
});
