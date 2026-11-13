import type { App } from "../app.js";
import { errors } from "../http/errors.js";
import { newId, row, rows } from "../db.js";
import { validateProgramInput, projectProgram, projectCategory, type ProgramRow, type CategoryRow, type RoundRow } from "../domain/programs.js";
import { audit } from "../domain/rounds.js";

export function registerProgramRoutes(app: App): void {
  app.get("/api/programs", "public", async () => {
    const programs = await rows<ProgramRow>(app.db, "SELECT * FROM programs ORDER BY year DESC, created_at DESC");
    const result = [];
    for (const program of programs) {
      const categories = await rows<CategoryRow>(app.db, "SELECT * FROM categories WHERE program_id = $1 ORDER BY created_at ASC", [program.id]);
      const rounds = categories.length > 0
        ? await rows<RoundRow>(app.db, "SELECT * FROM rounds WHERE category_id = ANY($1) ORDER BY seq ASC", [categories.map((c) => c.id)])
        : [];
      result.push(projectProgram(program, categories, rounds));
    }
    return { body: { programs: result } };
  });

  app.post("/api/programs", "director", async (ctx) => {
    const input = validateProgramInput((ctx.body ?? {}) as Record<string, unknown>);
    const id = newId("prg");
    await app.db.query(
      `INSERT INTO programs (id, name, year, time_zone, early_bird_date, deadline_date, early_bird_fee_cents, standard_fee_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, input.name, input.year, input.timeZone, input.earlyBirdDate, input.deadlineDate, input.earlyBirdFeeCents, input.standardFeeCents],
    );
    await app.db.query("INSERT INTO program_counters (program_id, next_entry_number) VALUES ($1, 1)", [id]);
    await audit(app.db, ctx.auth!.userId, "program.create", "program", id, input.name);
    const program = (await row<ProgramRow>(app.db, "SELECT * FROM programs WHERE id = $1", [id]))!;
    return { status: 201, body: { program: projectProgram(program, [], []) } };
  });

  app.patch("/api/programs/:id", "director", async (ctx) => {
    const program = await row<ProgramRow>(app.db, "SELECT * FROM programs WHERE id = $1", [ctx.params.id]);
    if (!program) {
      throw errors.notFound();
    }
    const nonScheduled = await row<{ count: string }>(
      app.db,
      `SELECT count(*) AS count FROM rounds WHERE category_id = ANY (SELECT id FROM categories WHERE program_id = $1) AND state <> 'scheduled'`,
      [program.id],
    );
    if (Number(nonScheduled?.count ?? 0) > 0) {
      throw errors.judgingStarted();
    }
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const earlyBirdDate = typeof body.earlyBirdDate === "string" ? body.earlyBirdDate : program.early_bird_date;
    const deadlineDate = typeof body.deadlineDate === "string" ? body.deadlineDate : program.deadline_date;
    const input = validateProgramInput({
      name: program.name,
      year: program.year,
      timeZone: program.time_zone,
      earlyBirdDate,
      deadlineDate,
      earlyBirdFeeCents: program.early_bird_fee_cents,
      standardFeeCents: program.standard_fee_cents,
    });
    await app.db.query(
      "UPDATE programs SET early_bird_date = $2, deadline_date = $3 WHERE id = $1",
      [program.id, input.earlyBirdDate, input.deadlineDate],
    );
    await audit(app.db, ctx.auth!.userId, "program.update", "program", program.id, `${input.earlyBirdDate} / ${input.deadlineDate}`);
    const updated = (await row<ProgramRow>(app.db, "SELECT * FROM programs WHERE id = $1", [program.id]))!;
    const categories = await rows<CategoryRow>(app.db, "SELECT * FROM categories WHERE program_id = $1 ORDER BY created_at ASC", [program.id]);
    const rounds = categories.length > 0
      ? await rows<RoundRow>(app.db, "SELECT * FROM rounds WHERE category_id = ANY($1) ORDER BY seq ASC", [categories.map((c) => c.id)])
      : [];
    return { body: { program: projectProgram(updated, categories, rounds) } };
  });

  app.post("/api/programs/:id/categories", "director", async (ctx) => {
    const program = await row<ProgramRow>(app.db, "SELECT * FROM programs WHERE id = $1", [ctx.params.id]);
    if (!program) {
      throw errors.notFound();
    }
    const nonScheduled = await row<{ count: string }>(
      app.db,
      `SELECT count(*) AS count FROM rounds WHERE category_id = ANY (SELECT id FROM categories WHERE program_id = $1) AND state <> 'scheduled'`,
      [program.id],
    );
    if (Number(nonScheduled?.count ?? 0) > 0) {
      throw errors.judgingStarted();
    }
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const fields: Record<string, string> = {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const shortlistSize = body.shortlistSize;
    const finalistCount = body.finalistCount;
    if (name.length < 2 || name.length > 60) {
      fields.name = "Category names are 2 to 60 characters.";
    }
    if (typeof shortlistSize !== "number" || !Number.isInteger(shortlistSize) || shortlistSize < 1 || shortlistSize > 50) {
      fields.shortlistSize = "Shortlist sizes run from 1 to 50.";
    }
    if (typeof finalistCount !== "number" || !Number.isInteger(finalistCount) || finalistCount < 1 || finalistCount > 50) {
      fields.finalistCount = "Finalist counts run from 1 up to the shortlist size.";
    } else if (typeof shortlistSize === "number" && finalistCount > shortlistSize) {
      fields.finalistCount = "Finalist counts run from 1 up to the shortlist size.";
    }
    if (Object.keys(fields).length > 0) {
      throw errors.validation(fields);
    }
    const existing = await row<{ id: string }>(app.db, "SELECT id FROM categories WHERE program_id = $1 AND lower(name) = lower($2)", [program.id, name]);
    if (existing) {
      throw errors.categoryExists();
    }
    const categoryId = newId("cat");
    await app.db.transaction(async (client) => {
      await client.query(
        "INSERT INTO categories (id, program_id, name, shortlist_size, finalist_count) VALUES ($1, $2, $3, $4, $5)",
        [categoryId, program.id, name, shortlistSize, finalistCount],
      );
      await client.query(
        "INSERT INTO rounds (id, category_id, name, kind, seq, state) VALUES ($1, $2, 'Round 1', 'round_1', 1, 'scheduled'), ($3, $2, 'Final round', 'final', 2, 'scheduled')",
        [newId("rnd"), categoryId, newId("rnd")],
      );
      await audit(client, ctx.auth!.userId, "category.create", "category", categoryId, name);
    });
    const category = (await row<CategoryRow>(app.db, "SELECT * FROM categories WHERE id = $1", [categoryId]))!;
    const rounds = await rows<RoundRow>(app.db, "SELECT * FROM rounds WHERE category_id = $1 ORDER BY seq ASC", [categoryId]);
    return {
      status: 201,
      body: {
        category: {
          ...projectCategory(category),
          rounds: rounds.map((r) => ({ id: r.id, name: r.name, kind: r.kind, state: r.state })),
        },
      },
    };
  });

  app.get("/api/programs/:id/summary", "director", async (ctx) => {
    const program = await row<ProgramRow>(app.db, "SELECT * FROM programs WHERE id = $1", [ctx.params.id]);
    if (!program) {
      throw errors.notFound();
    }
    const categories = await rows<CategoryRow>(app.db, "SELECT * FROM categories WHERE program_id = $1 ORDER BY created_at ASC", [program.id]);
    const result = [];
    for (const category of categories) {
      const states = await rows<{ state: string; count: string }>(
        app.db,
        "SELECT state, count(*) AS count FROM entries WHERE category_id = $1 GROUP BY state",
        [category.id],
      );
      const counts: Record<string, number> = {};
      for (const stateRow of states) {
        counts[stateRow.state] = Number(stateRow.count);
      }
      const rounds = await rows<RoundRow>(app.db, "SELECT * FROM rounds WHERE category_id = $1 ORDER BY seq ASC", [category.id]);
      const { panelForRound } = await import("../domain/rounds.js");
      const roundPanels = [];
      for (const round of rounds) {
        roundPanels.push({ id: round.id, name: round.name, state: round.state, panel: await panelForRound(app.db, round) });
      }
      result.push({ id: category.id, name: category.name, counts, rounds: roundPanels });
    }
    return { body: { categories: result } };
  });
}
