import {
  licenceEffectiveEnd,
  readLicenceState,
  type LicenceKind,
  type LicenceState,
} from '../../domain/licensing.js';
import { displayCoopTime, isoInstant } from '../../domain/time.js';
import { queryOn, type Queryable } from '../db/pool.js';
import type { SignedInPerson } from '../http/router.js';
import { essayCreditLine, loadCredits, loadFrames, type EssayRow } from './essays.js';

export const REVOKED_PLACEHOLDER_TITLE = 'Removed essay (legal takedown)';

export interface LicenceRow {
  id: string;
  essay_id: string;
  newsroom_slug: string;
  licensed_by: string;
  kind: LicenceKind;
  state: LicenceState;
  amount_minor: number;
  rate_bp: number;
  confirmed_at: Date;
  window_start: Date;
  window_end: Date;
  hold_until: Date;
  invoice_state: 'pending' | 'raised';
  grant_written: boolean;
  charge_attempts: number;
  activating_since: Date | null;
  revoked_at: Date | null;
}

export const LICENCE_COLUMNS = `id, essay_id, newsroom_slug, licensed_by, kind, state, amount_minor,
  rate_bp, confirmed_at, window_start, window_end, hold_until, invoice_state, grant_written,
  charge_attempts, activating_since, revoked_at`;

/** A pending licence past its hold deadline is gone from every read. */
const LIVE_LICENCE = `not (state = 'pending_invoice' and hold_until <= $now)`;

function withNow(sql: string, nowIndex: number): string {
  return sql.replace(/\$now/g, `$${nowIndex}`);
}

export async function loadLicence(
  client: Queryable,
  id: string,
  now: Date,
): Promise<LicenceRow | null> {
  const result = await queryOn<LicenceRow>(
    client,
    withNow(`select ${LICENCE_COLUMNS} from licences where id = $1 and ${LIVE_LICENCE}`, 2),
    [id, now],
  );
  return result.rows[0] ?? null;
}

export async function newsroomLicences(
  client: Queryable,
  newsroomSlug: string,
  now: Date,
): Promise<LicenceRow[]> {
  const result = await queryOn<LicenceRow>(
    client,
    withNow(
      `select ${LICENCE_COLUMNS} from licences
       where newsroom_slug = $1 and ${LIVE_LICENCE}
       order by confirmed_at desc, id`,
      2,
    ),
    [newsroomSlug, now],
  );
  return result.rows;
}

export async function essayLicences(
  client: Queryable,
  essayId: string,
  now: Date,
): Promise<LicenceRow[]> {
  const result = await queryOn<LicenceRow>(
    client,
    withNow(
      `select ${LICENCE_COLUMNS} from licences
       where essay_id = $1 and ${LIVE_LICENCE}
       order by confirmed_at, id`,
      2,
    ),
    [essayId, now],
  );
  return result.rows;
}

/** The SQL form of the effective-end rule, for queries that compare it in the database. */
export const EFFECTIVE_END_SQL =
  "(case when state = 'pending_invoice' then hold_until else window_end end)";

export function effectiveEnd(licence: LicenceRow): Date {
  if (licence.state !== 'pending_invoice' && licence.state !== 'active') return licence.window_end;
  return licenceEffectiveEnd(licence.state, licence.hold_until, licence.window_end);
}

export function stateAt(licence: LicenceRow, now: Date): LicenceState {
  return readLicenceState(licence.state, licence.window_end, now);
}

export type HeldBy = 'you' | 'your_newsroom' | 'another_newsroom';

export function holderPerspective(licence: LicenceRow, person: SignedInPerson): HeldBy {
  if (licence.licensed_by === person.id) return 'you';
  if (person.newsroomSlug && licence.newsroom_slug === person.newsroomSlug) return 'your_newsroom';
  return 'another_newsroom';
}

export interface WindowView {
  state: 'open' | 'claimed';
  held_by: HeldBy | null;
  held_until: string | null;
  held_until_display: string | null;
  standard_running_until: string | null;
  standard_running_until_display: string | null;
}

export async function holdingExclusive(
  client: Queryable,
  essayId: string,
  now: Date,
): Promise<LicenceRow | null> {
  const result = await queryOn<LicenceRow>(
    client,
    `select ${LICENCE_COLUMNS} from licences
     where essay_id = $1 and kind = 'exclusive' and state in ('pending_invoice', 'active')
       and ${EFFECTIVE_END_SQL} > $2
     limit 1`,
    [essayId, now],
  );
  return result.rows[0] ?? null;
}

/** The latest effective end among other newsrooms' pending or active standard licences. */
export async function standardRunningUntil(
  client: Queryable,
  essayId: string,
  exceptNewsroom: string | null,
  now: Date,
): Promise<Date | null> {
  const result = await queryOn<{ running_until: Date | null }>(
    client,
    `select max(${EFFECTIVE_END_SQL}) as running_until
     from licences
     where essay_id = $1 and kind = 'standard' and state in ('pending_invoice', 'active')
       and ($2::text is null or newsroom_slug <> $2)
       and ${EFFECTIVE_END_SQL} > $3`,
    [essayId, exceptNewsroom, now],
  );
  return result.rows[0]?.running_until ?? null;
}

