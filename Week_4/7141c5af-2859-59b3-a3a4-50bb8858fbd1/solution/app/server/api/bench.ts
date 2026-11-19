import { randomUUID } from "node:crypto";
import { UNIQUE_VIOLATION, one, query } from "../db/pool.ts";
import { copy } from "../domain/copy.ts";
import { coverDayRefusal, glueBody } from "../domain/glue.ts";
import { TURIN_ZONE } from "../domain/towns.ts";
import { dateCopy, isRealDate, mondayOf, turinToday, wallInstant, weekday } from "../domain/time.ts";
import { ApiError, conflict, invalid, notFound } from "../http/errors.ts";
import { type Ctx, json, route } from "../http/router.ts";
import { type Body, bodyOf, dateField, requiredText, timeField } from "./fields.ts";
import { findPiece } from "./resources.ts";

const BENCHES = ["frame", "cover"];
const LAST_WORKING_DAY = 4;

interface JobRow {
  id: string;
  piece_id: string;
  title: string;
  bench: string;
  day: string;
  glue_laid_at: Date | null;
}

const JOB_SELECT = `SELECT j.id, j.piece_id, p.title, j.bench, j.day, j.glue_laid_at
  FROM bench_jobs j JOIN pieces p ON p.id = j.piece_id JOIN clients c ON c.id = p.client_id`;
const LIVE_CLIENT = `c.state NOT IN ('erasing', 'erased')`;

function jobBody(job: JobRow) {
  return {
    id: job.id,
    pieceId: job.piece_id,
    pieceTitle: job.title,
    bench: job.bench,
    day: job.day,
    dayLabel: dateCopy(job.day),
    glue: glueBody(job.glue_laid_at),
  };
}

async function jobOf(deskId: string, id: string): Promise<JobRow | null> {
  return one<JobRow>(`${JOB_SELECT} WHERE j.id = $1 AND j.desk_id = $2 AND ${LIVE_CLIENT}`, [id, deskId]);
}

async function jobResource(ctx: Ctx): Promise<void> {
  const job = await jobOf(ctx.deskId, ctx.params.id as string);
  if (!job) throw notFound();
  ctx.loaded.job = job;
}

function benchField(body: Body): string {
  const bench = requiredText(body, "bench", 20);
  if (!BENCHES.includes(bench)) throw invalid("bench", copy("F-08"));
  return bench;
}

function workingDay(body: Body): string {
  const day = dateField(body, "day");
  if (weekday(day) > LAST_WORKING_DAY) throw invalid("day", copy("F-70"), "notAWorkingDay");
  return day;
}

async function takenRefusal(deskId: string, bench: string, day: string, jobId: string | null): Promise<ApiError | null> {
  const taken = await one<JobRow>(`${JOB_SELECT} WHERE j.desk_id = $1 AND j.bench = $2 AND j.day = $3 AND j.id IS DISTINCT FROM $4`, [deskId, bench, day, jobId]);
  return taken ? conflict("benchTaken", copy("F-66", { date: dateCopy(day), job: taken.title })) : null;
}

/** The piece's glue is its latest record on any of its jobs. */
async function checkGlue(pieceId: string, title: string, bench: string, day: string): Promise<void> {
  if (bench !== "cover") return;
  const glue = await one<{ laid: Date | null }>("SELECT max(glue_laid_at) AS laid FROM bench_jobs WHERE piece_id = $1", [pieceId]);
  const refusal = coverDayRefusal(glue?.laid ?? null, day, title);
  if (refusal) throw conflict("glueCuring", refusal);
}

/** The unique index settles a race between two moves: one lands, the loser reads F-66. */
async function claimingBench(deskId: string, bench: string, day: string, jobId: string | null, write: () => Promise<void>): Promise<void> {
  try {
    await write();
  } catch (error) {
    if ((error as { code?: string }).code !== UNIQUE_VIOLATION) throw error;
    throw (await takenRefusal(deskId, bench, day, jobId)) ?? error;
  }
}

async function checkPlace(ctx: Ctx, bench: string, day: string, pieceId: string, title: string, jobId: string | null): Promise<void> {
  const taken = await takenRefusal(ctx.deskId, bench, day, jobId);
  if (taken) throw taken;
  await checkGlue(pieceId, title, bench, day);
}

export function register(): void {
  route({
    method: "GET",
    pattern: "/api/bench-jobs",
    handle: async (ctx) => {
      const asked = ctx.query.get("week") || turinToday();
      if (!isRealDate(asked)) throw invalid("week", copy("F-07"));
      const week = mondayOf(asked);
      const jobs = await query<JobRow>(
        `${JOB_SELECT} WHERE j.desk_id = $1 AND ${LIVE_CLIENT} AND j.day >= $2::date AND j.day < $2::date + 7 ORDER BY j.day, j.bench DESC`,
        [ctx.deskId, week],
      );
      return json(200, { week, jobs: jobs.map(jobBody) });
    },
  });

  route({
    method: "POST",
    pattern: "/api/bench-jobs",
    handle: async (ctx) => {
      const body = bodyOf(ctx);
      const piece = typeof body.pieceId === "string" ? await findPiece(ctx.deskId, body.pieceId) : null;
      if (typeof body.pieceId === "string" && body.pieceId !== "" && !piece) throw notFound();
      if (!piece) throw invalid("pieceId", copy("F-04"));
      const bench = benchField(body);
      const day = workingDay(body);
      await checkPlace(ctx, bench, day, piece.id, piece.title, null);
      const id = randomUUID();
      await claimingBench(ctx.deskId, bench, day, null, async () => {
        await query("INSERT INTO bench_jobs (id, desk_id, piece_id, bench, day) VALUES ($1, $2, $3, $4, $5)", [id, ctx.deskId, piece.id, bench, day]);
      });
      return json(201, { job: jobBody((await jobOf(ctx.deskId, id)) as JobRow) });
    },
  });

  route({
    method: "PATCH",
    pattern: "/api/bench-jobs/:id",
    resource: jobResource,
    handle: async (ctx) => {
      const job = ctx.loaded.job as JobRow;
      const body = bodyOf(ctx);
      const bench = body.bench === undefined ? job.bench : benchField(body);
      const day = body.day === undefined ? job.day : workingDay(body);
      await checkPlace(ctx, bench, day, job.piece_id, job.title, job.id);
      await claimingBench(ctx.deskId, bench, day, job.id, async () => {
        await query("UPDATE bench_jobs SET bench = $1, day = $2 WHERE id = $3", [bench, day, job.id]);
      });
      return json(200, { job: jobBody((await jobOf(ctx.deskId, job.id)) as JobRow) });
    },
  });

  route({
    method: "POST",
    pattern: "/api/bench-jobs/:id/glue",
    resource: jobResource,
    handle: async (ctx) => {
      const job = ctx.loaded.job as JobRow;
      const body = bodyOf(ctx);
      const date = dateField(body, "date");
      const time = timeField(body, "time");
      const laidAt = wallInstant(date, time, TURIN_ZONE);
      if (!laidAt) throw invalid("time", copy("F-68", { time, town: "Turin", date: dateCopy(date) }));
      if (job.bench !== "frame") throw conflict("glueOnFrameOnly", copy("F-71"));
      await query("UPDATE bench_jobs SET glue_laid_at = $1 WHERE id = $2", [laidAt, job.id]);
      return json(200, { job: jobBody((await jobOf(ctx.deskId, job.id)) as JobRow) });
    },
  });
}
