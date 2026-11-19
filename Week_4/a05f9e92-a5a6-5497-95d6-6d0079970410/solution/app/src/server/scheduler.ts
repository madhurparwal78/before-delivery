import { currentOffset, loadOffset, now, setClockTo, withClockAt } from "./clock.js";
import { closeStep, expiredSteps, nextStepClose } from "./changes.js";
import { transaction, query, type Tx } from "./db.js";
import { Env, SYSTEM } from "./env.js";
import { publishTo, subscribedNumbers } from "./live.js";
import { climbDue, nextPageDue } from "./oncall.js";
import { findRecord, save } from "./records.js";
import { publishSla, runThreshold, scanSlas, slaViews, type Pending } from "./sla.js";
import { addDays, localParts, wallToInstant } from "../shared/tz.js";
import { dueWakeups, nextWakeup, resumeRun } from "./workflows.js";

interface Event {
  at: number;
  run: (env: Env) => Promise<void>;
}

const MAX_EVENTS = 5000;
let chain: Promise<unknown> = Promise.resolve();

/** One background run at a time; the real-time tick and clock changes queue behind each other. */
function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = chain.then(work, work);
  chain = next.catch(() => undefined);
  return next;
}

async function digestDue(tx: Tx, toMs: number): Promise<Array<{ at: number; username: string }>> {
  const rows = await tx.query(
    `SELECT u.username, u.time_zone, min(i.at) AS since FROM users u JOIN inbox i ON i.username = u.username
     WHERE u.digest = 'daily' AND NOT i.delivered AND NOT i.digested GROUP BY u.username, u.time_zone`,
  );
  const due: Array<{ at: number; username: string }> = [];
  for (const row of rows) {
    const zone = row.time_zone as string;
    const since = Date.parse(row.since as string);
    const local = localParts(since, zone);
    let day = { year: local.year, month: local.month, day: local.day };
    let at = wallToInstant(day.year, day.month, day.day, 8, 0, zone);
    if (at <= since) {
      day = addDays(day.year, day.month, day.day, 1);
      at = wallToInstant(day.year, day.month, day.day, 8, 0, zone);
    }
    if (at <= toMs) due.push({ at, username: row.username as string });
  }
  return due;
}

async function pickEvent(env: Env, toMs: number): Promise<Event | null> {
  const tx = env.tx;
  {
    const candidates: Event[] = [];
    const page = await nextPageDue(tx);
    if (page !== null && page <= toMs) candidates.push({ at: page, run: async (e) => void (await climbDue(e, page)) });
    const step = await nextStepClose(tx);
    if (step !== null && step <= toMs) {
      candidates.push({
        at: step,
        run: async (e) => {
          const [expired] = await expiredSteps(e.tx, step);
          if (expired) await closeStep(e, expired.number, expired.step);
        },
      });
    }
    const wake = await nextWakeup(tx);
    if (wake !== null && wake <= toMs) {
      candidates.push({
        at: wake,
        run: async (e) => {
          const [due] = await dueWakeups(e.tx, wake);
          if (due) await resumeRun(e, due.run);
        },
      });
    }
    const closing = (await tx.query("SELECT number, close_at FROM records WHERE close_at IS NOT NULL ORDER BY close_at LIMIT 1"))[0];
    if (closing) {
      const at = Date.parse(closing.close_at as string) + 1;
      if (at <= toMs) candidates.push({ at, run: async (e) => void (await save(e, { table: "incident", number: closing.number as string, submitted: {}, to: "closed", system: true })) });
    }
    for (const digest of await digestDue(tx, toMs)) candidates.push({ at: digest.at, run: (e) => sendDigest(e, digest.username) });
    const catalog = await env.slaCatalog();
    const { pending, flipped } = await scanSlas(tx, env.world, catalog, toMs);
    for (const rec of flipped) publishSla(rec, await slaViews(tx, rec, env.world, catalog, toMs), []);
    const first = pending[0];
    if (first) candidates.push({ at: first.at, run: async (e) => void (await runThresholdEvent(e, first)) });
    candidates.sort((a, b) => a.at - b.at);
    return candidates[0] ?? null;
  }
}

async function runThresholdEvent(env: Env, event: Pending): Promise<void> {
  const change = await runThreshold(env.tx, env.world, event);
  env.tx.after.push(async () => publishSla(event.rec, await slaViews(null, event.rec, env.world, await env.slaCatalog()), [change]));
}

async function sendDigest(env: Env, username: string): Promise<void> {
  const rows = await env.tx.query("UPDATE inbox SET digested = true WHERE username = $1 AND NOT delivered AND NOT digested RETURNING id", [username]);
  if (rows.length === 0) return;
  await env.tx.query("INSERT INTO inbox (username, event, text, at, delivered, digested) VALUES ($1, 'digest', $2, $3, true, true)", [username, `Daily digest: ${rows.length} updates`, new Date(now()).toISOString()]);
  env.tx.after.push(() => publishTo(username, "inbox", "item", { event: "digest" }));
}

/** Handles due events one transaction at a time; the advisory lock keeps several instances from firing the same event. */
async function drain(toMs: number): Promise<void> {
  for (let count = 0; count < MAX_EVENTS; count++) {
    const handled = await transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(7403)");
      const env = await Env.create(tx, SYSTEM);
      const event = await pickEvent(env, toMs);
      if (!event) return false;
      await withClockAt(event.at, () => event.run(env));
      return true;
    });
    if (!handled) return;
  }
}

/** Runs everything due up to the real clock; called once per real second. */
export function tick(): Promise<void> {
  return serial(async () => {
    await adoptSharedOffset();
    await drain(now());
  });
}

/** Instances sharing one database share one server clock: pick up an offset another instance persisted. */
async function adoptSharedOffset(): Promise<void> {
  const row = (await query("SELECT value FROM meta WHERE key = 'clock_offset'"))[0];
  const stored = row ? Number(row.value) : 0;
  if (Math.abs(stored - currentOffset()) > 5) loadOffset(stored);
}

/** Moves the server clock and runs every job due in between, in time order, before answering. */
export function moveClock(change: { set: number } | { advance: number }): Promise<number> {
  return serial(async () => {
    const target = "set" in change ? change.set : now() + change.advance * 1000;
    const forward = target >= now();
    if (forward) await drain(target);
    setClockTo(target);
    await persistOffset();
    await refreshSlaViews();
    return target;
  });
}

async function persistOffset(): Promise<void> {
  await query("INSERT INTO meta (key, value) VALUES ('clock_offset', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [JSON.stringify(currentOffset())]);
}

/** After the clock moved, subscribed pages get fresh SLA values because their countdowns restart from the server. */
async function refreshSlaViews(): Promise<void> {
  for (const number of subscribedNumbers("sla:")) {
    await transaction(async (tx) => {
      const env = await Env.create(tx, SYSTEM);
      const rec = await findRecord(tx, number);
      if (rec) publishSla(rec, await slaViews(tx, rec, env.world, await env.slaCatalog()), []);
    });
  }
}
