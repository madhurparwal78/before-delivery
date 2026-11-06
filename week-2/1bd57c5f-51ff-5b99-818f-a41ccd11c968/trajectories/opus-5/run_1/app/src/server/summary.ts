import { STATUS_LABELS, TRADE_KEYS, tradeLabel, type Trade } from '../shared/domain.js';
import { db, withTransaction } from './db.js';
import { config } from './env.js';
import {
  dateFromDayNumber,
  dayNumber,
  formatLocalDate,
  pad2,
  secondsOfDay,
  toLocal,
} from './core/timezone.js';
import { queueOutbox, signInLine } from './mail.js';
import {
  jobProgress,
  loadItems,
  loadMembers,
  loadJob,
  loadRooms,
  roomCounts,
  type Viewer,
} from './model.js';
import { allOccurrences } from './visits.js';

const HOMEOWNER_VIEWER: Viewer = {
  personId: '',
  role: 'homeowner',
  trade: null,
  memberId: null,
  name: '',
};

type Listed =
  | { number: number; title: string; removed: true }
  | { number: number; title: string; removed: false; status: keyof typeof STATUS_LABELS };

async function buildSummary(
  jobId: string,
  localDate: string,
  windowStart: Date,
  cutOff: Date,
): Promise<{ subject: string; body: string } | null> {
  const job = await loadJob(db, jobId);
  if (job === null) return null;
  const rooms = await loadRooms(db, jobId);
  const items = await loadItems(db, jobId);
  const progress = jobProgress(items, HOMEOWNER_VIEWER);

  const changes = await db.query(
    `select item_id, number, title, kind, at from item_changes
      where job_id = $1 and at > $2 and at <= $3 order by at, id`,
    [jobId, windowStart.toISOString(), cutOff.toISOString()],
  );
  const perItem = new Map<string, { number: number; created: boolean; deleted: boolean; title: string }>();
  for (const row of changes.rows) {
    const id = row.item_id as string;
    const entry =
      perItem.get(id) ?? { number: row.number as number, created: false, deleted: false, title: row.title as string };
    if (row.kind === 'created') entry.created = true;
    if (row.kind === 'deleted') {
      entry.deleted = true;
      entry.title = row.title as string;
    }
    perItem.set(id, entry);
  }

  const listed: Listed[] = [];
  for (const [id, entry] of perItem) {
    if (entry.deleted) {
      if (entry.created) continue;
      listed.push({ number: entry.number, title: entry.title, removed: true });
      continue;
    }
    const item = items.find((candidate) => candidate.id === id);
    if (item === undefined) continue;
    listed.push({ number: item.number, title: item.title, removed: false, status: item.status });
  }
  if (listed.length === 0) return null;
  listed.sort((a, b) => a.number - b.number);

  const tomorrow = formatLocalDate(dateFromDayNumber(dayNumber(parseDate(localDate)) + 1));
  const members = await loadMembers(db, jobId);
  const occurrences = (await allOccurrences(db, job))
    .flatMap((entry) => entry.occurrences)
    .filter((occurrence) => occurrence.status !== 'cancelled')
    .filter((occurrence) => formatLocalDate(occurrence.startsLocal) === tomorrow);
  const tradeOrder = (trade: Trade | null): number =>
    trade === null ? TRADE_KEYS.length : TRADE_KEYS.indexOf(trade);
  const visitLines = occurrences
    .map((occurrence) => {
      const member = members.find((candidate) => candidate.id === occurrence.memberId);
      return { occurrence, trade: member?.trade ?? null };
    })
    .sort(
      (a, b) =>
        a.occurrence.startsUtc.getTime() - b.occurrence.startsUtc.getTime() ||
        tradeOrder(a.trade) - tradeOrder(b.trade),
    )
    .map(
      ({ occurrence, trade }) =>
        `Visit ${formatLocalDate(occurrence.startsLocal)} ` +
        `${pad2(occurrence.startsLocal.hour)}:${pad2(occurrence.startsLocal.minute)} to ` +
        `${pad2(occurrence.endsLocal.hour)}:${pad2(occurrence.endsLocal.minute)}: ${tradeLabel(trade)}`,
    );

  const lines = [
    `${progress.percent}% verified (${progress.verified} of ${progress.total} items)`,
    ...rooms.map((room) => {
      const counts = roomCounts(items, HOMEOWNER_VIEWER, room.id);
      return `${room.name}: ${counts.verified} of ${counts.total} verified`;
    }),
    ...(visitLines.length === 0 ? ['No site visits tomorrow'] : visitLines),
    ...listed.map((entry) =>
      entry.removed
        ? `Item ${entry.number}: ${entry.title} — Removed`
        : `Item ${entry.number}: ${entry.title} — ${STATUS_LABELS[entry.status]}`,
    ),
    signInLine(),
  ];

  return {
    subject: `Snaglight: walkthrough summary for ${job.name}, ${localDate}`,
    body: lines.join('\n'),
  };
}

function parseDate(text: string): { year: number; month: number; day: number } {
  const [year, month, day] = text.split('-').map(Number);
  return { year, month, day };
}

async function runOnce(): Promise<void> {
  const jobs = await db.query(
    `select id, time_zone, created_at from jobs where status in ('active', 'walkthrough')`,
  );
  const now = new Date();
  for (const row of jobs.rows) {
    const jobId = row.id as string;
    const local = toLocal(row.time_zone as string, now);
    const localDate = formatLocalDate(local);
    if (secondsOfDay(local) < config.summaryTime.hour * 3600 + config.summaryTime.minute * 60) {
      continue;
    }
    const homeowners = (await loadMembers(db, jobId)).filter(
      (member) => member.role === 'homeowner',
    );
    if (homeowners.length === 0) continue;

    const runs = await db.query(
      `select local_date, cut_off from summary_runs where job_id = $1 order by cut_off desc`,
      [jobId],
    );
    if (runs.rows.some((entry) => entry.local_date === localDate)) continue;
    const windowStart =
      runs.rowCount > 0 ? (runs.rows[0].cut_off as Date) : (row.created_at as Date);

    const latest = await db.query(
      `select max(at) as newest from item_changes where job_id = $1 and at > $2 and at <= $3`,
      [jobId, windowStart.toISOString(), now.toISOString()],
    );
    const newest = latest.rows[0].newest as Date | null;
    if (newest === null) continue;
    if (now.getTime() - newest.getTime() < config.summaryQuietSeconds * 1000) continue;

    const claimed = await withTransaction(async (tx) => {
      const insert = await tx.query(
        `insert into summary_runs (job_id, local_date, cut_off) values ($1, $2, $3)
         on conflict (job_id, local_date) do nothing returning local_date`,
        [jobId, localDate, now.toISOString()],
      );
      return insert.rowCount > 0;
    });
    if (!claimed) continue;

    const summary = await buildSummary(jobId, localDate, windowStart, now);
    if (summary === null) continue;
    await withTransaction(async (tx) => {
      for (const homeowner of homeowners) {
        await queueOutbox(
          tx,
          jobId,
          'summary',
          homeowner.email,
          summary.subject,
          summary.body,
          now,
        );
      }
    });
  }
}

export function startSummaryScheduler(): void {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await runOnce();
    } catch {
      // The next tick retries.
    } finally {
      running = false;
    }
  };
  setInterval(() => void tick(), 10_000);
  void tick();
}
