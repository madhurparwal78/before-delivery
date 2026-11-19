export const ENQUIRY_STATUSES = [
  'new',
  'qualified',
  'proposal_sent',
  'accepted',
  'deposit_paid',
  'booked',
  'declined',
  'expired',
] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

export const ENQUIRY_STATUS_LABELS: Record<EnquiryStatus, string> = {
  new: 'New',
  qualified: 'Qualified',
  proposal_sent: 'Proposal sent',
  accepted: 'Accepted',
  deposit_paid: 'Deposit paid',
  booked: 'Booked',
  declined: 'Declined',
  expired: 'Expired',
};

const LEGAL_MOVES: Record<EnquiryStatus, readonly EnquiryStatus[]> = {
  new: ['qualified', 'declined'],
  qualified: ['proposal_sent', 'declined'],
  proposal_sent: ['accepted', 'expired', 'declined'],
  accepted: ['deposit_paid'],
  deposit_paid: ['booked'],
  booked: [],
  declined: [],
  expired: [],
};

export function isLegalEnquiryMove(from: EnquiryStatus, to: EnquiryStatus): boolean {
  return LEGAL_MOVES[from].includes(to);
}

/** The statuses whose proposal holds a place in its production month. */
export const CLAIMING_STATUSES = ['accepted', 'deposit_paid', 'booked'] as const;

/**
 * Read-time status: a stored `proposal_sent` enquiry whose accept link has passed its
 * expiry instant reads as `expired` everywhere.
 */
export function readTimeStatus(
  stored: EnquiryStatus,
  proposalExpiresAt: Date | null,
  now: Date,
): EnquiryStatus {
  if (stored === 'proposal_sent' && proposalExpiresAt !== null && proposalExpiresAt.getTime() <= now.getTime()) {
    return 'expired';
  }
  return stored;
}

/** The same rule as SQL. `e` is the enquiries alias and `pr` the proposals alias. */
export const READ_TIME_STATUS_SQL = `(CASE
    WHEN e.status = 'proposal_sent' AND pr.expires_at IS NOT NULL AND pr.expires_at <= now()
      THEN 'expired'
    ELSE e.status
  END)`;
