import { deriveCounts, type CountedItem } from "../shared/counts";
import { TRADES, isCrew, type Job, type Progress, type RoomCounts, type Trade } from "../shared/domain";
import { scopeTrade, type JobAccess } from "./access";
import { maybeOne, rows, sequence, type Db } from "./db";
import { codesVisibleUntil, loadSeries, nextVisit } from "./visits";

// Derived views of a job: the Job resource for one caller, and the counts for every scope,
// which the API, the plan labels, the event stream and the summary all take from the one
// derived-count calculation.

interface ScopeCounts {
  progress: Progress;
  rooms: { id: string; counts: RoomCounts }[];
}

/** Counts for the whole job (owner, lead, homeowner) and for each trade's scope. */
export interface CountsByScope {
  all: ScopeCounts;
  trades: Record<Trade, ScopeCounts>;
}

interface CountedRow extends CountedItem {
  trade: Trade | null;
}

function scopeCounts(items: readonly CountedItem[], roomIds: readonly string[]): ScopeCounts {
  const derived = deriveCounts(items, roomIds);
  return { progress: derived.progress, rooms: roomIds.map((id) => ({ id, counts: derived.rooms.get(id)! })) };
}

export async function countsByScope(db: Db, jobId: string): Promise<CountsByScope> {
  const [rooms, items] = await sequence(
    () => rows<{ id: string }>(db, "SELECT id FROM rooms WHERE job_id = $1 ORDER BY position", [jobId]),
    () => rows<CountedRow>(db, "SELECT room_id, status, trade FROM items WHERE job_id = $1", [jobId]),
  );
  const roomIds = rooms.map((room) => room.id);
  const trades = Object.fromEntries(
    TRADES.map((trade) => [
      trade,
      scopeCounts(
        items.filter((item) => item.trade === trade),
        roomIds,
      ),
    ]),
  ) as Record<Trade, ScopeCounts>;
  return { all: scopeCounts(items, roomIds), trades };
}

/** The counts one caller sees. */
export function countsFor(access: Pick<JobAccess, "role" | "trade">, counts: CountsByScope): ScopeCounts {
  const trade = scopeTrade(access);
  return trade === null ? counts.all : counts.trades[trade];
}

/** A job as the caller sees it: progress over their scope, codes and their next visit. */
export async function jobView(db: Db, access: JobAccess): Promise<Job> {
  const { job, role } = access;
  const now = new Date();
  const [items, plan, mySeries] = await Promise.all([
    rows<CountedItem>(db, "SELECT room_id, status FROM items WHERE job_id = $1 AND ($2::text IS NULL OR trade = $2)", [
      job.id,
      scopeTrade(access),
    ]),
    maybeOne<{ revision: number }>(db, "SELECT max(revision) AS revision FROM plan_revisions WHERE job_id = $1 HAVING count(*) > 0", [
      job.id,
    ]),
    role === "trade" ? loadSeries(db, job.id, access.memberId) : Promise.resolve([]),
  ]);
  return {
    id: job.id,
    name: job.name,
    address: job.address,
    time_zone: job.time_zone,
    status: job.status,
    progress: deriveCounts(items, []).progress,
    my_role: role,
    my_trade: access.trade,
    plan_url: plan ? `/api/jobs/${job.id}/plan` : null,
    plan_revision: plan?.revision ?? null,
    access_codes_available: isCrew(role) || (role === "trade" && codesVisibleUntil(mySeries, job.time_zone, now) !== null),
    next_visit: role === "trade" ? nextVisit(mySeries, job.time_zone, now) : null,
  };
}
