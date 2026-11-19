import { AUDIENCE_PLURALS, audienceOf } from '../../shared/labels.js';
import type { Badge, GrantStatus } from '../../shared/types.js';
import { endOfDay, formatDisplayDate, startOfDay } from '../time.js';
import type { Card } from './cards.js';
import type { GrantRecord, LicenceRecord, Viewer } from './records.js';

export interface AvailabilityInput {
  now: Date;
  viewer: Viewer;
  card: Card;
  licence: LicenceRecord;
  successorName: string | null;
  /** Every grant held by the viewer, directly or through a group. */
  viewerGrants: GrantRecord[];
  /** The viewer's own open request on this card, if any. */
  openRequestId: string | null;
}

export interface AvailabilityDecision {
  badge: Badge;
  reason: string | null;
  canRequest: boolean;
  requestReason: string | null;
  openRequestId: string | null;
  grant: GrantRecord | null;
  implicitGrant: boolean;
}

/** The stored status, with expiry derived from the app clock. */
export function effectiveGrantStatus(grant: GrantRecord, now: Date): GrantStatus {
  if (grant.status === 'active' || grant.status === 'pending_proof') {
    if (now.getTime() > endOfDay(grant.notAfter).getTime()) return 'expired';
  }
  return grant.status;
}

export function grantCoversCard(grant: GrantRecord, card: Card): boolean {
  return grant.assetId === card.assetId && grant.variantId === card.variantId;
}

export function grantIsOpen(grant: GrantRecord, now: Date): boolean {
  if (effectiveGrantStatus(grant, now) !== 'active') return false;
  if (grant.notBefore === null) return false;
  return now.getTime() >= startOfDay(grant.notBefore).getTime();
}

export function engagementEnded(viewer: Viewer, now: Date): boolean {
  if (viewer.principal.role !== 'agency') return false;
  const endsOn = viewer.organisation.engagementEndsOn;
  if (endsOn === null) return false;
  return now.getTime() > endOfDay(endsOn).getTime();
}

/** The one availability decision: every library read, link issue and link use runs this. */
export function decideAvailability(input: AvailabilityInput): AvailabilityDecision {
  const { now, viewer, card, licence } = input;
  const audience = audienceOf(viewer.principal.role);
  const cardGrants = input.viewerGrants.filter((grant) => grantCoversCard(grant, card));

  const openRequestId = input.openRequestId;

  if (card.asset.state === 'retired') {
    return {
      badge: 'Retired',
      reason: `Retired. Use ${input.successorName ?? 'another asset'} instead.`,
      canRequest: false,
      requestReason: null,
      openRequestId,
      grant: null,
      implicitGrant: false,
    };
  }

  if (card.asset.state === 'restricted') {
    return {
      badge: 'Restricted',
      reason: 'Restricted by the brand team.',
      canRequest: false,
      requestReason: null,
      openRequestId,
      grant: null,
      implicitGrant: false,
    };
  }

  const denial = explicitDeny(input, audience);
  if (denial) {
    return {
      badge: 'Restricted',
      reason: denial,
      canRequest: false,
      requestReason: null,
      openRequestId,
      grant: null,
      implicitGrant: false,
    };
  }

  const covering = cardGrants.find((grant) => grantIsOpen(grant, now));
  if (covering) {
    return {
      badge: 'Available',
      reason: null,
      canRequest: false,
      requestReason: null,
      openRequestId,
      grant: covering,
      implicitGrant: false,
    };
  }

  if (audience === 'employee' && licence.audiences.includes('employee')) {
    return {
      badge: 'Available',
      reason: null,
      canRequest: false,
      requestReason: null,
      openRequestId,
      grant: null,
      implicitGrant: true,
    };
  }

  const pendingProof = cardGrants.find((grant) => effectiveGrantStatus(grant, now) === 'pending_proof');

  if (viewer.principal.role === 'agency') {
    const requestReason = openRequestId
      ? `You already have ${openRequestId} open.`
      : pendingProof
        ? `Upload your proof for ${pendingProof.id} first.`
        : null;
    return {
      badge: 'Request required',
      reason: 'Request use to download.',
      canRequest: requestReason === null,
      requestReason,
      openRequestId,
      grant: pendingProof ?? null,
      implicitGrant: false,
    };
  }

  return {
    badge: 'Restricted',
    reason: `Not licensed for ${AUDIENCE_PLURALS[audience]}.`,
    canRequest: false,
    requestReason: null,
    openRequestId,
    grant: pendingProof ?? null,
    implicitGrant: false,
  };
}

function explicitDeny(input: AvailabilityInput, audience: 'employee' | 'agency' | 'press'): string | null {
  if (!input.licence.audiences.includes(audience)) {
    return `Not licensed for ${AUDIENCE_PLURALS[audience]}.`;
  }
  if (input.licence.excludedTerritories.includes(input.viewer.organisation.territory)) {
    return `Not licensed in ${input.viewer.organisation.territory}.`;
  }
  if (engagementEnded(input.viewer, input.now)) {
    return `Your engagement ended on ${formatDisplayDate(input.viewer.organisation.engagementEndsOn!)}.`;
  }
  return null;
}
