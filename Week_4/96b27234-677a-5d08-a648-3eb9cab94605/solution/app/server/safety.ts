import { invalid, reply, Router, type Context, type Reply } from "./http.js";
import { query } from "./db.js";
import { friendsHint, notifyPerson, repaintSessionsOf } from "./notify.js";
import { requirePerson, type Person } from "./people.js";

async function target(ctx: Context, person: Person): Promise<string> {
  const other = await requirePerson(ctx.params.personId ?? "", person.worldId);
  if (other.id === person.id) throw invalid("You cannot do that to yourself.");
  return other.id;
}

export function safetyRoutes(router: Router<Person>): void {
  router.add("POST", "/api/blocks/:personId", async (ctx, person): Promise<Reply> => {
    const id = await target(ctx, person);
    await query("INSERT INTO blocks (from_id, to_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [person.id, id]);
    await changed(person.id, id);
    return reply(200, { blocked: true });
  });

  router.add("DELETE", "/api/blocks/:personId", async (ctx, person): Promise<Reply> => {
    const id = await target(ctx, person);
    await query("DELETE FROM blocks WHERE from_id = $1 AND to_id = $2", [person.id, id]);
    await changed(person.id, id);
    return reply(200, { blocked: false });
  });

  router.add("POST", "/api/mutes/:personId", async (ctx, person): Promise<Reply> => {
    const id = await target(ctx, person);
    await query("INSERT INTO mutes (from_id, to_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [person.id, id]);
    return reply(200, { muted: true });
  });

  router.add("DELETE", "/api/mutes/:personId", async (ctx, person): Promise<Reply> => {
    const id = await target(ctx, person);
    await query("DELETE FROM mutes WHERE from_id = $1 AND to_id = $2", [person.id, id]);
    return reply(200, { muted: false });
  });
}

/** A block changes names, avatars and friend lists on both sides at once. */
async function changed(a: string, b: string): Promise<void> {
  await repaintSessionsOf([a, b]);
  await Promise.all([friendsHint(a), friendsHint(b), notifyPerson(a, { type: "friends" }), notifyPerson(b, { type: "friends" })]);
}

