/**
 * The bench week. One job per bench per day, and a cover job goes on a day only
 * if the piece's glue has cured by that bench day's start.
 */
import { F } from '../../shared/feedback.ts';
import {
  addDays,
  BUSINESS_ZONE,
  dateText,
  englishDate,
  englishDateTimeAt,
  isoWeekday,
  mondayOf,
  parseDate,
  resolveWall,
  startOfLocalDayAt,
  timeText,
  TOWN_ZONE,
  type CalendarDate,
} from '../domain/time.ts';
import { fail } from '../http/errors.ts';
import { Check } from '../http/validate.ts';
import type { Ctx, Route } from '../http/context.ts';
import { requireOwnPiece } from './lookup.ts';
import { BENCH_NAMES, presentBenchJob, type Bench, type Row } from '../present.ts';

/** Glue cures for 48 hours of real elapsed time. */
export const GLUE_CURE_MS = 48 * 60 * 60 * 1000;
/** A bench day starts at 09:00 Turin time. */
export const BENCH_DAY_START_HOUR = 9;

const BENCHES = ['frame', 'cover'] as const;

function curesAt(laidAt: unknown): number | null {
  if (laidAt === null || laidAt === undefined) return null;
  return new Date(laidAt as string).getTime() + GLUE_CURE_MS;
}

/** The latest glue laid on any of this piece's frame bench jobs. */
async function glueOfPiece(ctx: Ctx, pieceId: string): Promise<number | null> {
  const row = await ctx.app.db.one<Row>(
    `SELECT glue_laid_at FROM bench_jobs WHERE piece_id = $1 AND glue_laid_at IS NOT NULL
      ORDER BY glue_laid_at DESC LIMIT 1`,
    [pieceId],
  );
  return row ? curesAt(row.glue_laid_at) : null;
}

/** Refuses a day the bench does not work, a taken bench, or uncured glue. */
async function checkDay(
  ctx: Ctx,
  deskId: string,
  pieceId: string,
  pieceTitle: string,
  bench: Bench,
  day: CalendarDate,
  excludeJobId: string | null,
): Promise<void> {
  if (isoWeekday(day) > 5) throw fail.invalid(F.benchWeekdays);

  const taken = await ctx.app.db.one<Row>(
    `SELECT b.id, p.title FROM bench_jobs b JOIN pieces p ON p.id = b.piece_id
      WHERE b.desk_id = $1 AND b.bench = $2 AND b.day = $3
        AND ($4::bigint IS NULL OR b.id <> $4)`,
    [deskId, bench, dateText(day), excludeJobId],
  );
  if (taken) throw fail.conflict(F.benchTaken(englishDate(day), String(taken.title)));

  if (bench === 'cover') {
    const cures = await glueOfPiece(ctx, pieceId);
    if (cures !== null) {
      const dayStart = startOfLocalDayAt(BUSINESS_ZONE, day, BENCH_DAY_START_HOUR);
      if (cures > dayStart) {
        throw fail.conflict(
          F.glueCuring(pieceTitle, englishDateTimeAt(BUSINESS_ZONE, cures, 'Turin')),
        );
      }
    }
  }
}

async function weekJobs(ctx: Ctx, deskId: string, monday: CalendarDate): Promise<Row[]> {
  return ctx.app.db.query<Row>(
    `SELECT b.*, p.title AS piece_title FROM bench_jobs b JOIN pieces p ON p.id = b.piece_id
      WHERE b.desk_id = $1 AND b.day >= $2 AND b.day <= $3 ORDER BY b.day, b.bench`,
    [deskId, dateText(monday), dateText(addDays(monday, 6))],
  );
}

async function presentJob(ctx: Ctx, row: Row): Promise<Row> {
  const cures = row.glue_laid_at === null ? null : curesAt(row.glue_laid_at);
  return presentBenchJob(row, cures, ctx.app.now());
}

