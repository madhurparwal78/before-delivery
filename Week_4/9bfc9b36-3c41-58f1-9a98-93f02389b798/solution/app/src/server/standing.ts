/** The season's tape standing, derived on every request from one snapshot of the submissions. */
import { rows, type Queryable } from "./db.js";
import { displayNameOf } from "./accounts.js";
import { STANDING_CHIPS } from "../shared/copy.js";
import type { StandingRow } from "../shared/types.js";

interface SubmissionFact {
  id: string;
  num: number;
  status: "pending" | "accepted" | "rejected" | "reversed";
  decided_at: Date | null;
  email: string;
  display_name: string;
  deleted: boolean;
}

/** The years that have at least one submission, newest first. */
export async function seasonsWithSubmissions(db: Queryable): Promise<number[]> {
  const found = await rows<{ year: number }>(db, "SELECT DISTINCT extract(year FROM submitted_at AT TIME ZONE 'UTC')::int AS year FROM submission ORDER BY year DESC");
  return found.map((row) => row.year);
}

export async function standingFor(db: Queryable, season: number): Promise<StandingRow[]> {
  const facts = await rows<SubmissionFact>(
    db,
    `SELECT s.id, s.num, s.status, s.decided_at, a.email, a.display_name, a.deleted
       FROM submission s JOIN account a ON a.id = s.submitted_by
      WHERE s.submitted_at >= make_timestamptz($1, 1, 1, 0, 0, 0, 'UTC') AND s.submitted_at < make_timestamptz($1 + 1, 1, 1, 0, 0, 0, 'UTC')`,
    [season],
  );
  const byOwner = new Map<string, SubmissionFact[]>();
  for (const fact of facts) byOwner.set(fact.email, [...(byOwner.get(fact.email) ?? []), fact]);
  const decidedOrder = (a: SubmissionFact, b: SubmissionFact) => a.decided_at!.getTime() - b.decided_at!.getTime() || a.num - b.num;
  const owners = [...byOwner.entries()].map(([email, list]) => {
    const decided = list.filter((fact) => fact.status !== "pending").sort(decidedOrder);
    let streak = 0;
    for (let index = decided.length - 1; index >= 0 && decided[index]!.status !== "rejected"; index--) streak++;
    const accepted = list.filter((fact) => fact.status === "accepted");
    const earliest = accepted.length ? Math.min(...accepted.map((fact) => fact.decided_at!.getTime())) : Number.POSITIVE_INFINITY;
    return {
      email,
      name: displayNameOf(list[0]!),
      counted: list.length,
      accepted: accepted.length,
      rejected: list.filter((fact) => fact.status === "rejected").length,
      reversed: list.filter((fact) => fact.status === "reversed").length,
      streak,
      earliest,
    };
  });
  owners.sort((a, b) => b.accepted - a.accepted || a.earliest - b.earliest || (a.email < b.email ? -1 : a.email > b.email ? 1 : 0));
  return owners.map((owner, index) => ({
    rank: index + 1,
    owner_email: owner.email,
    owner_name: owner.name,
    counted: owner.counted,
    accepted: owner.accepted,
    rejected: owner.rejected,
    reversed: owner.reversed,
    streak: owner.streak,
    standing:
      owner.accepted >= 15 && owner.streak >= 10 ? STANDING_CHIPS.trueTape : owner.accepted >= 10 ? STANDING_CHIPS.steadyTape : STANDING_CHIPS.newTape,
  }));
}
