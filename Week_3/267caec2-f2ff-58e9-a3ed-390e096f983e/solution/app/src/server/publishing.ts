import { recordAudit } from "./audit.js";
import { requireRole, requireUser } from "./auth.js";
import { lockKey, many, one, pool, tx } from "./db.js";
import { FieldErrors, refuse } from "./errors.js";
import type { ApiRequest, ApiResult } from "./http.js";
import { queueMail } from "./mail.js";
import { type CategoryRow, CATEGORY_COLUMNS, categoryById, programById } from "./programs.js";
import { AWARDS, type Award, STATUS_LABEL, embargoPassed } from "./rules.js";
import { instantLabel, isoInZone, parseInstant } from "./time.js";

// Embargoed publishing, the results notice and the public gallery and leaderboard (brief: API, Public;
// Business rules, Publishing and embargo).

export async function publishCategory(req: ApiRequest): Promise<ApiResult> {
  const category = await tx(async (client) => {
    const user = await requireUser(req);
    const found = await categoryById(client, req.params.id ?? "");
    if (!found) throw refuse("not_found");
    requireRole(user, "director");
    await lockKey(client, `category:${found.id}`);
    const rounds = await many<{ id: string; kind: string; state: string }>(client,
      "SELECT id, kind, state FROM rounds WHERE category_id = $1 FOR UPDATE", [found.id]);
    if (rounds.some((r) => r.state === "published")) throw refuse("invalid_transition", undefined, { from: "published", action: "publish" });
    if (rounds.find((r) => r.kind === "final")?.state !== "normalised") throw refuse("final_not_confirmed");
    const embargoAt = parseInstant(req.body.embargoAt);
    if (!embargoAt) {
      const errors = new FieldErrors();
      errors.add("embargoAt", "Give the embargo time as ISO 8601 with an offset, such as 2026-12-01T18:00:00+00:00.");
      errors.throwIfAny();
    }
    const at = embargoAt as Date;
    const program = await programById(client, found.program_id);
    const zone = program?.time_zone ?? "UTC";
    await client.query("UPDATE entries SET state = 'published' WHERE category_id = $1 AND state = ANY($2)", [found.id, AWARDS]);
    await client.query("UPDATE rounds SET state = 'published' WHERE category_id = $1", [found.id]);
    await client.query("UPDATE categories SET embargo_at = $2 WHERE id = $1", [found.id, at]);
    await queueResults(client, found, program?.year ?? 0, at);
    await recordAudit(client, "category.publish", "category", found.id, { embargoAt: at.toISOString() });
    return { id: found.id, name: found.name, embargoAt: isoInZone(at, zone), embargoLabel: instantLabel(at, zone), state: "published" };
  });
  return { status: 200, json: { category } };
}

/** One results email per studio with an entry that reached Round 1, due at the embargo instant. */
async function queueResults(client: Parameters<typeof queueMail>[0], category: CategoryRow, year: number, embargoAt: Date): Promise<void> {
  const rows = await many<{ studio_id: string; email: string; entry_number: number; title: string; award: Award | null;
    state: string; round_1_score: string | null; final_score: string | null }>(client,
    `SELECT e.studio_id, su.email, e.entry_number, e.title, e.award, e.state, r1.score AS round_1_score, rf.score AS final_score
     FROM rounds k1 JOIN round_entries re ON re.round_id = k1.id JOIN entries e ON e.id = re.entry_id
     JOIN users su ON su.studio_id = e.studio_id AND su.role = 'studio'
     LEFT JOIN round_results r1 ON r1.round_id = k1.id AND r1.entry_id = e.id
     LEFT JOIN rounds kf ON kf.category_id = k1.category_id AND kf.kind = 'final'
     LEFT JOIN round_results rf ON rf.round_id = kf.id AND rf.entry_id = e.id
     WHERE k1.category_id = $1 AND k1.kind = 'round_1' ORDER BY e.entry_number`, [category.id]);
  const byStudio = new Map<string, typeof rows>();
  for (const row of rows) byStudio.set(row.studio_id, [...(byStudio.get(row.studio_id) ?? []), row]);
  for (const entries of byStudio.values()) {
    const lines = entries.map((e) => {
      const outcome = e.award ? STATUS_LABEL[e.award] : STATUS_LABEL.eliminated;
      const score = e.award ? e.final_score : e.round_1_score;
      return `Entry ${e.entry_number} — ${e.title}: ${outcome}${score === null ? "" : ` (${score})`}`;
    });
    await queueMail(client, "results", {
      to: entries[0]?.email ?? "",
      subject: `Cutline results: ${category.name} ${year}`,
      body: [`The ${category.name} results for ${year} are published.`, "", ...lines, "", "Cutline Jury Desk"].join("\n"),
    }, embargoAt);
  }
}

interface PublicRow {
  entry_id: string;
  entry_number: number;
  title: string;
  studio_name: string;
  program_name: string;
  year: number;
  category: string;
  category_id: string;
  award: Award;
  score: string | null;
  rank: number;
  cut: string;
  previous_score: string | null;
  round_1_rank: number | null;
}

