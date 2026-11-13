// The operator's claim view: exactly the published fields, in order.
import type { Desk } from '../server.js';
import type { ClaimRow } from '../store.js';

export async function claimView(desk: Desk, claim: ClaimRow): Promise<Record<string, unknown>> {
  if (claim.state === 'erased') {
    return {
      reference: claim.reference,
      state: 'erased',
      erased_at: claim.erasedAt ? claim.erasedAt.toISOString() : null,
    };
  }
  const model = claim.modelSlug !== null ? await desk.store.getModel(claim.modelSlug) : null;
  const part = claim.modelSlug !== null && claim.bookletNumber !== null
    ? await desk.store.getPart(claim.modelSlug, claim.bookletNumber)
    : null;
  const ruling = await desk.store.getRuling(claim.reference);
  const quotes = await desk.store.listQuotes(claim.reference);
  const payment = await desk.store.getPayment(claim.reference);
  const decline = await desk.store.getDecline(claim.reference);
  const photos = await desk.store.listPhotos(claim.reference);
  const share = await desk.store.getActiveShareToken(claim.reference);
  const shareState = share === null
    ? (claim.state === 'closed' ? 'ended' : 'withdrawn')
    : share.state;
  const lastShare = share === null ? await desk.store.getShareTokenForRef(claim.reference) : share;
  const noticesPending = await desk.store.pendingNotices(claim.reference);

  return {
    reference: claim.reference,
    state: claim.state,
    language: claim.language,
    owner: {
      name: claim.ownerName ?? '',
      email: claim.ownerEmail ?? '',
      postcode: claim.ownerPostcode ?? '',
    },
    purchase_date: claim.purchaseDate,
    club_member: claim.clubMember,
    model: model ? { slug: model.slug, name: model.name } : null,
    part: part ? {
      booklet_number: part.bookletNumber,
      part_number: part.partNumber,
      name: part.name,
      status: part.status,
      bin_count: part.binCount,
    } : null,
    quantity: claim.quantity,
    description: claim.description ?? '',
    photos: photos.map((p) => ({ index: p.index, content_type: p.content_type, bytes: p.bytes })),
    started_at: claim.createdAt.toISOString(),
    confirm_by: claim.confirmBy ? claim.confirmBy.toISOString() : null,
    confirmed_at: claim.confirmedAt ? claim.confirmedAt.toISOString() : null,
    ruling: ruling ? {
      inside: ruling.inside,
      edition: ruling.editionCode,
      cover_ends_at: ruling.coverEndsAt.toISOString(),
      cover_ends_on: ruling.coverEndsOn,
      term_months: ruling.termMonths,
      decided_at: ruling.decidedAt.toISOString(),
    } : null,
    quotes: quotes.map((q) => ({
      revision: q.revision,
      status: q.status,
      source: q.source,
      part_line_minor: q.partLineMinor,
      carriage_minor: q.carriageMinor,
      total_minor: q.totalMinor,
      band: q.band,
      carriage_valid_until: q.carriageValidUntil ? q.carriageValidUntil.toISOString() : null,
      promise: { kind: q.promiseKind, date: q.promiseDate },
      quoted_at: q.quotedAt.toISOString(),
    })),
    payment: payment ? { paid_minor: payment.paidMinor, paid_at: payment.paidAt.toISOString() } : null,
    decline: decline ? {
      reason: decline.reason,
      charged_minor: decline.chargedMinor,
      refunded_minor: decline.refundedMinor,
    } : null,
    dispatched_at: claim.dispatchedAt ? claim.dispatchedAt.toISOString() : null,
    closed_at: claim.closedAt ? claim.closedAt.toISOString() : null,
    share_link: {
      url: share !== null ? `/s/${share.token}` : (lastShare !== null ? `/s/${lastShare.token}` : ''),
      state: shareState,
    },
    notices_pending: noticesPending,
  };
}
