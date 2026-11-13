/**
 * The two claim views. Neither carries a database id, a Kill Bill id, a storage key or a
 * credential, and the share view carries no private field at all.
 */

import { currentQuote, type ClaimRecord } from '../db/claims';
import type { CataloguePart } from '../db/catalogue';

export interface PromiseView {
  kind: 'same_day' | 'later';
  date: string;
}

function instant(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function promiseOf(quote: { promise_kind: 'same_day' | 'later'; promise_date: string }): PromiseView {
  return { kind: quote.promise_kind, date: quote.promise_date };
}

export interface ClaimViewContext {
  modelName: string | null;
  part: CataloguePart | null;
}

/** The operator's claim view. An erased claim shows only that it was erased. */
export function claimView(record: ClaimRecord, context: ClaimViewContext): Record<string, unknown> {
  const { claim } = record;
  if (claim.state === 'erased') {
    return { reference: claim.reference, state: 'erased', erased_at: instant(claim.erased_at) };
  }

  return {
    reference: claim.reference,
    state: claim.state,
    language: claim.language,
    owner: { name: claim.owner_name, email: claim.owner_email, postcode: claim.owner_postcode },
    purchase_date: claim.purchase_date,
    club_member: claim.club_member,
    model: claim.model_slug === null ? null : { slug: claim.model_slug, name: context.modelName },
    part:
      context.part === null
        ? null
        : {
            booklet_number: context.part.bookletNumber,
            part_number: context.part.partNumber,
            name: context.part.name,
            status: context.part.status,
            bin_count: context.part.binCount,
          },
    quantity: claim.quantity,
    description: claim.description,
    photos: record.photos.map((photo) => ({
      index: photo.photo_index,
      content_type: photo.content_type,
      bytes: photo.byte_count,
    })),
    started_at: instant(claim.started_at),
    confirm_by: instant(claim.confirm_by),
    confirmed_at: instant(claim.confirmed_at),
    ruling:
      record.ruling === null
        ? null
        : {
            inside: record.ruling.inside,
            edition: record.ruling.edition_code,
            cover_ends_at: record.ruling.cover_ends_at.toISOString(),
            cover_ends_on: record.ruling.cover_ends_on,
            term_months: record.ruling.term_months,
            decided_at: record.ruling.decided_at.toISOString(),
          },
    quotes: record.quotes.map((quote) => ({
      revision: quote.revision,
      status: quote.status,
      source: quote.source,
      part_line_minor: quote.part_line_minor,
      carriage_minor: quote.carriage_minor,
      total_minor: quote.total_minor,
      band: quote.band,
      carriage_valid_until: quote.carriage_valid_until.toISOString(),
      promise: promiseOf(quote),
      quoted_at: quote.quoted_at.toISOString(),
    })),
    payment:
      record.payment === null
        ? null
        : { paid_minor: record.payment.paid_minor, paid_at: record.payment.paid_at.toISOString() },
    decline:
      record.decline === null
        ? null
        : {
            reason: record.decline.reason,
            charged_minor: record.decline.charged_minor,
            refunded_minor: record.decline.refunded_minor,
          },
    dispatched_at: instant(claim.dispatched_at),
    closed_at: instant(claim.closed_at),
    share_link:
      record.shareLink === null ? null : { url: `/s/${record.shareLink.token}`, state: record.shareLink.state },
    notices_pending: record.noticesPending,
  };
}

/**
 * The share view holds only these fields, and only the current quote revision: a void
 * revision never appears on the share page.
 */
export function shareView(record: ClaimRecord, context: ClaimViewContext): Record<string, unknown> {
  const { claim } = record;
  const quote = currentQuote(record);

  return {
    reference: claim.reference,
    state: claim.state,
    language: claim.language,
    model: { name: context.modelName },
    part:
      context.part === null
        ? null
        : {
            booklet_number: context.part.bookletNumber,
            part_number: context.part.partNumber,
            name: context.part.name,
          },
    quantity: claim.quantity,
    purchase_date: claim.purchase_date,
    ruling:
      record.ruling === null
        ? null
        : {
            inside: record.ruling.inside,
            edition: record.ruling.edition_code,
            cover_ends_at: record.ruling.cover_ends_at.toISOString(),
            cover_ends_on: record.ruling.cover_ends_on,
          },
    quote:
      quote === null
        ? null
        : {
            revision: quote.revision,
            part_line_minor: quote.part_line_minor,
            carriage_minor: quote.carriage_minor,
            total_minor: quote.total_minor,
            band: quote.band,
            promise: promiseOf(quote),
          },
    paid_minor: record.payment === null ? null : record.payment.paid_minor,
    decline:
      record.decline === null
        ? null
        : {
            reason: record.decline.reason,
            charged_minor: record.decline.charged_minor,
            refunded_minor: record.decline.refunded_minor,
          },
    dispatched_at: instant(claim.dispatched_at),
    history: record.history.map((entry) => ({ state: entry.state, at: entry.at.toISOString() })),
  };
}
