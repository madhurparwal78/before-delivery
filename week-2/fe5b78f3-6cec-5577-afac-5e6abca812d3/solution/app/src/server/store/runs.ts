// Loading a run and class under its row lock, and recording one change to it: rows, history, versions and mails.
import type { PoolClient } from "pg";
import type { ClassCode } from "../../shared/api.js";
import { announcementLine } from "../../shared/format.js";
import { type Train, coachesOf } from "../domain/catalog.js";
import type { RunPassenger, RunState } from "../domain/run.js";
import { describe, movedUp } from "../domain/status.js";
import { type Db, type PassengerRow, bumpVersion } from "./rows.js";
import { queueMail } from "./outbox.js";

/** One booking at a time per run and class: every allotment, cancellation and chart takes this lock first. */
export async function lockRun(client: PoolClient, train: string, runDate: string, cls: ClassCode): Promise<void> {
  await client.query("INSERT INTO runs (train, run_date, class) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [train, runDate, cls]);
  await client.query("SELECT 1 FROM runs WHERE train = $1 AND run_date = $2 AND class = $3 FOR UPDATE", [train, runDate, cls]);
}

export async function loadRun(db: Db, train: Train, runDate: string, cls: ClassCode): Promise<RunState> {
  const { rows } = await db.query<PassengerRow & { quota: RunPassenger["quota"]; from_seq: number; to_seq: number }>(
    `SELECT p.*, b.quota, b.from_seq, b.to_seq FROM passengers p JOIN bookings b ON b.pnr = p.pnr
      WHERE b.train = $1 AND b.run_date = $2 AND b.class = $3 ORDER BY b.seq, p.number`,
    [train.number, runDate, cls],
  );
  return {
    train,
    runDate,
    cls,
    coaches: coachesOf(train, cls),
    passengers: rows.map((r) => ({
      pnr: r.pnr, number: r.number, age: r.age, gender: r.gender, quota: r.quota, from: r.from_seq, to: r.to_seq,
      status: r.status, position: r.position, coach: r.coach, berth: r.berth, racPlace: r.rac_place, seq: r.queue_seq,
    })),
  };
}

const same = (a: RunPassenger, b: RunPassenger): boolean =>
  a.status === b.status && a.position === b.position && a.coach === b.coach && a.berth === b.berth &&
  a.racPlace === b.racPlace && a.seq === b.seq;

/**
 * Writes the passengers that changed between two states of a run and records the change: a history entry per new
 * label, one version step for every other PNR it moved or renumbered, and one status-moved mail per PNR in which a
 * passenger moved up. The PNR that caused the change counts its own version step.
 */
export async function recordRunChange(client: PoolClient, before: RunState, after: RunState, now: number, cause: string): Promise<void> {
  const touched = new Map<string, string[]>();
  for (const next of after.passengers) {
    const prev = before.passengers.find((p) => p.pnr === next.pnr && p.number === next.number);
    if (!prev || same(prev, next)) continue;
    await client.query(
      `UPDATE passengers SET status = $3, position = $4, coach = $5, berth = $6, rac_place = $7, queue_seq = $8
        WHERE pnr = $1 AND number = $2`,
      [next.pnr, next.number, next.status, next.position, next.coach, next.berth, next.racPlace, next.seq],
    );
    const from = describe(prev);
    const to = describe(next);
    if (from.label === to.label) continue;
    await client.query("INSERT INTO history (pnr, number, at_ms, from_label, to_label) VALUES ($1, $2, $3, $4, $5)", [
      next.pnr, next.number, now, from.label, to.label,
    ]);
    const lines = touched.get(next.pnr) ?? [];
    if (movedUp(prev.status, next.status)) lines.push(announcementLine(next.number, from, to));
    touched.set(next.pnr, lines);
  }
  for (const [pnr, lines] of touched) {
    if (pnr !== cause) await bumpVersion(client, pnr);
    if (lines.length === 0) continue;
    const { rows } = await client.query<{ email: string }>(
      "SELECT a.email FROM bookings b JOIN accounts a ON a.id = b.account_id WHERE b.pnr = $1",
      [pnr],
    );
    await queueMail(client, {
      to: rows[0]?.email ?? "",
      subject: `Your status moved: PNR ${pnr}`,
      text: `A cancellation on your train moved your booking up.\n\n${lines.join("\n")}\n\nPakka Rail`,
    });
  }
}
