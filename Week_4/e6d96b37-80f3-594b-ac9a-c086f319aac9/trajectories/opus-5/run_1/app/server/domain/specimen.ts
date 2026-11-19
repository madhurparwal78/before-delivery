import type { Attribution, Specimen, SpecimenStatus } from '../../shared/types.ts';

/**
 * The specimen lifecycle and eligibility, decided here and nowhere else.
 *
 *   intake -> pending_catalogue -> attributed | quarantined -> shelved
 *          -> reserved -> outbound -> transferred
 *
 * Any non-transferred specimen becomes `missing` when an audit marks it missing.
 */

export interface SpecimenFacts {
  attribution: Attribution;
  quarantined: boolean;
  missing: boolean;
  shelved: boolean;
  reservedOrHeld: boolean;
  outbound: boolean;
  transferred: boolean;
}

/** The single derivation of a specimen's status from the facts about it. */
export function statusOf(facts: SpecimenFacts): SpecimenStatus {
  if (facts.transferred) return 'transferred';
  if (facts.missing) return 'missing';
  if (facts.outbound) return 'outbound';
  if (facts.reservedOrHeld) return 'reserved';
  if (facts.quarantined) return 'quarantined';
  if (facts.attribution.register === 'pending') return 'pending_catalogue';
  if (facts.shelved) return 'shelved';
  return 'attributed';
}

/**
 * Eligibility for an album hole or an offer: a stored register record, certain
 * attribution, not quarantined, not missing, and not reserved, held or
 * outbound.
 */
export function isEligible(specimen: Specimen): boolean {
  return (
    specimen.attribution.register === 'stored' &&
    specimen.attribution.certainty === 'certain' &&
    !specimen.quarantined &&
    !specimen.missing &&
    specimen.status !== 'reserved' &&
    specimen.status !== 'outbound' &&
    specimen.status !== 'transferred'
  );
}

/** Reasons a specimen cannot be used, in the published 409 order. */
export type IneligibleReason =
  | 'in_offer'
  | 'quarantined'
  | 'outbound'
  | 'catalogue_pending'
  | null;

/** Why a specimen cannot fill an album hole, in the published order. */
export function albumIneligibility(specimen: Specimen): IneligibleReason {
  if (specimen.quarantined) return 'quarantined';
  if (
    specimen.status === 'reserved' ||
    specimen.status === 'outbound' ||
    specimen.status === 'transferred' ||
    specimen.missing
  ) {
    return 'outbound';
  }
  if (specimen.attribution.register === 'pending') return 'catalogue_pending';
  return null;
}

/** Why a specimen cannot join an offer basket, in the published order. */
export function offerIneligibility(specimen: Specimen): IneligibleReason {
  if (specimen.status === 'reserved' || specimen.status === 'outbound') return 'in_offer';
  if (specimen.attribution.register === 'pending') return 'catalogue_pending';
  if (specimen.quarantined || specimen.missing || specimen.status === 'transferred') {
    return 'in_offer';
  }
  if (specimen.attribution.certainty !== 'certain') return 'in_offer';
  return null;
}

/** Quarantining a reserved or outbound specimen is refused. */
export function canQuarantine(specimen: Specimen): boolean {
  return specimen.status !== 'reserved' && specimen.status !== 'outbound';
}

export const displayLabelFor = (reference: string): string => `Specimen ${reference}`;