export async function essayWindow(
  client: Queryable,
  essay: EssayRow,
  person: SignedInPerson,
  now: Date,
): Promise<WindowView> {
  if (essay.state === 'taken_down') {
    return {
      state: 'open',
      held_by: null,
      held_until: null,
      held_until_display: null,
      standard_running_until: null,
      standard_running_until_display: null,
    };
  }
  const exclusive = await holdingExclusive(client, essay.id, now);
  const running = await standardRunningUntil(client, essay.id, person.newsroomSlug, now);
  const heldUntil = exclusive ? effectiveEnd(exclusive) : null;
  return {
    state: exclusive ? 'claimed' : 'open',
    held_by: exclusive ? holderPerspective(exclusive, person) : null,
    held_until: heldUntil ? isoInstant(heldUntil) : null,
    held_until_display: heldUntil ? displayCoopTime(heldUntil) : null,
    standard_running_until: running ? isoInstant(running) : null,
    standard_running_until_display: running ? displayCoopTime(running) : null,
  };
}

export type ReceiptState = 'queued' | 'sent' | 'cancelled' | null;

export async function receiptState(client: Queryable, licenceId: string): Promise<ReceiptState> {
  const result = await queryOn<{ state: string }>(
    client,
    `select state from outbound_mail where licence_id = $1 and kind = 'licence_receipt'`,
    [licenceId],
  );
  const states = result.rows.map((row) => row.state);
  if (states.includes('queued')) return 'queued';
  if (states.includes('sent')) return 'sent';
  if (states.includes('cancelled')) return 'cancelled';
  return null;
}

export interface LicenceView {
  id: string;
  essay_id: string;
  essay_title: string;
  credit_line: string | null;
  kind: LicenceKind;
  state: LicenceState;
  newsroom: { slug: string; name: string };
  licensed_by: { name: string };
  confirmed_at: string;
  confirmed_display: string;
  window_start: string;
  window_end: string;
  window_end_display: string;
  hold_until: string | null;
  hold_until_display: string | null;
  amount_minor: number;
  currency: 'USD';
  invoice_state: 'pending' | 'raised';
  receipt_state: ReceiptState;
  frames: Array<{ id: string; position: number }>;
}

export async function licenceView(
  client: Queryable,
  licence: LicenceRow,
  now: Date,
): Promise<LicenceView> {
  const state = stateAt(licence, now);
  const essayResult = await queryOn<{ title: string; state: string }>(
    client,
    'select title, state from essays where id = $1',
    [licence.essay_id],
  );
  const newsroomResult = await queryOn<{ name: string }>(
    client,
    'select name from newsrooms where slug = $1',
    [licence.newsroom_slug],
  );
  const personResult = await queryOn<{ name: string }>(client, 'select name from people where id = $1', [
    licence.licensed_by,
  ]);
  const revoked = state === 'revoked';
  const credits = revoked ? [] : await loadCredits(client, licence.essay_id);
  const frames = revoked ? [] : await loadFrames(client, licence.essay_id);
  return {
    id: licence.id,
    essay_id: licence.essay_id,
    essay_title: revoked ? REVOKED_PLACEHOLDER_TITLE : (essayResult.rows[0]?.title ?? ''),
    credit_line: revoked ? null : essayCreditLine(credits),
    kind: licence.kind,
    state,
    newsroom: { slug: licence.newsroom_slug, name: newsroomResult.rows[0]?.name ?? '' },
    licensed_by: { name: personResult.rows[0]?.name ?? '' },
    confirmed_at: isoInstant(licence.confirmed_at),
    confirmed_display: displayCoopTime(licence.confirmed_at),
    window_start: isoInstant(licence.window_start),
    window_end: isoInstant(licence.window_end),
    window_end_display: displayCoopTime(licence.window_end),
    hold_until: state === 'pending_invoice' ? isoInstant(licence.hold_until) : null,
    hold_until_display: state === 'pending_invoice' ? displayCoopTime(licence.hold_until) : null,
    amount_minor: licence.amount_minor,
    currency: 'USD',
    invoice_state: licence.invoice_state,
    receipt_state: await receiptState(client, licence.id),
    frames: frames.map((frame) => ({ id: frame.id, position: frame.position })),
  };
}

/**
 * Lazily settles licences on one essay from the server clock: an active licence whose
 * window has ended becomes expired, and a pending licence past its hold deadline with no
 * attempt in flight is removed with no charge, grant or receipt.
 */
export async function reapEssayLicences(client: Queryable, essayId: string, now: Date): Promise<void> {
  await queryOn(
    client,
    `update licences set state = 'expired'
     where essay_id = $1 and state = 'active' and window_end <= $2`,
    [essayId, now],
  );
  await queryOn(
    client,
    `delete from licences
     where essay_id = $1 and state = 'pending_invoice' and hold_until <= $2
       and (activating_since is null or activating_since < now() - interval '6 seconds')`,
    [essayId, now],
  );
}
