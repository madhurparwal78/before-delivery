import type { App } from "../app.js";
import { errors } from "../http/errors.js";
import { newId, row, rows } from "../db.js";
import type { RoundRow, CategoryRow } from "../domain/programs.js";
import { deadlineLabel } from "../domain/time.js";
import type { Queryable } from "../db.js";

interface ScoreRow {
  round_id: string;
  juror_id: string;
  entry_id: string;
  craft: number;
  clarity: number;
  idea: number;
  story: number;
}

async function roundForJuror(app: App, jurorId: string, roundId: string): Promise<RoundRow | null> {
  const found = await row<RoundRow & { on_panel: string | null }>(app.db, `
    SELECT r.*, p2.juror_id AS on_panel FROM rounds r
    LEFT JOIN panel p2 ON p2.round_id = r.id AND p2.juror_id = $2
    WHERE r.id = $1
  `, [roundId, jurorId]);
  if (!found || !found.on_panel) {
    return null;
  }
  return found;
}

async function assignedEntries(client: Queryable, roundId: string, jurorId: string): Promise<{ id: string; entry_number: number; title: string; summary: string }[]> {
  return rows<{ id: string; entry_number: number; title: string; summary: string }>(client, `
    SELECT e.id, e.entry_number, e.title, e.summary FROM assignments a
    JOIN entries e ON e.id = a.entry_id
    WHERE a.round_id = $1 AND a.juror_id = $2
    ORDER BY e.entry_number ASC
  `, [roundId, jurorId]);
}

async function scoresFor(client: Queryable, roundId: string, jurorId: string): Promise<ScoreRow[]> {
  return rows<ScoreRow>(client, "SELECT * FROM scores WHERE round_id = $1 AND juror_id = $2", [roundId, jurorId]);
}

async function ballotSubmitted(client: Queryable, roundId: string, jurorId: string): Promise<boolean> {
  const found = await row<{ juror_id: string }>(client, "SELECT juror_id FROM ballots WHERE round_id = $1 AND juror_id = $2", [roundId, jurorId]);
  return Boolean(found);
}

