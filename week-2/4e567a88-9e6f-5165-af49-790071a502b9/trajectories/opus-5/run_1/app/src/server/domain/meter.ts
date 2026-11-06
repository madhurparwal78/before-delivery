import { Queryable, db } from '../db';
import { activeJobsOfTeam, lastSubmissionRefusedHardCap, periodSpendMicro, recentReplays } from '../store/jobs';
import { balancesOf } from '../store/ledger';
import { JsonObject, Policy } from '../types';
import { MICRO_PER_CREDIT, exactUnits } from './money';
import { BudgetPeriod, budgetPeriod } from './period';

export type CapState = 'under' | 'soft_cap_passed' | 'hard_cap_reached';

export interface PeriodState {
  period: BudgetPeriod;
  spendMicro: bigint;
  softCapMicro: bigint;
  hardCapMicro: bigint;
}

export async function periodStateOf(
  client: Queryable,
  teamId: string,
  policy: Policy,
  now: Date,
): Promise<PeriodState> {
  const team = policy.teams.find((candidate) => candidate.id === teamId);
  const period = budgetPeriod(now, policy.timezone);
  const spendMicro = await periodSpendMicro(client, teamId, period.startsAt);
  return {
    period,
    spendMicro,
    softCapMicro: BigInt(team?.soft_cap_credits ?? 0) * MICRO_PER_CREDIT,
    hardCapMicro: BigInt(team?.hard_cap_credits ?? 0) * MICRO_PER_CREDIT,
  };
}

export function capStateOf(state: PeriodState, lastAttemptRefused: boolean): CapState {
  if (state.spendMicro >= state.hardCapMicro || lastAttemptRefused) return 'hard_cap_reached';
  if (state.spendMicro >= state.softCapMicro) return 'soft_cap_passed';
  return 'under';
}

export async function meterJson(teamId: string, policy: Policy, now: Date): Promise<JsonObject> {
  const balances = await balancesOf(db, teamId);
  const active = await activeJobsOfTeam(teamId);
  const state = await periodStateOf(db, teamId, policy, now);
  const refused = await lastSubmissionRefusedHardCap(teamId, state.period.startsAt);
  const capState = capStateOf(state, refused);
  const softCapOffset =
    balances.settledMicro + balances.reservedMicro - state.spendMicro + state.softCapMicro;
  return {
    team_id: teamId,
    granted_micro: Number(balances.grantedMicro),
    available_micro: Number(balances.availableMicro),
    reserved_micro: Number(balances.reservedMicro),
    settled_micro: Number(balances.settledMicro),
    in_flight: active.map((job) => ({
      job_id: job.id,
      status: job.status,
      reserved_micro: Number(job.reservedMicro),
      estimated_units: exactUnits(job.estimatedUnitsMicro),
      unit: job.unit,
    })),
    recent_replays: await recentReplays(teamId),
    period: {
      label: state.period.label,
      starts_at: state.period.startsAt.toISOString(),
      ends_at: state.period.endsAt.toISOString(),
      spend_micro: Number(state.spendMicro),
      soft_cap_micro: Number(state.softCapMicro),
      hard_cap_micro: Number(state.hardCapMicro),
      soft_cap_offset_micro: Number(softCapOffset),
    },
    cap_state: capState,
  };
}
