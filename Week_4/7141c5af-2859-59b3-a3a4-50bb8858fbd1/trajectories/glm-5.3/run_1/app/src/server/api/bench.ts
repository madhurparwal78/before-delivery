import { Router, type Request, type Response } from "express";
import { q, q1 } from "../db.js";
import { err, asyncHandler } from "../http.js";
import { requireSession } from "../session.js";
import { apiMessages } from "../copy.js";
import { readJsonBody, asBody, assertDepth, assertOrigin } from "../request.js";
import { pieceOfDesk } from "./clients-pieces.js";
import { benchDayStartTurin, fmtDateEn, isoZ, localTimeHM, mondayOfISO, wallTimeToInstant, fmtDateTimeTurin, dayOfWeekISO, addDaysISO, localDate } from "../time.js";
import { newToken } from "../config.js";

export const benchRouter = Router({ mergeParams: true });

const BENCHES = ["frame", "cover"] as const;
type Bench = (typeof BENCHES)[number];

const glueJson = (job: { glue_laid_at: Date | null; glue_cures_at: Date | null }) => {
  if (!job.glue_laid_at || !job.glue_cures_at) return null;
  const cured = job.glue_cures_at.getTime() <= Date.now();
  return {
    laidAt: isoZ(job.glue_laid_at),
    curesAt: isoZ(job.glue_cures_at),
    state: cured ? "cured" : "curing",
    label: cured ? "Cured" : apiMessages.curingLabel(fmtDateTimeTurin(job.glue_cures_at)),
  };
};

const jobJson = (row: { id: string; piece_id: string; piece_title: string; bench: string; day: string; glue_laid_at: Date | null; glue_cures_at: Date | null }) => ({
  id: row.id,
  pieceId: row.piece_id,
  pieceTitle: row.piece_title,
  bench: row.bench,
  day: row.day,
  dayLabel: fmtDateEn(new Date(`${row.day}T12:00:00Z`), "Europe/Rome"),
  glue: glueJson(row),
});

const isWorkday = (date: string) => {
  const dow = dayOfWeekISO(date);
  return dow >= 1 && dow <= 5;
};

benchRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
  const session = await requireSession(req);
  const weekParam = typeof req.query.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.week) ? req.query.week : null;
  const week = weekParam ?? mondayOfISO(localDate(new Date(), "Europe/Rome"));
  const rows = await q<{ id: string; piece_id: string; piece_title: string; bench: string; day: string; glue_laid_at: Date | null; glue_cures_at: Date | null }>(
    `SELECT j.id, j.piece_id, p.title AS piece_title, j.bench, j.day::text AS day, j.glue_laid_at, j.glue_cures_at
     FROM bench_jobs j JOIN pieces p ON p.id = j.piece_id
     WHERE j.desk_id=$1 AND j.day >= $2 AND j.day < $3 ORDER BY j.day`,
    [session.deskId, week, addDaysISO(week, 7)]
  );
  res.json({ week, jobs: rows.map(jobJson) });
}));

benchRouter.post("/", asyncHandler(async (req: Request, res: Response) => {
  assertOrigin(req);
  const session = await requireSession(req);
  const body = asBody(await readJsonBody(req));
  assertDepth(body);
  const pieceId = typeof body.pieceId === "string" ? body.pieceId : "";
  const bench = typeof body.bench === "string" && (BENCHES as readonly string[]).includes(body.bench) ? (body.bench as Bench) : null;
  const day = typeof body.day === "string" ? body.day : "";
  const piece = pieceId ? await pieceOfDesk(session.deskId, pieceId) : null;
  const fields: Record<string, string> = {};
  if (!piece) fields.pieceId = apiMessages.fieldRequired;
  if (!bench) fields.bench = apiMessages.fieldRequired;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) fields.day = apiMessages.date;
  if (Object.keys(fields).length) throw err.field(fields);
  if (!isWorkday(day)) throw err.field({ day: apiMessages.workdaysOnly });
  const taken = await q1<{ id: string; piece_title: string }>(
    `SELECT j.id, p.title AS piece_title FROM bench_jobs j JOIN pieces p ON p.id = j.piece_id WHERE j.desk_id=$1 AND j.bench=$2 AND j.day=$3`,
    [session.deskId, bench, day]
  );
  if (taken) throw err.state("F-66", apiMessages.benchTaken.replace("<date>", fmtDateEn(new Date(`${day}T12:00:00Z`), "Europe/Rome")).replace("<job>", taken.piece_title));
  if (bench === "cover") {
    const glue = await q1<{ cures_at: Date; laid_at: Date }>(
      `SELECT glue_cures_at AS cures_at, glue_laid_at AS laid_at FROM bench_jobs WHERE desk_id=$1 AND piece_id=$2 AND glue_cures_at IS NOT NULL ORDER BY glue_laid_at DESC LIMIT 1`,
      [session.deskId, piece!.id]
    );
    if (glue && benchDayStartTurin(day).getTime() < glue.cures_at.getTime()) {
      throw err.state("F-67", apiMessages.glueCuring.replace("<title>", piece!.title as string).replace("<datetime>", fmtDateTimeTurin(glue.cures_at)));
    }
  }
  const id = newToken(8);
  await q("INSERT INTO bench_jobs (id, desk_id, piece_id, bench, day) VALUES ($1,$2,$3,$4,$5)", [id, session.deskId, piece!.id, bench, day]);
  const row = await q1<{ id: string; piece_id: string; piece_title: string; bench: string; day: string; glue_laid_at: Date | null; glue_cures_at: Date | null }>(
    `SELECT j.id, j.piece_id, p.title AS piece_title, j.bench, j.day::text AS day, j.glue_laid_at, j.glue_cures_at FROM bench_jobs j JOIN pieces p ON p.id = j.piece_id WHERE j.id = $1`, [id]
  );
  res.status(201).json({ job: jobJson(row!) });
}));

