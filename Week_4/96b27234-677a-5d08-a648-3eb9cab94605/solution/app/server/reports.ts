import { CATEGORIES } from "../shared/protocol.js";
import { worldNow } from "./clock.js";
import { conflict, invalid, notFound, reply, Router, text, textLength, type Reply } from "./http.js";
import { one, query } from "./db.js";
import { removeEverywhere } from "./membership.js";
import { notifyPerson } from "./notify.js";
import { newId, requirePerson, type Person } from "./people.js";

interface ReportRow {
  id: string;
  person_id: string;
  person_name: string;
  session_id: string;
  room_name: string;
  category: string;
  details: string;
  state: string;
  action: string | null;
  created_at: Date;
}

const SELECT = `
  SELECT r.id, r.person_id, p.display_name AS person_name, r.session_id, a.name AS room_name, r.category, r.details, r.state, r.action, r.created_at
  FROM reports r JOIN people p ON p.id = r.person_id JOIN sessions s ON s.id = r.session_id JOIN assets a ON a.id = s.room_id`;

const view = (row: ReportRow): Record<string, unknown> => ({
  id: row.id,
  personId: row.person_id,
  personName: row.person_name,
  sessionId: row.session_id,
  roomName: row.room_name,
  category: row.category,
  details: row.details,
  state: row.state,
  action: row.action,
  createdAt: row.created_at.toISOString(),
});

const LEGAL: Record<string, string[]> = { open: ["reviewing"], reviewing: ["upheld", "dismissed"], upheld: [], dismissed: [] };

function moderator(person: Person): void {
  if (person.siteRole !== "moderator") throw notFound();
}

/** Ends a person's sign-ins and live sessions at once; the next request and later sign-ins are refused. */
async function suspend(personId: string): Promise<void> {
  await query("UPDATE people SET suspended = true WHERE id = $1", [personId]);
  await query("DELETE FROM auth_tokens WHERE person_id = $1", [personId]);
  const left = await removeEverywhere(personId);
  if (left > 0) await notifyPerson(personId, { type: "notice", text: "A moderator has removed you from this session." });
}

async function warn(personId: string): Promise<void> {
  await query("INSERT INTO warnings (person_id) VALUES ($1)", [personId]);
  await notifyPerson(personId, { type: "warning" });
}

export function reportRoutes(router: Router<Person>): void {
  router.add("POST", "/api/reports", async (ctx, person): Promise<Reply> => {
    const body = ctx.json();
    const session = await one<{ id: string }>("SELECT id FROM sessions WHERE id = $1 AND world_id = $2 AND status = 'open'", [text(body.sessionId) ?? "", person.worldId]);
    if (!session) throw notFound();
    const reported = await requirePerson(text(body.personId) ?? "", person.worldId);
    const been = await one("SELECT 1 AS ok FROM session_members WHERE session_id = $1 AND person_id = $2", [session.id, person.id]);
    if (!been) throw notFound();
    const details = text(body.details) ?? "";
    if (!(CATEGORIES as readonly unknown[]).includes(body.category)) throw invalid("Choose a category.");
    if (textLength(details) < 1 || textLength(details) > 1000) throw invalid("Write 1 to 1000 characters.");
    if (reported.id === person.id) throw invalid("You cannot report yourself.");
    const id = newId();
    await query("INSERT INTO reports (id, world_id, person_id, session_id, category, details, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
      id,
      person.worldId,
      reported.id,
      session.id,
      body.category,
      details,
      await worldNow(person.worldId),
    ]);
    return reply(201, { id, state: "open" });
  });

  router.add("GET", "/api/moderation/reports", async (_ctx, person): Promise<Reply> => {
    moderator(person);
    const rows = await query<ReportRow>(`${SELECT} WHERE r.world_id = $1 ORDER BY r.created_at DESC, r.id`, [person.worldId]);
    return reply(200, { reports: rows.map(view) });
  });

  router.add("POST", "/api/moderation/reports/:id/move", async (ctx, person): Promise<Reply> => {
    moderator(person);
    const row = await one<ReportRow>(`${SELECT} WHERE r.id = $1 AND r.world_id = $2`, [ctx.params.id ?? "", person.worldId]);
    if (!row) throw notFound();
    const body = ctx.json();
    const state = text(body.state) ?? "";
    if (!Object.hasOwn(LEGAL, state)) throw invalid("Choose a valid state.");
    if (!LEGAL[row.state]?.includes(state)) throw conflict("This report cannot move that way.");
    const action = body.action;
    if (state === "upheld" && action !== "warn" && action !== "suspend") throw invalid("Choose warn or suspend.");
    const moved = await one<{ id: string }>(
      "UPDATE reports SET state = $2, action = $3 WHERE id = $1 AND state = $4 RETURNING id",
      [row.id, state, state === "upheld" ? action : null, row.state],
    );
    if (!moved) throw conflict("This report cannot move that way.");
    if (state === "upheld") await (action === "warn" ? warn(row.person_id) : suspend(row.person_id));
    const fresh = await one<ReportRow>(`${SELECT} WHERE r.id = $1`, [row.id]);
    return reply(200, view(fresh as ReportRow));
  });
}
