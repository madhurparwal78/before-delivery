// Deadline timers on the app clock (brief: Business rules / Deadlines). Nothing runs on the system clock:
// when the grading clock moves, every point that became due fires in due order, each in its own transaction.
import { pool, readClock, transaction } from "./db.ts";
import { ceilingAt, warningAt } from "./deadlines.ts";
import { escalateMissedDeadline, expireRequest, loadRequest, warnHolder, type RequestRow } from "./requestWorkflow.ts";

type Kind = "warning" | "breach" | "ceiling";
const KIND_ORDER: Record<Kind, number> = { warning: 0, breach: 1, ceiling: 2 };

interface Due {
  requestId: string;
  kind: Kind;
  at: string;
}

function duePoints(req: Pick<RequestRow, "id" | "submitted_at" | "deadline" | "application_class" | "warned" | "breached">, now: string): Due[] {
  const points: Due[] = [];
  if (!req.warned) points.push({ requestId: req.id, kind: "warning", at: warningAt(req.submitted_at!, req.application_class) });
  if (!req.breached) points.push({ requestId: req.id, kind: "breach", at: req.deadline! });
  points.push({ requestId: req.id, kind: "ceiling", at: ceilingAt(req.submitted_at!, req.application_class) });
  return points.filter((p) => p.at <= now);
}

async function nextDue(): Promise<Due | undefined> {
  const now = await readClock(pool);
  const rows = (await pool.query<RequestRow>("SELECT * FROM requests WHERE state = 'under_review'")).rows;
  return rows
    .flatMap((row) => duePoints(row, now))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.requestId < b.requestId ? -1 : 1)))[0];
}

async function fire(due: Due): Promise<void> {
  await transaction(async (tx) => {
    const req = await loadRequest(tx, due.requestId, true);
    if (!req || req.state !== "under_review") return;
    if (due.kind === "warning" && !req.warned) await warnHolder(tx, req);
    else if (due.kind === "breach" && !req.breached) await escalateMissedDeadline(tx, req, due.at);
    else if (due.kind === "ceiling") await expireRequest(tx, req, due.at);
  });
}

/** Fires every due timer, earliest first, until none remains. */
export async function runDueTimers(): Promise<void> {
  for (let due = await nextDue(); due; due = await nextDue()) await fire(due);
}