benchRouter.patch("/:id", asyncHandler(async (req: Request, res: Response) => {
  assertOrigin(req);
  const session = await requireSession(req);
  const row = await q1<{ id: string; piece_id: string; bench: string; day: string }>(
    "SELECT id, piece_id, bench, day::text AS day FROM bench_jobs WHERE id=$1 AND desk_id=$2", [req.params.id, session.deskId]
  );
  if (!row) throw err.notFound();
  const body = asBody(await readJsonBody(req));
  assertDepth(body);
  const bench = typeof body.bench === "string" && (BENCHES as readonly string[]).includes(body.bench) ? (body.bench as Bench) : row.bench as Bench;
  const day = typeof body.day === "string" ? body.day : row.day;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw err.field({ day: apiMessages.date });
  if (!isWorkday(day)) throw err.field({ day: apiMessages.workdaysOnly });
  const taken = await q1<{ id: string; piece_title: string }>(
    `SELECT j.id, p.title AS piece_title FROM bench_jobs j JOIN pieces p ON p.id = j.piece_id WHERE j.desk_id=$1 AND j.bench=$2 AND j.day=$3 AND j.id<>$4`,
    [session.deskId, bench, day, row.id]
  );
  if (taken) throw err.state("F-66", apiMessages.benchTaken.replace("<date>", fmtDateEn(new Date(`${day}T12:00:00Z`), "Europe/Rome")).replace("<job>", taken.piece_title));
  if (bench === "cover" && bench !== row.bench) {
    const glue = await q1<{ cures_at: Date }>(
      `SELECT glue_cures_at AS cures_at FROM bench_jobs WHERE desk_id=$1 AND piece_id=$2 AND glue_cures_at IS NOT NULL ORDER BY glue_laid_at DESC LIMIT 1`,
      [session.deskId, row.piece_id]
    );
    const piece = await pieceOfDesk(session.deskId, row.piece_id);
    if (glue && benchDayStartTurin(day).getTime() < glue.cures_at.getTime()) {
      throw err.state("F-67", apiMessages.glueCuring.replace("<title>", piece!.title as string).replace("<datetime>", fmtDateTimeTurin(glue.cures_at)));
    }
  }
  await q("UPDATE bench_jobs SET bench=$1, day=$2 WHERE id=$3", [bench, day, row.id]);
  const updated = await q1<{ id: string; piece_id: string; piece_title: string; bench: string; day: string; glue_laid_at: Date | null; glue_cures_at: Date | null }>(
    `SELECT j.id, j.piece_id, p.title AS piece_title, j.bench, j.day::text AS day, j.glue_laid_at, j.glue_cures_at FROM bench_jobs j JOIN pieces p ON p.id = j.piece_id WHERE j.id = $1`, [row.id]
  );
  res.json({ job: jobJson(updated!) });
}));

benchRouter.post("/:id/glue", asyncHandler(async (req: Request, res: Response) => {
  assertOrigin(req);
  const session = await requireSession(req);
  const row = await q1<{ id: string; piece_id: string; bench: string }>("SELECT id, piece_id, bench FROM bench_jobs WHERE id=$1 AND desk_id=$2", [req.params.id, session.deskId]);
  if (!row) throw err.notFound();
  if (row.bench !== "frame") throw err.state("F-71", apiMessages.glueOnFrame);
  const body = asBody(await readJsonBody(req));
  assertDepth(body);
  const date = typeof body.date === "string" ? body.date : "";
  const time = typeof body.time === "string" ? body.time : "";
  const fields: Record<string, string> = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fields.date = date === "" ? apiMessages.fieldRequired : apiMessages.date;
  if (!/^\d{2}:\d{2}$/.test(time)) fields.time = time === "" ? apiMessages.fieldRequired : apiMessages.notATime;
  if (Object.keys(fields).length) throw err.field(fields);
  const at = wallTimeToInstant("Europe/Rome", date, time);
  if (!at) throw err.field({ time: apiMessages.timeMissing.replace("<time>", time).replace("<town>", "Turin").replace("<date>", fmtDateEn(new Date(`${date}T12:00:00Z`), "Europe/Rome")) });
  const curesAt = new Date(at.getTime() + 48 * 3600_000);
  await q("UPDATE bench_jobs SET glue_laid_at=$1, glue_cures_at=$2 WHERE id=$3", [at.toISOString(), curesAt.toISOString(), row.id]);
  const updated = await q1<{ id: string; piece_id: string; piece_title: string; bench: string; day: string; glue_laid_at: Date | null; glue_cures_at: Date | null }>(
    `SELECT j.id, j.piece_id, p.title AS piece_title, j.bench, j.day::text AS day, j.glue_laid_at, j.glue_cures_at FROM bench_jobs j JOIN pieces p ON p.id = j.piece_id WHERE j.id = $1`, [row.id]
  );
  res.json({ job: jobJson(updated!) });
}));

void isoZ, localTimeHM;