/** Revealed entries only: published, with the category's embargo passed by the server clock. */
const REVEALED = `
  SELECT e.id AS entry_id, e.entry_number, e.title, s.name AS studio_name, p.name AS program_name, p.year,
    c.name AS category, c.id AS category_id, e.award, rf.score, rf.rank, rf.cut, r1.score AS previous_score,
    r1.rank AS round_1_rank
  FROM entries e
  JOIN categories c ON c.id = e.category_id
  JOIN programs p ON p.id = e.program_id
  JOIN studios s ON s.id = e.studio_id
  JOIN rounds kf ON kf.category_id = c.id AND kf.kind = 'final'
  JOIN round_results rf ON rf.round_id = kf.id AND rf.entry_id = e.id
  JOIN rounds k1 ON k1.category_id = c.id AND k1.kind = 'round_1'
  LEFT JOIN round_results r1 ON r1.round_id = k1.id AND r1.entry_id = e.id
  WHERE e.state = 'published' AND c.embargo_at <= $1`;

async function imagesOf(entryIds: string[]): Promise<Map<string, string[]>> {
  const rows = await many<{ entry_id: string; id: string }>(pool,
    "SELECT entry_id, id FROM assets WHERE entry_id = ANY($1) ORDER BY seq", [entryIds]);
  const images = new Map<string, string[]>();
  for (const row of rows) images.set(row.entry_id, [...(images.get(row.entry_id) ?? []), `/api/assets/${row.id}`]);
  return images;
}

export async function gallery(req: ApiRequest): Promise<ApiResult> {
  const award = req.query.get("award");
  if (award !== null && !(AWARDS as readonly string[]).includes(award)) {
    const errors = new FieldErrors();
    errors.add("award", "Choose winner, finalist or honourable_mention.");
    errors.throwIfAny();
  }
  const year = req.query.get("year");
  const category = req.query.get("category");
  const rows = await many<PublicRow>(pool,
    `${REVEALED} AND ($2::int IS NULL OR p.year = $2) AND ($3::text IS NULL OR lower(c.name) = lower($3))
       AND ($4::text IS NULL OR e.award = $4)
     ORDER BY p.year DESC, c.name, array_position($5::text[], e.award), rf.score::numeric DESC NULLS LAST, e.entry_number`,
    [new Date(), year && /^\d{1,4}$/.test(year) ? Number(year) : year ? -1 : null, category || null, award, AWARDS]);
  const images = await imagesOf(rows.map((r) => r.entry_id));
  return {
    status: 200,
    json: {
      items: rows.map((r) => ({
        entryNumber: r.entry_number, title: r.title, studioName: r.studio_name, programName: r.program_name, year: r.year,
        category: r.category, award: r.award, score: r.score, images: images.get(r.entry_id) ?? [],
      })),
    },
  };
}

/** The leaderboard's default: the newest program with a published category, else the newest program. */
async function defaultProgramId(): Promise<string | null> {
  const row = await one<{ id: string }>(pool, `SELECT p.id FROM programs p
    ORDER BY EXISTS (SELECT 1 FROM categories c WHERE c.program_id = p.id AND c.embargo_at IS NOT NULL) DESC,
      p.year DESC, p.seq DESC LIMIT 1`);
  return row?.id ?? null;
}

export async function leaderboard(req: ApiRequest): Promise<ApiResult> {
  const programId = req.query.get("programId") ?? (await defaultProgramId());
  const program = programId ? await programById(pool, programId) : null;
  if (!program) throw refuse("not_found");
  const now = new Date();
  const categories = await many<CategoryRow>(pool, `SELECT ${CATEGORY_COLUMNS} FROM categories c WHERE c.program_id = $1 ORDER BY c.seq`,
    [program.id]);
  const revealed = await many<PublicRow>(pool, `${REVEALED} AND c.program_id = $2 ORDER BY rf.rank`, [now, program.id]);
  return {
    status: 200,
    json: {
      program: { id: program.id, name: program.name, year: program.year, timeZone: program.time_zone },
      categories: categories.map((c) => {
        const state = c.embargo_at === null ? "pending" : embargoPassed(c.embargo_at, now) ? "revealed" : "embargoed";
        const rows = state === "revealed" ? revealed.filter((r) => r.category_id === c.id) : [];
        return {
          id: c.id,
          name: c.name,
          state,
          revealsAt: state === "embargoed" && c.embargo_at ? isoInZone(c.embargo_at, program.time_zone) : null,
          revealsLabel: state === "embargoed" && c.embargo_at ? instantLabel(c.embargo_at, program.time_zone) : null,
          cut: c.finalist_count,
          rows: previousRanks(rows).map(({ row, previousRank }) => ({
            rank: row.rank, entryNumber: row.entry_number, title: row.title, studioName: row.studio_name, score: row.score,
            previousRank, previousScore: row.previous_score, award: row.award, cut: row.cut,
          })),
        };
      }),
    },
  };
}

/** previousRank is the entry's Round 1 rank among the category's shortlisted entries. */
function previousRanks(rows: PublicRow[]): { row: PublicRow; previousRank: number }[] {
  const byRoundOne = [...rows].sort((a, b) => (a.round_1_rank ?? 0) - (b.round_1_rank ?? 0));
  return rows.map((row) => ({ row, previousRank: byRoundOne.indexOf(row) + 1 }));
}
