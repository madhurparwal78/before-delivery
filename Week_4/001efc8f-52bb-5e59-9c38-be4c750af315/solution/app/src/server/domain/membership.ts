import { now } from "../clock.js";
import { one, pool, rows, tx } from "../db.js";
import { alreadyMember, ApiError, FIELD, invalid } from "../errors.js";
import { logEvents } from "../events.js";
import type { Viewer } from "../http.js";
import { channelFor, type MemberChannel } from "./channels.js";
import { isUuid } from "./ids.js";
import { projectUser, type UserJson, type UserRow } from "./projection.js";
import { managesPeople } from "./roles.js";

type MemberJson = { user: UserJson; joined_at: string };

export async function channelMembers(viewer: Viewer, channelId: string): Promise<MemberJson[]> {
  const found = await rows<UserRow & { joined_at: Date }>(
    pool,
    `SELECT u.id, u.name, u.handle, u.email, u.role, u.status, m.joined_at
       FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.channel_id = $1 ORDER BY u.name, u.id`,
    [channelId],
  );
  return found.map(({ joined_at, ...user }) => ({ user: projectUser(viewer, user), joined_at: joined_at.toISOString() }));
}

// Operations managers add active people of their own workspace to channels they belong to.
export async function addMember(viewer: Viewer, channel: MemberChannel, value: Record<string, unknown>): Promise<MemberJson> {
  const userId = value.user_id;
  const person = isUuid(userId)
    ? await one<UserRow>(pool, "SELECT id, name, handle, email, role, status FROM users WHERE id = $1 AND workspace_id = $2 AND status = 'active'", [userId, channel.workspace_id])
    : undefined;
  if (isUuid(userId) && !person) throw new ApiError("not_found");
  if (!managesPeople(viewer.role)) throw new ApiError("forbidden");
  if (!person) throw invalid({ user_id: FIELD.userId });

  const joinedAt = now();
  await tx(async (client) => {
    const inserted = await client.query("INSERT INTO memberships (channel_id, user_id, joined_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [
      channel.id, person.id, joinedAt,
    ]);
    if (inserted.rowCount === 0) throw alreadyMember(person.name);
    const [eventId] = await logEvents(client, async () => [
      { workspaceId: channel.workspace_id, channelId: channel.id, userId: person.id, name: "channel.added", payload: { channel: await channelFor(client, channel.id, person.id) } },
    ]);
    // Channel events reach a member only when logged after they joined.
    await client.query("UPDATE memberships SET joined_event_id = $3 WHERE channel_id = $1 AND user_id = $2", [channel.id, person.id, eventId]);
  });
  return { user: projectUser(viewer, person), joined_at: joinedAt.toISOString() };
}

export async function removeMember(viewer: Viewer, channel: MemberChannel, userId: string): Promise<void> {
  if (!isUuid(userId) || !(await one(pool, "SELECT 1 FROM users WHERE id = $1 AND workspace_id = $2", [userId, channel.workspace_id]))) {
    throw new ApiError("not_found");
  }
  if (!managesPeople(viewer.role)) throw new ApiError("forbidden");
  await tx(async (client) => {
    const removed = await client.query("DELETE FROM memberships WHERE channel_id = $1 AND user_id = $2", [channel.id, userId]);
    if (removed.rowCount === 0) throw new ApiError("not_found");
    await logEvents(client, async () => [
      { workspaceId: channel.workspace_id, channelId: channel.id, userId, name: "channel.revoked", payload: { channel_id: channel.id } },
    ]);
  });
}
