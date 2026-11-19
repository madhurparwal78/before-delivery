import type { Tx } from "./db.js";
import { db, write } from "./db.js";
import { record } from "./audit.js";
import { now } from "./clock.js";
import { emitToDesk, connected, keepAlive, send } from "./events.js";
import { sweepBoundaries } from "./access-sync.js";
import { KeycloakUnavailable, setEnabled } from "./keycloak.js";
import type { PersonRow, RotationRow, RuleRow, VaultRow } from "./model.js";
import { officeDate, officeMidnight } from "./office-time.js";
import { endAccess, startTerms } from "./people.js";
import { markOverdue, openReviewFor, openingDay } from "./reviews.js";
import { dueRuns, overdueTurns } from "./turns.js";
import { runsBetween } from "./rotations.js";
import { termEndInstant } from "./visibility.js";
import { driveSeat, markWaiting, retryWaiting } from "./seats.js";
import { runCheck } from "./health.js";
import { config } from "./config.js";

/** Scheduled rules take force at 00:00 office time on their effective date; the previous rule is superseded. */
async function takeForce(tx: Tx, at: Date): Promise<void> {
  const today = officeDate(at);
  const due = await tx.query<RuleRow>(
    `SELECT r.* FROM rules r JOIN vaults v ON v.id = r.vault_id WHERE r.state = 'scheduled' AND r.effective_on <= $1
     ORDER BY v.ord, r.effective_on, r.ord`,
    [today],
  );
  const announced = new Map<string, { vault: VaultRow; rule: RuleRow }>();
  for (const rule of due) {
    const vault = await tx.one<VaultRow>("SELECT * FROM vaults WHERE id = $1", [rule.vault_id]);
    if (!vault) continue;
    const previous = await tx.one<RuleRow>("SELECT * FROM rules WHERE vault_id = $1 AND state = 'in_force'", [vault.id]);
    const when = officeMidnight(rule.effective_on);
    await tx.query("UPDATE rules SET state = 'in_force', took_force_on = effective_on WHERE id = $1", [rule.id]);
    await record(tx, "system", "rule_in_force", { kind: "vault", id: vault.id, name: vault.name }, { rule_id: rule.id, min_length: rule.min_length }, when);
    if (previous) {
      await tx.query("UPDATE rules SET state = 'superseded' WHERE id = $1", [previous.id]);
      await record(tx, "system", "rule_superseded", { kind: "vault", id: vault.id, name: vault.name }, { rule_id: previous.id }, when);
    }
    announced.set(vault.id, { vault, rule });
  }
  const ordered = [...announced.values()];
  if (ordered.length > 0) {
    tx.after(() => ordered.forEach(({ vault, rule }) => emitToDesk("rule-in-force", { vault_id: vault.id, rule_id: rule.id, name: vault.name })));
  }
}

/** The end of an engagement term (23:59 office time on its last day) does everything a leave does. */
async function endTerms(at: Date): Promise<void> {
  const people = await db.query<PersonRow>(
    "SELECT * FROM people WHERE role = 'outside_bookkeeper' AND left_at IS NULL AND term_ends_on IS NOT NULL ORDER BY ord",
  );
  for (const person of people) {
    const endsAt = termEndInstant(person.term_ends_on ?? "");
    if (endsAt.getTime() > at.getTime()) continue;
    try {
      await setEnabled(person.handle, false);
    } catch (error) {
      if (error instanceof KeycloakUnavailable) return;
      throw error;
    }
    const finished = await write(async (tx) => {
      const fresh = await tx.one<PersonRow>("SELECT * FROM people WHERE id = $1", [person.id]);
      if (!fresh || fresh.left_at) return null;
      return endAccess(tx, fresh, "system", "term_end", endsAt);
    });
    if (finished && !(await driveSeat(person.id, Date.now() + 3000, "system"))) await markWaiting(finished.person, "system");
  }
}

async function endSessions(at: Date): Promise<void> {
  for (const connection of [...connected()]) {
    if (connection.endsAt.getTime() <= at.getTime()) {
      send(connection, "session-ended", {});
      connection.res.end();
    }
  }
}

/** Reads only: whether any timed change is due, so an idle second never takes the write lock. */
async function timedWorkPending(at: Date): Promise<boolean> {
  const today = officeDate(at);
  const counts = await db.one<{ rules: number; late: number; overdue_reviews: number }>(
    `SELECT (SELECT count(*) FROM rules WHERE state = 'scheduled' AND effective_on <= $1)::int AS rules,
            (SELECT count(*) FROM turns WHERE state = 'due' AND due_by < $1)::int AS late,
            (SELECT count(*) FROM reviews WHERE status = 'open' AND overdue_from <= $1)::int AS overdue_reviews`,
    [today],
  );
  if (!counts || counts.rules > 0 || counts.late > 0 || counts.overdue_reviews > 0) return true;
  const opening = openingDay(today);
  if (today >= opening.opened_on && !(await db.one("SELECT 1 FROM reviews WHERE quarter_year = $1 AND quarter = $2", [opening.year, opening.quarter]))) return true;
  const rotations = await db.query<RotationRow & { filed: number }>(
    "SELECT r.*, (SELECT count(*) FROM turns t WHERE t.rotation_id = r.id AND t.run_at > r.since)::int AS filed FROM rotations r",
  );
  return rotations.some((rotation) => runsBetween(rotation, rotation.since, at).length > rotation.filed);
}

let busy = false;

async function tick(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const at = now();
    if (await timedWorkPending(at)) {
      await write(async (tx) => {
        await takeForce(tx, at);
        await dueRuns(tx, at);
        await overdueTurns(tx, at);
        await openReviewFor(tx, officeDate(at), true);
        await markOverdue(tx, at);
      });
    }
    await startTerms();
    await endTerms(at);
    await sweepBoundaries();
    await endSessions(at);
  } catch (error) {
    console.error("scheduler tick failed:", error instanceof Error ? error.message : "unknown error");
  } finally {
    busy = false;
  }
}

export function startScheduler(): void {
  setInterval(() => void tick(), 1000);
  setInterval(() => keepAlive(), 15_000);
  let retrying = false;
  setInterval(() => {
    if (retrying) return;
    retrying = true;
    retryWaiting()
      .catch(() => undefined)
      .finally(() => {
        retrying = false;
      });
  }, 2000);
  const check = (): void => void runCheck().catch(() => undefined);
  check();
  setInterval(check, config.breachCheckSeconds * 1000);
}
