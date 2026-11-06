/** Every published string, in one place, shared by the server and the screens. */

export const ERROR_COPY = {
  unauthenticated: 'Sign in to continue.',
  session_ended: 'Your session ended. Sign in again to continue. What you typed is kept.',
  access_removed: 'Your access to this workspace was removed.',
  bad_partner_key: 'This partner key is not valid.',
  bad_signature: 'The message signature could not be verified.',
  forbidden: "Your role can't do this.",
  not_found: 'Not found.',
  method_not_allowed: 'Method not allowed.',
  too_large: 'The request is too large.',
  unsupported_media_type: "This content type isn't accepted here.",
  bad_json: "The request body isn't valid JSON.",
  invalid: 'Check the highlighted fields.',
  storage_unreachable: 'Storage is unreachable. Nothing was saved. Try again in a few minutes.',
  invoicing_unreachable:
    'Invoicing is unreachable. The month was not closed and nothing was sent. Try again in a few minutes.',
  sign_in_failed: 'Email or password is incorrect.',
  listing_withdrawn: 'This exchange has withdrawn its listing.',
  request_page_ended: 'This data request page has ended. Ask the requesting exchange for a new one.',
  original_erased: 'This original was erased under the retention rule.',
  counterparty_blocked: 'This counterparty is Blocked. The withdrawal was not created.',
  release_not_allowed: "This withdrawal can't be released yet.",
  case_closed: 'This case is already closed.',
  reason_not_needed: 'A reason is needed only after No response.',
  ownership_not_pending: 'Ownership is not pending on this case.',
  request_page_not_open: 'This case has no open data request.',
  claim_not_held: 'Claim this case before deciding.',
  lei_taken: 'A counterparty with this LEI already exists.',
  name_taken: 'A counterparty with this legal name already exists.',
  address_taken: 'An address is already in the address registry.',
  email_taken: 'This email already belongs to a member.',
  own_membership: "You can't change or remove your own membership.",
  message_id_reused: 'This message id was already received with different content.',
  answer_not_expected: 'This case is not waiting for your answer.',
  already_answered: 'This page has already been answered.',
  file_too_large: 'The certificate is larger than 5,000,000 bytes.',
  unsupported_file: 'Attach a PNG, JPEG or WebP image.',
  bad_form: 'The form could not be read.',
  request_key_reused: 'This request key was already used with a different body.',
  case_not_closed: 'Only a closed case can be archived.',
  case_not_archived: 'Only an archived case can be brought back.',
  key_revoked: 'This key is already revoked.',
} as const;

export function rateLimitedCopy(seconds: number): string {
  return `Too many requests. Try again in ${seconds} seconds.`;
}

export function alreadyClaimedCopy(memberName: string, dateTime: string): string {
  return `Claimed by ${memberName} at ${dateTime}.`;
}

export function alreadyDecidedCopy(memberName: string, dateTime: string): string {
  return `Already decided by ${memberName} at ${dateTime}.`;
}

export function claimLapsedCopy(dateTime: string): string {
  return `Your claim lapsed at ${dateTime}.`;
}

export function claimedCopy(dateTime: string): string {
  return `Claimed. Your claim lasts until ${dateTime}.`;
}

export function changeExistsCopy(jurisdictionName: string, date: string): string {
  return `A change for ${jurisdictionName} on ${date} is already announced.`;
}

export function monthClosedCopy(monthLabel: string): string {
  return `${monthLabel} is already closed.`;
}

export function monthNotEndedCopy(monthLabel: string): string {
  return `${monthLabel} has not ended yet.`;
}

export function monthEmptyCopy(monthLabel: string): string {
  return `${monthLabel} has no messages to bill.`;
}

export const FIELD_COPY = {
  amount: (decimals: number): string =>
    `Enter an amount greater than zero with at most ${decimals} decimals.`,
  amountString: 'Send the amount as a string.',
  address: 'Each address must be lnl1 followed by 30 lower-case letters or digits.',
  customerId: 'Choose a customer.',
  beneficiaryName: "Enter the beneficiary's name.",
  legalName: 'Enter the legal name.',
  lei: 'Enter a 20-character LEI whose check digits are valid.',
  leiUnchangeable: "The LEI can't be changed.",
  jurisdictionCode: 'Choose a jurisdiction.',
  notes: 'Notes can be at most 2,000 characters.',
  contactEmail: "Enter the compliance contact's email.",
  takesEffectOn: 'Choose today or a later date.',
  reason: 'Enter a reason.',
  month: 'Choose a month that has started.',
  requestKey: 'Send a Request-Key header.',
  certificate: 'Attach the licence certificate.',
  depositAddress: 'No customer holds this deposit address.',
  caseReference: 'No case with this reference was sent to you.',
  check: 'Check this field.',
} as const;

