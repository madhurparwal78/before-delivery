import { entriesOpen, feeCentsAt, tierAt } from './domain/fees';
import { statusLabel } from './domain/states';
import { cutoffInstant, dateLabel, toIsoUtc, withOffset } from './domain/time';
import type {
  Actor,
  AssetRow,
  CategoryRow,
  EntryRow,
  ProgramRow,
  RoundRow,
} from './domain/types';

export function userJson(actor: Actor, studioName: string | null): Record<string, unknown> {
  return {
    id: actor.id,
    role: actor.role,
    name: actor.name,
    email: actor.email,
    studioId: actor.studioId,
    studioName,
  };
}

export function categoryJson(
  category: CategoryRow,
  rounds: RoundRow[] | null,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: category.id,
    name: category.name,
    shortlistSize: category.shortlist_size,
    finalistCount: category.finalist_count,
  };
  if (rounds !== null) {
    base.rounds = rounds.map((round) => ({
      id: round.id,
      name: round.name,
      kind: round.kind,
      state: round.state,
    }));
  }
  return base;
}

export function programJson(
  program: ProgramRow,
  categories: Record<string, unknown>[],
  now: Date,
): Record<string, unknown> {
  return {
    id: program.id,
    name: program.name,
    year: program.year,
    timeZone: program.time_zone,
    earlyBirdDate: program.early_bird_date,
    deadlineDate: program.deadline_date,
    earlyBirdEndsAt: withOffset(cutoffInstant(program.early_bird_date, program.time_zone), program.time_zone),
    deadlineAt: withOffset(cutoffInstant(program.deadline_date, program.time_zone), program.time_zone),
    earlyBirdLabel: dateLabel(program.early_bird_date, program.time_zone),
    deadlineLabel: dateLabel(program.deadline_date, program.time_zone),
    earlyBirdFeeCents: program.early_bird_fee_cents,
    standardFeeCents: program.standard_fee_cents,
    currentTier: tierAt(program, now),
    currentFeeCents: feeCentsAt(program, now),
    entriesOpen: entriesOpen(program, now),
    categories,
  };
}

export function assetJson(asset: AssetRow): Record<string, unknown> {
  return {
    id: asset.id,
    url: `/api/assets/${asset.id}`,
    name: asset.name,
    type: asset.content_type,
    width: asset.width,
    height: asset.height,
    bytes: asset.bytes,
  };
}

export interface EntryContext {
  entry: EntryRow;
  assets: AssetRow[];
  program: ProgramRow;
  categoryName: string;
  embargoPassed: boolean;
  roundOneScore: string | null;
  finalScore: string | null;
  studioName: string;
  studioEmail: string;
}

interface StudioFacing {
  state: EntryRow['state'];
  award: EntryRow['award'];
  score: string | null;
}

const RESULT_STATES = new Set(['winner', 'finalist', 'honourable_mention', 'published']);

/** The single place that decides what a studio may see of its own entry. */
export function studioFacing(context: EntryContext): StudioFacing {
  const { entry, embargoPassed } = context;
  if (RESULT_STATES.has(entry.state)) {
    return embargoPassed
      ? { state: 'published', award: entry.award, score: context.finalScore }
      : { state: 'final_round', award: null, score: null };
  }
  if (entry.state === 'eliminated') {
    return { state: 'eliminated', award: null, score: embargoPassed ? context.roundOneScore : null };
  }
  return { state: entry.state, award: null, score: null };
}

function directorFacing(context: EntryContext): StudioFacing {
  const { entry } = context;
  return {
    state: entry.state,
    award: entry.award,
    score: entry.state === 'eliminated' ? context.roundOneScore : context.finalScore ?? context.roundOneScore,
  };
}

export function entryJson(context: EntryContext, asDirector: boolean, now: Date): Record<string, unknown> {
  const { entry, program } = context;
  const facing = asDirector ? directorFacing(context) : studioFacing(context);
  const body: Record<string, unknown> = {
    id: entry.id,
    entryNumber: entry.entry_number,
    programId: entry.program_id,
    categoryId: entry.category_id,
    categoryName: context.categoryName,
    title: entry.title,
    summary: entry.summary,
    siteUrl: entry.site_url,
    credits: entry.credits,
    state: facing.state,
    statusLabel: statusLabel(facing.state, facing.award),
    disqualifyReason: entry.disqualify_reason,
    award: facing.award,
    score: facing.score,
    assets: context.assets.map(assetJson),
    fee: entry.fee_tier === null ? null : { tier: entry.fee_tier, amountCents: entry.fee_cents },
    submittedAt: toIsoUtc(entry.submitted_at),
    deadlineLabel: dateLabel(program.deadline_date, program.time_zone),
    canWithdraw: entry.state === 'submitted',
    refundOnWithdraw: entriesOpen(program, now),
  };
  if (asDirector) {
    body.studioId = entry.studio_id;
    body.studioName = context.studioName;
    body.studioEmail = context.studioEmail;
  }
  return body;
}

export function receiptJson(entry: EntryRow, title: string): Record<string, unknown> {
  return {
    entryNumber: entry.entry_number,
    title,
    amountCents: entry.fee_cents,
    currency: 'USD',
    tier: entry.fee_tier,
    invoiceId: entry.invoice_id,
    paymentId: entry.payment_id,
    paidAt: toIsoUtc(entry.paid_at),
    refund:
      entry.refunded_at === null
        ? null
        : { amountCents: entry.refund_amount_cents, refundedAt: toIsoUtc(entry.refunded_at) },
  };
}

export function roundJson(round: RoundRow, program: ProgramRow): Record<string, unknown> {
  const deadline = round.ballot_deadline;
  return {
    id: round.id,
    categoryId: round.category_id,
    name: round.name,
    kind: round.kind,
    state: round.state,
    ballotDeadline: deadline,
    ballotDeadlineLabel: deadline === null ? null : dateLabel(deadline, program.time_zone),
    ballotDeadlineAt:
      deadline === null ? null : withOffset(cutoffInstant(deadline, program.time_zone), program.time_zone),
    openedAt: toIsoUtc(round.opened_at),
    closedAt: toIsoUtc(round.closed_at),
  };
}
