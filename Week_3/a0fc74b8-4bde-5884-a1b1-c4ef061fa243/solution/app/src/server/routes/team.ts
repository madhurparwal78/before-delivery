import { Hono } from "hono";
import { pool, tx } from "../db.js";
import { ApiError, forbidden, notFound, validation } from "../errors.js";
import { VALIDATION_COPY } from "../../shared/copy.js";
import { can } from "../domain/permissions.js";
import { announce } from "../domain/rows.js";
import { isUuid } from "../util.js";
import type { MemberJson, Role, TeamJson } from "../../shared/types.js";
import { jsonBody, requireActor } from "./context.js";

export const teamRoutes = new Hono();

teamRoutes.get("/", async (c) => {
  const actor = await requireActor(c);
  const { rows: teams } = await pool.query<{ id: string; name: string }>("SELECT id, name FROM teams WHERE id = $1", [actor.teamId]);
  const { rows: members } = await pool.query<MemberJson>("SELECT id, email, name, role FROM users WHERE team_id = $1 ORDER BY name, email", [actor.teamId]);
  const team = teams[0];
  if (!team) throw notFound();
  const body: TeamJson = { id: team.id, name: team.name, members };
  return c.json(body);
});

teamRoutes.patch("/members/:userId", async (c) => {
  const actor = await requireActor(c);
  const userId = c.req.param("userId");
  const body = await jsonBody(c);
  const member = await tx(async (client) => {
    // One role change per team at a time: two owners stepping down together must not both see the other as the remaining owner.
    await client.query("SELECT id FROM teams WHERE id = $1 FOR UPDATE", [actor.teamId]);
    const { rows } = await client.query<MemberJson>(
      "SELECT id, email, name, role FROM users WHERE id = $1 AND team_id = $2 FOR UPDATE",
      [isUuid(userId) ? userId : null, actor.teamId],
    );
    const target = rows[0];
    if (!target) throw notFound();
    if (!can(actor, "team.manage")) throw forbidden();
    const role = body["role"];
    if (role !== "owner" && role !== "member" && role !== "viewer") throw validation({ role: VALIDATION_COPY.role });
    if (target.role === "owner" && role !== "owner") {
      const { rows: owners } = await client.query("SELECT 1 FROM users WHERE team_id = $1 AND role = 'owner' AND id <> $2", [actor.teamId, target.id]);
      if (owners.length === 0) throw new ApiError(409, { error: "last_owner" });
    }
    await client.query("UPDATE users SET role = $2 WHERE id = $1", [target.id, role satisfies Role]);
    await announce(client, { type: "role", userId: target.id });
    return { ...target, role };
  });
  return c.json(member);
});
