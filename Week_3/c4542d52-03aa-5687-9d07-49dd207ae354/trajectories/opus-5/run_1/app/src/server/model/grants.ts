import type { AgreementStatus, Grant, GrantState, VestingType } from "../../shared/types.js";
import type { Transaction } from "../db.js";
import { serverDate as pacificDate } from "../domain/dates.js";
import { parseDecimal } from "../domain/money.js";
import { buildSchedule, nextTranche, vestedOptions, type ScheduleInput } from "../domain/vesting.js";
import { loadPeople, type PersonRow } from "./people.js";
import { loadRegisterTotals, type RegisterTotals } from "./register.js";

export interface GrantRow {
  id: string;
  holder_id: string | null;
  options: number | null;
  strike: string | null;
  vesting_type: VestingType | null;
  vesting_start: string | null;
  state: GrantState;
  draft_version: number;
  offered_at: Date | null;
  offer_expires_at: Date | null;
  offer_warning_at: Date | null;
  warning_sent: boolean;
  accepted_at: Date | null;
  agreement_status: AgreementStatus;
  agreement_document_id: string | null;
  exercised: number;
  cancelled: number;
  forfeited: number;
}

export const GRANT_COLUMNS = `id, holder_id, options, strike::text as strike, vesting_type,
  vesting_start::text as vesting_start, state, draft_version, offered_at, offer_expires_at,
  offer_warning_at, warning_sent, accepted_at, agreement_status, agreement_document_id,
  exercised, cancelled, forfeited`;

export interface GrantContext {
  now: Date;
  serverDate: string;
  totals: RegisterTotals;
  people: Map<string, PersonRow>;
  votes: Map<string, { approve: number; decline: number }>;
  openOrders: Map<string, number>;
}

export async function grantContext(tx: Transaction, now: Date): Promise<GrantContext> {
  const [totals, people, voteRows, orderRows] = await Promise.all([
    loadRegisterTotals(tx),
    loadPeople(tx),
    tx.query<{ grant_id: string; vote: string; count: number }>(
      "select grant_id, vote, count(*)::int as count from grant_votes group by grant_id, vote",
    ),
    tx.query<{ grant_id: string; options: number }>(
      `select grant_id, coalesce(sum(options), 0)::int as options
         from exercise_orders where state in ('pending', 'held') group by grant_id`,
    ),
  ]);
  const votes = new Map<string, { approve: number; decline: number }>();
  for (const row of voteRows) {
    const entry = votes.get(row.grant_id) ?? { approve: 0, decline: 0 };
    if (row.vote === "approve") entry.approve = row.count;
    else entry.decline = row.count;
    votes.set(row.grant_id, entry);
  }
  return {
    now,
    serverDate: pacificDate(now),
    totals,
    people: new Map(people.map((person) => [person.id, person])),
    votes,
    openOrders: new Map(orderRows.map((row) => [row.grant_id, row.options])),
  };
}

export function scheduleInputFor(row: GrantRow, context: GrantContext): ScheduleInput | null {
  if (row.options === null || row.strike === null || row.vesting_type === null || row.vesting_start === null) return null;
  if (row.state !== "accepted") return null;
  const strike = parseDecimal(row.strike, 4);
  if (strike === null) return null;
  const holder = row.holder_id === null ? undefined : context.people.get(row.holder_id);
  const holderTotals = row.holder_id === null ? undefined : context.totals.holders.get(row.holder_id);
  return {
    options: row.options,
    strike,
    vestingType: row.vesting_type,
    vestingStart: row.vesting_start,
    serverDate: context.serverDate,
    exercised: row.exercised,
    cancelled: row.cancelled,
    terminationDate: holder?.termination_date ?? null,
    windowEnded: holder?.window_closed ?? false,
    holderIssuedShares: holderTotals?.issuedShares ?? 0,
    fullyDilutedTotal: context.totals.fullyDilutedTotal,
  };
}

export function buildGrant(row: GrantRow, context: GrantContext): Grant {
  const holder = row.holder_id === null ? undefined : context.people.get(row.holder_id);
  const input = scheduleInputFor(row, context);
  const vested = input === null ? 0 : vestedOptions(input);
  const inOpenOrders = row.state === "accepted" ? context.openOrders.get(row.id) ?? 0 : 0;
  const exercised = row.state === "accepted" ? row.exercised : 0;
  const cancelled = row.state === "accepted" ? row.cancelled : 0;
  const forfeited = row.state === "accepted" ? row.forfeited : 0;
  return {
    id: row.id,
    holder_id: row.holder_id,
    holder_name: holder?.name ?? null,
    options: row.options,
    strike: row.strike,
    vesting_type: row.vesting_type,
    vesting_start: row.vesting_start,
    state: row.state,
    draft_version: row.draft_version,
    votes: context.votes.get(row.id) ?? { approve: 0, decline: 0 },
    offered_at: row.offered_at === null ? null : row.offered_at.toISOString(),
    offer_expires_at: row.offer_expires_at === null ? null : row.offer_expires_at.toISOString(),
    offer_warning_at: row.offer_warning_at === null ? null : row.offer_warning_at.toISOString(),
    accepted_at: row.accepted_at === null ? null : row.accepted_at.toISOString(),
    agreement: { status: row.agreement_status, document_id: row.agreement_document_id },
    vested,
    exercised,
    cancelled,
    forfeited,
    in_open_orders: inOpenOrders,
    exercisable: Math.max(0, vested - exercised - cancelled - inOpenOrders),
    next_tranche: input === null ? null : nextTranche(input),
    exercise_window_ends_at: holder?.window_ends_at?.toISOString() ?? null,
    schedule: input === null ? [] : buildSchedule(input),
    server_date: context.serverDate,
    server_time: context.now.toISOString(),
  };
}

export async function loadGrantRowForUpdate(tx: Transaction, id: string): Promise<GrantRow | null> {
  return tx.queryOne<GrantRow>(`select ${GRANT_COLUMNS} from grants where id = $1 for update`, [id]);
}
