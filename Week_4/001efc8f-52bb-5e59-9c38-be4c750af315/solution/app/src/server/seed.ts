import { randomUUID } from "node:crypto";
import type pg from "pg";
import { addSeconds, now } from "./clock.js";
import { config } from "./config.js";
import { one } from "./db.js";
import { hashPassword } from "./domain/passwords.js";

const PASSWORD = "frost-line-2026";

const WORKSPACES = [
  { key: "kestrel", name: "Kestrel Refrigeration Co.", timeZone: "America/Chicago" },
  { key: "halvard", name: "Halvard Mechanical", timeZone: "America/New_York" },
] as const;

const PEOPLE = [
  { key: "dana", name: "Dana Okafor", handle: "dana", email: "dana@kestrel.example", role: "dispatcher", ws: "kestrel" },
  { key: "rui", name: "Rui Takeda", handle: "rui", email: "rui@kestrel.example", role: "field_technician", ws: "kestrel" },
  { key: "sam", name: "Sam Lindqvist", handle: "sam", email: "sam@kestrel.example", role: "field_technician", ws: "kestrel" },
  { key: "priya", name: "Priya Venkat", handle: "priya", email: "priya@kestrel.example", role: "crew_lead", ws: "kestrel" },
  { key: "marco", name: "Marco Bellini", handle: "marco", email: "marco@kestrel.example", role: "crew_lead", ws: "kestrel" },
  { key: "jo", name: "Jo Adeyemi", handle: "jo", email: "jo@kestrel.example", role: "ops_manager", ws: "kestrel" },
  { key: "lee", name: "Lee Moreau", handle: "lee", email: "lee@halvard.example", role: "ops_manager", ws: "halvard" },
  { key: "ari", name: "Ari Novak", handle: "ari", email: "ari@halvard.example", role: "field_technician", ws: "halvard" },
] as const;

const CHANNELS = [
  { name: "shift-bulletins", ws: "kestrel", kind: "broadcast", private: false, members: ["dana", "rui", "sam", "priya", "marco", "jo"] },
  { name: "crew-main", ws: "kestrel", kind: "crew", private: false, members: ["dana", "rui", "sam", "priya", "marco", "jo"] },
  { name: "install-team", ws: "kestrel", kind: "crew", private: false, members: ["dana", "rui", "priya", "marco", "jo"] },
  { name: "weekend-emergency", ws: "kestrel", kind: "crew", private: true, members: ["dana", "rui", "sam", "priya", "jo"] },
  { name: "site-store-114", ws: "kestrel", kind: "crew", private: false, members: ["dana", "rui", "priya", "marco", "jo"] },
  { name: "halvard-crew", ws: "halvard", kind: "crew", private: false, members: ["lee", "ari"] },
] as const;

const MESSAGES = [
  { channel: "shift-bulletins", author: "priya", pinnedBy: "priya", text: "LOCKOUT — Store 114 rooftop RTU-3 is locked and tagged out pending compressor replacement. Do not reset the disconnect." },
  { channel: "site-store-114", author: "dana", pinnedBy: null, text: "Store 114 walk-in WIC-2: target superheat 8°F at the evaporator outlet. Send a gauge photo when you set it." },
  { channel: "weekend-emergency", author: "dana", pinnedBy: null, text: "Store 114 after hours: gate code 4471#, alarm panel is left of the dock door." },
  { channel: "crew-main", author: "marco", pinnedBy: null, text: "Van 6 has the spare TXV kit and the 404A jug." },
  { channel: "halvard-crew", author: "lee", pinnedBy: null, text: "Store 114 walk-in door heater swap booked for Thursday." },
] as const;

// Creates the seed once; later serves find it and change nothing. Runs under the schema lock.
export async function seed(client: pg.PoolClient): Promise<void> {
  const present = await one(client, "SELECT 1 FROM workspaces WHERE name = $1", [WORKSPACES[0].name]);
  if (present) return;

  const created = now();
  const workspaceIds = new Map<string, string>();
  for (const ws of WORKSPACES) {
    const id = randomUUID();
    workspaceIds.set(ws.key, id);
    await client.query("INSERT INTO workspaces (id, name, time_zone) VALUES ($1, $2, $3)", [id, ws.name, ws.timeZone]);
  }

  const passwordHash = await hashPassword(PASSWORD);
  const userIds = new Map<string, string>();
  for (const person of PEOPLE) {
    const id = randomUUID();
    userIds.set(person.key, id);
    await client.query(
      `INSERT INTO users (id, workspace_id, name, handle, email, role, status, password_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8)`,
      [id, workspaceIds.get(person.ws), person.name, person.handle, person.email, person.role, passwordHash, created],
    );
  }

  const channelIds = new Map<string, string>();
  for (const channel of CHANNELS) {
    const id = randomUUID();
    channelIds.set(channel.name, id);
    await client.query("INSERT INTO channels (id, workspace_id, name, kind, private) VALUES ($1, $2, $3, $4, $5)", [
      id, workspaceIds.get(channel.ws), channel.name, channel.kind, channel.private,
    ]);
    for (const member of channel.members) {
      await client.query("INSERT INTO memberships (channel_id, user_id, joined_at) VALUES ($1, $2, $3)", [id, userIds.get(member), created]);
    }
  }

  for (const [index, message] of MESSAGES.entries()) {
    const id = randomUUID();
    const sentAt = addSeconds(created, index + 1);
    const channel = CHANNELS.find((c) => c.name === message.channel);
    const channelId = channelIds.get(message.channel);
    const authorId = userIds.get(message.author);
    if (!channel || !channelId || !authorId) throw new Error("seed table mismatch");
    await client.query(
      `INSERT INTO messages (id, workspace_id, channel_id, author_id, via_send, text, version, sent_at, editable_until, pinned_by, pinned_at)
       VALUES ($1, $2, $3, $4, false, $5, 1, $6, $7, $8, $9)`,
      [
        id, workspaceIds.get(channel.ws), channelId, authorId, message.text, sentAt,
        addSeconds(sentAt, config.editWindowSeconds),
        message.pinnedBy ? userIds.get(message.pinnedBy) : null,
        message.pinnedBy ? created : null,
      ],
    );
    await client.query("INSERT INTO message_versions (message_id, version, text, edited_by, created_at) VALUES ($1, 1, $2, $3, $4)", [
      id, message.text, authorId, sentAt,
    ]);
    await client.query(
      `INSERT INTO deliveries (message_id, user_id)
       SELECT $1, user_id FROM memberships WHERE channel_id = $2 AND user_id <> $3`,
      [id, channelId, authorId],
    );
  }
}