export function registerJurorRoutes(app: App): void {
  app.get("/api/juror/rounds", "juror", async (ctx) => {
    const rounds = await rows<{
      id: string; name: string; category_name: string; ballot_deadline: string | null; time_zone: string; kind: string;
    }>(app.db, `
      SELECT r.id, r.name, r.ballot_deadline, c.name AS category_name, p.time_zone, r.kind FROM rounds r
      JOIN panel p2 ON p2.round_id = r.id AND p2.juror_id = $1
      JOIN categories c ON c.id = r.category_id
      JOIN programs p ON p.id = c.program_id
      WHERE r.state = 'open'
      ORDER BY r.opened_at ASC
    `, [ctx.auth!.userId]);
    const result = [];
    for (const round of rounds) {
      const assigned = await rows<{ id: string }>(app.db, "SELECT id FROM assignments WHERE round_id = $1 AND juror_id = $2", [round.id, ctx.auth!.userId]);
      const scored = await rows<{ id: string }>(
        app.db,
        `SELECT a.id FROM assignments a JOIN scores s ON s.round_id = a.round_id AND s.juror_id = a.juror_id AND s.entry_id = a.entry_id
         WHERE a.round_id = $1 AND a.juror_id = $2`,
        [round.id, ctx.auth!.userId],
      );
      const submitted = await ballotSubmitted(app.db, round.id, ctx.auth!.userId);
      result.push({
        id: round.id,
        name: round.name,
        categoryName: round.category_name,
        ballotDeadlineLabel: round.ballot_deadline ? deadlineLabel(round.ballot_deadline, round.time_zone) : null,
        assigned: assigned.length,
        remaining: submitted ? 0 : assigned.length - scored.length,
        ballotSubmitted: submitted,
      });
    }
    return { body: { rounds: result } };
  });

  app.get("/api/rounds/:id/ballot", "juror", async (ctx) => {
    const round = await roundForJuror(app, ctx.auth!.userId, ctx.params.id);
    if (!round || round.state === "scheduled") {
      throw errors.notFound();
    }
    const category = await row<CategoryRow>(app.db, "SELECT * FROM categories WHERE id = $1", [round.category_id]);
    const program = await row<{ time_zone: string }>(app.db, `
      SELECT p.time_zone FROM programs p JOIN categories c ON c.program_id = p.id WHERE c.id = $1
    `, [round.category_id]);
    const assigned = await assignedEntries(app.db, round.id, ctx.auth!.userId);
    const scoreRows = await scoresFor(app.db, round.id, ctx.auth!.userId);
    const scoreByEntry = new Map(scoreRows.map((s) => [s.entry_id, s]));
    const entries = [];
    for (const entry of assigned) {
      const assets = await rows<{ id: string; width: number; height: number }>(app.db, "SELECT id, width, height FROM assets WHERE entry_id = $1 ORDER BY sort ASC, created_at ASC", [entry.id]);
      const score = scoreByEntry.get(entry.id);
      entries.push({
        entryId: entry.id,
        entryNumber: entry.entry_number,
        title: entry.title,
        summary: entry.summary,
        images: assets.map((a) => ({ url: `/api/assets/${a.id}`, width: a.width, height: a.height })),
        scores: score ? { craft: score.craft, clarity: score.clarity, idea: score.idea, story: score.story } : null,
      });
    }
    const submitted = await ballotSubmitted(app.db, round.id, ctx.auth!.userId);
    const scored = entries.filter((e) => e.scores !== null).length;
    const programZone = program?.time_zone;
    return {
      body: {
        round: {
          id: round.id,
          name: round.name,
          categoryName: category?.name ?? "",
          ballotDeadlineLabel: round.ballot_deadline && program ? deadlineLabel(round.ballot_deadline, program.time_zone) : null,
          ballotDeadlineAt: round.ballot_deadline && programZone
            ? (await import("../domain/time.js")).instantWithZone((await import("../domain/time.js")).deadlineBoundary(round.ballot_deadline, programZone), programZone)
            : null,
          state: round.state,
        },
        entries,
        assigned: entries.length,
        scored,
        remaining: submitted ? 0 : entries.length - scored,
        submitted,
      },
    };
  });

  app.put("/api/rounds/:id/scores/:entryId", "juror", async (ctx) => {
    const round = await roundForJuror(app, ctx.auth!.userId, ctx.params.id);
    if (!round || round.state === "scheduled") {
      throw errors.notFound();
    }
    if (round.state !== "open") {
      throw errors.roundClosed();
    }
    const assignment = await row<{ id: string }>(app.db, "SELECT id FROM assignments WHERE round_id = $1 AND juror_id = $2 AND entry_id = $3", [round.id, ctx.auth!.userId, ctx.params.entryId]);
    if (!assignment) {
      throw errors.notFound();
    }
    if (await ballotSubmitted(app.db, round.id, ctx.auth!.userId)) {
      throw errors.ballotSubmitted();
    }
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const fields: Record<string, string> = {};
    const parse = (name: string): number | null => {
      const value = body[name];
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 10) {
        fields[name] = "Scores are whole numbers from 1 to 10.";
        return null;
      }
      return value;
    };
    const craft = parse("craft");
    const clarity = parse("clarity");
    const idea = parse("idea");
    const story = parse("story");
    if (Object.keys(fields).length > 0) {
      throw errors.validation(fields);
    }
    await app.db.query(
      `INSERT INTO scores (round_id, juror_id, entry_id, craft, clarity, idea, story, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (round_id, juror_id, entry_id) DO UPDATE SET craft = $4, clarity = $5, idea = $6, story = $7, updated_at = now()`,
      [round.id, ctx.auth!.userId, ctx.params.entryId, craft, clarity, idea, story],
    );
    const assigned = await assignedEntries(app.db, round.id, ctx.auth!.userId);
    const scoreRows = await scoresFor(app.db, round.id, ctx.auth!.userId);
    const scoredIds = new Set(scoreRows.map((s) => s.entry_id));
    const remaining = assigned.filter((e) => !scoredIds.has(e.id)).length;
    return { body: { scores: { craft, clarity, idea, story }, remaining } };
  });

  app.post("/api/rounds/:id/ballot/submit", "juror", async (ctx) => {
    const target = await roundForJuror(app, ctx.auth!.userId, ctx.params.id);
    if (!target || target.state === "scheduled") {
      throw errors.notFound();
    }
    const result = await app.db.transaction(async (client) => {
      // The single order for a submit racing a close: both lock the round row first.
      const locked = await client.query<RoundRow>("SELECT * FROM rounds WHERE id = $1 FOR UPDATE", [target.id]);
      const round = locked.rows[0];
      if (!round || round.state !== "open") {
        return { refused: true as const };
      }
      const existing = await client.query<{ juror_id: string }>("SELECT juror_id FROM ballots WHERE round_id = $1 AND juror_id = $2", [round.id, ctx.auth!.userId]);
      if (existing.rows.length > 0) {
        throw errors.ballotSubmitted();
      }
      const assigned = await assignedEntries(client, round.id, ctx.auth!.userId);
      const scoreRows = await scoresFor(client, round.id, ctx.auth!.userId);
      const scoredIds = new Set(scoreRows.map((s) => s.entry_id));
      const unscored = assigned.filter((e) => !scoredIds.has(e.id)).length;
      if (unscored > 0) {
        throw errors.ballotIncomplete(unscored);
      }
      const counted = assigned.filter((e) => scoredIds.has(e.id)).length;
      await client.query(
        "INSERT INTO ballots (round_id, juror_id, counted, submitted_at) VALUES ($1, $2, $3, now())",
        [round.id, ctx.auth!.userId, counted],
      );
      return { refused: false as const, counted, submittedAt: new Date() };
    });
    if (result.refused) {
      throw errors.roundClosed();
    }
    return { body: { submitted: true, counted: result.counted, submittedAt: result.submittedAt.toISOString().slice(0, 19) + "Z" } };
  });

  app.post("/api/rounds/:id/entries/:entryId/recuse", "juror", async (ctx) => {
    const target = await roundForJuror(app, ctx.auth!.userId, ctx.params.id);
    if (!target || target.state === "scheduled") {
      throw errors.notFound();
    }
    if (target.state !== "open") {
      throw errors.roundClosed();
    }
    const result = await app.db.transaction(async (client) => {
      const locked = await client.query<RoundRow>("SELECT * FROM rounds WHERE id = $1 FOR UPDATE", [target.id]);
      const round = locked.rows[0];
      if (!round || round.state !== "open") {
        throw errors.roundClosed();
      }
      const assignment = await client.query<{ id: string }>("SELECT id FROM assignments WHERE round_id = $1 AND juror_id = $2 AND entry_id = $3", [round.id, ctx.auth!.userId, ctx.params.entryId]);
      if (assignment.rows.length === 0) {
        throw errors.notFound();
      }
      await client.query(
        "DELETE FROM assignments WHERE round_id = $1 AND juror_id = $2 AND entry_id = $3",
        [round.id, ctx.auth!.userId, ctx.params.entryId],
      );
      await client.query("DELETE FROM scores WHERE round_id = $1 AND juror_id = $2 AND entry_id = $3", [round.id, ctx.auth!.userId, ctx.params.entryId]);
      await client.query("UPDATE rounds SET packet_dirty = true WHERE id = $1", [round.id]);
      const assigned = await assignedEntries(client, round.id, ctx.auth!.userId);
      const scoreRows = await scoresFor(client, round.id, ctx.auth!.userId);
      const scoredIds = new Set(scoreRows.map((s) => s.entry_id));
      const submitted = await ballotSubmitted(client, round.id, ctx.auth!.userId);
      return { remaining: submitted ? 0 : assigned.filter((e) => !scoredIds.has(e.id)).length };
    });
    return { body: result };
  });

  app.post("/api/conflicts", "juror", async (ctx) => {
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const studioId = typeof body.studioId === "string" ? body.studioId : "";
    const note = typeof body.note === "string" ? body.note.slice(0, 300) : null;
    const studio = await row<{ id: string; name: string }>(app.db, "SELECT id, name FROM studios WHERE id = $1", [studioId]);
    if (!studio) {
      throw errors.validation({ studioId: "Choose an existing studio." });
    }
    const result = await app.db.transaction(async (client) => {
      const existing = await client.query<{ id: string; declared_at: Date }>("SELECT id, declared_at FROM conflicts WHERE juror_id = $1 AND studio_id = $2", [ctx.auth!.userId, studio.id]);
      if (existing.rows.length > 0) {
        return { created: false, declaredAt: existing.rows[0].declared_at, removed: 0 };
      }
      await client.query("INSERT INTO conflicts (id, juror_id, studio_id, note) VALUES ($1, $2, $3, $4)", [newId("con"), ctx.auth!.userId, studio.id, note]);
      // Remove stored assignments to that studio's entries in every open round the juror sits on.
      const removed = await client.query<{ count: string }>(`
        WITH deleted AS (DELETE FROM assignments a
          USING rounds r
          WHERE a.round_id = r.id AND r.state = 'open' AND a.juror_id = $1 AND a.entry_id IN (SELECT id FROM entries WHERE studio_id = $2)
          RETURNING a.id)
        SELECT count(*) AS count FROM deleted
      `, [ctx.auth!.userId, studio.id]);
      await client.query(`
        DELETE FROM scores s USING rounds r
        WHERE s.round_id = r.id AND r.state = 'open' AND s.juror_id = $1 AND s.entry_id IN (SELECT id FROM entries WHERE studio_id = $2)
      `, [ctx.auth!.userId, studio.id]);
      await client.query(`
        UPDATE rounds SET packet_dirty = true
        WHERE state = 'open' AND id IN (SELECT round_id FROM panel WHERE juror_id = $1)
      `, [ctx.auth!.userId]);
      return { created: true, declaredAt: new Date(), removed: Number(removed.rows[0]?.count ?? 0) };
    });
    return {
      status: result.created ? 201 : 200,
      body: {
        conflict: {
          studioId: studio.id,
          studioName: studio.name,
          note,
          declaredAt: result.declaredAt.toISOString().slice(0, 19) + "Z",
        },
        removedAssignments: result.removed,
      },
    };
  });

  app.get("/api/conflicts", "juror", async (ctx) => {
    const conflicts = await rows<{ studio_id: string; studio_name: string; note: string | null; declared_at: Date }>(app.db, `
      SELECT c.studio_id, s.name AS studio_name, c.note, c.declared_at FROM conflicts c
      JOIN studios s ON s.id = c.studio_id
      WHERE c.juror_id = $1 ORDER BY c.declared_at ASC
    `, [ctx.auth!.userId]);
    return {
      body: {
        conflicts: conflicts.map((c) => ({
          studioId: c.studio_id,
          studioName: c.studio_name,
          note: c.note,
          declaredAt: c.declared_at.toISOString().slice(0, 19) + "Z",
        })),
      },
    };
  });
}
