import type { VoteView } from "../shared/protocol.js";
import { conflict, invalid, notFound, reply, Router, text, type Reply } from "./http.js";
import { one, query, tx, type Db } from "./db.js";
import { worldNow } from "./clock.js";
import { config } from "./config.js";
import { leaveSession } from "./membership.js";
import { notifyPerson, notifySession } from "./notify.js";
import { newId, type Person } from "./people.js";
import { loadSession, isInside, type SessionRow } from "./sessiondata.js";
import { live } from "./valkey.js";

/** Yes votes needed: 60% of the eligible, rounded up. */
const votesNeeded = (eligible: number): number => Math.ceil((eligible * 60) / 100);

interface VoteRow {
  id: string;
  target_id: string;
  status: "open" | "passed" | "failed";
  eligible: number;
  needed: number;
  closes_at: Date;
  yes: number;
  no: number;
}

const VOTE_SELECT = `
  SELECT v.id, v.target_id, v.status, v.eligible, v.needed, v.closes_at,
         (SELECT count(*) FROM ballots b WHERE b.vote_id = v.id AND b.choice = 'yes') AS yes,
         (SELECT count(*) FROM ballots b WHERE b.vote_id = v.id AND b.choice = 'no') AS no
  FROM votes v`;

const toView = (row: VoteRow): VoteView => ({
  id: row.id,
  targetId: row.target_id,
  status: row.status,
  eligible: row.eligible,
  needed: row.needed,
  yes: row.yes,
  no: row.no,
  closesAt: row.closes_at.toISOString(),
});

export async function votesOf(sessionId: string, db?: Db): Promise<VoteView[]> {
  const rows = await query<VoteRow>(`${VOTE_SELECT} WHERE v.session_id = $1 ORDER BY v.created_at, v.id`, [sessionId], db);
  return rows.map(toView);
}

/** Closes every vote of the world whose window has run out, and tells each room its vote did not pass. */
export async function closeDueVotes(worldId?: string): Promise<void> {
  const closed = await query<{ session_id: string }>(
    `UPDATE votes v SET status = 'failed' FROM sessions s
     WHERE s.id = v.session_id AND v.status = 'open' AND v.closes_at <= world_now(s.world_id) AND ($1::text IS NULL OR s.world_id = $1)
     RETURNING v.session_id`,
    [worldId ?? null],
  );
  for (const row of closed) await notifySession(row.session_id, { kind: "state", notes: [{ t: "vote-failed" }] });
}

/** Votes whose pass removes the target at once. */
async function pass(session: SessionRow, vote: VoteRow): Promise<void> {
  await leaveSession(session.id, vote.target_id, { forced: true, ban: true, notes: [{ t: "removed-vote", p: vote.target_id }] });
  await notifyPerson(vote.target_id, { type: "notice", text: "The room voted to remove you." });
}

async function insideSession(ctx: { params: Record<string, string> }, person: Person): Promise<SessionRow> {
  const session = await loadSession(ctx.params.id ?? "", person.worldId);
  if (!session || !(await isInside(session.id, person.id))) throw notFound();
  return session;
}

export function voteRoutes(router: Router<Person>): void {
  router.add("GET", "/api/sessions/:id/votes", async (ctx, person): Promise<Reply> => {
    const session = await insideSession(ctx, person);
    await closeDueVotes(person.worldId);
    return reply(200, { votes: await votesOf(session.id) });
  });

  router.add("POST", "/api/sessions/:id/votes", async (ctx, person): Promise<Reply> => {
    const session = await insideSession(ctx, person);
    const body = ctx.json();
    const targetId = text(body.personId) ?? "";
    const target = await one<{ person_id: string }>(
      "SELECT person_id FROM session_members WHERE session_id = $1 AND person_id = $2 AND NOT gone",
      [session.id, targetId],
    );
    if (!target) throw notFound();
    if (targetId === person.id) throw invalid("You cannot start a vote about yourself.");
    live();
    await closeDueVotes(person.worldId);
    const created = await tx(async (client) => {
      await query("SELECT id FROM sessions WHERE id = $1 FOR UPDATE", [session.id], client);
      const eligible = (
        await query<{ person_id: string }>(
          "SELECT person_id FROM session_members WHERE session_id = $1 AND NOT gone AND person_id <> $2",
          [session.id, targetId],
          client,
        )
      ).map((row) => row.person_id);
      if (eligible.length < 2) throw conflict("Too few people to vote.");
      const open = await one("SELECT 1 AS ok FROM votes WHERE session_id = $1 AND target_id = $2 AND status = 'open'", [session.id, targetId], client);
      if (open) throw conflict("A vote on this person is already open.");
      const now = await worldNow(person.worldId, client);
      const id = newId();
      await query(
        "INSERT INTO votes (id, session_id, target_id, created_at, closes_at, eligible, needed) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [id, session.id, targetId, now, new Date(now.getTime() + config.voteWindowSeconds * 1000), eligible.length, votesNeeded(eligible.length)],
        client,
      );
      for (const eligibleId of eligible) await query("INSERT INTO vote_eligible (vote_id, person_id) VALUES ($1, $2)", [id, eligibleId], client);
      await query("INSERT INTO ballots (vote_id, person_id, choice) VALUES ($1, $2, 'yes')", [id, person.id], client);
      return id;
    });
    await notifySession(session.id, { kind: "state", notes: [] });
    const view = (await votesOf(session.id)).find((vote) => vote.id === created);
    return reply(201, view);
  });

  router.add("POST", "/api/sessions/:id/votes/:voteId/ballots", async (ctx, person): Promise<Reply> => {
    const session = await insideSession(ctx, person);
    const choice = ctx.json().choice;
    live();
    await closeDueVotes(person.worldId);
    const outcome = await tx(async (client) => {
      const locked = await one<{ id: string }>("SELECT id FROM votes WHERE id = $1 AND session_id = $2 FOR UPDATE", [ctx.params.voteId ?? "", session.id], client);
      if (!locked) throw notFound();
      const row = (await one<VoteRow>(`${VOTE_SELECT} WHERE v.id = $1`, [locked.id], client)) as VoteRow;
      if (row.status !== "open" || row.closes_at <= (await worldNow(person.worldId, client))) throw conflict("This vote has closed.");
      const eligible = await one("SELECT 1 AS ok FROM vote_eligible WHERE vote_id = $1 AND person_id = $2", [row.id, person.id], client);
      if (!eligible) throw conflict("You cannot vote on this.");
      if (await one("SELECT 1 AS ok FROM ballots WHERE vote_id = $1 AND person_id = $2", [row.id, person.id], client)) {
        throw conflict("You have already voted.");
      }
      if (choice !== "yes" && choice !== "no") throw invalid("Choose yes or no.");
      await query("INSERT INTO ballots (vote_id, person_id, choice) VALUES ($1, $2, $3)", [row.id, person.id, choice], client);
      const yes = row.yes + (choice === "yes" ? 1 : 0);
      const passed = yes >= row.needed;
      if (passed) await query("UPDATE votes SET status = 'passed' WHERE id = $1", [row.id], client);
      return { row, passed };
    });
    if (outcome.passed) await pass(session, outcome.row);
    else await notifySession(session.id, { kind: "state", notes: [] });
    const view = (await votesOf(session.id)).find((vote) => vote.id === outcome.row.id);
    return reply(201, view);
  });
}
