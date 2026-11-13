import type { App } from "../app.js";
import { errors } from "../http/errors.js";
import { newId, row, rows } from "../db.js";
import type { CategoryRow, ProgramRow, RoundRow } from "../domain/programs.js";
import { programById } from "../domain/programs.js";
import { windowOpen, deadlineLabel, embargoLabel, instantWithZone } from "../domain/time.js";
import { assertTransition, type EntryState } from "../domain/entries.js";
import {
  panelForRound, projectRound, standingsForRound, computeStandings, openRound, audit,
  excludedStudios, inRoundStates, type Standings,
} from "../domain/rounds.js";
import { StorageUnavailable } from "../providers/storage.js";
import { enqueueEmail, invitationEmail } from "../domain/mail.js";
import { isoUtc } from "../http/util.js";

interface EntryFullRow {
  id: string;
  program_id: string;
  category_id: string;
  studio_id: string;
  entry_number: number;
  title: string;
  summary: string;
  site_url: string;
  credits: string;
  state: EntryState;
  submitted_at: Date | null;
  paid_fee_cents: number | null;
  fee_tier: "early_bird" | "standard" | null;
  invoice_id: string | null;
  payment_id: string | null;
  paid_at: Date | null;
  refund_amount_cents: number | null;
  refunded_at: Date | null;
  disqualify_reason: string | null;
  award: string | null;
  r1_score: string | null;
  final_score: string | null;
}

