import type { PoolClient } from "pg";
import { CATEGORIES, DIRECTIONS, RANKS, ROLES, VISIBILITIES, type Direction, type Layout, type Rank, type Role, type Visibility } from "../shared/protocol.js";
import { one, query, tx } from "./db.js";
import { checkGlb } from "./glb.js";
import { generateModel } from "./glbmaker.js";
import { Refusal } from "./http.js";
import { hashPassword, newId } from "./people.js";
import type { Kind } from "./rank.js";
import { parseLayout, stanceRecord, tileKey, type Stance } from "./room.js";
import { putObject, saving, versionKey } from "./storage.js";
import { START_PATTERN, isZone } from "./zones.js";
import { positionsKey, presenceKey, run, tilesKey, membersKey } from "./valkey.js";
import { worldNow } from "./clock.js";

/** The reason a world description cannot be built: answered as 422 with free text. */
const bad = (reason: string): Refusal => new Refusal(422, reason);

type Spec = Record<string, unknown>;

const list = (value: unknown, name: string): Spec[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "object" || item === null || Array.isArray(item))) throw bad(`${name} should be a list of objects.`);
  return value as Spec[];
};

const str = (value: unknown, name: string): string => {
  if (typeof value !== "string" || value === "") throw bad(`${name} should be a non-empty string.`);
  return value;
};

interface WorldIds {
  worldId: string;
  people: Record<string, string>;
  communities: Record<string, string>;
  avatars: Record<string, string>;
  rooms: Record<string, string>;
  sessions: Record<string, string>;
  reports: Record<string, string>;
  gatherings: Record<string, string>;
}

const pick = (ids: Record<string, string>, key: unknown, what: string): string => {
  const found = typeof key === "string" ? ids[key] : undefined;
  if (!found) throw bad(`${what} refers to something that is not in this world: ${String(key)}.`);
  return found;
};

interface VersionSpec {
  rank: Rank;
  layout: Layout | null;
  published: boolean;
}

function versionsOf(spec: Spec, kind: Kind): VersionSpec[] {
  const raw = spec.versions === undefined ? [{ rank: spec.rank, layout: spec.layout, published: true }] : list(spec.versions, "versions");
  if (raw.length === 0) throw bad("versions should not be empty.");
  return raw.map((item) => {
    const rank = (item.rank ?? "Feather") as Rank;
    if (!RANKS.includes(rank)) throw bad(`rank should be one of ${RANKS.join(", ")}.`);
    const layout = kind === "room" ? parseLayout(item.layout) : null;
    if (kind === "room" && !layout) throw bad("A room needs a valid layout.");
    return { rank, layout, published: item.published !== false };
  });
}

interface PlacedSession {
  sessionId: string;
  roomId: string;
  layout: Layout;
  members: { personId: string; stance: Stance }[];
}

/**
 * Builds one world from its description: everyone and everything belongs to `worldId`. Models are generated
 * and stored in MinIO, placed people are written to Valkey, and nothing stays if any step fails.
 */