export const benchRoutes: readonly Route[] = [
  {
    method: 'GET',
    pattern: '/api/bench-jobs',
    auth: 'required',
    async handle(ctx) {
      const desk = ctx.requireDesk();
      const weekText = ctx.query('week');
      const week = weekText === null ? ctx.app.today() : parseDate(weekText);
      if (!week) throw fail.invalid(F.notDate);
      const monday = mondayOf(week);
      const rows = await weekJobs(ctx, desk.id, monday);
      ctx.json(200, {
        week: dateText(monday),
        jobs: await Promise.all(rows.map((row) => presentJob(ctx, row))),
      });
    },
  },

  {
    method: 'POST',
    pattern: '/api/bench-jobs',
    auth: 'required',
    body: 'json',
    async handle(ctx) {
      const desk = ctx.requireDesk();
      const piece = await requireOwnPiece(ctx, ctx.body.pieceId);
      const check = new Check(ctx.body);
      const bench = check.choice('bench', BENCHES) as Bench | null;
      const day = check.date('day');
      check.done();

      await checkDay(ctx, desk.id, String(piece.id), String(piece.title), bench!, day!, null);
      const row = await ctx.app.db.one<Row>(
        `INSERT INTO bench_jobs (desk_id, piece_id, bench, day) VALUES ($1,$2,$3,$4) RETURNING *`,
        [desk.id, piece.id, bench, dateText(day!)],
      );
      const job = await presentJob(ctx, { ...row!, piece_title: piece.title });
      ctx.json(201, {
        job,
        message: F.jobAdded(String(piece.title), BENCH_NAMES[bench!], englishDate(day!)),
      });
    },
  },

  {
    method: 'PATCH',
    pattern: '/api/bench-jobs/:id',
    auth: 'required',
    body: 'json',
    async resolve(ctx) {
      const desk = ctx.requireDesk();
      const id = ctx.param('id');
      if (!/^\d+$/.test(id)) throw fail.notFound();
      const row = await ctx.app.db.one<Row>(
        `SELECT b.*, p.title AS piece_title FROM bench_jobs b JOIN pieces p ON p.id = b.piece_id
          WHERE b.id = $1 AND b.desk_id = $2`,
        [id, desk.id],
      );
      if (!row) throw fail.notFound();
      ctx.resolved.job = row;
    },
    async handle(ctx) {
      const desk = ctx.requireDesk();
      const job = ctx.resolved.job!;
      const check = new Check(ctx.body);
      const bench = check.has('bench') ? (check.choice('bench', BENCHES) as Bench | null) : undefined;
      const day = check.has('day') ? check.date('day') : undefined;
      check.done();

      const nextBench = (bench ?? String(job.bench)) as Bench;
      const nextDay = day ?? parseDate(String(job.day))!;
      await checkDay(
        ctx,
        desk.id,
        String(job.piece_id),
        String(job.piece_title),
        nextBench,
        nextDay,
        String(job.id),
      );

      const row = await ctx.app.db.one<Row>(
        `UPDATE bench_jobs SET bench = $2, day = $3 WHERE id = $1 RETURNING *`,
        [job.id, nextBench, dateText(nextDay)],
      );
      ctx.json(200, {
        job: await presentJob(ctx, { ...row!, piece_title: job.piece_title }),
        message: F.jobMoved(
          String(job.piece_title),
          BENCH_NAMES[nextBench],
          englishDate(nextDay),
        ),
      });
    },
  },

  {
    method: 'POST',
    pattern: '/api/bench-jobs/:id/glue',
    auth: 'required',
    body: 'json',
    async resolve(ctx) {
      const desk = ctx.requireDesk();
      const id = ctx.param('id');
      if (!/^\d+$/.test(id)) throw fail.notFound();
      const row = await ctx.app.db.one<Row>(
        `SELECT b.*, p.title AS piece_title FROM bench_jobs b JOIN pieces p ON p.id = b.piece_id
          WHERE b.id = $1 AND b.desk_id = $2`,
        [id, desk.id],
      );
      if (!row) throw fail.notFound();
      ctx.resolved.job = row;
    },
    async handle(ctx) {
      const job = ctx.resolved.job!;
      const check = new Check(ctx.body);
      const date = check.date('date');
      const time = check.time('time');
      check.done();

      if (job.bench !== 'frame') throw fail.conflict(F.glueOnFrame);

      // A wall time that does not exist on its day is refused.
      const resolvedWall = resolveWall(BUSINESS_ZONE, {
        ...date!,
        hour: time!.hour,
        minute: time!.minute,
        second: 0,
      });
      if (resolvedWall.kind === 'absent') {
        throw fail.invalid(
          F.noSuchTime(timeText(time!.hour, time!.minute), 'Turin', englishDate(date!)),
        );
      }

      const row = await ctx.app.db.one<Row>(
        `UPDATE bench_jobs SET glue_laid_at = $2 WHERE id = $1 RETURNING *`,
        [job.id, new Date(resolvedWall.ms)],
      );
      const cures = resolvedWall.ms + GLUE_CURE_MS;
      ctx.json(200, {
        job: await presentJob(ctx, { ...row!, piece_title: job.piece_title }),
        message: F.glueLaid(
          String(job.piece_title),
          englishDateTimeAt(BUSINESS_ZONE, cures, 'Turin'),
        ),
      });
    },
  },
];

export { TOWN_ZONE };
