import { randomBytes } from "node:crypto";
import { iso } from "./clock";
import { one, rows, type Db } from "./db";
import { unknownClaim } from "./errors";
import { isObject } from "./parse";
import { normaliseReference } from "./rules";
import type {
  ClaimState,
  ClaimView,
  DeclineReason,
  DeclineView,
  ErasedClaimView,
  Lang,
  LinkState,
  OpsClaimView,
  OpsPartView,
  QuoteView,
  RulingView,
  ShareView,
} from "../shared/types";

export interface ClaimRow {
  reference: string;
  state: ClaimState;
  language: Lang | null;
  name: string | null;
  email: string | null;
  postcode: string | null;
  purchase_date: string | null;
  model_slug: string | null;
  booklet_number: number | null;
  quantity: number | null;
  description: string | null;
  started_at: Date | null;
  confirm_by: Date | null;
  confirm_token: string | null;
  confirmed_at: Date | null;
  ruling_inside: boolean | null;
  ruling_edition: string | null;
  ruling_cover_ends_at: Date | null;
  ruling_cover_ends_on: string | null;
  ruling_term_months: number | null;
  ruling_decided_at: Date | null;
  paid_minor: number | null;
  paid_at: Date | null;
  decline_reason: DeclineReason | null;
  decline_charged_minor: number | null;
  decline_refunded_minor: number | null;
  dispatched_at: Date | null;
  closed_at: Date | null;
  erased_at: Date | null;
  billing_account: string | null;
}

/** A claim that has not been erased: every column set when a claim starts is present. */
export interface LiveClaimRow extends ClaimRow {
  language: Lang;
  name: string;
  email: string;
  postcode: string;
  purchase_date: string;
  model_slug: string;
  booklet_number: number;
  quantity: number;
  description: string;
  started_at: Date;
  confirm_by: Date;
}

/** The one place a claim row is read as live; every action refuses an erased claim (409) before it gets here. */
export const liveOf = (row: ClaimRow): LiveClaimRow => row as LiveClaimRow;

export interface QuoteRow {
  claim_reference: string;
  revision: number;
  status: "current" | "void";
  source: "bin" | "supplier";
  quantity: number;
  part_line_minor: number;
  carriage_minor: number;
  total_minor: number;
  band: string;
  carriage_valid_until: Date;
  promise_kind: "same_day" | "later";
  promise_date: string;
  quoted_at: Date;
  billing_invoice: string;
  bin_returned: boolean;
}

export interface PartRow {
  model_slug: string;
  booklet_number: number;
  part_number: string;
  name: string;
  price_minor: number;
  weight_g: number;
  longest_side_mm: number;
  status: "active" | "withdrawn";
  bin_count: number;
}

const isoOrNull = (at: Date | null): string | null => (at ? iso(at) : null);

export const newToken = (): string => randomBytes(32).toString("base64url");

// ---- finding claims ------------------------------------------------------------------------

/**
 * The one place a reference becomes a claim. A malformed, unknown or (for owners) erased reference
 * answers exactly like an unknown one.
 */
export async function findClaim(
  db: Db,
  reference: unknown,
  who: "owner" | "operator",
  options: { lock?: boolean; unknown?: Parameters<typeof unknownClaim>[0] } = {},
): Promise<ClaimRow> {
  const normal = normaliseReference(reference);
  if (!normal) return unknownClaim(options.unknown);
  const row = await one<ClaimRow>(db, `SELECT * FROM claims WHERE reference = $1${options.lock ? " FOR UPDATE" : ""}`, [normal]);
  if (!row || (who === "owner" && row.state === "erased")) return unknownClaim(options.unknown);
  return row;
}

/** A body `reference` naming a different claim than the one addressed is an unknown claim. */
export function requireSameReference(body: unknown, claim: ClaimRow, unknown: Parameters<typeof unknownClaim>[0] = "not_found"): void {
  if (!isObject(body) || !("reference" in body)) return;
  if (normaliseReference(body["reference"]) !== claim.reference) unknownClaim(unknown);
}

export async function isClubMember(db: Db, email: string, purchaseDate: string): Promise<boolean> {
  const found = await one<{ member: boolean }>(db, "SELECT EXISTS (SELECT 1 FROM club_roster WHERE lower(email) = lower($1) AND joined_on < $2) AS member", [email, purchaseDate]);
  return found?.member ?? false;
}