export const PENDING_COPY = {
  signIn: 'Signing in…',
  createCase: 'Creating case…',
  release: 'Releasing…',
  returnWithdrawal: 'Returning…',
  recordReason: 'Saving reason…',
  recordOwnership: 'Saving…',
  sendRequestPage: 'Sending…',
  endRequestPage: 'Ending…',
  claim: 'Claiming…',
  saveDecision: 'Saving decision…',
  addCounterparty: 'Saving…',
  saveChanges: 'Saving…',
  previewImport: 'Reading file…',
  saveImport: 'Saving import…',
  announceChange: 'Announcing…',
  closeMonth: 'Closing month…',
  downloadFile: 'Preparing file…',
  archive: 'Saving…',
  createKey: 'Creating…',
  revokeKey: 'Revoking…',
  listing: 'Saving…',
  addMember: 'Saving…',
  sendAnswer: 'Sending answer…',
} as const;

export const SUCCESS_COPY = {
  release: 'Released. The withdrawal can leave.',
  returnWithdrawal: "Returned to the customer's balance.",
  recordReason: 'Reason recorded. The operations lead can now release this withdrawal.',
  recordOwnership: 'Ownership confirmed.',
  endRequestPage: 'Request page ended.',
  addCounterparty: 'Counterparty added.',
  saveChanges: 'Changes saved.',
  archive: 'Case archived.',
  restore: 'Case brought back.',
  createKey: "Key created. Copy it now: it won't be shown again.",
  revokeKey: 'Key revoked.',
  withdrawListing: 'Listing withdrawn.',
  listAgain: 'Listed again.',
  addMember: 'Member added.',
  sendAnswer: 'Answer sent. Thank you.',
} as const;

export function caseCreatedCopy(reference: string): string {
  return `Case ${reference} created.`;
}

export function noResponseCopy(dateTime: string): string {
  return `No response. The answer period ended at ${dateTime}.`;
}

export function requestPageSentCopy(contactEmail: string): string {
  return `New request page sent to ${contactEmail}.`;
}

export function decisionSavedCopy(decision: 'accept' | 'reject'): string {
  return `Decision saved: ${decision === 'accept' ? 'Accepted' : 'Rejected'}.`;
}

export function previewReadCopy(rows: number, matched: number, added: number, refused: number): string {
  return `${rows} rows read: ${matched} matched, ${added} new, ${refused} refused.`;
}

export function importSavedCopy(created: number, updated: number, unchanged: number): string {
  return `Import saved: ${created} created, ${updated} updated, ${unchanged} unchanged.`;
}

export function changeAnnouncedCopy(jurisdictionName: string, date: string): string {
  return `Change announced for ${jurisdictionName} from ${date}.`;
}

export function monthInvoicedCopy(monthLabel: string): string {
  return `${monthLabel} closed. Invoice received.`;
}

export function fileDownloadedCopy(fileName: string): string {
  return `File downloaded: ${fileName}.`;
}

export const CASE_STATUS_TEXT: Readonly<Record<string, string>> = {
  awaiting_ownership: 'Ownership pending',
  in_review: 'In review',
  awaiting_answer: 'Waiting for answer',
  accepted: 'Accepted',
  rejected: 'Rejected',
  no_response: 'No response',
  cleared: 'Ready to release',
  released: 'Released',
  returned: 'Returned',
};

export const STATE_COPY = {
  retentionScheduled: (dateTime: string): string => `Personal data is kept until ${dateTime}.`,
  retentionPending: 'Erasing personal data. Waiting for storage to confirm.',
  retentionErased: (dateTime: string): string => `Personal data erased on ${dateTime}.`,
  retentionArchived: (dateTime: string): string => `Archived on ${dateTime}.`,
  requestPageLive: (countdown: string): string => `This page ends in ${countdown}.`,
  requestPageAnswered: 'Answer received. Thank you.',
  requestPageEnded: 'This data request page has ended. Ask the requesting exchange for a new one.',
  caseRequestPageLive: (dateTime: string): string => `Request page live until ${dateTime}.`,
  caseRequestPageEnded: (dateTime: string): string => `Request page ended at ${dateTime}.`,
  nameCheck: (result: string): string =>
    `Name check: ${result === 'match' ? 'Match' : result === 'partial' ? 'Partial' : 'No match'}`,
  monthOpen: 'Open',
  monthReady: 'Ready to close',
  monthInvoiced: 'Invoiced',
  filesIdle: 'Choose a month and download its file.',
  filesEmpty: (monthLabel: string): string =>
    `No transfers in ${monthLabel}. The file has a header row only.`,
  dailyEmpty: (date: string): string => `No transfers on ${date}.`,
  listingListed: 'Listed in the public directory.',
  listingNotListed: 'Not listed.',
  listingWithdrawn: 'This exchange has withdrawn its listing.',
  unknownPage: "We couldn't find that page.",
  emptyTable: 'Nothing here yet.',
  answerCountdown: (countdown: string): string => `Answer due in ${countdown}`,
  claimCountdown: (countdown: string): string => `Claim ends in ${countdown}`,
  notesCounter: (count: number): string => `${count.toLocaleString('en-GB')} of 2,000`,
} as const;

export function directoryStatusCopy(count: number): string {
  return count === 1 ? '1 exchange matches' : `${count} exchanges match`;
}