export function registerDirectorRoutes(app: App): void {
  app.get("/api/categories/:id/entries", "director", async (ctx) => {
    const category = await row<CategoryRow>(app.db, "SELECT * FROM categories WHERE id = $1", [ctx.params.id]);
    if (!category) {
      throw errors.notFound();
    }
    const entries = await rows<EntryFullRow & { studio_name: string; studio_email: string }>(app.db, `
      SELECT e.*, s.name AS studio_name, s.email AS studio_email FROM entries e
      JOIN studios s ON s.id = e.studio_id
      WHERE e.category_id = $1 AND e.state <> 'draft' ORDER BY e.entry_number ASC
    `, [category.id]);
    const { entryProjection } = await import("./entries.js");
    const result = [];
    for (const entry of entries) {
      result.push(await entryProjection(app, entry, { director: true }));
    }
    return { body: { entries: result } };
  });

  app.post("/api/entries/:id/screen", "director", async (ctx) => {
    const entry = await row<EntryFullRow>(app.db, "SELECT * FROM entries WHERE id = $1", [ctx.params.id]);
    if (!entry) {
      throw errors.notFound();
    }
    const program = await programById(app.db, entry.program_id);
    if (!program) {
      throw errors.notFound();
    }
    if (windowOpen(program.deadline_date, program.time_zone)) {
      throw errors.deadlineNotPassed(deadlineLabel(program.deadline_date, program.time_zone));
    }
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const decision = body.decision;
    if (decision !== "pass" && decision !== "disqualify") {
      throw errors.validation({ decision: "Decisions are pass or disqualify." });
    }
    let reason: string | null = null;
    if (decision === "disqualify") {
      reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (reason.length < 1 || reason.length > 300) {
        throw errors.validation({ reason: "Give a reason of 1 to 300 characters." });
      }
    }
    assertTransition(entry.state, decision === "pass" ? "screen_pass" : "screen_disqualify");
    await app.db.transaction(async (client) => {
      if (decision === "pass") {
        await client.query("UPDATE entries SET state = 'screened' WHERE id = $1", [entry.id]);
        await audit(client, ctx.auth!.userId, "entry.pass", "entry", entry.id, String(entry.entry_number));
      } else {
        await client.query("UPDATE entries SET state = 'disqualified', disqualify_reason = $2 WHERE id = $1", [entry.id, reason]);
        await audit(client, ctx.auth!.userId, "entry.disqualify", "entry", entry.id, String(entry.entry_number));
      }
    });
    const updated = (await row<EntryFullRow>(app.db, "SELECT * FROM entries WHERE id = $1", [entry.id]))!;
    const { entryProjection } = await import("./entries.js");
    return { body: { entry: await entryProjection(app, updated, { director: true }) } };
  });

  app.post("/api/entries/:id/reinstate", "director", async (ctx) => {
    const entry = await row<EntryFullRow>(app.db, "SELECT * FROM entries WHERE id = $1", [ctx.params.id]);
    if (!entry) {
      throw errors.notFound();
    }
    const program = await programById(app.db, entry.program_id);
    if (!program) {
      throw errors.notFound();
    }
    if (windowOpen(program.deadline_date, program.time_zone)) {
      throw errors.deadlineNotPassed(deadlineLabel(program.deadline_date, program.time_zone));
    }
    assertTransition(entry.state, "reinstate");
    await app.db.transaction(async (client) => {
      await client.query("UPDATE entries SET state = 'screened', disqualify_reason = NULL WHERE id = $1", [entry.id]);
      await audit(client, ctx.auth!.userId, "entry.reinstate", "entry", entry.id, String(entry.entry_number));
    });
    const updated = (await row<EntryFullRow>(app.db, "SELECT * FROM entries WHERE id = $1", [entry.id]))!;
    const { entryProjection } = await import("./entries.js");
    return { body: { entry: await entryProjection(app, updated, { director: true }) } };
  });

  app.get("/api/rounds/:id", "director", async (ctx) => {
    const round = await row<RoundRow>(app.db, "SELECT * FROM rounds WHERE id = $1", [ctx.params.id]);
    if (!round) {
      throw errors.notFound();
    }
    const program = await programForRound(app, round);
    const panel = await panelForRound(app.db, round);
    return { body: { round: projectRound(round, program), panel } };
  });

  app.post("/api/rounds/:id/jurors", "director", async (ctx) => {
    const round = await row<RoundRow>(app.db, "SELECT * FROM rounds WHERE id = $1", [ctx.params.id]);
    if (!round) {
      throw errors.notFound();
    }
    if (round.state !== "scheduled" && round.state !== "open") {
      throw errors.invalidTransition(round.state, "panel.add");
    }
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const jurorId = typeof body.jurorId === "string" ? body.jurorId : "";
    if (!jurorId) {
      throw errors.validation({ jurorId: "Choose a juror." });
    }
    const juror = await row<{ id: string; name: string; email: string; studio_id: string | null }>(app.db, "SELECT id, name, email, studio_id FROM users WHERE id = $1 AND role = 'juror'", [jurorId]);
    if (!juror) {
      throw errors.validation({ jurorId: "Choose a juror." });
    }
    const onPanel = await row<{ juror_id: string }>(app.db, "SELECT juror_id FROM panel WHERE round_id = $1 AND juror_id = $2", [round.id, juror.id]);
    if (!onPanel) {
      await app.db.transaction(async (client) => {
        await client.query("INSERT INTO panel (round_id, juror_id) VALUES ($1, $2)", [round.id, juror.id]);
        if (round.state === "open") {
          const excluded = await excludedStudios(client, juror.id);
          const entries = await rows<{ id: string }>(
            client,
            `SELECT e.id FROM entries e WHERE e.category_id = $1 AND e.state = ANY($2) AND e.studio_id <> ALL($3) ORDER BY e.entry_number ASC`,
            [round.category_id, inRoundStates(round.kind), excluded.length > 0 ? excluded : ["__none__"]],
          );
          for (const entry of entries) {
            await client.query(
              "INSERT INTO assignments (id, round_id, juror_id, entry_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
              [newId("asg"), round.id, juror.id, entry.id],
            );
          }
          const category = await row<CategoryRow>(client, "SELECT * FROM categories WHERE id = $1", [round.category_id]);
          const program = await programForRound(app, round);
          const email = invitationEmail({
            categoryName: category?.name ?? "",
            roundName: round.name,
            ballotDeadlineLabel: round.ballot_deadline ? deadlineLabel(round.ballot_deadline, program.time_zone) : "",
            assigned: entries.length,
          });
          await enqueueEmail(client, "invitation", juror.email, email.subject, email.body);
          await client.query("UPDATE rounds SET packet_dirty = true WHERE id = $1", [round.id]);
        }
        await audit(client, ctx.auth!.userId, "panel.add", "round", round.id, juror.name);
      });
    }
    const updated = (await row<RoundRow>(app.db, "SELECT * FROM rounds WHERE id = $1", [round.id]))!;
    const panel = await panelForRound(app.db, updated);
    return { status: onPanel ? 200 : 201, body: { panel } };
  });

  app.post("/api/rounds/:id/open", "director", async (ctx) => {
    const round = await row<RoundRow>(app.db, "SELECT * FROM rounds WHERE id = $1", [ctx.params.id]);
    if (!round) {
      throw errors.notFound();
    }
    const program = await programForRound(app, round);
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const ballotDeadline = typeof body.ballotDeadline === "string" ? body.ballotDeadline : "";
    try {
      await app.db.transaction(async (client) => {
        const locked = await client.query<RoundRow>("SELECT * FROM rounds WHERE id = $1 FOR UPDATE", [round.id]);
        await openRound(client, locked.rows[0], program, ballotDeadline, ctx.auth!.userId, app.storage);
      });
    } catch (error) {
      if (error instanceof StorageUnavailable) {
        throw errors.storageUnavailable("Storage is unavailable, so the round was not opened. Try again shortly.");
      }
      throw error;
    }
    const updated = (await row<RoundRow>(app.db, "SELECT * FROM rounds WHERE id = $1", [round.id]))!;
    return { body: { round: projectRound(updated, program) } };
  });

  app.post("/api/rounds/:id/close", "director", async (ctx) => {
    const round = await row<RoundRow>(app.db, "SELECT * FROM rounds WHERE id = $1", [ctx.params.id]);
    if (!round) {
      throw errors.notFound();
    }
    const program = await programForRound(app, round);
    const category = await row<CategoryRow>(app.db, "SELECT * FROM categories WHERE id = $1", [round.category_id]);
    if (!category) {
      throw errors.notFound();
    }
    const result = await app.db.transaction(async (client) => {
      const locked = await client.query<RoundRow>("SELECT * FROM rounds WHERE id = $1 FOR UPDATE", [round.id]);
      const current = locked.rows[0];
      if (!current || current.state !== "open") {
        throw errors.invalidTransition(current?.state ?? "unknown", "round.close");
      }
      // The round score is computed once at close and stored.
      const standings = await computeStandings(client, current, category, false);
      await client.query(
        "INSERT INTO round_results (round_id, provisional, rows) VALUES ($1, false, $2) ON CONFLICT (round_id) DO UPDATE SET rows = $2, computed_at = now()",
        [current.id, JSON.stringify(standings)],
      );
      await client.query("UPDATE rounds SET state = 'closed', closed_at = now() WHERE id = $1", [current.id]);
      for (const standing of standings.rows) {
        if (current.kind === "round_1") {
          await client.query(
            "UPDATE entries SET r1_score = $2, r1_rank = $3 WHERE id = $1",
            [standing.entryId, standing.score, standing.rank],
          );
        } else {
          await client.query(
            "UPDATE entries SET final_score = $2, final_rank = $3 WHERE id = $1",
            [standing.entryId, standing.score, standing.rank],
          );
        }
      }
      await audit(client, ctx.auth!.userId, "round.close", "round", current.id, current.name);
      return standings;
    });
    const updated = (await row<RoundRow>(app.db, "SELECT * FROM rounds WHERE id = $1", [round.id]))!;
    return { body: { round: projectRound(updated, program), standings: result } };
  });

  app.post("/api/rounds/:id/confirm", "director", async (ctx) => {
    const round = await row<RoundRow>(app.db, "SELECT * FROM rounds WHERE id = $1", [ctx.params.id]);
    if (!round) {
      throw errors.notFound();
    }
    const program = await programForRound(app, round);
    const category = await row<CategoryRow>(app.db, "SELECT * FROM categories WHERE id = $1", [round.category_id]);
    if (!category) {
      throw errors.notFound();
    }
    const result = await app.db.transaction(async (client) => {
      const locked = await client.query<RoundRow>("SELECT * FROM rounds WHERE id = $1 FOR UPDATE", [round.id]);
      const current = locked.rows[0];
      if (!current || current.state !== "closed") {
        throw errors.invalidTransition(current?.state ?? "unknown", "round.confirm");
      }
      const stored = await client.query<{ rows: Standings }>("SELECT rows FROM round_results WHERE round_id = $1", [current.id]);
      const standings = stored.rows[0]?.rows as Standings;
      const outcomes: { entryNumber: number; state: EntryState }[] = [];
      for (const standing of standings.rows) {
        let newState: EntryState;
        if (current.kind === "round_1") {
          newState = standing.cut === "above" ? "shortlisted" : "eliminated";
        } else {
          newState = standing.rank === 1 ? "winner" : standing.rank <= category.finalist_count ? "finalist" : "honourable_mention";
        }
        await client.query("UPDATE entries SET state = $2 WHERE id = $1", [standing.entryId, newState]);
        if (current.kind === "final") {
          const award = standing.rank === 1 ? "winner" : standing.rank <= category.finalist_count ? "finalist" : "honourable_mention";
          await client.query("UPDATE entries SET award = $2 WHERE id = $1", [standing.entryId, award]);
        }
        outcomes.push({ entryNumber: standing.entryNumber, state: newState });
      }
      await client.query("UPDATE rounds SET state = 'normalised' WHERE id = $1", [current.id]);
      await audit(client, ctx.auth!.userId, "round.confirm", "round", current.id, current.name);
      return outcomes;
    });
    const updated = (await row<RoundRow>(app.db, "SELECT * FROM rounds WHERE id = $1", [round.id]))!;
    return { body: { round: projectRound(updated, program), outcomes: result } };
  });

  app.get("/api/rounds/:id/standings", "director", async (ctx) => {
    const round = await row<RoundRow>(app.db, "SELECT * FROM rounds WHERE id = $1", [ctx.params.id]);
    if (!round) {
      throw errors.notFound();
    }
    const category = await row<CategoryRow>(app.db, "SELECT * FROM categories WHERE id = $1", [round.category_id]);
    if (!category) {
      throw errors.notFound();
    }
    const standings = await standingsForRound(app.db, round, category);
    if (round.state === "normalised" || round.state === "published") {
      // Award markers appear on confirmed final-round standings.
      const awards = new Map(
        (await rows<{ id: string; award: string | null }>(app.db, "SELECT id, award FROM entries WHERE category_id = $1 AND award IS NOT NULL", [round.category_id]))
          .map((e) => [e.id, e.award]),
      );
      standings.rows = standings.rows.map((r) => ({ ...r, award: awards.get(r.entryId) ?? null }));
    }
    return { body: standings };
  });

  app.post("/api/categories/:id/publish", "director", async (ctx) => {
    const category = await row<CategoryRow>(app.db, "SELECT * FROM categories WHERE id = $1", [ctx.params.id]);
    if (!category) {
      throw errors.notFound();
    }
    const program = await programById(app.db, category.program_id);
    if (!program) {
      throw errors.notFound();
    }
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const embargoRaw = typeof body.embargoAt === "string" ? body.embargoAt : "";
    const embargoDate = new Date(embargoRaw);
    if (!embargoRaw || Number.isNaN(embargoDate.getTime())) {
      throw errors.validation({ embargoAt: "Times use ISO 8601 with an offset." });
    }
    await app.db.transaction(async (client) => {
      const rounds = await rows<RoundRow>(client, "SELECT * FROM rounds WHERE category_id = $1 ORDER BY seq ASC", [category.id]);
      const final = rounds.find((r) => r.kind === "final");
      if (!final) {
        throw errors.notFound();
      }
      if (final.state === "published") {
        throw errors.invalidTransition(final.state, "category.publish");
      }
      if (final.state !== "normalised") {
        throw errors.finalNotConfirmed();
      }
      await client.query("UPDATE rounds SET state = 'published' WHERE category_id = $1", [category.id]);
      await client.query(
        `UPDATE entries SET state = 'published' WHERE category_id = $1 AND state IN ('winner','finalist','honourable_mention')`,
        [category.id],
      );
      await client.query(
        "UPDATE categories SET embargo_at = $2, published_at = now() WHERE id = $1",
        [category.id, embargoDate],
      );
      await audit(client, ctx.auth!.userId, "category.publish", "category", category.id, category.name);
    });
    const updated = (await row<CategoryRow>(app.db, "SELECT * FROM categories WHERE id = $1", [category.id]))!;
    return {
      body: {
        category: {
          id: updated.id,
          name: updated.name,
          embargoAt: updated.embargo_at ? instantWithZone(updated.embargo_at, program.time_zone) : null,
          embargoLabel: updated.embargo_at ? embargoLabel(updated.embargo_at, program.time_zone) : null,
          state: "published",
        },
      },
    };
  });

  app.get("/api/audit", "director", async () => {
    const events = await rows<{ id: string; action: string; target_type: string; target_id: string; at: Date; detail: string }>(
      app.db,
      "SELECT id, action, target_type, target_id, at, detail FROM audit_events ORDER BY at DESC, id DESC LIMIT 200",
    );
    return {
      body: {
        events: events.map((e) => ({
          id: e.id,
          action: e.action,
          targetType: e.target_type,
          targetId: e.target_id,
          at: isoUtc(e.at),
          detail: e.detail,
        })),
      },
    };
  });
}

async function programForRound(app: App, round: RoundRow): Promise<ProgramRow> {
  const program = await row<ProgramRow>(app.db, "SELECT p.* FROM programs p JOIN categories c ON c.program_id = p.id WHERE c.id = $1", [round.category_id]);
  if (!program) {
    throw errors.notFound();
  }
  return program;
}

export { programForRound };