export async function recordState(db: Db, claim: ClaimRow, state: ClaimState, at: Date): Promise<void> {
  await rows(db, "UPDATE claims SET state = $2 WHERE reference = $1", [claim.reference, state]);
  await addHistory(db, claim.reference, state, at);
}

async function addHistory(db: Db, reference: string, state: ClaimState, at: Date): Promise<void> {
  await rows(
    db,
    "INSERT INTO claim_history (claim_reference, seq, state, at) VALUES ($1, COALESCE((SELECT max(seq) + 1 FROM claim_history WHERE claim_reference = $1), 1), $2, $3)",
    [reference, state, at],
  );
}

// ---- catalogue lookups -----------------------------------------------------------------------

export const partOf = (db: Db, modelSlug: string, booklet: number): Promise<PartRow | null> =>
  one<PartRow>(db, "SELECT * FROM parts WHERE model_slug = $1 AND booklet_number = $2", [modelSlug, booklet]);

export async function holidaySet(db: Db): Promise<Set<string>> {
  const found = await rows<{ day: string }>(db, "SELECT day FROM bank_holidays");
  return new Set(found.map((row) => row.day));
}

// ---- share links ---------------------------------------------------------------------------

export async function issueShareToken(db: Db, reference: string, at: Date): Promise<string> {
  const token = newToken();
  await rows(db, "INSERT INTO share_tokens (token, claim_reference, state, created_at) VALUES ($1, $2, 'active', $3)", [token, reference, at]);
  return token;
}

export async function activeShareToken(db: Db, reference: string): Promise<string | null> {
  const found = await one<{ token: string }>(db, "SELECT token FROM share_tokens WHERE claim_reference = $1 AND state = 'active' ORDER BY created_at DESC LIMIT 1", [reference]);
  return found?.token ?? null;
}

export async function withdrawShareTokens(db: Db, reference: string): Promise<void> {
  await rows(db, "UPDATE share_tokens SET state = 'withdrawn' WHERE claim_reference = $1 AND state = 'active'", [reference]);
}

// ---- views ---------------------------------------------------------------------------------

const quoteView = (row: QuoteRow): QuoteView => ({
  revision: row.revision,
  status: row.status,
  source: row.source,
  part_line_minor: row.part_line_minor,
  carriage_minor: row.carriage_minor,
  total_minor: row.total_minor,
  band: row.band,
  carriage_valid_until: iso(row.carriage_valid_until),
  promise: { kind: row.promise_kind, date: row.promise_date },
  quoted_at: iso(row.quoted_at),
});

export async function quotesOf(db: Db, reference: string): Promise<QuoteRow[]> {
  return rows<QuoteRow>(db, "SELECT * FROM quote_revisions WHERE claim_reference = $1 ORDER BY revision DESC", [reference]);
}

/** A quoted claim always has exactly one current revision. */
export async function currentQuote(db: Db, reference: string): Promise<QuoteRow> {
  return (await quotesOf(db, reference)).find((quote) => quote.status === "current") as QuoteRow;
}

/** The Kill Bill account exists from the first quote on, so every claim past quoting has one. */
export const billingAccountOf = (claim: ClaimRow): string => claim.billing_account as string;