export async function createWorld(body: Spec, worldId: string, options: { newWorld: boolean; client?: PoolClient } = { newWorld: true }): Promise<WorldIds> {
  const ids: WorldIds = { worldId, people: {}, communities: {}, avatars: {}, rooms: {}, sessions: {}, reports: {}, gatherings: {} };
  const people = list(body.people, "people");
  const hashes = await Promise.all(people.map((person) => hashPassword(typeof person.password === "string" ? person.password : "")));
  const placed: PlacedSession[] = [];
  const build = async (client: PoolClient): Promise<void> => {
    if (options.newWorld) await query("INSERT INTO worlds (id) VALUES ($1)", [worldId], client);
    for (const [index, person] of people.entries()) {
      const key = str(person.key, "person key");
      const email = str(person.email, "person email").trim().toLowerCase();
      if (typeof person.password !== "string" || person.password.length < 1) throw bad("A person needs a password.");
      if (!isZone(person.timeZone)) throw bad("A person needs a time zone from the list.");
      const role = person.siteRole ?? "member";
      if (role !== "member" && role !== "moderator") throw bad("siteRole should be member or moderator.");
      if (await one("SELECT 1 AS ok FROM people WHERE email = $1", [email], client)) throw bad(`The email ${email} is already used.`);
      const id = newId();
      ids.people[key] = id;
      await query(
        "INSERT INTO people (id, world_id, email, password_hash, display_name, time_zone, site_role, confirmed) VALUES ($1, $2, $3, $4, $5, $6, $7, true)",
        [id, worldId, email, hashes[index], str(person.displayName, "displayName"), person.timeZone, role],
        client,
      );
    }
    for (const pair of Array.isArray(body.friendships) ? body.friendships : []) {
      const [a, b] = (Array.isArray(pair) ? pair : []) as unknown[];
      const first = pick(ids.people, a, "friendship");
      const second = pick(ids.people, b, "friendship");
      await query("INSERT INTO friendships (a, b) VALUES ($1, $2) ON CONFLICT DO NOTHING", first < second ? [first, second] : [second, first], client);
    }
    for (const block of list(body.blocks, "blocks")) {
      await query("INSERT INTO blocks (from_id, to_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [pick(ids.people, block.from, "block"), pick(ids.people, block.to, "block")], client);
    }
    for (const mute of list(body.mutes, "mutes")) {
      await query("INSERT INTO mutes (from_id, to_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [pick(ids.people, mute.from, "mute"), pick(ids.people, mute.to, "mute")], client);
    }
    for (const community of list(body.communities, "communities")) {
      if (!isZone(community.timeZone)) throw bad("A community needs a time zone from the list.");
      const id = newId();
      ids.communities[str(community.key, "community key")] = id;
      await query("INSERT INTO communities (id, world_id, name, time_zone) VALUES ($1, $2, $3, $4)", [id, worldId, str(community.name, "community name"), community.timeZone], client);
      for (const member of list(community.members, "members")) {
        if (!ROLES.includes(member.role as Role)) throw bad("A member role should be owner, steward or member.");
        await query("INSERT INTO community_members (community_id, person_id, role) VALUES ($1, $2, $3)", [id, pick(ids.people, member.person, "community member"), member.role], client);
      }
    }
    const layouts = new Map<string, Layout>();
    for (const [kind, group, target] of [["avatar", "avatars", ids.avatars], ["room", "rooms", ids.rooms]] as const) {
      for (const spec of list(body[group], group)) {
        const id = newId();
        target[str(spec.key, `${kind} key`)] = id;
        const name = str(spec.name, `${kind} name`);
        const versions = versionsOf(spec, kind);
        await query("INSERT INTO assets (id, world_id, owner_id, kind, name, next_version) VALUES ($1, $2, $3, $4, $5, $6)", [
          id, worldId, pick(ids.people, spec.owner, `${kind} owner`), kind, name, versions.length + 1,
        ], client);
        let current: number | null = null;
        for (const [at, version] of versions.entries()) {
          const bytes = generateModel(kind, version.rank, name);
          const checked = checkGlb(kind, bytes);
          if (!checked.ok) throw bad(checked.message);
          await saving(() => putObject(versionKey(id, at + 1), bytes));
          await query(
            `INSERT INTO asset_versions (asset_id, version, status, rank, worst_measure, measures, measure_ranks, layout)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [id, at + 1, version.published ? "published" : "checked", checked.rank, checked.worstMeasure, checked.measures, checked.measureRanks, version.layout],
            client,
          );
          if (version.published) current = at + 1;
          if (version.layout) layouts.set(`${id}:${at + 1}`, version.layout);
        }
        await query("UPDATE assets SET current_version = $2 WHERE id = $1", [id, current], client);
      }
    }
    for (const person of people) {
      if (person.avatar !== undefined) await query("UPDATE people SET avatar_id = $2 WHERE id = $1", [ids.people[person.key as string], pick(ids.avatars, person.avatar, "avatar")], client);
    }
    for (const spec of list(body.sessions, "sessions")) {
      const visibility = spec.visibility as Visibility;
      if (!VISIBILITIES.includes(visibility)) throw bad("A session visibility should be public, friends, community or invite.");
      const roomId = pick(ids.rooms, spec.room, "session room");
      const room = await one<{ current_version: number | null }>("SELECT current_version FROM assets WHERE id = $1", [roomId], client);
      if (!room?.current_version) throw bad("A session's room needs a published version.");
      const layout = layouts.get(`${roomId}:${room.current_version}`) as Layout;
      const capacity = spec.capacity;
      if (typeof capacity !== "number" || !Number.isInteger(capacity) || capacity < 1) throw bad("A session needs a capacity of at least 1.");
      const hostId = pick(ids.people, spec.host, "session host");
      const communityId = spec.community === null || spec.community === undefined ? null : pick(ids.communities, spec.community, "session community");
      const id = newId();
      ids.sessions[str(spec.key, "session key")] = id;
      await query("INSERT INTO sessions (id, world_id, room_id, host_id, visibility, capacity, community_id) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
        id, worldId, roomId, hostId, visibility, capacity, communityId,
      ], client);
      for (const invitee of Array.isArray(spec.invitees) ? spec.invitees : []) {
        await query("INSERT INTO session_invitees (session_id, person_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [id, pick(ids.people, invitee, "session invitee")], client);
      }
      const placements = list(spec.placements, "placements");
      const first = layout.spawn[0] ?? { x: 0, y: 0 };
      const members: PlacedSession["members"] = (placements.length > 0 ? placements : [{ person: spec.host, x: first.x, y: first.y, facing: "south" }]).map((placement) => {
        const x = placement.x as number;
        const y = placement.y as number;
        if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= layout.width || y >= layout.height) throw bad("A placement should be inside the room.");
        if (!DIRECTIONS.includes(placement.facing as Direction)) throw bad("A placement should face north, east, south or west.");
        return { personId: pick(ids.people, placement.person, "placement"), stance: { x, y, facing: placement.facing as Direction, seated: false, from: null, at: 0 } };
      });
      for (const member of members) {
        await query("INSERT INTO session_members (session_id, person_id, joined_seq, room_version, gone) VALUES ($1, $2, nextval('join_seq'), $3, false)", [
          id, member.personId, room.current_version,
        ], client);
      }
      placed.push({ sessionId: id, roomId, layout, members });
    }
    for (const report of list(body.reports, "reports")) {
      pick(ids.people, report.filer, "report filer");
      const state = report.state ?? "open";
      if (!CATEGORIES.includes(report.category as (typeof CATEGORIES)[number])) throw bad("A report category should be harassment, hateful-content, impersonation or other.");
      const id = newId();
      ids.reports[str(report.key, "report key")] = id;
      await query("INSERT INTO reports (id, world_id, person_id, session_id, category, details, state, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", [
        id, worldId, pick(ids.people, report.person, "report person"), pick(ids.sessions, report.session, "report session"), report.category,
        str(report.details, "report details"), state, await worldNow(worldId, client),
      ], client);
    }
    for (const gathering of list(body.gatherings, "gatherings")) {
      if (!START_PATTERN.test(str(gathering.startsLocal, "startsLocal"))) throw bad("A gathering needs startsLocal like 2027-03-07T19:00.");
      if (gathering.recurrence !== "none" && gathering.recurrence !== "weekly") throw bad("A gathering recurrence should be none or weekly.");
      const id = newId();
      ids.gatherings[str(gathering.key, "gathering key")] = id;
      await query("INSERT INTO gatherings (id, community_id, title, starts_local, duration_minutes, recurrence, attend_limit) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
        id, pick(ids.communities, gathering.community, "gathering community"), str(gathering.title, "gathering title"), gathering.startsLocal,
        gathering.durationMinutes, gathering.recurrence, gathering.limit,
      ], client);
      for (const attendee of Array.isArray(gathering.attending) ? gathering.attending : []) {
        await query("INSERT INTO attendees (gathering_id, person_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [id, pick(ids.people, attendee, "attending")], client);
      }
    }
    if (placed.length > 0) await writePlacements(placed);
  };
  await (options.client ? build(options.client) : tx(build));
  return ids;
}

/** Placed people hold their tiles in Valkey and read as present, with no socket. */
async function writePlacements(sessions: PlacedSession[]): Promise<void> {
  await run(async (client) => {
    for (const session of sessions) {
      for (const { personId, stance } of session.members) {
        await client.hset(positionsKey(session.sessionId), personId, stanceRecord(stance));
        await client.hset(tilesKey(session.sessionId), tileKey(stance.x, stance.y), personId);
        await client.sadd(membersKey(session.sessionId), personId);
        await client.set(presenceKey(personId), "1");
      }
    }
  });
}
