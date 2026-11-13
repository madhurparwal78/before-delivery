import type { PoolClient } from 'pg';
import { loadConfig } from './config.js';
import { serverDate } from './time.js';
import { markDate, cumulativeAt, latestVestedMark, costCents, centsString, ownershipPercent, type Tranche } from './vesting.js';
import type { GrantRow, PersonRec } from './register.js';
import { grantFigures, holdingsByHolder, fullyDilutedTotal } from './register.js';

export interface Schedule {
  tranches: Tranche[];
  next_tranche: { date: string; cumulative: number } | null;
  next_tranche_delta: number;
}

export interface GrantJson {
  id: string;
  holder_id: string;
  holder_name: string;
  options: number;
  strike: string;
  vesting_type: 'standard' | 'monthly';
  vesting_start: string | null;
  state: string;
  draft_version: number;
  votes: { approve: number; decline: number };
  offered_at: string | null;
  offer_expires_at: string | null;
  offer_warning_at: string | null;
  accepted_at: string | null;
  agreement: { status: string; document_id: string | null };
  vested: number;
  exercised: number;
  cancelled: number;
  forfeited: number;
  in_open_orders: number;
  exercisable: number;
  next_tranche: { date: string; cumulative: number } | null;
  exercise_window_ends_at: string | null;
  schedule: Tranche[];
  server_date: string;
  server_time: string;
}

export async function serializeGrant(
  client: PoolClient,
  grant: GrantRow,
  at: Date,
): Promise<GrantJson> {
  const cfg = loadConfig();
  const dateStr = serverDate(at);
  const figures = await grantFigures(client, grant, at);
  const holder = await client.query<PersonRec>('SELECT * FROM people WHERE id = $1', [grant.holder_id]);
  const votes = await client.query<{ vote: string }>('SELECT vote FROM grant_votes WHERE grant_id = $1', [grant.id]);
  const doc = grant.agreement_document_id
    ? await client.query<{ status: string }>('SELECT status FROM documents WHERE id = $1', [grant.agreement_document_id])
    : null;

  const agreementStatus = grant.state === 'accepted'
    ? (doc?.rows[0]?.status === 'sealed' ? 'sealed' : 'paper')
    : (doc?.rows[0] ? doc.rows[0].status : 'none');

  const offerWarningAt = grant.offer_expires_at
    ? new Date(grant.offer_expires_at.getTime() - cfg.offerWarningSeconds * 1000)
    : null;

  const strikeDec = parseStrike(grant.strike);
  const totalFd = await fullyDilutedTotal(client);
  const holdings = await holdingsByHolder(client);
  const issuedShares = holdings.get(grant.holder_id) ?? 0;

  const inputs = {
    options: Number(grant.options),
    vestingType: grant.vesting_type,
    vestingStart: grant.vesting_start,
  };
  const vestedMark = latestVestedMark(inputs, dateStr);
  const terminationVestedMark = grant.termination_date
    ? latestVestedMark(inputs, grant.termination_date)
    : null;
  const windowEnded = holder.rows[0]?.window_ends_at ? at >= holder.rows[0].window_ends_at : false;

  const schedule: Tranche[] = [];
  for (let m = 0; m <= 48; m++) {
    const date = markDate(grant.vesting_start, m);
    let cumulative = cumulativeAt(inputs, m);
    if (terminationVestedMark !== null && m > terminationVestedMark) {
      cumulative = cumulativeAt(inputs, terminationVestedMark);
    }
    const net = Math.max(0, cumulative - figures.exercised - grant.cancelled);
    const state = trancheCellState(grant, m, date, vestedMark, figures.exercised, windowEnded, inputs, terminationVestedMark);
    schedule.push({
      month: m,
      date,
      cumulative,
      state,
      cost_at_strike: centsString(costCents(net, strikeDec)),
      vested_ownership: ownershipPercent(issuedShares + net, totalFd),
    });
  }

  let nextTranche: { date: string; cumulative: number } | null = null;
  if (grant.state === 'accepted' && !grant.termination_date) {
    const currentCumulative = cumulativeAt(inputs, Math.max(0, vestedMark));
    for (let m = vestedMark + 1; m <= 48; m++) {
      const cumulative = cumulativeAt(inputs, m);
      if (cumulative > currentCumulative) {
        nextTranche = { date: markDate(grant.vesting_start, m), cumulative };
        break;
      }
    }
  }

  return {
    id: grant.id,
    holder_id: grant.holder_id,
    holder_name: holder.rows[0]?.name ?? '',
    options: Number(grant.options),
    strike: grant.strike,
    vesting_type: grant.vesting_type,
    vesting_start: grant.vesting_start,
    state: grant.state,
    draft_version: grant.draft_version,
    votes: {
      approve: votes.rows.filter((v) => v.vote === 'approve').length,
      decline: votes.rows.filter((v) => v.vote === 'decline').length,
    },
    offered_at: grant.offered_at ? grant.offered_at.toISOString() : null,
    offer_expires_at: grant.offer_expires_at ? grant.offer_expires_at.toISOString() : null,
    offer_warning_at: offerWarningAt ? offerWarningAt.toISOString() : null,
    accepted_at: grant.accepted_at ? grant.accepted_at.toISOString() : null,
    agreement: { status: agreementStatus, document_id: grant.agreement_document_id ?? null },
    vested: figures.vested,
    exercised: figures.exercised,
    cancelled: Number(grant.cancelled),
    forfeited: Number(grant.forfeited),
    in_open_orders: figures.in_open_orders,
    exercisable: figures.exercisable,
    next_tranche: nextTranche,
    exercise_window_ends_at: holder.rows[0]?.window_ends_at ? holder.rows[0].window_ends_at.toISOString() : null,
    schedule,
    server_date: dateStr,
    server_time: at.toISOString(),
  };
}

export function parseStrike(strike: string): { unscaled: bigint; scale: number } {
  const [whole, frac = ''] = strike.split('.');
  return { unscaled: BigInt(whole + frac.padEnd(4, '0')), scale: 4 };
}

/**
 * A cell's state, in order of precedence:
 * 1. cancelled after a departure (cell date after the termination date);
 * 2. cancelled at window end (a vested cell stays vested only when its
 *    cumulative is no more than the exercised count);
 * 3. vested (date on or before the server date);
 * 4. unvested.
 */
function trancheCellState(
  grant: GrantRow,
  m: number,
  date: string,
  vestedMark: number,
  exercised: number,
  windowEnded: boolean,
  inputs: { options: number; vestingType: 'standard' | 'monthly'; vestingStart: string },
  terminationVestedMark: number | null,
): 'vested' | 'unvested' | 'cancelled' {
  if (grant.termination_date && date > grant.termination_date) return 'cancelled';
  if (m > vestedMark) return 'unvested';
  if (terminationVestedMark !== null && windowEnded) {
    const cumulative = cumulativeAt(inputs, m);
    if (cumulative > exercised) return 'cancelled';
  }
  return 'vested';
}
