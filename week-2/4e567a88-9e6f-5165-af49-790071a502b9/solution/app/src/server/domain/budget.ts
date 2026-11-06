// Period spend and the cap state of a team's budget period.

import type { Db } from "../db";
import { one, single } from "../db";
import { MICRO } from "../../shared/money";
import type { BudgetPeriod } from "./period";
import type { TeamPolicy } from "./policy";

type CapState = "under" | "soft_cap_passed" | "hard_cap_reached";

/** Charges of succeeded jobs plus current reservations of in-flight jobs, for jobs submitted in the period. */
export async function periodSpend(db: Db, teamId: string, period: BudgetPeriod): Promise<bigint> {
  const row = await single<{ spend: bigint }>(db,
    `SELECT COALESCE(SUM(CASE WHEN status = 'succeeded' THEN charged_micro
                              WHEN status IN ('queued', 'leased', 'running') THEN reserved_micro ELSE 0 END), 0)::bigint AS spend
     FROM jobs WHERE team_id = $1 AND submitted_at >= $2 AND submitted_at < $3`,
    [teamId, period.startsAt, period.endsAt]);
  return row.spend;
}

export const softCapMicro = (team: TeamPolicy): bigint => BigInt(team.soft_cap_credits) * MICRO;
export const hardCapMicro = (team: TeamPolicy): bigint => BigInt(team.hard_cap_credits) * MICRO;

/** Whether the team's most recent submission attempt in the period was refused for the hard cap. */
export async function lastAttemptRefused(db: Db, teamId: string, period: BudgetPeriod): Promise<boolean> {
  const row = await one<{ refused: boolean }>(db,
    "SELECT refused FROM cap_attempts WHERE team_id = $1 AND period_start = $2", [teamId, period.startsAt]);
  return row?.refused ?? false;
}

export async function recordAttempt(db: Db, teamId: string, period: BudgetPeriod, refused: boolean): Promise<void> {
  await db.query(
    `INSERT INTO cap_attempts (team_id, period_start, refused) VALUES ($1, $2, $3)
     ON CONFLICT (team_id) DO UPDATE SET period_start = EXCLUDED.period_start, refused = EXCLUDED.refused`,
    [teamId, period.startsAt, refused]);
}

export function capState(spend: bigint, team: TeamPolicy, refusedLast: boolean): CapState {
  if (spend >= hardCapMicro(team) || refusedLast) return "hard_cap_reached";
  return spend >= softCapMicro(team) ? "soft_cap_passed" : "under";
}

/** Claims the period's one notice of a kind; true only for the first claim. */
export async function claimNotice(db: Db, teamId: string, period: BudgetPeriod, kind: "soft" | "hard"): Promise<boolean> {
  const result = await db.query(
    "INSERT INTO cap_notices (team_id, period_start, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
    [teamId, period.startsAt, kind]);
  return result.rowCount === 1;
}
