import type { App } from "../app.js";
import { errors } from "../http/errors.js";
import { row, rows } from "../db.js";
import type { ProgramRow } from "../domain/programs.js";
import { embargoLabel, instantWithZone } from "../domain/time.js";

const AWARD_ORDER = new Map([["winner", 0], ["finalist", 1], ["honourable_mention", 2]]);

export function registerPublicRoutes(app: App): void {
  app.get("/api/public/gallery", "public", async (ctx) => {
    const yearParam = ctx.query.get("year");
    const categoryParam = ctx.query.get("category");
    const awardParam = ctx.query.get("award");
    if (awardParam && !AWARD_ORDER.has(awardParam)) {
      throw errors.validation({ award: "Award levels are winner, finalist or honourable_mention." });
    }
    const now = Date.now();
    const entries = await rows<{
      entry_number: number; title: string; studio_name: string; program_name: string; year: number;
      category_name: string; award: string; final_score: string; image_ids: string[];
    }>(app.db, `
      SELECT e.entry_number, e.title, s.name AS studio_name, p.name AS program_name, p.year,
             c.name AS category_name, e.award, e.final_score,
             (SELECT array_agg(a.id ORDER BY a.sort, a.created_at) FROM assets a WHERE a.entry_id = e.id) AS image_ids
      FROM entries e
      JOIN studios s ON s.id = e.studio_id
      JOIN programs p ON p.id = e.program_id
      JOIN categories c ON c.id = e.category_id
      WHERE e.state = 'published' AND e.award IS NOT NULL
        AND c.published_at IS NOT NULL AND c.embargo_at IS NOT NULL AND c.embargo_at <= $1
        AND ($2::int IS NULL OR p.year = $2)
        AND ($3::text IS NULL OR lower(c.name) = lower($3))
        AND ($4::text IS NULL OR e.award = $4)
    `, [new Date(now), yearParam ? Number(yearParam) : null, categoryParam || null, awardParam || null]);
    const items = entries
      .filter((e) => e.image_ids && e.image_ids.length > 0)
      .map((e) => ({
        entryNumber: e.entry_number,
        title: e.title,
        studioName: e.studio_name,
        programName: e.program_name,
        year: e.year,
        category: e.category_name,
        award: e.award,
        score: e.final_score,
        images: (e.image_ids ?? []).map((id) => `/api/assets/${id}`),
      }))
      .sort((a, b) => {
        if (a.year !== b.year) {
          return b.year - a.year;
        }
        if (a.category !== b.category) {
          return a.category.localeCompare(b.category);
        }
        const awardDiff = (AWARD_ORDER.get(a.award) ?? 9) - (AWARD_ORDER.get(b.award) ?? 9);
        if (awardDiff !== 0) {
          return awardDiff;
        }
        return Number(b.score ?? 0) - Number(a.score ?? 0);
      });
    return { body: { items } };
  });

  app.get("/api/public/leaderboard", "public", async (ctx) => {
    const programId = ctx.query.get("programId");
    let program: ProgramRow | null = null;
    if (programId) {
      program = await row<ProgramRow>(app.db, "SELECT * FROM programs WHERE id = $1", [programId]);
      if (!program) {
        throw errors.notFound();
      }
    } else {
      program = await defaultLeaderboardProgram(app);
    }
    if (!program) {
      return { body: { program: null, categories: [] } };
    }
    const now = Date.now();
    const categories = await rows<{
      id: string; name: string; shortlist_size: number; finalist_count: number; embargo_at: Date | null; published_at: Date | null;
      round_id: string; round_state: string; rows: unknown;
    }>(app.db, `
      SELECT c.id, c.name, c.shortlist_size, c.finalist_count, c.embargo_at, c.published_at,
             r.id AS round_id, r.state AS round_state, res.rows AS rows
      FROM categories c
      JOIN rounds r ON r.category_id = c.id AND r.kind = 'final'
      LEFT JOIN round_results res ON res.round_id = r.id
      WHERE c.program_id = $1 ORDER BY c.created_at ASC
    `, [program.id]);
    const entryStudio = new Map(
      (await rows<{ id: string; studio_name: string; r1_rank: number; r1_score: string }>(app.db, `
        SELECT e.id, s.name AS studio_name, e.r1_rank, e.r1_score FROM entries e
        JOIN studios s ON s.id = e.studio_id
        JOIN categories c ON c.id = e.category_id WHERE c.program_id = $1
      `, [program.id])).map((r) => [r.id, r]),
    );
    const result = [];
    for (const category of categories) {
      const published = Boolean(category.published_at);
      const embargoAt = category.embargo_at ? new Date(category.embargo_at) : null;
      const revealed = published && embargoAt !== null && embargoAt.getTime() <= now;
      let state: "pending" | "embargoed" | "revealed" = "pending";
      if (revealed) {
        state = "revealed";
      } else if (published && embargoAt !== null) {
        state = "embargoed";
      }
      const standings = category.rows as { rows: { rank: number; entryId: string; entryNumber: number; title: string; score: string | null; cut: string }[]; cut: number } | null;
      let boardRows: Record<string, unknown>[] = [];
      if (revealed && standings?.rows) {
        const shortlisted = await rows<{ id: string; r1_rank: number; r1_score: string }>(app.db, `
          SELECT e.id, e.r1_rank, e.r1_score FROM entries e WHERE e.category_id = $1 AND e.state IN ('published','winner','finalist','honourable_mention') ORDER BY e.r1_rank ASC
        `, [category.id]);
        const previousById = new Map<string, { previousRank: number; previousScore: string | null }>();
        shortlisted.forEach((e, index) => {
          previousById.set(e.id, { previousRank: e.r1_rank ?? index + 1, previousScore: e.r1_score });
        });
        const awards = new Map(
          (await rows<{ id: string; award: string }>(app.db, "SELECT id, award FROM entries WHERE category_id = $1 AND award IS NOT NULL", [category.id])).map((e) => [e.id, e.award]),
        );
        boardRows = standings.rows.map((r) => ({
          rank: r.rank,
          entryNumber: r.entryNumber,
          title: r.title,
          studioName: entryStudio.get(r.entryId)?.studio_name ?? "",
          score: r.score,
          previousRank: previousById.get(r.entryId)?.previousRank ?? null,
          previousScore: previousById.get(r.entryId)?.previousScore ?? null,
          award: awards.get(r.entryId) ?? null,
          cut: r.cut,
        }));
      }
      result.push({
        id: category.id,
        name: category.name,
        state,
        revealsAt: state === "embargoed" && embargoAt ? instantWithZone(embargoAt, program!.time_zone) : null,
        revealsLabel: state === "embargoed" && embargoAt ? embargoLabel(embargoAt, program!.time_zone) : null,
        cut: category.finalist_count,
        rows: boardRows,
      });
    }
    return {
      body: {
        program: { id: program.id, name: program.name, year: program.year, timeZone: program.time_zone },
        categories: result,
      },
    };
  });

  app.get("/api/health", "public", async () => {
    return { body: { status: "ok" } };
  });
}

async function defaultLeaderboardProgram(app: App): Promise<ProgramRow | null> {
  const published = await rows<ProgramRow>(app.db, `
    SELECT DISTINCT p.* FROM programs p
    JOIN categories c ON c.program_id = p.id
    JOIN rounds r ON r.category_id = c.id AND r.kind = 'final' AND r.state = 'published'
    ORDER BY p.year DESC, p.created_at DESC
  `);
  if (published.length > 0) {
    return published[0];
  }
  return row<ProgramRow>(app.db, "SELECT * FROM programs ORDER BY year DESC, created_at DESC LIMIT 1");
}
