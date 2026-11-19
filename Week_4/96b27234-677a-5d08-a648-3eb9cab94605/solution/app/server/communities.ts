import { ROLES, type Role } from "../shared/protocol.js";
import { conflict, invalid, notFound, reply, Router, text, textLength, type Reply } from "./http.js";
import { one, query, tx } from "./db.js";
import { memberCommunity } from "./gatherings.js";
import { removeEverywhere } from "./membership.js";
import { notifyPerson } from "./notify.js";
import { newId, requirePerson, type Person } from "./people.js";
import { isZone } from "./zones.js";

interface MemberRow {
  person_id: string;
  display_name: string;
  email: string;
  role: Role;
  joined_at: Date;
}

export function communityRoutes(router: Router<Person>): void {
  router.add("GET", "/api/communities", async (_ctx, person): Promise<Reply> => {
    const rows = await query<{ id: string; name: string; time_zone: string; role: Role }>(
      `SELECT c.id, c.name, c.time_zone, m.role FROM communities c JOIN community_members m ON m.community_id = c.id
       WHERE m.person_id = $1 AND c.world_id = $2 ORDER BY c.name, c.id`,
      [person.id, person.worldId],
    );
    return reply(200, { communities: rows.map((row) => ({ id: row.id, name: row.name, timeZone: row.time_zone, role: row.role })) });
  });

  router.add("POST", "/api/communities", async (ctx, person): Promise<Reply> => {
    const body = ctx.json();
    const name = (text(body.name) ?? "").trim();
    if (textLength(name) < 1 || textLength(name) > 80) throw invalid("Give the community a name of 1 to 80 characters.");
    if (!isZone(body.timeZone)) throw invalid("Choose a time zone from the list.");
    const id = newId();
    await query("INSERT INTO communities (id, world_id, name, time_zone) VALUES ($1, $2, $3, $4)", [id, person.worldId, name, body.timeZone]);
    await query("INSERT INTO community_members (community_id, person_id, role) VALUES ($1, $2, 'owner')", [id, person.id]);
    return reply(201, { id, name, timeZone: body.timeZone, role: "owner" });
  });

  router.add("GET", "/api/communities/:id/members", async (ctx, person): Promise<Reply> => {
    const community = await memberCommunity(ctx.params.id ?? "", person);
    const rows = await query<MemberRow>(
      `SELECT m.person_id, p.display_name, p.email, m.role, m.joined_at FROM community_members m JOIN people p ON p.id = m.person_id
       WHERE m.community_id = $1 ORDER BY m.joined_at, p.display_name, p.id`,
      [community.id],
    );
    const members = rows.map((row) => ({
      personId: row.person_id,
      displayName: row.display_name,
      role: row.role,
      ...(community.role !== "member" ? { joinedAt: row.joined_at.toISOString() } : {}),
      ...(community.role === "owner" ? { email: row.email } : {}),
    }));
    return reply(200, { members, total: members.length });
  });

  router.add("POST", "/api/communities/:id/members", async (ctx, person): Promise<Reply> => {
    const community = await memberCommunity(ctx.params.id ?? "", person);
    if (community.role === "member") throw notFound();
    const added = await requirePerson(text(ctx.json().personId) ?? "", person.worldId);
    await query("INSERT INTO community_members (community_id, person_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING", [community.id, added.id]);
    const row = await one<{ role: Role }>("SELECT role FROM community_members WHERE community_id = $1 AND person_id = $2", [community.id, added.id]);
    await notifyPerson(added.id, { type: "role" });
    return reply(201, { personId: added.id, role: row?.role ?? "member" });
  });

  router.add("PUT", "/api/communities/:id/members/:personId", async (ctx, person): Promise<Reply> => {
    const community = await memberCommunity(ctx.params.id ?? "", person);
    if (community.role !== "owner") throw notFound();
    const target = await one<{ role: Role }>("SELECT role FROM community_members WHERE community_id = $1 AND person_id = $2", [community.id, ctx.params.personId ?? ""]);
    if (!target) throw notFound();
    const role = ctx.json().role;
    if (!(ROLES as readonly unknown[]).includes(role)) throw invalid("Choose owner, steward or member.");
    await tx(async (client) => {
      const owners = await query<{ person_id: string }>("SELECT person_id FROM community_members WHERE community_id = $1 AND role = 'owner' FOR UPDATE", [community.id], client);
      const current = owners.some((owner) => owner.person_id === ctx.params.personId);
      if (current && role !== "owner" && owners.length < 2) throw conflict("A community needs an owner.");
      await query("UPDATE community_members SET role = $3 WHERE community_id = $1 AND person_id = $2", [community.id, ctx.params.personId, role], client);
    });
    await notifyPerson(ctx.params.personId ?? "", { type: "role" });
    return reply(200, { personId: ctx.params.personId, role });
  });

  router.add("DELETE", "/api/communities/:id/members/:personId", async (ctx, person): Promise<Reply> => {
    const community = await memberCommunity(ctx.params.id ?? "", person);
    if (community.role === "member") throw notFound();
    const targetId = ctx.params.personId ?? "";
    const target = await one<{ role: Role }>("SELECT role FROM community_members WHERE community_id = $1 AND person_id = $2", [community.id, targetId]);
    if (!target || targetId === person.id || (community.role === "steward" && target.role !== "member")) throw notFound();
    await query("DELETE FROM community_members WHERE community_id = $1 AND person_id = $2", [community.id, targetId]);
    await removeEverywhere(targetId, community.id);
    await notifyPerson(targetId, { type: "notice", text: "You are no longer in this community." });
    await notifyPerson(targetId, { type: "role" });
    return reply(200, { status: "removed" });
  });
}