/** The claim as seen by the operator; an erased claim is only its reference, state and erasure instant. */
export async function opsView(db: Db, row: ClaimRow): Promise<OpsClaimView> {
  if (row.state === "erased") {
    const erased: ErasedClaimView = { reference: row.reference, state: "erased", erased_at: iso(row.erased_at as Date) };
    return erased;
  }
  const claim = liveOf(row);
  const [model, part, photos, quotes, token, pending, club] = await Promise.all([
    one<{ slug: string; name: string }>(db, "SELECT slug, name FROM models WHERE slug = $1", [claim.model_slug]),
    partOf(db, claim.model_slug, claim.booklet_number),
    rows<{ idx: number; content_type: string; bytes: number }>(db, "SELECT idx, content_type, bytes FROM claim_photos WHERE claim_reference = $1 ORDER BY idx", [claim.reference]),
    quotesOf(db, claim.reference),
    one<{ token: string; state: string }>(db, "SELECT token, state FROM share_tokens WHERE claim_reference = $1 ORDER BY (state = 'active') DESC, created_at DESC LIMIT 1", [claim.reference]),
    one<{ n: number }>(db, "SELECT count(*)::int AS n FROM notice_queue WHERE claim_reference = $1", [claim.reference]),
    isClubMember(db, claim.email, claim.purchase_date),
  ]);
  const catalogued = { model: model as { slug: string; name: string }, part: part as PartRow };
  const partView: OpsPartView = {
    booklet_number: catalogued.part.booklet_number,
    part_number: catalogued.part.part_number,
    name: catalogued.part.name,
    status: catalogued.part.status,
    bin_count: catalogued.part.bin_count,
  };
  const shareLink: ClaimView["share_link"] = token ? { url: `/s/${token.token}`, state: claim.state === "closed" ? "ended" : (token.state as LinkState) } : null;
  const view: ClaimView = {
    reference: claim.reference,
    state: claim.state as ClaimView["state"],
    language: claim.language,
    owner: { name: claim.name, email: claim.email, postcode: claim.postcode },
    purchase_date: claim.purchase_date,
    club_member: club,
    model: catalogued.model,
    part: partView,
    quantity: claim.quantity,
    description: claim.description,
    photos: photos.map((photo) => ({ index: photo.idx, content_type: photo.content_type, bytes: photo.bytes })),
    started_at: iso(claim.started_at),
    confirm_by: iso(claim.confirm_by),
    confirmed_at: isoOrNull(claim.confirmed_at),
    ruling: rulingOf(claim),
    quotes: quotes.map(quoteView),
    payment: claim.paid_minor === null ? null : { paid_minor: claim.paid_minor, paid_at: iso(claim.paid_at as Date) },
    decline: declineOf(claim),
    dispatched_at: isoOrNull(claim.dispatched_at),
    closed_at: isoOrNull(claim.closed_at),
    share_link: shareLink,
    notices_pending: pending?.n ?? 0,
  };
  return view;
}

function rulingOf(claim: ClaimRow): RulingView | null {
  if (claim.ruling_inside === null) return null;
  return {
    inside: claim.ruling_inside,
    edition: claim.ruling_edition as string,
    cover_ends_at: iso(claim.ruling_cover_ends_at as Date),
    cover_ends_on: claim.ruling_cover_ends_on as string,
    term_months: claim.ruling_term_months,
    decided_at: iso(claim.ruling_decided_at as Date),
  };
}

function declineOf(claim: ClaimRow): DeclineView | null {
  if (claim.decline_reason === null) return null;
  return { reason: claim.decline_reason, charged_minor: claim.decline_charged_minor as number, refunded_minor: claim.decline_refunded_minor as number };
}

/** The read-only view a share token returns; it never carries a private field, an id or a storage key. */
export async function shareView(db: Db, row: ClaimRow): Promise<ShareView> {
  const claim = liveOf(row);
  const [model, part, quotes, history] = await Promise.all([
    one<{ name: string }>(db, "SELECT name FROM models WHERE slug = $1", [claim.model_slug]),
    partOf(db, claim.model_slug, claim.booklet_number),
    quotesOf(db, claim.reference),
    rows<{ state: ClaimState; at: Date }>(db, "SELECT state, at FROM claim_history WHERE claim_reference = $1 ORDER BY seq", [claim.reference]),
  ]);
  const current = quotes.find((quote) => quote.status === "current");
  const ruling = rulingOf(claim);
  const catalogued = part as PartRow;
  return {
    reference: claim.reference,
    state: claim.state,
    language: claim.language,
    model: { name: (model as { name: string }).name },
    part: { booklet_number: catalogued.booklet_number, part_number: catalogued.part_number, name: catalogued.name },
    quantity: claim.quantity,
    purchase_date: claim.purchase_date,
    ruling: ruling && { inside: ruling.inside, edition: ruling.edition, cover_ends_at: ruling.cover_ends_at, cover_ends_on: ruling.cover_ends_on },
    quote: current ? {
      revision: current.revision,
      part_line_minor: current.part_line_minor,
      carriage_minor: current.carriage_minor,
      total_minor: current.total_minor,
      band: current.band,
      promise: { kind: current.promise_kind, date: current.promise_date },
    } : null,
    paid_minor: claim.paid_minor,
    decline: declineOf(claim),
    dispatched_at: isoOrNull(claim.dispatched_at),
    history: history.map((entry) => ({ state: entry.state, at: iso(entry.at) })),
  };
}
