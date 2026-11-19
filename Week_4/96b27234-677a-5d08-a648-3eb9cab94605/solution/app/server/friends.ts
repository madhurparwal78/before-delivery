import { worldNow } from "./clock.js";
import { config } from "./config.js";
import { one, query, tx } from "./db.js";
import { invalid, notFound, originOf, reply, Router, type Reply } from "./http.js";
import { absoluteUrl, enqueueMail } from "./mail.js";
import { friendsHint, notifyPerson } from "./notify.js";
import { newId, newToken, type Person } from "./people.js";
import { accessFor, mayJoin, openSessions } from "./sessiondata.js";
import { presenceKey, valkeyFlaggedDown, run } from "./valkey.js";
import { lowerEmail, validEmail } from "./accounts.js";

const orderedPair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

interface FriendRow {
  id: string;
  display_name: string;
}

async function presenceOf(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0 || valkeyFlaggedDown()) return new Set();
  try {
    const flags = await run((client) => Promise.all(ids.map((id) => client.exists(presenceKey(id)))));
    return new Set(ids.filter((_, index) => flags[index] === 1));
  } catch {
    return new Set();
  }
}

export function friendRoutes(router: Router<Person>): void {
  router.add("GET", "/api/friends", async (_ctx, person): Promise<Reply> => {
    const friends = await query<FriendRow>(
      `SELECT p.id, p.display_name FROM people p
       WHERE p.world_id = $1 AND p.id IN (SELECT b FROM friendships WHERE a = $2 UNION SELECT a FROM friendships WHERE b = $2)
         AND NOT EXISTS (SELECT 1 FROM blocks k WHERE (k.from_id = $2 AND k.to_id = p.id) OR (k.from_id = p.id AND k.to_id = $2))
       ORDER BY p.display_name, p.id`,
      [person.worldId, person.id],
    );
    const present = await presenceOf(friends.map((friend) => friend.id));
    const access = await accessFor(person);
    const sessions = await openSessions(person.worldId);
    const inSession = await query<{ person_id: string; session_id: string }>(
      "SELECT person_id, session_id FROM session_members WHERE person_id = ANY($1) AND NOT gone ORDER BY joined_seq",
      [friends.map((friend) => friend.id)],
    );
    return reply(200, {
      friends: friends.map((friend) => {
        const open = present.has(friend.id)
          ? sessions.find(
              (session) => inSession.some((row) => row.person_id === friend.id && row.session_id === session.id) && mayJoin(person, session, access),
            )
          : undefined;
        const presence = !present.has(friend.id) ? "offline" : open ? "in-session" : "online";
        return {
          personId: friend.id,
          displayName: friend.display_name,
          presence,
          session: open ? { id: open.id, roomName: open.roomName } : null,
        };
      }),
    });
  });

  router.add("DELETE", "/api/friends/:personId", async (ctx, person): Promise<Reply> => {
    const [a, b] = orderedPair(person.id, ctx.params.personId ?? "");
    const removed = await query("DELETE FROM friendships f USING people p WHERE f.a = $1 AND f.b = $2 AND p.id = $3 AND p.world_id = $4 RETURNING f.a", [a, b, ctx.params.personId ?? "", person.worldId]);
    if (removed.length === 0) throw notFound();
    await Promise.all([friendsHint(person.id), notifyPerson(ctx.params.personId ?? "", { type: "friends" })]);
    return reply(200, { status: "removed" });
  });

  router.add("POST", "/api/friends/invites", async (ctx, person): Promise<Reply> => {
    const email = ctx.json().email;
    if (!validEmail(email)) throw invalid("Enter a valid email address.");
    const now = await worldNow(person.worldId);
    const token = newToken();
    await tx(async (client) => {
      await query("INSERT INTO friend_invites (id, token, from_id, email, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6)", [
        newId(),
        token,
        person.id,
        lowerEmail(email),
        now,
        new Date(now.getTime() + config.inviteTtlSeconds * 1000),
      ], client);
      await enqueueMail(
        lowerEmail(email),
        `${person.displayName} invited you to Hearthtile`,
        `${person.displayName} invited you to Hearthtile. Accept the invitation: ${absoluteUrl(originOf(ctx), `/invites/${token}`)}`,
        client,
      );
    });
    return reply(202, { status: "sent" });
  });

  router.add("GET", "/api/friends/invites", async (_ctx, person): Promise<Reply> => {
    const rows = await query<{ id: string; email: string; state: string; expires_at: Date; dead: boolean }>(
      "SELECT id, email, state, expires_at, expires_at <= world_now($2) AS dead FROM friend_invites WHERE from_id = $1 ORDER BY created_at, id",
      [person.id, person.worldId],
    );
    return reply(200, {
      invites: rows.map((row) => ({
        id: row.id,
        email: row.email,
        state: row.state === "pending" && row.dead ? "expired" : row.state,
        expiresAt: row.expires_at.toISOString(),
      })),
    });
  });

  router.add("DELETE", "/api/friends/invites/:id", async (ctx, person): Promise<Reply> => {
    const revoked = await one<{ id: string }>("UPDATE friend_invites SET state = 'revoked' WHERE id = $1 AND from_id = $2 AND state = 'pending' RETURNING id", [ctx.params.id ?? "", person.id]);
    if (!revoked) throw notFound();
    return reply(200, { status: "revoked" });
  });

  router.add(
    "GET",
    "/api/invites/:token",
    async (ctx): Promise<Reply> => {
      const invite = await aliveInvite(ctx.params.token ?? "");
      if (!invite) throw notFound();
      return reply(200, { from: invite.display_name });
    },
    { anonymous: true },
  );

  router.add("POST", "/api/invites/:token/accept", async (ctx, person): Promise<Reply> => {
    const invite = await aliveInvite(ctx.params.token ?? "");
    if (!invite || invite.from_id === person.id || invite.world_id !== person.worldId) throw notFound();
    const apart = await one("SELECT 1 AS ok FROM blocks WHERE (from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1)", [person.id, invite.from_id]);
    if (apart) throw notFound();
    const [a, b] = orderedPair(person.id, invite.from_id);
    await tx(async (client) => {
      const used = await one<{ id: string }>("UPDATE friend_invites SET state = 'used' WHERE id = $1 AND state = 'pending' RETURNING id", [invite.id], client);
      if (!used) throw notFound();
      await query("INSERT INTO friendships (a, b) VALUES ($1, $2) ON CONFLICT DO NOTHING", [a, b], client);
    });
    await Promise.all([notifyPerson(person.id, { type: "friends" }), notifyPerson(invite.from_id, { type: "friends" })]);
    return reply(200, { status: "friends" });
  });
}

interface AliveInvite {
  id: string;
  from_id: string;
  world_id: string;
  display_name: string;
}

async function aliveInvite(token: string): Promise<AliveInvite | null> {
  return one<AliveInvite>(
    `SELECT i.id, i.from_id, p.world_id, p.display_name FROM friend_invites i JOIN people p ON p.id = i.from_id
     WHERE i.token = $1 AND i.state = 'pending' AND i.expires_at > world_now(p.world_id)`,
    [token],
  );
}

